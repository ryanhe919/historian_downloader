"""Path utilities — locate user data / default output directories."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def user_data_dir() -> Path:
    """Return the sidecar's user-data directory.

    Priority:
      1. env var ``HD_USER_DATA_DIR`` (injected by Electron main).
      2. OS-specific fallbacks so the sidecar also runs standalone for dev.
    """
    env = os.environ.get("HD_USER_DATA_DIR")
    if env:
        p = Path(env)
        p.mkdir(parents=True, exist_ok=True)
        return p

    home = Path.home()
    if sys.platform == "darwin":
        p = home / "Library" / "Application Support" / "HistorianDownloader"
    elif sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(home)
        p = Path(base) / "HistorianDownloader"
    else:
        p = home / ".local" / "share" / "HistorianDownloader"
    p.mkdir(parents=True, exist_ok=True)
    return p


def default_output_dir() -> Path:
    """Default export directory (per architecture §8.4)."""
    home = Path.home()
    if sys.platform == "win32":
        d = Path("D:/Historian/Exports")
        try:
            d.mkdir(parents=True, exist_ok=True)
            return d
        except OSError:
            return home / "Documents" / "Historian" / "Exports"
    return home / "Historian" / "Exports"
