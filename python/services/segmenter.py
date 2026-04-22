"""Split a time range into contiguous segments of N days (no overlaps)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class Segment:
    index: int  # 0-based
    start: datetime
    end: datetime


def split_segments(start: datetime, end: datetime, segment_days: int) -> list[Segment]:
    """Return a list of segments covering [start, end) exactly (no overlap, no gap).

    The final segment may be shorter than ``segment_days`` — clamped to ``end``.
    Raises ValueError on invalid input.
    """
    if end <= start:
        raise ValueError("end must be strictly after start")
    if segment_days < 1 or segment_days > 30:
        raise ValueError(f"segment_days out of range: {segment_days}")

    step = timedelta(days=int(segment_days))
    out: list[Segment] = []
    cursor = start
    idx = 0
    while cursor < end:
        seg_end = cursor + step
        if seg_end > end:
            seg_end = end
        out.append(Segment(index=idx, start=cursor, end=seg_end))
        cursor = seg_end
        idx += 1
    return out
