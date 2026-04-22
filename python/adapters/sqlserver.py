"""SQL Server (InTouch / Wonderware Historian) adapter.

Cross-platform; uses ``pymssql`` and the ``OpenQuery(INSQL, ...)`` templates
migrated from ``AIModelAPI/apps/historian_api/views.py`` (InTouch branch).

If ``pymssql`` is not installed, ``is_available()`` returns False and the
factory should fall back to ``MockAdapter``.
"""

from __future__ import annotations

import asyncio
import logging
import time as _time
from datetime import datetime, timezone
from typing import AsyncIterator

from rpc import errors
from util.time import sampling_seconds

from .base import BaseHistorianAdapter

log = logging.getLogger(__name__)


try:
    import pymssql  # type: ignore

    _HAS_PYMSSQL = True
except Exception as _exc:
    pymssql = None  # type: ignore
    _HAS_PYMSSQL = False
    log.debug("pymssql unavailable: %s", _exc)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _quote(v: str) -> str:
    return str(v).replace("'", "''")


def _format_ts(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def build_openquery_sql(tag: str, start: str, end: str, interval_ms: int) -> str:
    """Render the legacy OpenQuery(INSQL, ...) template for a single tag.

    Mirrors views.py lines 161-170 closely.
    """
    return (
        "SET QUOTED_IDENTIFIER OFF "
        'SELECT * FROM OpenQuery(INSQL, " '
        "SELECT DateTime, TagName, Value FROM History "
        "WHERE wwVersion = 'Latest' AND wwRetrievalMode = 'Cyclic' "
        f"AND wwResolution = {int(interval_ms)} "
        f"AND DateTime >= '{_quote(start)}' AND DateTime <= '{_quote(end)}' "
        f"AND History.TagName IN ('{_quote(tag)}') "
        '")'
    )


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class SqlServerAdapter(BaseHistorianAdapter):
    """Wonderware / InTouch Historian via MS SQL Server (INSQL linked server)."""

    DEFAULT_PORT = 1433

    @classmethod
    def is_available(cls) -> bool:
        return _HAS_PYMSSQL

    # ---- connection ----

    def _connect(self):
        if not _HAS_PYMSSQL:
            raise errors.AdapterDriverError("pymssql is not installed")
        s = self.server or {}
        host = s.get("host") or ""
        port = s.get("port") or self.DEFAULT_PORT
        user = s.get("username")
        password = s.get("password") or ""
        timeout = int(s.get("timeoutS", 15))
        try:
            return pymssql.connect(
                server=f"{host}:{port}",
                user=user,
                password=password,
                database=(s.get("extra") or {}).get("database", "Runtime"),
                login_timeout=timeout,
                timeout=timeout,
            )
        except Exception as exc:
            msg = str(exc).lower()
            if "timeout" in msg:
                raise errors.ConnectionTimeoutError(timeout) from exc
            if "login" in msg or "password" in msg or "authentication" in msg:
                raise errors.AuthFailed() from exc
            if "refused" in msg or "unreachable" in msg or "cannot connect" in msg:
                raise errors.ConnectionRefusedRpc(str(exc)) from exc
            raise errors.AdapterDriverError(str(exc)) from exc

    # ---- test_connection ----

    async def test_connection(self) -> dict:
        timeout_s = int((self.server or {}).get("timeoutS", 15))
        t0 = _time.monotonic()
        loop = asyncio.get_running_loop()

        def _probe() -> int:
            conn = self._connect()
            try:
                cur = conn.cursor()
                cur.execute("SELECT TOP 1 TagName FROM Runtime.dbo.Tag")
                _ = cur.fetchall()
                cur.execute("SELECT COUNT(*) FROM Runtime.dbo.Tag")
                row = cur.fetchone()
                return int(row[0]) if row and row[0] is not None else 0
            finally:
                conn.close()

        try:
            count = await asyncio.wait_for(
                loop.run_in_executor(None, _probe), timeout=timeout_s
            )
        except asyncio.TimeoutError as exc:
            raise errors.ConnectionTimeoutError(timeout_s) from exc
        latency_ms = int((_time.monotonic() - t0) * 1000)
        return {
            "ok": True,
            "latencyMs": latency_ms,
            "tagCount": count,
            "version": (self.server or {}).get("version") or "InTouch (SQL Server)",
        }

    # ---- list_tag_tree ----

    async def list_tag_tree(
        self, path: str | None = None, depth: int = 1
    ) -> list[dict]:
        loop = asyncio.get_running_loop()
        prefix = (path or "").strip()

        def _query() -> list[str]:
            conn = self._connect()
            try:
                cur = conn.cursor()
                # TODO: confirm actual Runtime.dbo.Tag schema against a live
                # InTouch Historian deployment; some installs expose the list
                # via Runtime.dbo.AnalogTag + Runtime.dbo.DiscreteTag unions.
                if prefix:
                    sql = (
                        "SELECT TagName FROM Runtime.dbo.Tag "
                        f"WHERE TagName LIKE '{_quote(prefix)}.%' "
                        "OR TagName LIKE '" + _quote(prefix) + "\\_%' ESCAPE '\\'"
                    )
                else:
                    sql = "SELECT TagName FROM Runtime.dbo.Tag"
                cur.execute(sql)
                rows = cur.fetchall()
                return [r[0] for r in rows if r and r[0]]
            finally:
                conn.close()

        try:
            tag_names = await loop.run_in_executor(None, _query)
        except errors.RpcError:
            raise
        except Exception as exc:
            raise errors.TagTreeFail(str(exc)) from exc

        return _build_tree_level(tag_names, prefix, depth)

    # ---- search_tags ----

    async def search_tags(
        self,
        query: str,
        limit: int = 100,
        offset: int = 0,
        filter_type: str | None = None,
    ) -> dict:
        q = (query or "").strip()
        limit = max(1, min(int(limit or 100), 500))
        offset = max(0, int(offset or 0))
        loop = asyncio.get_running_loop()

        def _query() -> list[tuple]:
            conn = self._connect()
            try:
                cur = conn.cursor()
                # Wonderware schema may or may not have Description column — try
                # the full select and degrade gracefully.
                where = ""
                if q:
                    ql = _quote(q)
                    where = f"WHERE TagName LIKE '%{ql}%' OR Description LIKE '%{ql}%'"
                sql = (
                    "SELECT TagName, Description, EngineeringUnit, TagType "
                    f"FROM Runtime.dbo.Tag {where} ORDER BY TagName"
                )
                try:
                    cur.execute(sql)
                except Exception:
                    # Fallback without description/unit — older schemas.
                    cur = conn.cursor()
                    fb_where = f"WHERE TagName LIKE '%{_quote(q)}%'" if q else ""
                    cur.execute(
                        f"SELECT TagName FROM Runtime.dbo.Tag {fb_where} ORDER BY TagName"
                    )
                return cur.fetchall()
            finally:
                conn.close()

        try:
            rows = await loop.run_in_executor(None, _query)
        except errors.RpcError:
            raise
        except Exception as exc:
            raise errors.AdapterDriverError(str(exc)) from exc

        items: list[dict] = []
        for row in rows:
            tagname = row[0]
            desc = row[1] if len(row) > 1 else ""
            unit = row[2] if len(row) > 2 else ""
            tagtype = row[3] if len(row) > 3 else None
            type_ = _classify_tag_type(tagtype)
            if filter_type in ("Analog", "Digital") and type_ != filter_type:
                continue
            items.append(
                {
                    "id": tagname,
                    "label": tagname,
                    "kind": "leaf",
                    "desc": desc or "",
                    "unit": unit or "",
                    "type": type_,
                    "dataType": str(tagtype) if tagtype is not None else "",
                }
            )
        total = len(items)
        return {"items": items[offset : offset + limit], "total": total}

    # ---- get_tag_meta ----

    async def get_tag_meta(self, tag_id: str) -> dict:
        loop = asyncio.get_running_loop()

        def _query() -> tuple | None:
            conn = self._connect()
            try:
                cur = conn.cursor()
                sql = (
                    "SELECT TagName, Description, EngineeringUnit, TagType, "
                    "MaxEU, MinEU "
                    "FROM Runtime.dbo.Tag "
                    f"WHERE TagName = '{_quote(tag_id)}'"
                )
                try:
                    cur.execute(sql)
                except Exception:
                    cur = conn.cursor()
                    cur.execute(
                        f"SELECT TagName FROM Runtime.dbo.Tag "
                        f"WHERE TagName = '{_quote(tag_id)}'"
                    )
                return cur.fetchone()
            finally:
                conn.close()

        try:
            row = await loop.run_in_executor(None, _query)
        except errors.RpcError:
            raise
        except Exception as exc:
            raise errors.AdapterDriverError(str(exc)) from exc

        if not row:
            raise errors.TagNotFoundError(tag_id)

        tagname = row[0]
        desc = row[1] if len(row) > 1 else ""
        unit = row[2] if len(row) > 2 else ""
        tagtype = row[3] if len(row) > 3 else None
        max_eu = row[4] if len(row) > 4 else None
        min_eu = row[5] if len(row) > 5 else None

        meta: dict = {
            "id": tagname,
            "label": tagname,
            "kind": "leaf",
            "desc": desc or "",
            "unit": unit or "",
            "type": _classify_tag_type(tagtype),
            "dataType": str(tagtype) if tagtype is not None else "",
            "description": desc or "",
        }
        try:
            if max_eu is not None:
                meta["max"] = float(max_eu)
            if min_eu is not None:
                meta["min"] = float(min_eu)
        except (TypeError, ValueError):
            pass
        return meta

    # ---- read_segment ----

    async def read_segment(
        self,
        tag_ids: list[str],
        start: datetime,
        end: datetime,
        sampling: str,
    ) -> AsyncIterator[dict]:
        if not tag_ids:
            return

        step_s = sampling_seconds(sampling)
        interval_ms = step_s * 1000
        start_s = _format_ts(start)
        end_s = _format_ts(end)
        loop = asyncio.get_running_loop()

        def _run(tag: str) -> list[tuple]:
            conn = self._connect()
            try:
                cur = conn.cursor()
                sql = build_openquery_sql(tag, start_s, end_s, interval_ms)
                log.debug("sqlserver read_segment SQL: %s", sql)
                cur.execute(sql)
                return cur.fetchall()
            finally:
                conn.close()

        per_tag: dict[str, dict[str, object]] = {}  # tagname → {dt: value}
        all_ts: set[str] = set()
        for tag in tag_ids:
            try:
                rows = await loop.run_in_executor(None, _run, tag)
            except errors.RpcError:
                raise
            except Exception as exc:
                raise errors.AdapterDriverError(str(exc)) from exc
            tag_map: dict[str, object] = {}
            for r in rows:
                if not r:
                    continue
                # Legacy view ordering: DateTime, TagName, Value.
                dt = r[0]
                val = r[2] if len(r) > 2 else None
                dt_s = _format_dt_cell(dt)
                tag_map[dt_s] = val
                all_ts.add(dt_s)
            per_tag[tag] = tag_map

        # Emit rows in ascending timestamp order.
        for ts in sorted(all_ts):
            yield {
                "time": ts,
                "values": [per_tag.get(t, {}).get(ts) for t in tag_ids],
                "quality": [
                    "Good" if per_tag.get(t, {}).get(ts) is not None else "Bad"
                    for t in tag_ids
                ],
            }

    # ---- preview_sample ----

    async def preview_sample(
        self,
        tag_ids: list[str],
        start: datetime,
        end: datetime,
        sampling: str,
        max_points: int = 240,
    ) -> dict:
        times: list[str] = []
        values: list[list] = [[] for _ in tag_ids]
        quality: list[list[str]] = [[] for _ in tag_ids]
        n = 0
        async for row in self.read_segment(tag_ids, start, end, sampling):
            times.append(row["time"])
            for idx in range(len(tag_ids)):
                values[idx].append(row["values"][idx])
                quality[idx].append(row["quality"][idx])
            n += 1
            if n >= max_points:
                break
        return {
            "times": times,
            "values": values,
            "quality": quality,
            "tags": [{"id": t, "label": t} for t in tag_ids],
            "truncated": n >= max_points,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DIGITAL_TYPES = {"Discrete", "Digital", "Bit", "Bool", "Boolean"}


def _classify_tag_type(tagtype) -> str:
    if tagtype is None:
        return "Analog"
    if isinstance(tagtype, int):
        # Wonderware TagType enum: historically 1=Analog, 2=Discrete, 3=String,
        # ... but builds vary; err on "Analog" for unknown numeric codes.
        return "Digital" if tagtype == 2 else "Analog"
    s = str(tagtype).strip()
    return "Digital" if s in _DIGITAL_TYPES else "Analog"


def _format_dt_cell(cell) -> str:
    """Normalise a DB datetime cell → ISO-ish 'YYYY-MM-DD HH:MM:SS' string."""
    if cell is None:
        return ""
    if isinstance(cell, datetime):
        dt = cell if cell.tzinfo else cell.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    return str(cell)


def _build_tree_level(tag_names: list[str], prefix: str, depth: int) -> list[dict]:
    """Split tagnames on '.' or '_' and fold into folder/leaf nodes.

    Wonderware tagnames typically use ``.`` (``AREA.EQUIP.ATTR``) but older
    InTouch exports use ``_`` — treat both as separators so either works.
    """

    # Normalise separators to '.' for grouping purposes but keep IDs intact.
    def parts_of(name: str) -> list[str]:
        s = name.replace("_", ".")
        return s.split(".")

    prefix_parts = parts_of(prefix) if prefix else []
    plen = len(prefix_parts)

    children: dict[str, dict] = {}
    leaves: list[tuple[str, str]] = []  # (full_id, label)

    for name in tag_names:
        p = parts_of(name)
        if plen and p[:plen] != prefix_parts:
            continue
        remainder = p[plen:]
        if not remainder:
            continue
        if len(remainder) == 1:
            leaves.append((name, remainder[0]))
            continue
        head = remainder[0]
        full_head = ".".join(prefix_parts + [head]) if prefix_parts else head
        bucket = children.setdefault(full_head, {"leaves": set(), "raw": []})
        bucket["leaves"].add(name)
        bucket["raw"].append(name)

    out: list[dict] = []
    for full_id, label in leaves:
        out.append({"id": full_id, "label": label, "kind": "leaf"})
    for full_head, bucket in children.items():
        short = full_head.split(".")[-1]
        node: dict = {
            "id": full_head,
            "label": short,
            "kind": "folder",
            "count": len(bucket["leaves"]),
            "hasChildren": True,
        }
        if depth > 1:
            node["children"] = _build_tree_level(bucket["raw"], full_head, depth - 1)
        out.append(node)
    out.sort(key=lambda n: (0 if n["kind"] == "folder" else 1, n["label"].lower()))
    return out
