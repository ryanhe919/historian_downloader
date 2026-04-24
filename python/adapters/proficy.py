"""Proficy Historian (iFix) adapter.

Windows-only; uses ADODB via ``win32com.client`` (pywin32) and the
``ihtrend`` / ``ihtags`` SQL templates migrated from
``AIModelAPI/apps/historian_api/views.py``.

On non-Windows hosts ``is_available()`` returns False and the factory falls
back to ``MockAdapter`` — so importing this file on macOS is safe (no COM
call happens at import time).
"""

from __future__ import annotations

import asyncio
import logging
import sys
import time as _time
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator

from rpc import errors
from util.time import format_iso, sampling_seconds

from . import _oledb
from .base import BaseHistorianAdapter

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lazy imports for pythoncom — defer platform-specific imports
# ---------------------------------------------------------------------------


def _get_pythoncom():
    """Return the pythoncom module or None if unavailable."""
    try:
        import pythoncom  # type: ignore

        return pythoncom
    except ImportError:
        return None


# ---------------------------------------------------------------------------
# Datatype mapping — iFix ihtags.datatype → RPC TagNode.type
# ---------------------------------------------------------------------------

_DIGITAL_DATATYPES = {"DI", "DO", "BO", "BL", "BOOL", "BOOLEAN", "DIGITAL"}


def _classify_type(datatype: str | None) -> str:
    if not datatype:
        return "Analog"
    up = str(datatype).strip().upper()
    if up in _DIGITAL_DATATYPES:
        return "Digital"
    return "Analog"


def _quote(val: str) -> str:
    """Escape single quotes for SQL string literals."""
    return str(val).replace("'", "''")


