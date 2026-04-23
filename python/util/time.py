"""Time utilities — ISO 8601 parse/format and preset→range expansion."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    """ISO 8601 UTC with millisecond precision, e.g. 2026-04-21T08:00:00.000Z."""
    return format_iso(now_utc())


def format_iso(dt: datetime) -> str:
    """Format a datetime as 'YYYY-MM-DDTHH:MM:SS.sssZ' (UTC)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse_iso(value: str) -> datetime:
    """Parse an ISO 8601 string to a timezone-aware UTC datetime.

    Accepts:
      - 2026-04-21T08:00:00Z
      - 2026-04-21T08:00:00.000Z
      - 2026-04-21T08:00:00+00:00
      - 2026-04-21 08:00:00 (treated as naive/UTC)
    """
    s = value.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    # Allow space separator.
    if "T" not in s and " " in s:
        s = s.replace(" ", "T", 1)
    try:
        dt = datetime.fromisoformat(s)
    except ValueError as e:
        raise ValueError(f"invalid iso8601 timestamp: {value!r}") from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


_PRESET_DELTAS: dict[str, timedelta] = {
    "last-1h": timedelta(hours=1),
    "last-24h": timedelta(hours=24),
    "last-7d": timedelta(days=7),
    "last-30d": timedelta(days=30),
    "last-90d": timedelta(days=90),
    "last-y": timedelta(days=365),
}


def preset_to_range(
    preset_id: str, now: datetime | None = None
) -> tuple[datetime, datetime]:
    """Return (start, end) for a preset id. Raises KeyError for unknown preset."""
    delta = _PRESET_DELTAS[preset_id]
    end = now or now_utc()
    start = end - delta
    return start, end


def validate_range(start: datetime, end: datetime) -> None:
    """Raise ValueError if the range is invalid."""
    if start >= end:
        raise ValueError(f"start >= end: {format_iso(start)} >= {format_iso(end)}")


SAMPLING_SECONDS: dict[str, int] = {
    "raw": 5,
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "60m": 3600,
    "1h": 3600,
}


def sampling_seconds(sampling: str) -> int:
    try:
        return SAMPLING_SECONDS[sampling]
    except KeyError:
        pass

    match = re.fullmatch(r"([1-9]\d*)m", sampling)
    if match:
        return int(match.group(1)) * 60

    raise ValueError(f"unknown sampling: {sampling}")
