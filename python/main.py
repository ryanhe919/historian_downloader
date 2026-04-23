"""Historian Downloader sidecar entry point.

Wires up logging → storage → dispatcher → transport and registers every
``historian.*`` method in ``docs/rpc-contract.md``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import signal
import sys
import uuid
from pathlib import Path
from typing import Any

# Make sibling packages importable when run directly (``python python/main.py``)
# or frozen by PyInstaller.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from adapters.factory import adapter_support, create_adapter
from rpc import errors
from rpc.dispatcher import Dispatcher
from rpc.transport import LineTransport, configure_stdout
from services.export_queue import ExportQueue
from services.writers import (
    build_header,
    ensure_output_dir,
    extension_for,
    resolve_output_dir,
    supports_excel,
    validate_format,
)
from services.segmenter import split_segments
from storage.db import Storage, public_task_view
from util.logging import configure_logging_to_stderr
from util.paths import default_output_dir, user_data_dir
from util.time import iso_now, parse_iso, sampling_seconds, validate_range

log = logging.getLogger("hd.sidecar")


# Version is injected at sidecar build/dev time from package.json via
# scripts/write-python-version.mjs → python/_generated_version.py. If the
# file is absent (fresh checkout, someone ran main.py directly without the
# npm script), fall back to an obviously-placeholder tag.
try:
    from _generated_version import VERSION  # type: ignore[import-not-found]
except ImportError:
    VERSION = "0.0.0+dev"


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def _ensure_dict(params: Any) -> dict:
    if isinstance(params, dict):
        return params
    if params is None:
        return {}
    raise errors.RpcError(errors.INVALID_PARAMS, "params must be an object")


def _require(params: dict, key: str, typ: type | tuple[type, ...] | None = None) -> Any:
    if key not in params:
        raise errors.RpcError(errors.INVALID_PARAMS, f"missing required param: {key}")
    val = params[key]
    if typ is not None and not isinstance(val, typ):
        raise errors.RpcError(errors.INVALID_PARAMS, f"param {key!r} has wrong type")
    return val


# ---------------------------------------------------------------------------
# Server helpers — look up a saved server record from SQLite.
# ---------------------------------------------------------------------------


def _lookup_server(storage: Storage, server_id: str) -> dict:
    """Return the SQLite-persisted server config, or raise ServerNotFound."""
    row = storage.get_server(server_id)
    if row is None:
        raise errors.ServerNotFound(server_id)
    return row


def _lookup_runtime_server(storage: Storage, server_id: str) -> dict:
    """Return a saved server enriched with runtime-only secrets."""
    row = storage.get_server_runtime(server_id)
    if row is None:
        raise errors.ServerNotFound(server_id)
    return row


def _resolve_runtime_server(storage: Storage, server: dict) -> dict:
    """Merge a transient server payload with any saved runtime secrets."""
    server_id = server.get("id")
    saved = _lookup_runtime_server(storage, server_id) if isinstance(server_id, str) else {}
    runtime = dict(saved)
    runtime.update(server)
    if not runtime.get("password") and isinstance(server_id, str):
        password = storage.get_server_password(server_id)
        if password is not None:
            runtime["password"] = password
    return runtime


# ---------------------------------------------------------------------------
# Method registration
# ---------------------------------------------------------------------------


def register_methods(
    dispatcher: Dispatcher, storage: Storage, queue: ExportQueue
) -> None:

    # ---- system.* ----

    @dispatcher.method("system.ping")
    async def _system_ping(_params):
        # Notification (no id) — no reply expected. Handler exists so unknown-method
        # warnings don't fire.
        return None

    # ---- historian.listServers ----

    @dispatcher.method("historian.listServers")
    async def _list_servers(_params):
        return storage.list_servers()

    # ---- historian.testConnection ----

    @dispatcher.method("historian.testConnection")
    async def _test_connection(params):
        params = _ensure_dict(params)
        server = _require(params, "server", dict)
        server_id = server.get("id")
        runtime_server = _resolve_runtime_server(storage, server)
        adapter = create_adapter(runtime_server)

        async def _emit_status(
            status: str, *, latency_ms=None, error: str | None = None
        ) -> None:
            if not server_id:
                return
            payload: dict = {"serverId": server_id, "status": status}
            if latency_ms is not None:
                payload["latencyMs"] = latency_ms
            if error is not None:
                payload["error"] = error
            await dispatcher.emit("historian.connection.statusChanged", payload)

        try:
            try:
                res = await adapter.test_connection()
            except Exception as exc:
                # Broadcast the failure so the renderer's live status goes
                # red immediately, then let the caller see the same error
                # as an RPC rejection.
                await _emit_status("offline", error=str(exc))
                raise
            finally:
                await adapter.close()
        except Exception:
            raise

        await _emit_status(
            "connected" if res.get("ok") else "offline",
            latency_ms=res.get("latencyMs"),
            error=None if res.get("ok") else res.get("detail"),
        )
        return res

    # ---- historian.saveServer ----

    @dispatcher.method("historian.saveServer")
    async def _save_server(params):
        params = _ensure_dict(params)
        server_in = _require(params, "server", dict)
        name = server_in.get("name")
        if not isinstance(name, str) or not name.strip():
            raise errors.InvalidRangeError("server.name is required")
        sid = params.get("id") or server_in.get("id")
        saved = storage.save_server(server_in, server_id=sid)
        return {"id": saved["id"], "server": saved}

    # ---- historian.deleteServer ----

    @dispatcher.method("historian.deleteServer")
    async def _delete_server(params):
        params = _ensure_dict(params)
        sid = _require(params, "id", str)
        storage.delete_server(sid)
        return {"ok": True}

    # ---- historian.listTagTree ----

    @dispatcher.method("historian.listTagTree")
    async def _list_tag_tree(params):
        params = _ensure_dict(params)
        sid = _require(params, "serverId", str)
        path = params.get("path")
        depth = int(params.get("depth") or 1)
        server = _lookup_runtime_server(storage, sid)
        adapter = create_adapter(server)
        try:
            return await adapter.list_tag_tree(path=path, depth=depth)
        finally:
            await adapter.close()

    # ---- historian.searchTags ----

    @dispatcher.method("historian.searchTags")
    async def _search_tags(params):
        params = _ensure_dict(params)
        sid = _require(params, "serverId", str)
        query = params.get("query") or ""
        limit = int(params.get("limit") or 100)
        offset = int(params.get("offset") or 0)
        filter_ = params.get("filter") or {}
        ftype = filter_.get("type")
        if ftype == "All":
            ftype = None
        server = _lookup_runtime_server(storage, sid)
        adapter = create_adapter(server)
        try:
            return await adapter.search_tags(
                query, limit=limit, offset=offset, filter_type=ftype
            )
        finally:
            await adapter.close()

    # ---- historian.getTagMeta ----

    @dispatcher.method("historian.getTagMeta")
    async def _get_tag_meta(params):
        params = _ensure_dict(params)
        sid = _require(params, "serverId", str)
        tag_id = _require(params, "tagId", str)
        server = _lookup_runtime_server(storage, sid)
        adapter = create_adapter(server)
        try:
            return await adapter.get_tag_meta(tag_id)
        finally:
            await adapter.close()

    # ---- historian.preview.sample ----

    @dispatcher.method("historian.preview.sample")
    async def _preview_sample(params):
        params = _ensure_dict(params)
        sid = _require(params, "serverId", str)
        tag_ids = _require(params, "tagIds", list)
        if len(tag_ids) > 10:
            raise errors.RpcError(
                errors.INVALID_PARAMS, "tagIds: max 10 tags for preview"
            )
        rng = _require(params, "range", dict)
        start = parse_iso(rng["start"])
        end = parse_iso(rng["end"])
        try:
            validate_range(start, end)
        except ValueError as e:
            raise errors.InvalidRangeError(str(e))
        sampling = _require(params, "sampling", str)
        try:
            sampling_seconds(sampling)
        except ValueError:
            raise errors.InvalidSamplingError(sampling)
        max_points = int(params.get("maxPoints") or 240)
        server = _lookup_runtime_server(storage, sid)
        adapter = create_adapter(server)
        try:
            return await adapter.preview_sample(
                tag_ids, start, end, sampling, max_points=max_points
            )
        finally:
            await adapter.close()

    # ---- historian.export.start ----

    @dispatcher.method("historian.export.start")
    async def _export_start(params):
        params = _ensure_dict(params)
        sid = _require(params, "serverId", str)
        tag_ids = _require(params, "tagIds", list)
        if not tag_ids:
            raise errors.InvalidRangeError("tagIds is empty")
        rng = _require(params, "range", dict)
        start = parse_iso(rng["start"])
        end = parse_iso(rng["end"])
        try:
            validate_range(start, end)
        except ValueError as e:
            raise errors.InvalidRangeError(str(e))
        sampling = _require(params, "sampling", str)
        try:
            sampling_seconds(sampling)
        except ValueError:
            raise errors.InvalidSamplingError(sampling)
        segment_days = int(_require(params, "segmentDays", int))
        if segment_days < 1 or segment_days > 30:
            raise errors.InvalidRangeError(f"segmentDays out of range: {segment_days}")
        fmt = _require(params, "format", str)
        validate_format(fmt)

        raw_output_dir = params.get("outputDir") or str(default_output_dir())
        # Expand ``~``/relatives BEFORE persisting so the task record carries
        # an absolute path — important since the Electron renderer may send a
        # POSIX tilde or a dev-relative path.
        resolved_output_dir = str(resolve_output_dir(raw_output_dir))
        ensure_output_dir(resolved_output_dir)
        output_dir = resolved_output_dir

        name = params.get("name") or f"export_{_timestamp_slug()}"

        total_segments = len(split_segments(start, end, segment_days))
        output_path = str(Path(output_dir) / f"{name}.{extension_for(fmt)}")

        task_in = {
            "id": uuid.uuid4().hex,
            "serverId": sid,
            "name": name,
            "tagIds": tag_ids,
            "range": {"start": rng["start"], "end": rng["end"]},
            "sampling": sampling,
            "segmentDays": segment_days,
            "format": fmt,
            "outputDir": output_dir,
            "outputPath": output_path,
            "status": "queued",
            "totalSegments": total_segments,
            "doneSegments": 0,
            "progress": 0,
            "options": params.get("options") or {},
        }
        task = storage.create_task(task_in)
        await queue.enqueue(task["id"])
        await dispatcher.emit(
            "historian.export.statusChanged", {"task": public_task_view(task)}
        )
        return {"taskId": task["id"], "task": public_task_view(task)}

    # ---- historian.export.pause / .resume / .cancel ----

    @dispatcher.method("historian.export.pause")
    async def _export_pause(params):
        params = _ensure_dict(params)
        tid = _require(params, "taskId", str)
        task = await queue.pause(tid)
        return {"ok": True, "task": public_task_view(task)}

    @dispatcher.method("historian.export.resume")
    async def _export_resume(params):
        params = _ensure_dict(params)
        tid = _require(params, "taskId", str)
        task = await queue.resume(tid)
        return {"ok": True, "task": public_task_view(task)}

    @dispatcher.method("historian.export.cancel")
    async def _export_cancel(params):
        params = _ensure_dict(params)
        tid = _require(params, "taskId", str)
        task = await queue.cancel(tid)
        return {"ok": True, "task": public_task_view(task)}

    # ---- historian.export.list ----

    @dispatcher.method("historian.export.list")
    async def _export_list(_params):
        return {"items": [public_task_view(t) for t in storage.list_tasks()]}

    # ---- historian.export.history ----

    @dispatcher.method("historian.export.history")
    async def _export_history(params):
        params = _ensure_dict(params)
        limit = int(params.get("limit") or 50)
        offset = int(params.get("offset") or 0)
        query = params.get("query")
        items, total = storage.list_history(limit=limit, offset=offset, query=query)
        for it in items:
            it["exists"] = Path(it["path"]).exists() if it.get("path") else False
        return {"items": items, "total": total}

    # ---- historian.export.remove ----

    @dispatcher.method("historian.export.remove")
    async def _export_remove(params):
        params = _ensure_dict(params)
        hid = _require(params, "historyId", str)
        item = storage.get_history(hid)
        if item is None:
            raise errors.ExportNotFound(hid)
        delete_file = bool(params.get("deleteFile"))
        if delete_file and item.get("path"):
            try:
                Path(item["path"]).unlink()
            except FileNotFoundError:
                pass
            except OSError as e:
                log.warning("failed to delete history file %s: %s", item["path"], e)
        storage.remove_history(hid)
        return {"ok": True}

    # ---- historian.export.openInFolder ----

    @dispatcher.method("historian.export.openInFolder")
    async def _export_open_in_folder(params):
        params = _ensure_dict(params)
        hid = _require(params, "historyId", str)
        item = storage.get_history(hid)
        if item is None:
            raise errors.ExportNotFound(hid)
        return {"ok": True, "path": item.get("path") or ""}


def _timestamp_slug() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def _seed_mock_servers_if_requested(storage: Storage) -> None:
    """Dev-mode convenience: when ``HD_FORCE_MOCK=1`` AND the DB has no saved
    servers yet, populate it with the bundled ``MOCK_SERVERS`` so first-time
    launches show something to click. Production (no env var) never seeds.

    Re-seeds are guarded by the "empty DB" check only — if a dev deletes a
    mock server it stays deleted until the DB is wiped.
    """
    if os.environ.get("HD_FORCE_MOCK") != "1":
        return
    if storage.list_servers():
        return
    # Local import keeps the production import graph free of mock data.
    from adapters.mock import MOCK_SERVERS

    for s in MOCK_SERVERS:
        storage.save_server(s, server_id=s["id"])
    log.info("HD_FORCE_MOCK=1: seeded %d mock servers into empty DB", len(MOCK_SERVERS))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def amain() -> int:
    configure_logging_to_stderr()
    configure_stdout()
    log.info(
        "Historian Downloader sidecar v%s starting (py=%s, platform=%s)",
        VERSION,
        platform.python_version(),
        sys.platform,
    )

    udir = user_data_dir()
    storage = Storage(udir / "hd.sqlite3")
    _seed_mock_servers_if_requested(storage)
    dispatcher = Dispatcher()

    transport_holder: dict[str, LineTransport | None] = {"t": None}

    async def emit(method: str, params: dict) -> None:
        t = transport_holder["t"]
        if t is None:
            return
        await t.write({"jsonrpc": "2.0", "method": method, "params": params or {}})

    dispatcher.set_emit(emit)

    queue = ExportQueue(storage, emit)
    register_methods(dispatcher, storage, queue)
    queue.start()

    transport = LineTransport(dispatcher.handle)
    transport_holder["t"] = transport

    # Announce readiness.
    await emit(
        "system.ready",
        {
            "version": VERSION,
            "pythonVersion": platform.python_version(),
            "platform": sys.platform,
            "adapters": adapter_support(),
            "userDataDir": str(udir),
        },
    )

    # Hook SIGTERM for graceful shutdown on POSIX.
    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _request_stop():
        log.info("received signal; stopping sidecar")
        stop_event.set()
        transport.stop()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except (
            NotImplementedError,
            RuntimeError,
        ):  # pragma: no cover — Windows / non-main thread
            pass

    transport_task = asyncio.create_task(transport.run(), name="rpc-transport")
    stop_task = asyncio.create_task(stop_event.wait(), name="stop-event")

    done, pending = await asyncio.wait(
        {transport_task, stop_task}, return_when=asyncio.FIRST_COMPLETED
    )
    for p in pending:
        p.cancel()
    await queue.stop()
    storage.close()
    log.info("sidecar exited")
    return 0


def main() -> None:
    # Keep the platform-default event loop. On Windows 3.8+ that is
    # ProactorEventLoop, which actually supports ``connect_read_pipe`` on
    # the stdin HANDLE a PIPE-spawned subprocess inherits — WindowsSelector
    # is the one that raises NotImplementedError for pipe streams. Earlier
    # revisions got this backwards and forced Selector here, which made the
    # transport loop fail to initialise and broke the packaged Windows
    # build entirely.
    try:
        raise SystemExit(asyncio.run(amain()))
    except KeyboardInterrupt:
        raise SystemExit(0)


if __name__ == "__main__":
    main()
