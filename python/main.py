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
from adapters.mock import MOCK_SERVERS
from rpc import errors
from rpc.dispatcher import Dispatcher
from rpc.transport import LineTransport, configure_stdout
from services.export_queue import ExportQueue
from services.writers import (
    build_header,
    ensure_output_dir,
    extension_for,
    supports_excel,
    validate_format,
)
from services.segmenter import split_segments
from storage.db import Storage, public_task_view
from util.logging import configure_logging_to_stderr
from util.paths import default_output_dir, user_data_dir
from util.time import iso_now, parse_iso, sampling_seconds, validate_range


log = logging.getLogger("hd.sidecar")


VERSION = "0.1.0"


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
# Server helpers — mock servers + DB-saved servers appear together.
# ---------------------------------------------------------------------------


def _mock_server_as_server_td(s: dict) -> dict:
    return {
        "id": s["id"],
        "name": s["name"],
        "type": s["type"],
        "host": s["host"],
        "hasPassword": False,
        "timeoutS": 15,
        "tls": False,
        "windowsAuth": False,
        "status": "ready",
        "version": s.get("version"),
        "tagCount": s.get("tagCount"),
        "createdAt": "1970-01-01T00:00:00.000Z",
        "updatedAt": "1970-01-01T00:00:00.000Z",
    }


def _resolve_server_config(storage: Storage, server_id: str) -> dict | None:
    """Return a dict suitable for ``create_adapter`` — checks DB first then mocks."""
    if server_id in {s["id"] for s in MOCK_SERVERS}:
        return next(s for s in MOCK_SERVERS if s["id"] == server_id)
    return storage.get_server(server_id)


# ---------------------------------------------------------------------------
# Method registration
# ---------------------------------------------------------------------------


def register_methods(dispatcher: Dispatcher, storage: Storage, queue: ExportQueue) -> None:

    # ---- system.* ----

    @dispatcher.method("system.ping")
    async def _system_ping(_params):
        # Notification (no id) — no reply expected. Handler exists so unknown-method
        # warnings don't fire.
        return None

    # ---- historian.listServers ----

    @dispatcher.method("historian.listServers")
    async def _list_servers(_params):
        saved = storage.list_servers()
        saved_ids = {s["id"] for s in saved}
        mock_views = [_mock_server_as_server_td(s) for s in MOCK_SERVERS if s["id"] not in saved_ids]
        return saved + mock_views

    # ---- historian.testConnection ----

    @dispatcher.method("historian.testConnection")
    async def _test_connection(params):
        params = _ensure_dict(params)
        server = _require(params, "server", dict)
        adapter = create_adapter(server)
        try:
            res = await adapter.test_connection()
        finally:
            await adapter.close()

        server_id = server.get("id")
        if server_id:
            await dispatcher.emit(
                "historian.connection.statusChanged",
                {
                    "serverId": server_id,
                    "status": "connected" if res.get("ok") else "offline",
                    "latencyMs": res.get("latencyMs"),
                },
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
        server = _resolve_server_config(storage, sid)
        if server is None:
            raise errors.TagTreeFail(f"unknown server: {sid}")
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
        server = _resolve_server_config(storage, sid)
        if server is None:
            raise errors.TagTreeFail(f"unknown server: {sid}")
        adapter = create_adapter(server)
        try:
            return await adapter.search_tags(query, limit=limit, offset=offset, filter_type=ftype)
        finally:
            await adapter.close()

    # ---- historian.getTagMeta ----

    @dispatcher.method("historian.getTagMeta")
    async def _get_tag_meta(params):
        params = _ensure_dict(params)
        sid = _require(params, "serverId", str)
        tag_id = _require(params, "tagId", str)
        server = _resolve_server_config(storage, sid)
        if server is None:
            raise errors.TagTreeFail(f"unknown server: {sid}")
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
            raise errors.RpcError(errors.INVALID_PARAMS, "tagIds: max 10 tags for preview")
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
        server = _resolve_server_config(storage, sid)
        if server is None:
            raise errors.TagTreeFail(f"unknown server: {sid}")
        adapter = create_adapter(server)
        try:
            return await adapter.preview_sample(tag_ids, start, end, sampling, max_points=max_points)
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

        output_dir = params.get("outputDir") or str(default_output_dir())
        ensure_output_dir(output_dir)

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
        await dispatcher.emit("historian.export.statusChanged", {"task": public_task_view(task)})
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


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def amain() -> int:
    configure_logging_to_stderr()
    configure_stdout()
    log.info("Historian Downloader sidecar v%s starting (py=%s, platform=%s)",
             VERSION, platform.python_version(), sys.platform)

    udir = user_data_dir()
    storage = Storage(udir / "hd.sqlite3")
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
    await emit("system.ready", {
        "version": VERSION,
        "pythonVersion": platform.python_version(),
        "platform": sys.platform,
        "adapters": adapter_support(),
        "userDataDir": str(udir),
    })

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
        except (NotImplementedError, RuntimeError):  # pragma: no cover — Windows / non-main thread
            pass

    transport_task = asyncio.create_task(transport.run(), name="rpc-transport")
    stop_task = asyncio.create_task(stop_event.wait(), name="stop-event")

    done, pending = await asyncio.wait({transport_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
    for p in pending:
        p.cancel()
    await queue.stop()
    storage.close()
    log.info("sidecar exited")
    return 0


def main() -> None:
    try:
        raise SystemExit(asyncio.run(amain()))
    except KeyboardInterrupt:
        raise SystemExit(0)


if __name__ == "__main__":
    main()
