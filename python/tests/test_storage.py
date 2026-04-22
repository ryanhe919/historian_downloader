"""Storage CRUD + migration tests."""

from __future__ import annotations

import pytest

from storage.db import Storage


@pytest.fixture()
def storage(tmp_path):
    db = Storage(tmp_path / "hd.sqlite3")
    yield db
    db.close()


def test_migration_creates_schema_version(storage):
    v = storage.get_setting("schema_version")
    assert v == "1"


def test_server_crud_roundtrip(storage):
    s = storage.save_server(
        {
            "name": "iFix Prod",
            "type": "iFix",
            "host": "10.0.0.1",
            "port": 1433,
            "username": "admin",
            "password": "s3cret",
            "timeoutS": 20,
            "tls": True,
            "windowsAuth": False,
        }
    )
    assert s["id"]
    assert s["hasPassword"] is True
    assert s["tls"] is True
    assert s["timeoutS"] == 20

    listed = storage.list_servers()
    assert len(listed) == 1

    # decrypt / decode
    assert storage.get_server_password(s["id"]) == "s3cret"

    # update without changing password preserves encrypted value
    updated = storage.save_server(
        {"name": "iFix Prod 2", "type": "iFix", "host": "10.0.0.2"}, server_id=s["id"]
    )
    assert updated["name"] == "iFix Prod 2"
    assert updated["hasPassword"] is True
    assert storage.get_server_password(s["id"]) == "s3cret"

    assert storage.delete_server(s["id"]) is True
    assert storage.list_servers() == []


def test_task_crud_and_update(storage):
    t = storage.create_task(
        {
            "serverId": "srv-1",
            "name": "job-a",
            "tagIds": ["a", "b"],
            "range": {
                "start": "2026-04-01T00:00:00.000Z",
                "end": "2026-04-02T00:00:00.000Z",
            },
            "sampling": "1m",
            "segmentDays": 1,
            "format": "CSV",
            "outputDir": "/tmp/out",
            "totalSegments": 1,
        }
    )
    assert t["status"] == "queued"
    assert t["tagIds"] == ["a", "b"]
    assert t["tagCount"] == 2

    updated = storage.update_task(t["id"], status="running", progress=33, sizeBytes=100)
    assert updated["status"] == "running"
    assert updated["progress"] == 33
    assert updated["sizeBytes"] == 100


def test_history_list_with_query_and_pagination(storage):
    for i in range(5):
        storage.add_history(
            {
                "name": f"job_{i}.csv",
                "path": f"/tmp/job_{i}.csv",
                "tagCount": 2,
                "rows": 1000 + i,
                "sizeBytes": 2000 + i,
                "range": {
                    "start": "2026-04-01T00:00:00.000Z",
                    "end": "2026-04-02T00:00:00.000Z",
                },
                "format": "CSV",
            }
        )
    items, total = storage.list_history(limit=3, offset=0)
    assert total == 5
    assert len(items) == 3
    items, total = storage.list_history(query="job_2")
    assert total == 1
    assert items[0]["name"] == "job_2.csv"


def test_settings_roundtrip(storage):
    assert storage.get_setting("theme") is None
    storage.set_setting("theme", "dark")
    assert storage.get_setting("theme") == "dark"
    storage.set_setting("theme", "light")
    assert storage.get_setting("theme") == "light"
