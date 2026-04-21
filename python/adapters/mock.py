"""In-memory mock adapter. Cross-platform, zero external dependencies.

Provides a mock tag tree close to ``data.js`` plus enough extra leaves
under 生产线 B / 质检系统 / 环境监测 so the UI can exercise the full flow.
"""

from __future__ import annotations

import asyncio
import math
import random
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

from rpc import errors
from util.time import format_iso, sampling_seconds


# ---------- static mock tree ----------


def _leaf(
    id_: str,
    label: str,
    desc: str,
    unit: str,
    type_: str = "Analog",
    data_type: str = "FLOAT32",
) -> dict:
    return {
        "id": id_,
        "label": label,
        "kind": "leaf",
        "desc": desc,
        "unit": unit,
        "type": type_,
        "dataType": data_type,
    }


def _folder(id_: str, label: str, children: list[dict] | None = None) -> dict:
    return {
        "id": id_,
        "label": label,
        "kind": "folder",
        "children": children or [],
    }


def _build_tree() -> list[dict]:
    """Build the full mock tag tree. IDs are path-like strings."""
    tree: list[dict] = []

    # ---------- 生产线 A ----------
    line_a = _folder("line-a", "生产线 A", [
        _folder("line-a/boiler", "锅炉系统", [
            _leaf("line-a/boiler/BOILER_01.TEMP",   "BOILER_01.TEMP",   "一号锅炉温度", "°C"),
            _leaf("line-a/boiler/BOILER_01.PRES",   "BOILER_01.PRES",   "一号锅炉压力", "MPa"),
            _leaf("line-a/boiler/BOILER_01.FLOW",   "BOILER_01.FLOW",   "一号锅炉流量", "m³/h"),
            _leaf("line-a/boiler/BOILER_01.STATUS", "BOILER_01.STATUS", "一号锅炉状态", "",    type_="Digital", data_type="BOOL"),
            _leaf("line-a/boiler/BOILER_02.TEMP",   "BOILER_02.TEMP",   "二号锅炉温度", "°C"),
            _leaf("line-a/boiler/BOILER_02.PRES",   "BOILER_02.PRES",   "二号锅炉压力", "MPa"),
        ]),
        _folder("line-a/comp", "压缩机", [
            _leaf("line-a/comp/COMP_01.RPM", "COMP_01.RPM", "压缩机 1 转速", "rpm"),
            _leaf("line-a/comp/COMP_01.AMP", "COMP_01.AMP", "压缩机 1 电流", "A"),
            _leaf("line-a/comp/COMP_02.RPM", "COMP_02.RPM", "压缩机 2 转速", "rpm"),
            _leaf("line-a/comp/COMP_02.AMP", "COMP_02.AMP", "压缩机 2 电流", "A"),
        ]),
        _folder("line-a/pump", "水泵", [
            _leaf("line-a/pump/PUMP_01.FLOW",    "PUMP_01.FLOW",    "水泵 1 流量", "m³/h"),
            _leaf("line-a/pump/PUMP_01.VIB",     "PUMP_01.VIB",     "水泵 1 振动", "mm/s"),
            _leaf("line-a/pump/PUMP_02.FLOW",    "PUMP_02.FLOW",    "水泵 2 流量", "m³/h"),
        ]),
    ])

    # ---------- 生产线 B ----------
    line_b = _folder("line-b", "生产线 B", [
        _folder("line-b/reactor", "反应釜", [
            _leaf("line-b/reactor/REACT_01.TEMP",  "REACT_01.TEMP",  "反应釜 1 温度", "°C"),
            _leaf("line-b/reactor/REACT_01.PRES",  "REACT_01.PRES",  "反应釜 1 压力", "MPa"),
            _leaf("line-b/reactor/REACT_01.LEVEL", "REACT_01.LEVEL", "反应釜 1 液位", "%"),
            _leaf("line-b/reactor/REACT_02.TEMP",  "REACT_02.TEMP",  "反应釜 2 温度", "°C"),
        ]),
        _folder("line-b/conveyor", "输送带", [
            _leaf("line-b/conveyor/CONV_01.SPEED",   "CONV_01.SPEED",   "输送带 1 速度", "m/s"),
            _leaf("line-b/conveyor/CONV_01.RUNNING", "CONV_01.RUNNING", "输送带 1 状态", "",  type_="Digital", data_type="BOOL"),
            _leaf("line-b/conveyor/CONV_02.SPEED",   "CONV_02.SPEED",   "输送带 2 速度", "m/s"),
        ]),
        _folder("line-b/packer", "包装机", [
            _leaf("line-b/packer/PACK_01.COUNT", "PACK_01.COUNT", "包装数量",   "ea"),
            _leaf("line-b/packer/PACK_01.ERR",   "PACK_01.ERR",   "错误计数",   "ea"),
            _leaf("line-b/packer/PACK_01.STATUS","PACK_01.STATUS","包装机状态", "",  type_="Digital", data_type="BOOL"),
        ]),
    ])

    # ---------- 质检系统 ----------
    qa = _folder("qa", "质检系统", [
        _folder("qa/visual", "视觉检测", [
            _leaf("qa/visual/VIS_01.DEFECTS",  "VIS_01.DEFECTS",  "视觉系统 1 缺陷数", "ea"),
            _leaf("qa/visual/VIS_01.RATE",     "VIS_01.RATE",     "视觉系统 1 合格率", "%"),
            _leaf("qa/visual/VIS_02.DEFECTS",  "VIS_02.DEFECTS",  "视觉系统 2 缺陷数", "ea"),
        ]),
        _folder("qa/weight", "称重", [
            _leaf("qa/weight/SCALE_01.NET", "SCALE_01.NET", "在线秤 1 净重", "g"),
            _leaf("qa/weight/SCALE_01.OK",  "SCALE_01.OK",  "在线秤 1 合格", "",  type_="Digital", data_type="BOOL"),
            _leaf("qa/weight/SCALE_02.NET", "SCALE_02.NET", "在线秤 2 净重", "g"),
        ]),
        _folder("qa/chemistry", "化学分析", [
            _leaf("qa/chemistry/PH_01.VALUE",  "PH_01.VALUE",  "pH 值",         "pH"),
            _leaf("qa/chemistry/COND_01.VALUE","COND_01.VALUE","电导率",         "µS/cm"),
            _leaf("qa/chemistry/DO_01.VALUE",  "DO_01.VALUE",  "溶解氧",         "mg/L"),
        ]),
    ])

    # ---------- 环境监测 ----------
    env = _folder("env", "环境监测", [
        _folder("env/air", "空气质量", [
            _leaf("env/air/PM25.VALUE", "PM25.VALUE", "PM2.5",        "µg/m³"),
            _leaf("env/air/PM10.VALUE", "PM10.VALUE", "PM10",         "µg/m³"),
            _leaf("env/air/CO2.VALUE",  "CO2.VALUE",  "二氧化碳浓度",  "ppm"),
        ]),
        _folder("env/water", "水质", [
            _leaf("env/water/TURB.VALUE",  "TURB.VALUE",  "浊度",   "NTU"),
            _leaf("env/water/COD.VALUE",   "COD.VALUE",   "COD",    "mg/L"),
            _leaf("env/water/NH3_N.VALUE", "NH3_N.VALUE", "氨氮",   "mg/L"),
        ]),
        _folder("env/power", "能耗", [
            _leaf("env/power/TOTAL_KW.VALUE", "TOTAL_KW.VALUE", "总功率",       "kW"),
            _leaf("env/power/TOTAL_KWH.VALUE","TOTAL_KWH.VALUE","累计电量",     "kWh"),
            _leaf("env/power/PF.VALUE",       "PF.VALUE",       "功率因数",     ""),
        ]),
    ])

    tree.extend([line_a, line_b, qa, env])
    return tree


