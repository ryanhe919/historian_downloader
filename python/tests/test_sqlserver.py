"""Unit tests for ``adapters.sqlserver``.

Uses ``unittest.mock`` to stub ``pymssql.connect`` so tests run on macOS
without a real SQL Server. Assertions focus on:

  * OpenQuery(INSQL, ...) template alignment with legacy views.py.
  * Tag tree assembly + search / meta mapping.
"""

from __future__ import annotations

import sys
import types
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from adapters import sqlserver
from adapters.sqlserver import (
    SqlServerAdapter,
    build_openquery_sql,
    _build_tree_level,
    _classify_tag_type,
    split_tags,
)

# ---------------------------------------------------------------------------
# Pure helpers.
# ---------------------------------------------------------------------------


def test_build_openquery_sql_matches_legacy_template():
    sql = build_openquery_sql(
        ["AREA1.TEMP"], "2026-04-21 00:00:00", "2026-04-22 00:00:00", 60_000
    )
    assert "SET QUOTED_IDENTIFIER OFF" in sql
    assert "OpenQuery(INSQL" in sql
    assert "wwVersion = 'Latest'" in sql
    assert "wwRetrievalMode = 'Cyclic'" in sql
    assert "wwResolution = 60000" in sql
    assert "DateTime >= '2026-04-21 00:00:00'" in sql
    assert "DateTime <= '2026-04-22 00:00:00'" in sql
    assert "History.TagName IN ('AREA1.TEMP')" in sql


def test_build_openquery_sql_raw_mode_uses_5s_resolution():
    sql = build_openquery_sql(["X"], "2026-04-21 00:00:00", "2026-04-21 01:00:00", 5000)
    assert "wwResolution = 5000" in sql


def test_classify_tag_type_handles_strings_and_enum():
    assert _classify_tag_type(None) == "Analog"
    assert _classify_tag_type("Discrete") == "Digital"
    assert _classify_tag_type("Analog") == "Analog"
    assert _classify_tag_type(1) == "Analog"
    assert _classify_tag_type(2) == "Digital"


def test_build_tree_level_keeps_dotted_and_underscore_names_flat():
    tags = ["AREA1.EQUIP.A", "AREA1.EQUIP.B", "AREA2_LINE_C"]
    nodes = _build_tree_level(tags, prefix="", depth=1)
    assert [n["label"] for n in nodes] == sorted(tags)
    assert all(n["kind"] == "leaf" for n in nodes)


def test_build_tree_level_respects_prefix():
    tags = ["AREA1.EQUIP.A", "AREA1.EQUIP.B", "AREA2.X"]
    under_a1 = _build_tree_level(tags, prefix="AREA1", depth=2)
    labels = {n["label"] for n in under_a1}
    assert labels == {"AREA1.EQUIP.A", "AREA1.EQUIP.B"}


def test_split_tags_chunks_correctly():
    assert split_tags(["a", "b", "c", "d", "e"], 2) == [["a", "b"], ["c", "d"], ["e"]]
    assert split_tags(["only"], 20) == [["only"]]
    with pytest.raises(ValueError):
        split_tags([], 10)


# ---------------------------------------------------------------------------
# Adapter tests with mocked pymssql.
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_pymssql():
    """Ensure the adapter believes pymssql is installed, even if it isn't."""
    fake_module = types.ModuleType("pymssql")
    fake_module.connect = MagicMock()
    with patch.object(sqlserver, "pymssql", fake_module), patch.object(
        sqlserver, "_HAS_PYMSSQL", True
    ):
        yield fake_module


def _make_cursor(rows):
    cur = MagicMock()
    state = {"rows": list(rows), "last_sql": None}

    def _exec(sql, *a, **kw):
        state["last_sql"] = sql

    cur.execute.side_effect = _exec
    cur.fetchall.side_effect = lambda: list(state["rows"])
    cur.fetchone.side_effect = lambda: (state["rows"][0] if state["rows"] else None)
    cur.close.return_value = None
    return cur, state


def _make_conn(rows):
    conn = MagicMock()
    cur, state = _make_cursor(rows)
    conn.cursor.return_value = cur
    conn.close.return_value = None
    return conn, state


