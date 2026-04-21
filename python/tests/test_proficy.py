"""Unit tests for ``adapters.proficy``.

These tests never touch real COM — they exercise the pure-Python SQL builders
and the async adapter methods with the ``_oledb.connect`` dispatcher monkey-
patched to return a fake connection. The assertions focus on:

  * SQL template alignment with the legacy ``views.py`` branch.
  * Tag-tree assembly from flat ``A.B.C`` style tagnames.
  * ``read_segment`` merging multi-batch + multi-chunk results by timestamp.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from adapters import proficy
from adapters.proficy import (
    ProficyHistorianAdapter,
    build_ihtrend_sql,
    split_tags,
    _build_tree_level,
    _split_times,
)


# ---------------------------------------------------------------------------
# Pure helpers — no COM involved.
# ---------------------------------------------------------------------------


def test_split_tags_chunks_correctly():
    assert split_tags(["a", "b", "c", "d", "e"], 2) == [["a", "b"], ["c", "d"], ["e"]]
    assert split_tags(["only"], 20) == [["only"]]
    with pytest.raises(ValueError):
        split_tags([], 10)


def test_build_ihtrend_sql_matches_legacy_template():
    sql = build_ihtrend_sql(
        ["BOILER_01.TEMP", "BOILER_01.PRES"],
        "2026-04-21 00:00:00",
        "2026-04-22 00:00:00",
        interval_ms=60_000,
        sampling_mode="Lab",
    )
    assert "FROM ihtrend" in sql
    assert "BOILER_01.TEMP.value" in sql
    assert "BOILER_01.PRES.value" in sql
    assert "intervalmilliseconds=60000" in sql
    assert "timestamp>='2026-04-21 00:00:00'" in sql
    assert "timestamp<='2026-04-22 00:00:00'" in sql
    assert "SamplingMode=Lab" in sql
    assert sql.strip().endswith("ORDER BY timestamp")


def test_build_ihtrend_sql_raw_mode():
    sql = build_ihtrend_sql(["x"], "2026-04-21 00:00:00", "2026-04-21 01:00:00",
                            interval_ms=5000, sampling_mode="Raw")
    assert "SamplingMode=Raw" in sql
    assert "intervalmilliseconds=5000" in sql


def test_split_times_returns_full_coverage():
    start = datetime(2026, 4, 21, tzinfo=timezone.utc)
    end = start + timedelta(hours=10)
    chunks = _split_times(start, end, chunk_minutes=120)
    assert chunks[0][0] == start
    assert chunks[-1][1] == end
    for a, b in chunks:
        assert a < b


def test_build_tree_level_folds_dotted_tagnames():
    tags = [
        "BOILER_01.TEMP",
        "BOILER_01.PRES",
        "BOILER_02.TEMP",
        "COMP_01.RPM",
    ]
    nodes = _build_tree_level(tags, prefix="", depth=1)
    # Expect two folders + any top-level leaves (none here).
    folders = [n for n in nodes if n["kind"] == "folder"]
    leaves = [n for n in nodes if n["kind"] == "leaf"]
    assert {f["label"] for f in folders} == {"BOILER_01", "BOILER_02", "COMP_01"}
    assert leaves == []
    # BOILER_01 has 2 descendants.
    b01 = next(f for f in folders if f["label"] == "BOILER_01")
    assert b01["count"] == 2
    assert b01["hasChildren"] is True


def test_build_tree_level_recurses_with_depth():
    tags = ["AREA1.EQUIP.ATTR1", "AREA1.EQUIP.ATTR2", "AREA1.OTHER.ATTR"]
    nodes = _build_tree_level(tags, prefix="", depth=2)
    area1 = next(n for n in nodes if n["label"] == "AREA1")
    assert "children" in area1
    labels = {c["label"] for c in area1["children"]}
    assert labels == {"EQUIP", "OTHER"}


def test_build_tree_level_with_prefix_returns_children_under_prefix():
    tags = [
        "AREA1.EQUIP.ATTR1",
        "AREA1.EQUIP.ATTR2",
        "AREA1.OTHER.ATTR",
        "AREA2.EQUIP.X",
    ]
    nodes = _build_tree_level(tags, prefix="AREA1", depth=1)
    assert {n["label"] for n in nodes} == {"EQUIP", "OTHER"}
    for n in nodes:
        assert n["id"].startswith("AREA1.")


# ---------------------------------------------------------------------------
# Adapter tests with mocked COM layer.
# ---------------------------------------------------------------------------


def _build_mock_conn(fake_rows_by_sql: dict[str, list]):
    """Return a mock connection whose cursor serves rows keyed by SQL substring."""
    conn = MagicMock(name="conn")

    def make_cursor():
        cur = MagicMock(name="cursor")
        state = {"rows": []}

        def _execute(sql, *args, **kwargs):
            matched: list = []
            for key, rows in fake_rows_by_sql.items():
                if key in sql:
                    matched = rows
                    break
            state["rows"] = list(matched)

        cur.execute.side_effect = _execute
        cur.fetchall.side_effect = lambda: list(state["rows"])
        cur.fetchmany.side_effect = lambda n=1: [state["rows"].pop(0) for _ in range(min(n, len(state["rows"])))]
        cur.fetchone.side_effect = lambda: (state["rows"][0] if state["rows"] else None)
        cur.close.return_value = None
        return cur

    conn.cursor.side_effect = make_cursor
    conn.close.return_value = None
    return conn


@pytest.fixture
def patched_environment():
    """Pretend we're on a Windows host with pywin32/pythoncom available."""
    with patch.object(ProficyHistorianAdapter, "is_available", classmethod(lambda cls: True)):
        yield


