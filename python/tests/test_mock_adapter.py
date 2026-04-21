"""MockAdapter basic correctness tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from adapters.mock import MockAdapter
from rpc.errors import TagNotFoundError


def _mock_server() -> dict:
    return {"id": "mock-1", "type": "mock", "host": "mock"}


@pytest.mark.asyncio
async def test_list_tag_tree_root_returns_four_top_folders():
    a = MockAdapter(_mock_server())
    nodes = await a.list_tag_tree()
    ids = [n["id"] for n in nodes]
    assert ids == ["line-a", "line-b", "qa", "env"]
    assert all(n["kind"] == "folder" for n in nodes)
    assert all(n.get("hasChildren") is True for n in nodes)
    assert all(n.get("count", 0) >= 3 for n in nodes)


@pytest.mark.asyncio
async def test_list_tag_tree_subpath_returns_children():
    a = MockAdapter(_mock_server())
    line_a_children = await a.list_tag_tree("line-a")
    assert len(line_a_children) == 3
    assert {c["label"] for c in line_a_children} == {"锅炉系统", "压缩机", "水泵"}

    leaves = await a.list_tag_tree("line-a/boiler")
    assert all(leaf["kind"] == "leaf" for leaf in leaves)
    assert any(leaf["id"].endswith("BOILER_01.TEMP") for leaf in leaves)


@pytest.mark.asyncio
async def test_search_tags_finds_by_label():
    a = MockAdapter(_mock_server())
    res = await a.search_tags("BOILER_01")
    assert res["total"] >= 4
    assert all("BOILER_01" in it["label"] for it in res["items"])


@pytest.mark.asyncio
async def test_search_tags_respects_pagination_and_filter():
    a = MockAdapter(_mock_server())
    all_leaves = await a.search_tags("", limit=500)
    total = all_leaves["total"]
    assert total > 10

    page1 = await a.search_tags("", limit=5, offset=0)
    page2 = await a.search_tags("", limit=5, offset=5)
    assert [i["id"] for i in page1["items"]] != [i["id"] for i in page2["items"]]

    digital = await a.search_tags("", filter_type="Digital", limit=500)
    assert all(i["type"] == "Digital" for i in digital["items"])
    assert digital["total"] < total


@pytest.mark.asyncio
async def test_get_tag_meta_not_found_raises():
    a = MockAdapter(_mock_server())
    with pytest.raises(TagNotFoundError):
        await a.get_tag_meta("does-not-exist")


@pytest.mark.asyncio
async def test_get_tag_meta_returns_stats_for_known_leaf():
    a = MockAdapter(_mock_server())
    meta = await a.get_tag_meta("line-a/boiler/BOILER_01.TEMP")
    assert meta["kind"] == "leaf"
    assert "min" in meta and "max" in meta
    assert meta["unit"] == "°C"


@pytest.mark.asyncio
async def test_read_segment_yields_expected_row_count_for_raw_sampling():
    a = MockAdapter(_mock_server())
    start = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
    end = start + timedelta(minutes=1)  # 60s @ 5s step = 12 rows
    tag_ids = ["line-a/boiler/BOILER_01.TEMP", "line-a/boiler/BOILER_01.PRES"]
    rows = [r async for r in a.read_segment(tag_ids, start, end, "raw")]
    assert len(rows) == 12
    for row in rows:
        assert set(row.keys()) == {"time", "values", "quality"}
        assert len(row["values"]) == 2
        assert len(row["quality"]) == 2


@pytest.mark.asyncio
async def test_preview_sample_truncates_when_over_max_points():
    a = MockAdapter(_mock_server())
    start = datetime(2026, 4, 21, 8, 0, 0, tzinfo=timezone.utc)
    end = start + timedelta(hours=1)  # 720 rows @ 5s step
    res = await a.preview_sample(
        ["line-a/boiler/BOILER_01.TEMP"], start, end, "raw", max_points=240
    )
    assert res["truncated"] is True
    assert len(res["times"]) == 240
    assert len(res["values"][0]) == 240
    assert len(res["quality"][0]) == 240
    assert res["tags"][0]["label"] == "BOILER_01.TEMP"


@pytest.mark.asyncio
async def test_test_connection_returns_ok():
    a = MockAdapter({"id": "mock-x", "version": "Mock 1.0"})
    res = await a.test_connection()
    assert res["ok"] is True
    assert 80 <= res["latencyMs"] <= 210
    assert res["tagCount"] > 0
