"""End-to-end test of the export queue using MockAdapter + a tmp output dir."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from adapters.mock import MockAdapter
from services.export_queue import ExportQueue
from storage.db import Storage
from util.time import format_iso


def _iso(y, m, d, hh=0, mm=0):
    return format_iso(datetime(y, m, d, hh, mm, tzinfo=timezone.utc))


@pytest.fixture()
def storage(tmp_path):
    db = Storage(tmp_path / "hd.sqlite3")
    yield db
    db.close()


@pytest.fixture()
def mock_factory():
    def _factory(server):
        return MockAdapter(server)

    return _factory


@pytest.mark.asyncio
async def test_export_happy_path_writes_csv_and_history(
    storage, mock_factory, tmp_path
):
    events: list = []

    async def emit(method, params):
        events.append((method, params))

    queue = ExportQueue(
        storage,
        emit,
        server_provider=lambda sid: {"id": sid, "type": "mock"},
        adapter_factory=mock_factory,
    )
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    # Use a short range so the test is quick.
    start = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
    end = start + timedelta(minutes=2)

    task = storage.create_task(
        {
            "serverId": "mock-1",
            "name": "test_job",
            "tagIds": ["line-a/boiler/BOILER_01.TEMP", "line-a/boiler/BOILER_01.PRES"],
            "range": {"start": format_iso(start), "end": format_iso(end)},
            "sampling": "raw",
            "segmentDays": 1,
            "format": "CSV",
            "outputDir": str(out_dir),
            "totalSegments": 1,
            "status": "queued",
        }
    )

    queue.start()
    await queue.enqueue(task["id"])

    # Wait for completion (polling the DB).
    for _ in range(100):
        t = storage.get_task(task["id"])
        if t and t["status"] in ("done", "failed", "cancelled"):
            break
        await asyncio.sleep(0.05)
    await queue.stop()

    t = storage.get_task(task["id"])
    assert t is not None
    assert t["status"] == "done", f"unexpected status {t['status']}: {t.get('error')}"
    assert t["progress"] == 100
    assert t["sizeBytes"] > 0

    out_path = Path(t["outputPath"])
    assert out_path.exists()
    lines = out_path.read_text(encoding="utf-8").strip().splitlines()
    # header + 24 rows (2 min / 5s)
    assert len(lines) == 1 + 24
    assert lines[0].startswith("time,")

    # history row created
    items, total = storage.list_history()
    assert total == 1
    assert items[0]["name"] == "test_job"
    assert items[0]["rows"] == 24

    # notifications emitted
    methods = [m for m, _ in events]
    assert "historian.export.progress" in methods
    status_changes = [p for m, p in events if m == "historian.export.statusChanged"]
    assert status_changes, "expected at least one statusChanged event"
    assert status_changes[-1]["task"]["status"] == "done"


@pytest.mark.asyncio
async def test_cancel_queued_task_marks_cancelled(storage, mock_factory, tmp_path):
    async def emit(method, params):
        pass

    queue = ExportQueue(
        storage,
        emit,
        server_provider=lambda sid: {"id": sid, "type": "mock"},
        adapter_factory=mock_factory,
    )
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    task = storage.create_task(
        {
            "serverId": "mock-1",
            "name": "cancel_me",
            "tagIds": ["line-a/boiler/BOILER_01.TEMP"],
            "range": {"start": _iso(2026, 4, 21, 8), "end": _iso(2026, 4, 21, 9)},
            "sampling": "raw",
            "segmentDays": 1,
            "format": "CSV",
            "outputDir": str(out_dir),
            "totalSegments": 1,
            "status": "queued",
        }
    )
    # Cancel without ever starting the worker.
    result = await queue.cancel(task["id"])
    assert result["status"] == "cancelled"


@pytest.mark.asyncio
async def test_json_format_writes_jsonl(storage, mock_factory, tmp_path):
    async def emit(method, params):
        pass

    queue = ExportQueue(
        storage,
        emit,
        server_provider=lambda sid: {"id": sid, "type": "mock"},
        adapter_factory=mock_factory,
    )
    out_dir = tmp_path / "out"
    out_dir.mkdir()

    start = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
    end = start + timedelta(seconds=30)  # 6 rows
    task = storage.create_task(
        {
            "serverId": "mock-1",
            "name": "jsonl_job",
            "tagIds": ["line-a/boiler/BOILER_01.TEMP"],
            "range": {"start": format_iso(start), "end": format_iso(end)},
            "sampling": "raw",
            "segmentDays": 1,
            "format": "JSON",
            "outputDir": str(out_dir),
            "totalSegments": 1,
            "status": "queued",
        }
    )
    queue.start()
    await queue.enqueue(task["id"])
    for _ in range(100):
        t = storage.get_task(task["id"])
        if t and t["status"] in ("done", "failed", "cancelled"):
            break
        await asyncio.sleep(0.05)
    await queue.stop()

    t = storage.get_task(task["id"])
    assert t["status"] == "done"
    out_path = Path(t["outputPath"])
    assert out_path.suffix == ".jsonl"
    lines = out_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 6
    import json as _json

    first = _json.loads(lines[0])
    assert "time" in first and "values" in first