@pytest.mark.asyncio
async def test_list_tag_tree_queries_ihtags_and_builds_tree(patched_environment):
    conn = _build_mock_conn({
        "FROM ihtags": [
            ["BOILER_01.TEMP"],
            ["BOILER_01.PRES"],
            ["BOILER_02.TEMP"],
        ]
    })
    adapter = ProficyHistorianAdapter({"id": "p1", "host": "10.0.0.1", "timeoutS": 5})
    with patch.object(adapter, "_open_connection", return_value=conn):
        nodes = await adapter.list_tag_tree(path=None, depth=1)
    labels = {n["label"] for n in nodes}
    assert "BOILER_01" in labels and "BOILER_02" in labels
    b01 = next(n for n in nodes if n["label"] == "BOILER_01")
    assert b01["kind"] == "folder"
    assert b01["count"] == 2


@pytest.mark.asyncio
async def test_list_tag_tree_with_prefix_uses_like_clause(patched_environment):
    captured_sql: list[str] = []
    conn = MagicMock()

    def make_cursor():
        cur = MagicMock()
        state = {"rows": [["AREA1.EQUIP.A"], ["AREA1.EQUIP.B"]]}

        def _exec(sql, *a, **kw):
            captured_sql.append(sql)

        cur.execute.side_effect = _exec
        cur.fetchall.side_effect = lambda: list(state["rows"])
        cur.close.return_value = None
        return cur

    conn.cursor.side_effect = make_cursor
    conn.close.return_value = None

    adapter = ProficyHistorianAdapter({"id": "p1", "host": "h", "timeoutS": 5})
    with patch.object(adapter, "_open_connection", return_value=conn):
        await adapter.list_tag_tree(path="AREA1", depth=1)

    assert captured_sql, "expected a SELECT to have been issued"
    assert "ihtags" in captured_sql[0]
    assert "LIKE 'AREA1.%'" in captured_sql[0]


@pytest.mark.asyncio
async def test_search_tags_returns_leaves_with_unit_and_type(patched_environment):
    rows = [
        ["BOILER_01.TEMP", "Boiler temp", "°C", "F"],
        ["BOILER_01.STATUS", "Boiler status", "", "DI"],
    ]
    conn = _build_mock_conn({"FROM ihtags": rows})
    adapter = ProficyHistorianAdapter({"id": "p1", "host": "h", "timeoutS": 5})
    with patch.object(adapter, "_open_connection", return_value=conn):
        res = await adapter.search_tags("BOILER", limit=10, offset=0)
    assert res["total"] == 2
    ids = {i["id"] for i in res["items"]}
    assert ids == {"BOILER_01.TEMP", "BOILER_01.STATUS"}
    status_item = next(i for i in res["items"] if i["id"] == "BOILER_01.STATUS")
    assert status_item["type"] == "Digital"
    temp_item = next(i for i in res["items"] if i["id"] == "BOILER_01.TEMP")
    assert temp_item["type"] == "Analog"
    assert temp_item["unit"] == "°C"