# Flatten helpers — computed lazily.

def _leaves(nodes: list[dict]) -> list[dict]:
    out: list[dict] = []
    for n in nodes:
        if n["kind"] == "leaf":
            out.append(n)
        else:
            out.extend(_leaves(n.get("children", [])))
    return out


def _find_node(nodes: list[dict], node_id: str) -> dict | None:
    for n in nodes:
        if n["id"] == node_id:
            return n
        if n["kind"] == "folder":
            hit = _find_node(n.get("children", []), node_id)
            if hit is not None:
                return hit
    return None


# ---------- static server list ----------

MOCK_SERVERS = [
    {"id": "ifix-prod", "name": "iFix — 生产线 A",  "type": "iFix",    "host": "192.168.10.21", "version": "iFix 6.5",        "tagCount": 12840},
    {"id": "ifix-qa",   "name": "iFix — 质检区",    "type": "iFix",    "host": "192.168.10.22", "version": "iFix 6.1",        "tagCount": 3420},
    {"id": "intouch-a", "name": "InTouch — 车间 1", "type": "InTouch", "host": "192.168.20.11", "version": "InTouch 2020 R2", "tagCount": 8905},
    {"id": "intouch-b", "name": "InTouch — 车间 2", "type": "InTouch", "host": "192.168.20.12", "version": "InTouch 2017",    "tagCount": 6120},
]


