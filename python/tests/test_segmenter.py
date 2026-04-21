"""Segmenter boundary tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from services.segmenter import split_segments


UTC = timezone.utc


def _dt(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=UTC)


def test_even_division():
    start = _dt(2026, 4, 1)
    end = _dt(2026, 4, 11)  # 10 days
    segs = split_segments(start, end, 2)
    assert len(segs) == 5
    assert segs[0].start == start
    assert segs[-1].end == end
    # contiguous, no gaps
    for prev, nxt in zip(segs, segs[1:]):
        assert prev.end == nxt.start


def test_uneven_last_segment_is_clamped():
    start = _dt(2026, 4, 1)
    end = _dt(2026, 4, 10, 12)  # 9.5 days
    segs = split_segments(start, end, 2)
    assert len(segs) == 5
    assert segs[-1].end == end
    # Last segment shorter than 2 days
    assert (segs[-1].end - segs[-1].start) < timedelta(days=2)


def test_end_equals_segment_boundary_no_empty_trailing():
    start = _dt(2026, 4, 1)
    end = _dt(2026, 4, 8)  # exactly 7 days
    segs = split_segments(start, end, 7)
    assert len(segs) == 1
    assert segs[0].start == start
    assert segs[0].end == end


def test_single_day_total_with_one_day_segments():
    start = _dt(2026, 4, 1)
    end = _dt(2026, 4, 2)
    segs = split_segments(start, end, 1)
    assert len(segs) == 1


def test_invalid_segment_days_raises():
    with pytest.raises(ValueError):
        split_segments(_dt(2026, 4, 1), _dt(2026, 4, 2), 0)
    with pytest.raises(ValueError):
        split_segments(_dt(2026, 4, 1), _dt(2026, 4, 2), 31)


def test_invalid_range_raises():
    with pytest.raises(ValueError):
        split_segments(_dt(2026, 4, 2), _dt(2026, 4, 1), 1)
    with pytest.raises(ValueError):
        split_segments(_dt(2026, 4, 1), _dt(2026, 4, 1), 1)


def test_indices_are_sequential_from_zero():
    segs = split_segments(_dt(2026, 1, 1), _dt(2026, 3, 1), 7)
    assert [s.index for s in segs] == list(range(len(segs)))