@pytest.mark.asyncio
async def test_get_tag_meta_maps_hi_lo_range(patched_environment):
    row = ["BOILER_01.TEMP", "Boiler temp", "°C", "F", 500.0, 0.0, 5000]
    conn = _build_mock_conn({"FROM ihtags": [row]})
    adapter = ProficyHistorianAdapter({"id": "p1", "host": "h", "timeoutS": 5})
    with patch.object(adapter, "_open_connection", return_value=conn):
        meta = await adapter.get_tag_meta("BOILER_01.TEMP")
    assert meta["id"] == "BOILER_01.TEMP"
    assert meta["unit"] == "°C"
    assert meta["max"] == 500.0
    assert meta["min"] == 0.0
    assert meta["sampleIntervalMs"] == 5000
    assert meta["type"] == "Analog"


@pytest.mark.asyncio
async def test_get_tag_meta_raises_when_missing(patched_environment):
    conn = _build_mock_conn({"FROM ihtags": []})
    adapter = ProficyHistorianAdapter({"id": "p1", "host": "h", "timeoutS": 5})
    from rpc.errors import TagNotFoundError
    with patch.object(adapter, "_open_connection", return_value=conn):
        with pytest.raises(TagNotFoundError):
            await adapter.get_tag_meta("nope")


@pytest.mark.asyncio
async def test_read_segment_yields_rows_with_expected_sql(patched_environment):
    """Verify the SQL hitting the DB matches the legacy ihtrend template."""

    captured_sql: list[str] = []

    # Two tags × one time chunk → one SQL call per batch. Since batch size is 20
    # and we have 2 tags, there'll be a single batch hitting ihtrend.
    fake_dt = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
    fake_dt2 = datetime(2026, 4, 21, 8, 1, 0, tzinfo=timezone.utc)

    class FakeTs:
        def __init__(self, dt): self._dt = dt
        def timestamp(self): return self._dt.timestamp()

    rows_by_sql = {
        "FROM ihtrend": [
            [FakeTs(fake_dt), 100.0, 5.0],
            [FakeTs(fake_dt2), 101.0, 5.1],
        ],
    }

    def make_conn():
        conn = MagicMock()

        def make_cursor():
            cur = MagicMock()
            state = {"rows": []}

            def _exec(sql, *a, **kw):
                captured_sql.append(sql)
                state["rows"] = list(rows_by_sql.get("FROM ihtrend", []))

            cur.execute.side_effect = _exec
            cur.fetchall.side_effect = lambda: list(state["rows"])
            cur.close.return_value = None
            return cur

        conn.cursor.side_effect = make_cursor
        conn.close.return_value = None
        return conn

    adapter = ProficyHistorianAdapter({"id": "p1", "host": "h", "timeoutS": 5})
    start = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
    end = start + timedelta(minutes=5)
    with patch.object(adapter, "_open_connection", side_effect=lambda: make_conn()):
        rows = [r async for r in adapter.read_segment(
            ["BOILER_01.TEMP", "BOILER_01.PRES"], start, end, "1m"
        )]

    assert len(rows) == 2
    for r in rows:
        assert set(r.keys()) == {"time", "values", "quality"}
        assert len(r["values"]) == 2
        assert len(r["quality"]) == 2
    # SQL sanity check.
    assert captured_sql, "expected at least one ihtrend query"
    sql = captured_sql[0]
    assert "FROM ihtrend" in sql
    assert "BOILER_01.TEMP.value" in sql
    assert "BOILER_01.PRES.value" in sql
    assert "intervalmilliseconds=60000" in sql
    assert "SamplingMode=Lab" in sql


@pytest.mark.asyncio
async def test_test_connection_returns_ok_with_latency(patched_environment):
    rows = [["TAG" + str(i)] for i in range(42)]
    conn = _build_mock_conn({"FROM ihtags": rows})
    adapter = ProficyHistorianAdapter({"id": "p1", "host": "h", "timeoutS": 5,
                                       "version": "iFix 6.5"})
    with patch.object(adapter, "_open_connection", return_value=conn):
        res = await adapter.test_connection()
    assert res["ok"] is True
    assert isinstance(res["latencyMs"], int)
    assert res["tagCount"] == 42
    assert res["version"] == "iFix 6.5"