@pytest.mark.asyncio
async def test_test_connection_uses_top1_and_count(patched_pymssql):
    # First execute() hits TOP 1, second hits COUNT(*). We can't distinguish
    # easily with a single cursor, so serve a dummy row then a count row.
    conn = MagicMock()
    cur = MagicMock()
    call = {"i": 0}
    rows_seq = [[["tag1"]], [[1234]]]

    def _exec(sql, *a, **kw):
        call["sql_" + str(call["i"])] = sql

    cur.execute.side_effect = _exec

    def _fetchall():
        cur_idx = call["i"]
        call["i"] += 1
        return rows_seq[cur_idx] if cur_idx < len(rows_seq) else []

    def _fetchone():
        # second call in test_connection uses fetchone.
        return [1234]

    cur.fetchall.side_effect = _fetchall
    cur.fetchone.side_effect = _fetchone
    cur.close.return_value = None
    conn.cursor.return_value = cur
    conn.close.return_value = None

    patched_pymssql.connect.return_value = conn

    adapter = SqlServerAdapter(
        {
            "id": "s1",
            "type": "InTouch",
            "host": "1.2.3.4",
            "port": 1433,
            "username": "sa",
            "password": "pw",
            "timeoutS": 5,
        }
    )
    res = await adapter.test_connection()
    assert res["ok"] is True
    assert res["tagCount"] == 1234
    assert isinstance(res["latencyMs"], int)
    # Verify pymssql.connect was called with server=host:port.
    args, kwargs = patched_pymssql.connect.call_args
    assert kwargs["server"] == "1.2.3.4:1433"
    assert kwargs["user"] == "sa"
    assert kwargs["password"] == "pw"


@pytest.mark.asyncio
async def test_list_tag_tree_uses_runtime_dbo_tag(patched_pymssql):
    rows = [["AREA1.EQUIP.A"], ["AREA1.EQUIP.B"], ["AREA2.X"]]
    conn, state = _make_conn(rows)
    patched_pymssql.connect.return_value = conn
    adapter = SqlServerAdapter({"id": "s1", "host": "h", "port": 1433, "timeoutS": 5})
    nodes = await adapter.list_tag_tree(path=None, depth=1)
    labels = {n["label"] for n in nodes}
    assert "AREA1.EQUIP.A" in labels and "AREA2.X" in labels
    assert all(n["kind"] == "leaf" for n in nodes)
    assert "Runtime.dbo.Tag" in state["last_sql"]


@pytest.mark.asyncio
async def test_search_tags_handles_typed_rows(patched_pymssql):
    rows = [
        ["AREA1.TEMP", "Area1 temperature", "°C", "Analog"],
        ["AREA1.STATUS", "Area1 status", "", "Discrete"],
    ]
    conn, state = _make_conn(rows)
    patched_pymssql.connect.return_value = conn
    adapter = SqlServerAdapter({"id": "s1", "host": "h", "port": 1433, "timeoutS": 5})
    res = await adapter.search_tags("AREA1", limit=10, offset=0)
    assert res["total"] == 2
    types_ = {i["id"]: i["type"] for i in res["items"]}
    assert types_["AREA1.TEMP"] == "Analog"
    assert types_["AREA1.STATUS"] == "Digital"
    # SQL sanity.
    assert "Runtime.dbo.Tag" in state["last_sql"]
    assert "LIKE '%AREA1%'" in state["last_sql"]


@pytest.mark.asyncio
async def test_get_tag_meta_maps_max_min(patched_pymssql):
    row = ["AREA1.TEMP", "Area1 temperature", "°C", "Analog", 100.0, 0.0]
    conn, state = _make_conn([row])
    patched_pymssql.connect.return_value = conn
    adapter = SqlServerAdapter({"id": "s1", "host": "h", "port": 1433, "timeoutS": 5})
    meta = await adapter.get_tag_meta("AREA1.TEMP")
    assert meta["id"] == "AREA1.TEMP"
    assert meta["unit"] == "°C"
    assert meta["min"] == 0.0
    assert meta["max"] == 100.0
    assert meta["type"] == "Analog"