def _format_ts_for_ihtrend(dt: datetime) -> str:
    """Proficy ihtrend expects 'YYYY-MM-DD HH:MM:SS' UTC strings (legacy view did the same)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# Helpers ported from AIModelAPI/.../views.py (__split_tags / __get_sql /
# __read_data). Kept standalone so they're unit-testable without COM.
# ---------------------------------------------------------------------------


def split_tags(tags: list[str], n: int) -> list[list[str]]:
    """Split tag list into chunks of size ``n`` (used for ihtrend batching)."""
    if len(tags) < 1:
        raise ValueError("split_tags: empty input")
    return [tags[i : i + n] for i in range(0, len(tags), n)]


def build_ihtrend_sql(
    tags: list[str],
    start_time: str,
    end_time: str,
    interval_ms: int,
    sampling_mode: str = "Lab",
) -> str:
    """Compose the ``SELECT ... FROM ihtrend`` query for a tag batch.

    Mirrors the legacy ``HistorianDataView.__get_sql`` template, generalised to
    accept an explicit ``interval_ms`` (so raw / minute / hour modes work) and
    ``SamplingMode`` (Lab, Raw, Interpolated, ...).
    """
    features = "timestamp, " + ", ".join(f"{t}.value" for t in tags)
    filters = [
        f"intervalmilliseconds={int(interval_ms)}",
        f"timestamp>='{_quote(start_time)}'",
        f"timestamp<='{_quote(end_time)}'",
        f"SamplingMode={sampling_mode}",
    ]
    return (
        f"SELECT {features} FROM ihtrend "
        f"WHERE {' AND '.join(filters)} "
        f"ORDER BY timestamp"
    )


def read_ihtrend(conn, sql: str) -> list[list]:
    """Execute ``sql`` on the given ADODB connection and normalise timestamps.

    Returns a list of rows where the first column is an ISO-8601 string
    truncated to seconds (matching the legacy view behaviour).
    """
    cursor = conn.cursor()
    cursor.execute(sql)
    rows = cursor.fetchall()
    out: list[list] = []
    for r in rows:
        ts_raw = r[0]
        if hasattr(ts_raw, "timestamp"):
            ts = datetime.fromtimestamp(ts_raw.timestamp(), tz=timezone.utc)
            r[0] = ts.strftime("%Y-%m-%d %H:%M:%S")
        out.append(r)
    cursor.close()
    return out


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------


class ProficyHistorianAdapter(BaseHistorianAdapter):
    """GE Proficy iFix Historian adapter (Windows + ADODB)."""

    DEFAULT_PROVIDER = "iHOLEDB.iHistorian.1"
    TAG_BATCH_SIZE = 20  # tags per ihtrend query (legacy default)
    TIME_CHUNK_MIN = 3  # chunk window = interval_min * 1440 * TIME_CHUNK_MIN
    QUERY_DELAY_S = 15  # small backoff between SQL calls to ease server load

    @classmethod
    def is_available(cls) -> bool:
        """True iff pywin32 + pythoncom are importable. Always False on non-Windows."""
        if sys.platform != "win32":
            return False
        return _oledb.is_available() and _get_pythoncom() is not None

    # ---- connection ----

    def _open_connection(self):
        """Dispatch the ADODB connection. Raises an RpcError subclass on failure."""
        if not self.is_available():
            raise errors.OleComUnavailable()
        pythoncom = _get_pythoncom()
        if pythoncom is not None:
            try:
                pythoncom.CoInitialize()
            except Exception as exc:  # pragma: no cover — Windows-only
                log.warning("CoInitialize failed: %s", exc)

        s = self.server or {}
        try:
            conn = _oledb.connect(
                dsn=s.get("dsn") or s.get("host"),
                host=s.get("host"),
                user=s.get("username"),
                password=s.get("password") or "",
                provider=(s.get("extra") or {}).get("provider")
                or self.DEFAULT_PROVIDER,
            )
        except Exception as exc:  # pragma: no cover — Windows COM failures
            msg = str(exc).lower()
            if "timeout" in msg:
                raise errors.ConnectionTimeoutError(int(s.get("timeoutS", 15))) from exc
            if "login" in msg or "authentication" in msg or "password" in msg:
                raise errors.AuthFailed() from exc
            if "refused" in msg or "unreachable" in msg:
                raise errors.ConnectionRefusedRpc(str(exc)) from exc
            raise errors.AdapterDriverError(str(exc)) from exc
        return conn

    async def test_connection(self) -> dict:
        timeout_s = int((self.server or {}).get("timeoutS", 15))
        t0 = _time.monotonic()
        loop = asyncio.get_running_loop()

        def _probe() -> dict:
            conn = self._open_connection()
            try:
                cur = conn.cursor()
                cur.execute("SELECT tagname FROM ihtags")
                # Peek the first row (driver may not support TOP 1 in all builds);
                # fetch a bounded sample so the call returns quickly even on big servers.
                sample = cur.fetchmany(500)
                cur.close()
                tag_count = len(sample)
            finally:
                conn.close()
            return {"tagCount": tag_count}

        try:
            res = await asyncio.wait_for(
                loop.run_in_executor(None, _probe), timeout=timeout_s
            )
        except asyncio.TimeoutError as exc:
            raise errors.ConnectionTimeoutError(timeout_s) from exc
        latency_ms = int((_time.monotonic() - t0) * 1000)
        return {
            "ok": True,
            "latencyMs": latency_ms,
            "tagCount": res.get("tagCount", 0),
            "version": (self.server or {}).get("version") or "Proficy iFix",
        }

    # ---- tag browsing ----

    async def list_tag_tree(
        self, path: str | None = None, depth: int = 1
    ) -> list[dict]:
        loop = asyncio.get_running_loop()
        prefix = (path or "").strip()

        def _query() -> list[str]:
            conn = self._open_connection()
            try:
                cur = conn.cursor()
                if prefix:
                    sql = f"SELECT tagname FROM ihtags WHERE tagname LIKE '{_quote(prefix)}.%'"
                else:
                    sql = "SELECT tagname FROM ihtags"
                cur.execute(sql)
                names = [r[0] for r in cur.fetchall() if r and r[0]]
                cur.close()
                return names
            finally:
                conn.close()

        try:
            tag_names = await loop.run_in_executor(None, _query)
            await asyncio.sleep(self.QUERY_DELAY_S)
        except errors.RpcError:
            raise
        except Exception as exc:
            raise errors.TagTreeFail(str(exc)) from exc

        return _build_tree_level(tag_names, prefix, depth)

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
            conn = self._open_connection()
            try:
                cur = conn.cursor()
                # Proficy OLE DB doesn't support OFFSET reliably — pull, slice in Python.
                where = ""
                if q:
                    ql = _quote(q)
                    where = f"WHERE tagname LIKE '%{ql}%' OR description LIKE '%{ql}%'"
                sql = (
                    "SELECT tagname, description, engunits, datatype "
                    f"FROM ihtags {where} ORDER BY tagname"
                )
                cur.execute(sql)
                rows = cur.fetchall()
                cur.close()
                return rows
            finally:
                conn.close()

        try:
            rows = await loop.run_in_executor(None, _query)
            await asyncio.sleep(self.QUERY_DELAY_S)
        except errors.RpcError:
            raise
        except Exception as exc:
            raise errors.AdapterDriverError(str(exc)) from exc

        items: list[dict] = []
        for row in rows:
            tagname = row[0]
            desc = row[1] if len(row) > 1 else None
            unit = row[2] if len(row) > 2 else None
            dtype = row[3] if len(row) > 3 else None
            type_ = _classify_type(dtype)
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
                    "dataType": dtype or "",
                }
            )
        total = len(items)
        return {"items": items[offset : offset + limit], "total": total}

    async def get_tag_meta(self, tag_id: str) -> dict:
        loop = asyncio.get_running_loop()

        def _query() -> list | None:
            conn = self._open_connection()
            try:
                cur = conn.cursor()
                sql = (
                    "SELECT tagname, description, engunits, datatype, "
                    "hirange, lorange, samplingperiod "
                    f"FROM ihtags WHERE tagname='{_quote(tag_id)}'"
                )
                cur.execute(sql)
                row = cur.fetchone()
                cur.close()
                return row
            finally:
                conn.close()

        try:
            row = await loop.run_in_executor(None, _query)
            await asyncio.sleep(self.QUERY_DELAY_S)
        except errors.RpcError:
            raise
        except Exception as exc:
            raise errors.AdapterDriverError(str(exc)) from exc

        if not row:
            raise errors.TagNotFoundError(tag_id)

        tagname = row[0]
        desc = row[1] or ""
        unit = row[2] or ""
        dtype = row[3] or ""
        hirange = row[4]
        lorange = row[5]
        sampling_period = row[6]

        out = {
            "id": tagname,
            "label": tagname,
            "kind": "leaf",
            "desc": desc,
            "unit": unit,
            "type": _classify_type(dtype),
            "dataType": dtype,
            "description": desc,
        }
        try:
            if hirange is not None:
                out["max"] = float(hirange)
            if lorange is not None:
                out["min"] = float(lorange)
        except (TypeError, ValueError):
            pass
        if sampling_period is not None:
            try:
                # Proficy samplingperiod is in milliseconds in most builds.
                out["sampleIntervalMs"] = int(sampling_period)
            except (TypeError, ValueError):
                pass
        return out

    # ---- read segment ----

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
        sampling_mode = "Raw" if sampling == "raw" else "Lab"

        # Chunk timeline into ``TIME_CHUNK_MIN * interval_min * day`` windows
        # as the legacy code did — keeps Proficy ihtrend happy on long ranges.
        interval_min = max(1, step_s // 60)
        chunk_minutes = interval_min * 1440 * self.TIME_CHUNK_MIN
        time_chunks = _split_times(start, end, chunk_minutes)

        tag_batches = split_tags(tag_ids, self.TAG_BATCH_SIZE)
        loop = asyncio.get_running_loop()

        def _run_one(
            tag_batch: list[str], chunk_start: datetime, chunk_end: datetime
        ) -> list[list]:
            conn = self._open_connection()
            try:
                sql = build_ihtrend_sql(
                    tag_batch,
                    _format_ts_for_ihtrend(chunk_start),
                    _format_ts_for_ihtrend(chunk_end),
                    interval_ms,
                    sampling_mode=sampling_mode,
                )
                log.debug("proficy read_segment SQL: %s", sql)
                return read_ihtrend(conn, sql)
            finally:
                conn.close()

        # Merge batches by timestamp as we stream.
        for c_start, c_end in time_chunks:
            merged: dict[str, dict[str, float]] = {}
            order: list[str] = []
            for batch in tag_batches:
                try:
                    rows = await loop.run_in_executor(
                        None, _run_one, batch, c_start, c_end
                    )
                    await asyncio.sleep(self.QUERY_DELAY_S)
                except errors.RpcError:
                    raise
                except Exception as exc:
                    raise errors.AdapterDriverError(str(exc)) from exc
                for row in rows:
                    ts = row[0]
                    if ts not in merged:
                        merged[ts] = {}
                        order.append(ts)
                    for i, tag in enumerate(batch, start=1):
                        if i < len(row):
                            merged[ts][tag] = row[i]

            for ts in order:
                row_vals = merged[ts]
                yield {
                    "time": ts,
                    "values": [row_vals.get(t) for t in tag_ids],
                    "quality": [
                        "Good" if row_vals.get(t) is not None else "Bad"
                        for t in tag_ids
                    ],
                }

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
        tags = [{"id": t, "label": t} for t in tag_ids]
        return {
            "times": times,
            "values": values,
            "quality": quality,
            "tags": tags,
            "truncated": n >= max_points,
        }


# ---------------------------------------------------------------------------
# Tag-tree assembly — keep historian tag names flat for the UI
# ---------------------------------------------------------------------------


def _build_tree_level(tag_names: list[str], prefix: str, depth: int) -> list[dict]:
    """Return flat leaf nodes without splitting dotted tag names.

    Users expect ``AREA1.EQUIP.TEMP`` to remain a single selectable label,
    not a synthetic folder chain. ``prefix`` is treated as an optional
    startswith filter for compatibility with the RPC shape.
    """
    prefix_dot = f"{prefix}." if prefix else ""
    out: list[dict] = []
    seen: set[str] = set()

    for name in tag_names:
        if prefix and not (name == prefix or name.startswith(prefix_dot)):
            continue
        if name in seen:
            continue
        seen.add(name)
        out.append({"id": name, "label": name, "kind": "leaf"})

    out.sort(key=lambda n: n["label"].lower())
    return out


def _split_times(
    start: datetime, end: datetime, chunk_minutes: int
) -> list[tuple[datetime, datetime]]:
    """Mirror of legacy ``__split_times`` using real datetimes (UTC)."""
    if chunk_minutes <= 0:
        return [(start, end)]
    chunks: list[tuple[datetime, datetime]] = []
    cur = start
    step = timedelta(minutes=chunk_minutes)
    while cur < end:
        nxt = min(cur + step, end)
        chunks.append((cur, nxt))
        cur = nxt
    if not chunks:
        chunks.append((start, end))
    return chunks
