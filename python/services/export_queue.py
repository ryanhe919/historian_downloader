"""Single-worker async export queue with pause/resume/cancel + SQLite persistence."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Awaitable, Callable

from adapters.base import BaseHistorianAdapter
from adapters.factory import create_adapter
from rpc import errors
from services import writers
from services.estimator import estimate_rows, estimate_size_bytes
from services.segmenter import Segment, split_segments
from storage.db import Storage, public_task_view
from util.time import iso_now, parse_iso

log = logging.getLogger(__name__)


EmitFn = Callable[[str, dict], Awaitable[None]]
AdapterFactory = Callable[[dict], BaseHistorianAdapter]


class _TaskControls:
    """Per-task runtime controls — not persisted, recreated on resume."""

    def __init__(self) -> None:
        self.pause_event = asyncio.Event()
        self.pause_event.set()  # initially "running" (not paused)
        self.cancel_flag = False


class ExportQueue:
    """Single-worker queue. One task processed at a time to avoid COM/OLE races.

    Public API (async):
      - enqueue(task) — task is already persisted in SQLite; this just wakes the worker.
      - pause(task_id), resume(task_id), cancel(task_id)
      - start() / stop()
    """

    PROGRESS_INTERVAL_S = 0.5

    def __init__(
        self,
        storage: Storage,
        emit: EmitFn,
        *,
        server_provider: Callable[[str], dict | None] | None = None,
        adapter_factory: AdapterFactory | None = None,
    ) -> None:
        self._storage = storage
        self._emit = emit
        self._adapter_factory = adapter_factory or create_adapter
        self._server_provider = server_provider or storage.get_server
        self._wakeup = asyncio.Event()
        self._controls: dict[str, _TaskControls] = {}
        self._current_task_id: str | None = None
        self._worker: asyncio.Task | None = None
        self._stopping = False

    # ---------- lifecycle ----------

    def start(self) -> None:
        if self._worker is None:
            self._worker = asyncio.create_task(
                self._run_forever(), name="export-worker"
            )
            log.info("export queue worker started")

    async def stop(self) -> None:
        self._stopping = True
        self._wakeup.set()
        if self._worker:
            self._worker.cancel()
            try:
                await self._worker
            except (asyncio.CancelledError, Exception):
                pass
            self._worker = None

    # ---------- external controls ----------

    async def enqueue(self, task_id: str) -> None:
        self._wakeup.set()

    async def pause(self, task_id: str) -> dict:
        task = self._storage.get_task(task_id)
        if task is None:
            raise errors.ExportNotFound(task_id)
        if task["status"] in ("done", "cancelled", "failed"):
            raise errors.ExportAlreadyRunning()  # closest match — cannot pause finished task
        ctl = self._controls.setdefault(task_id, _TaskControls())
        ctl.pause_event.clear()
        self._storage.update_task(task_id, status="paused")
        updated = self._storage.get_task(task_id)
        await self._emit("historian.export.statusChanged", {"task": public_task_view(updated)})  # type: ignore[arg-type]
        return updated  # type: ignore[return-value]

    async def resume(self, task_id: str) -> dict:
        task = self._storage.get_task(task_id)
        if task is None:
            raise errors.ExportNotFound(task_id)
        if task["status"] == "done":
            raise errors.ExportAlreadyRunning()
        ctl = self._controls.setdefault(task_id, _TaskControls())
        ctl.pause_event.set()
        # If it was paused we switch back to queued so the worker picks it up.
        if task["status"] == "paused":
            self._storage.update_task(task_id, status="queued")
            self._wakeup.set()
        updated = self._storage.get_task(task_id)
        await self._emit("historian.export.statusChanged", {"task": public_task_view(updated)})  # type: ignore[arg-type]
        return updated  # type: ignore[return-value]

    async def cancel(self, task_id: str) -> dict:
        task = self._storage.get_task(task_id)
        if task is None:
            raise errors.ExportNotFound(task_id)
        if task["status"] in ("done", "cancelled"):
            return task
        ctl = self._controls.setdefault(task_id, _TaskControls())
        ctl.cancel_flag = True
        ctl.pause_event.set()  # unblock the pause-wait so cancellation can be seen
        if task["status"] == "queued":
            # Not running — mark directly.
            self._storage.update_task(task_id, status="cancelled")
        self._wakeup.set()
        updated = self._storage.get_task(task_id)
        await self._emit("historian.export.statusChanged", {"task": public_task_view(updated)})  # type: ignore[arg-type]
        return updated  # type: ignore[return-value]

    # ---------- worker loop ----------

    async def _run_forever(self) -> None:
        try:
            while not self._stopping:
                task = self._pick_next_task()
                if task is None:
                    self._wakeup.clear()
                    try:
                        await asyncio.wait_for(self._wakeup.wait(), timeout=1.0)
                    except asyncio.TimeoutError:
                        pass
                    continue
                await self._run_one(task)
        except asyncio.CancelledError:
            log.info("export worker cancelled")
            raise

    def _pick_next_task(self) -> dict | None:
        tasks = self._storage.list_tasks(statuses=["queued"])
        return tasks[0] if tasks else None

    async def _run_one(self, task: dict) -> None:
        task_id = task["id"]
        self._current_task_id = task_id
        ctl = self._controls.setdefault(task_id, _TaskControls())

        try:
            start = parse_iso(task["range"]["start"])
            end = parse_iso(task["range"]["end"])
            segments = split_segments(start, end, int(task["segmentDays"]))
        except ValueError as e:
            log.error("task %s has invalid range: %s", task_id, e)
            self._storage.update_task(task_id, status="failed", error=str(e))
            await self._emit(
                "historian.export.statusChanged",
                {"task": public_task_view(self._storage.get_task(task_id) or {})},
            )
            return

        tag_ids: list[str] = task["tagIds"]
        fmt: str = task["format"]
        options = task.get("options") or {}
        include_quality = bool(options.get("includeQuality"))
        utf8_bom = bool(options.get("utf8Bom"))

        # Resolve server + adapter. Keep ``adapter`` initialised to None so
        # the ``finally: await adapter.close()`` below can short-circuit if
        # the factory raises (network filesystem access, missing DSN, etc.).
        adapter: BaseHistorianAdapter | None = None
        output_dir = Path(task["outputDir"])
        loop = asyncio.get_running_loop()
        try:
            # ensure_output_dir touches the filesystem (mkdir, probe write);
            # network drives can take seconds — run in executor so the
            # transport loop stays responsive.
            await loop.run_in_executor(None, writers.ensure_output_dir, output_dir)
        except errors.OutputDirUnwritable as e:
            log.error("output dir not writable: %s", e.message)
            self._storage.update_task(task_id, status="failed", error=e.message)
            await self._emit(
                "historian.export.statusChanged",
                {"task": public_task_view(self._storage.get_task(task_id) or {})},
            )
            return

        server = self._server_provider(task["serverId"]) or {
            "id": task["serverId"],
            "type": "mock",
        }
        try:
            adapter = self._adapter_factory(server)
        except Exception as e:
            log.exception("adapter factory failed for task %s", task_id)
            self._storage.update_task(task_id, status="failed", error=str(e))
            await self._emit(
                "historian.export.statusChanged",
                {"task": public_task_view(self._storage.get_task(task_id) or {})},
            )
            return

        ext = writers.extension_for(fmt)
        output_path = output_dir / f"{task['name']}.{ext}"
        self._storage.update_task(
            task_id,
            status="running",
            totalSegments=len(segments),
            outputPath=str(output_path),
        )
        est_rows = estimate_rows(start, end, task["sampling"])
        est_size = estimate_size_bytes(est_rows, len(tag_ids), fmt, include_quality)
        started = time.monotonic()
        total_rows_written = 0
        total_bytes = 0
        last_progress_emit = 0.0

        await self._emit(
            "historian.export.statusChanged",
            {"task": public_task_view(self._storage.get_task(task_id) or {})},
        )

        # Excel is emitted as a single-shot write at the end (not append-friendly).
        excel_rows: list[dict] | None = [] if fmt == "Excel" else None
        header = writers.build_header(tag_ids, include_quality)

        try:
            for seg in segments:
                # Await resume if paused; abort if cancelled.
                await ctl.pause_event.wait()
                if ctl.cancel_flag:
                    raise errors.ExportCancelled()

                rows = await self._read_segment_rows(
                    adapter, tag_ids, seg, task["sampling"]
                )

                if fmt == "CSV":
                    stats = writers.write_csv_segment(
                        output_path,
                        rows,
                        header=header,
                        append=seg.index > 0,
                        include_quality=include_quality,
                        utf8_bom=utf8_bom,
                    )
                elif fmt == "JSON":
                    stats = writers.write_json_segment(
                        output_path,
                        rows,
                        append=seg.index > 0,
                        include_quality=include_quality,
                        utf8_bom=utf8_bom,
                    )
                elif fmt == "Excel":
                    excel_rows.extend(rows)  # type: ignore[union-attr]
                    stats = writers.WriteStats(rows=len(rows), bytes_appended=0)
                else:
                    raise errors.InvalidFormatError(fmt)

                total_rows_written += stats.rows
                total_bytes += stats.bytes_appended

                elapsed = max(0.001, time.monotonic() - started)
                speed = int(total_bytes / elapsed)
                progress = int((seg.index + 1) * 100 / max(1, len(segments)))

                self._storage.update_task(
                    task_id,
                    doneSegments=seg.index + 1,
                    progress=progress,
                    sizeBytes=total_bytes,
                    speedBytesPerSec=speed,
                    checkpoint=seg.end.isoformat(),
                )

                now = time.monotonic()
                if (
                    now - last_progress_emit >= self.PROGRESS_INTERVAL_S
                    or seg.index + 1 == len(segments)
                ):
                    await self._emit(
                        "historian.export.progress",
                        {
                            "taskId": task_id,
                            "progress": progress,
                            "doneSegments": seg.index + 1,
                            "totalSegments": len(segments),
                            "currentSegment": {
                                "index": seg.index,
                                "start": seg.start.isoformat().replace("+00:00", "Z"),
                                "end": seg.end.isoformat().replace("+00:00", "Z"),
                            },
                            "speedBytesPerSec": speed,
                            "sizeBytes": total_bytes,
                            "estimatedSizeBytes": est_size,
                            "rowsWritten": total_rows_written,
                        },
                    )
                    last_progress_emit = now

            # Finalize Excel.
            if fmt == "Excel" and excel_rows is not None:
                stats = writers.write_excel_whole(
                    output_path,
                    excel_rows,
                    header=header,
                    include_quality=include_quality,
                )
                total_bytes = stats.bytes_appended

            self._storage.update_task(
                task_id,
                status="done",
                progress=100,
                sizeBytes=total_bytes,
            )
            final = self._storage.get_task(task_id) or {}
            await self._emit(
                "historian.export.statusChanged", {"task": public_task_view(final)}
            )
            # Record history.
            self._storage.add_history(
                {
                    "taskId": task_id,
                    "name": task["name"],
                    "path": str(output_path),
                    "serverId": task["serverId"],
                    "tagCount": len(tag_ids),
                    "rows": total_rows_written,
                    "sizeBytes": total_bytes,
                    "range": task["range"],
                    "format": fmt,
                    "createdAt": iso_now(),
                }
            )

        except errors.ExportCancelled:
            log.info("task %s cancelled", task_id)
            self._storage.update_task(task_id, status="cancelled")
            await self._emit(
                "historian.export.statusChanged",
                {"task": public_task_view(self._storage.get_task(task_id) or {})},
            )
        except Exception as e:
            log.exception("task %s failed", task_id)
            self._storage.update_task(task_id, status="failed", error=str(e))
            await self._emit(
                "historian.export.statusChanged",
                {"task": public_task_view(self._storage.get_task(task_id) or {})},
            )
        finally:
            self._current_task_id = None
            if adapter is not None:
                try:
                    await adapter.close()
                except Exception:  # noqa: BLE001 — best effort cleanup
                    log.exception("adapter close failed for task %s", task_id)

    async def _read_segment_rows(
        self,
        adapter,
        tag_ids: list[str],
        seg: Segment,
        sampling: str,
    ) -> list[dict]:
        rows: list[dict] = []
        async for row in adapter.read_segment(tag_ids, seg.start, seg.end, sampling):
            rows.append(row)
        return rows
