from __future__ import annotations

import pytest

from util.time import sampling_seconds


@pytest.mark.parametrize(
    ("sampling", "seconds"),
    [
        ("raw", 5),
        ("1m", 60),
        ("5m", 300),
        ("15m", 900),
        ("30m", 1800),
        ("60m", 3600),
        ("7m", 420),
        ("1h", 3600),
    ],
)
def test_sampling_seconds_supports_presets_and_custom_minutes(sampling: str, seconds: int):
    assert sampling_seconds(sampling) == seconds


@pytest.mark.parametrize("sampling", ["0m", "-5m", "abc", "custom", "2h"])
def test_sampling_seconds_rejects_invalid_values(sampling: str):
    with pytest.raises(ValueError, match="unknown sampling"):
        sampling_seconds(sampling)
