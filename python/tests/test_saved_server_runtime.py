from __future__ import annotations

import pytest

import main as sidecar_main
from rpc.dispatcher import Dispatcher
from services.export_queue import ExportQueue
from storage.db import Storage


@pytest.fixture()
def storage(tmp_path):
    db = Storage(tmp_path / "hd.sqlite3")
    yield db
    db.close()


class _DummyQueue:
    async def enqueue(self, _task_id: str) -> None:
        return None

    async def pause(self, _task_id: str) -> dict:
        return {"id": "noop"}

    async def resume(self, _task_id: str) -> dict:
        return {"id": "noop"}

    async def cancel(self, _task_id: str) -> dict:
        return {"id": "noop"}


class _RecordingAdapter:
    seen_servers: list[dict] = []

    def __init__(self, server: dict) -> None:
        self.server = dict(server)
        self.__class__.seen_servers.append(self.server)

    async def test_connection(self) -> dict:
        return {"ok": True, "latencyMs": 12}

    async def list_tag_tree(self, path=None, depth=1) -> list[dict]:
        return [{"id": "folder-1", "label": "Folder", "kind": "folder"}]

    async def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_test_connection_reuses_saved_password_when_draft_password_is_blank(
    storage, monkeypatch
):
    storage.save_server(
        {
            "id": "srv-1",
            "name": "Prod",
            "type": "InTouch",
            "host": "sql.example.com",
            "username": "operator",
            "password": "saved-secret",
        }
    )
    dispatcher = Dispatcher()
    sidecar_main.register_methods(dispatcher, storage, _DummyQueue())
    monkeypatch.setattr(sidecar_main, "create_adapter", _RecordingAdapter)
    _RecordingAdapter.seen_servers.clear()

    response = await dispatcher.handle(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "historian.testConnection",
            "params": {
                "server": {
                    "id": "srv-1",
                    "type": "InTouch",
                    "host": "sql.example.com",
                    "username": "operator",
                }
            },
        }
    )

    assert response == {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {"ok": True, "latencyMs": 12},
    }
    assert _RecordingAdapter.seen_servers[-1]["password"] == "saved-secret"


@pytest.mark.asyncio
async def test_list_tag_tree_uses_runtime_server_with_saved_password(
    storage, monkeypatch
):
    storage.save_server(
        {
            "id": "srv-2",
            "name": "Prod",
            "type": "InTouch",
            "host": "sql.example.com",
            "username": "operator",
            "password": "saved-secret",
        }
    )
    dispatcher = Dispatcher()
    sidecar_main.register_methods(dispatcher, storage, _DummyQueue())
    monkeypatch.setattr(sidecar_main, "create_adapter", _RecordingAdapter)
    _RecordingAdapter.seen_servers.clear()

    response = await dispatcher.handle(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "historian.listTagTree",
            "params": {"serverId": "srv-2"},
        }
    )

    assert response == {
        "jsonrpc": "2.0",
        "id": 2,
        "result": [{"id": "folder-1", "label": "Folder", "kind": "folder"}],
    }
    assert _RecordingAdapter.seen_servers[-1]["password"] == "saved-secret"


def test_export_queue_default_server_provider_includes_saved_password(storage):
    storage.save_server(
        {
            "id": "srv-3",
            "name": "Prod",
            "type": "InTouch",
            "host": "sql.example.com",
            "username": "operator",
            "password": "saved-secret",
        }
    )

    async def _emit(_method: str, _params: dict) -> None:
        return None

    queue = ExportQueue(storage, _emit)
    runtime_server = queue._server_provider("srv-3")

    assert runtime_server is not None
    assert runtime_server["password"] == "saved-secret"