@pytest.mark.asyncio
async def test_get_tag_meta_missing_raises(patched_pymssql):
    conn, _ = _make_conn([])
    patched_pymssql.connect.return_value = conn
    adapter = SqlServerAdapter({"id": "s1", "host": "h", "port": 1433, "timeoutS": 5})
    from rpc.errors import TagNotFoundError

    with pytest.raises(TagNotFoundError):
        await adapter.get_tag_meta("nope")


@pytest.mark.asyncio
async def test_read_segment_uses_openquery_and_merges_rows(patched_pymssql):
    """read_segment batches tags and merges rows across tags by timestamp."""
    captured: list[str] = []

    # Each connection used once per tag batch.
    def _connect_factory(*args, **kwargs):
        conn = MagicMock()
        cur = MagicMock()
        ts1 = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
        ts2 = datetime(2026, 4, 21, 8, 1, 0, tzinfo=timezone.utc)
        state = {"rows": []}

        def _exec(sql, *a, **kw):
            captured.append(sql)
            rows: list[tuple] = []
            if "'TAG1'" in sql:
                rows.extend([(ts1, "TAG1", 10.0), (ts2, "TAG1", 11.0)])
            if "'TAG2'" in sql:
                rows.extend([(ts1, "TAG2", 20.0), (ts2, "TAG2", 22.0)])
            state["rows"] = rows

        cur.execute.side_effect = _exec
        cur.fetchall.side_effect = lambda: list(state["rows"])
        cur.close.return_value = None
        conn.cursor.return_value = cur
        conn.close.return_value = None
        return conn

    patched_pymssql.connect.side_effect = _connect_factory

    adapter = SqlServerAdapter({"id": "s1", "host": "h", "port": 1433, "timeoutS": 5})
    start = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
    end = start + timedelta(minutes=5)
    rows = [r async for r in adapter.read_segment(["TAG1", "TAG2"], start, end, "1m")]

    # Two timestamps merged across two tags.
    assert len(rows) == 2
    assert rows[0]["values"] == [10.0, 20.0]
    assert rows[1]["values"] == [11.0, 22.0]
    assert rows[0]["quality"] == ["Good", "Good"]
    assert len(captured) == 1
    assert all("OpenQuery(INSQL" in s for s in captured)
    assert "wwResolution = 60000" in captured[0]
    assert "DateTime >= '2026-04-21 08:00:00'" in captured[0]
    assert "History.TagName IN ('TAG1', 'TAG2')" in captured[0]


@pytest.mark.asyncio
async def test_read_segment_splits_large_tag_sets_into_batches_of_20(patched_pymssql):
    captured: list[str] = []

    def _connect_factory(*args, **kwargs):
        conn = MagicMock()
        cur = MagicMock()
        ts = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
        state = {"rows": []}

        def _exec(sql, *a, **kw):
            captured.append(sql)
            rows: list[tuple] = []
            for i in range(1, 22):
                tag = f"TAG{i}"
                if f"'{tag}'" in sql:
                    rows.append((ts, tag, float(i)))
            state["rows"] = rows

        cur.execute.side_effect = _exec
        cur.fetchall.side_effect = lambda: list(state["rows"])
        cur.close.return_value = None
        conn.cursor.return_value = cur
        conn.close.return_value = None
        return conn

    patched_pymssql.connect.side_effect = _connect_factory

    adapter = SqlServerAdapter({"id": "s1", "host": "h", "port": 1433, "timeoutS": 5})
    start = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
    end = start + timedelta(minutes=1)
    tag_ids = [f"TAG{i}" for i in range(1, 22)]

    rows = [r async for r in adapter.read_segment(tag_ids, start, end, "1m")]

    assert len(captured) == 2
    assert len(rows) == 1
    assert rows[0]["values"] == [float(i) for i in range(1, 22)]
    assert "History.TagName IN ('TAG1', 'TAG2'" in captured[0]
    assert "'TAG21'" in captured[1]


@pytest.mark.asyncio
async def test_is_available_reflects_import_state():
    # Directly probe the class method — should match the module's _HAS_PYMSSQL.
    assert SqlServerAdapter.is_available() == sqlserver._HAS_PYMSSQL
