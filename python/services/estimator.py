"""Rough size/row estimators for export preflight."""

from __future__ import annotations

from datetime import datetime

from util.time import sampling_seconds

# Bytes per row (average) for each format — derived from empirical CSV/JSON runs.
_BYTES_PER_ROW_PER_TAG: dict[str, int] = {
    "CSV": 22,
    "Excel": 35,
    "JSON": 80,
}


def estimate_rows(start: datetime, end: datetime, sampling: str) -> int:
    step = sampling_seconds(sampling)
    seconds = max(0.0, (end - start).total_seconds())
    return int(seconds // step)


def estimate_size_bytes(
    rows: int,
    tag_count: int,
    fmt: str = "CSV",
    include_quality: bool = False,
) -> int:
    per = _BYTES_PER_ROW_PER_TAG.get(fmt, 25)
    if include_quality:
        per += 6
    # +32 bytes for timestamp column per row.
    return rows * (32 + per * max(1, tag_count))