class MockAdapter:
    """Deterministic mock adapter suitable for dev + CI."""

    _TREE = _build_tree()
    _LEAVES = _leaves(_TREE)
    _LEAF_INDEX = {n["id"]: n for n in _LEAVES}

    def __init__(self, server: dict) -> None:
        self.server = server

    @property
    def server_id(self) -> str:
        return self.server.get("id", "")

    # ---------- connection ----------

    async def test_connection(self) -> dict:
        latency = random.randint(80, 200)
        await asyncio.sleep(latency / 1000)
        return {
            "ok": True,
            "latencyMs": latency,
            "tagCount": len(self._LEAVES),
            "version": self.server.get("version") or "Mock 1.0",
        }

    # ---------- tag tree ----------

    async def list_tag_tree(self, path: str | None = None, depth: int = 1) -> list[dict]:
        if not path:
            return [self._node_summary(n, depth) for n in self._TREE]
        node = _find_node(self._TREE, path)
        if node is None or node["kind"] != "folder":
            return []
        return [self._node_summary(c, depth) for c in node.get("children", [])]

    def _node_summary(self, n: dict, depth: int) -> dict:
        if n["kind"] == "leaf":
            return {
                "id": n["id"],
                "label": n["label"],
                "kind": "leaf",
                "desc": n.get("desc", ""),
                "unit": n.get("unit", ""),
                "type": n.get("type", "Analog"),
                "dataType": n.get("dataType", "FLOAT32"),
            }
        leaf_count = len(_leaves(n.get("children", [])))
        children = n.get("children", [])
        summary = {
            "id": n["id"],
            "label": n["label"],
            "kind": "folder",
            "count": leaf_count,
            "hasChildren": bool(children),
        }
        if depth > 1 and children:
            summary["children"] = [self._node_summary(c, depth - 1) for c in children]
        return summary

    async def search_tags(
        self,
        query: str,
        limit: int = 100,
        offset: int = 0,
        filter_type: str | None = None,
    ) -> dict:
        q = (query or "").strip().lower()
        results: list[dict] = []
        for leaf in self._LEAVES:
            if filter_type in ("Analog", "Digital") and leaf.get("type") != filter_type:
                continue
            hay = f"{leaf['label']} {leaf.get('desc', '')}".lower()
            if not q or q in hay:
                results.append(self._node_summary(leaf, 1))
        total = len(results)
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        return {"items": results[offset : offset + limit], "total": total}

    async def get_tag_meta(self, tag_id: str) -> dict:
        leaf = self._LEAF_INDEX.get(tag_id)
        if leaf is None:
            raise errors.TagNotFoundError(tag_id)
        now = datetime.now(timezone.utc)
        # Deterministic-ish "range of available data" to help the UI.
        return {
            **self._node_summary(leaf, 1),
            "min": 0.0,
            "max": 500.0,
            "precision": 2,
            "description": leaf.get("desc", ""),
            "sampleIntervalMs": 5000,
            "firstTimestamp": format_iso(now - timedelta(days=365)),
            "lastTimestamp": format_iso(now),
        }

    # ---------- time-series generation ----------

    def _synthetic_value(self, tag_id: str, ts: datetime) -> float:
        """Deterministic synthetic series keyed by tag_id."""
        seed = sum(ord(c) for c in tag_id) or 1
        t = ts.timestamp()
        base = 400 + (seed % 50)
        amp = 3 + (seed % 7)
        val = base + math.sin(t / (900 + (seed % 60))) * amp \
              + math.cos(t / 300) * (amp * 0.4) \
              + (((seed * int(t)) % 7) - 3) * 0.05  # pseudo-noise, deterministic
        return round(val, 3)

    def _quality_for(self, tag_id: str, ts: datetime) -> str:
        # Occasionally flip to Uncertain.
        seed = (sum(ord(c) for c in tag_id) + int(ts.timestamp())) % 97
        if seed == 7:
            return "Uncertain"
        if seed == 11:
            return "Bad"
        return "Good"

    async def read_segment(
        self,
        tag_ids: list[str],
        start: datetime,
        end: datetime,
        sampling: str,
    ) -> AsyncIterator[dict]:
        step = timedelta(seconds=sampling_seconds(sampling))
        ts = start
        while ts < end:
            row = {
                "time": format_iso(ts),
                "values": [self._synthetic_value(tid, ts) for tid in tag_ids],
                "quality": [self._quality_for(tid, ts) for tid in tag_ids],
            }
            yield row
            ts = ts + step

    async def preview_sample(
        self,
        tag_ids: list[str],
        start: datetime,
        end: datetime,
        sampling: str,
        max_points: int = 240,
    ) -> dict:
        step = timedelta(seconds=sampling_seconds(sampling))
        total_points = max(1, int((end - start) / step))
        truncated = False
        if total_points > max_points:
            # Downsample by expanding the step so we land on ~max_points.
            step = (end - start) / max_points
            total_points = max_points
            truncated = True

        times: list[str] = []
        values: list[list[float | None]] = [[] for _ in tag_ids]
        quality: list[list[str]] = [[] for _ in tag_ids]
        for i in range(total_points):
            ts = start + step * i
            times.append(format_iso(ts))
            for idx, tid in enumerate(tag_ids):
                values[idx].append(self._synthetic_value(tid, ts))
                quality[idx].append(self._quality_for(tid, ts))

        tag_summaries: list[dict] = []
        for tid in tag_ids:
            leaf = self._LEAF_INDEX.get(tid)
            if leaf is None:
                tag_summaries.append({"id": tid, "label": tid})
            else:
                tag_summaries.append({"id": tid, "label": leaf["label"], "unit": leaf.get("unit", "")})

        return {
            "times": times,
            "values": values,
            "quality": quality,
            "tags": tag_summaries,
            "truncated": truncated,
        }

    async def close(self) -> None:
        return None
