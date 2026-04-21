"""Cross-platform machine identifier retrieval.

Used to derive a local encryption key for credentials. Fall back to a random
UUID persisted under ``$HD_USER_DATA_DIR/.machine-id`` when the platform ID is
unavailable (e.g., sandboxed runtime, headless Linux without systemd).

This is NOT a cryptographic guarantee of identity; it's a "better than a
hard-coded salt" defense-in-depth tier that mirrors what most desktop apps do
for AES-GCM with a locally-derived key.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path


log = logging.getLogger(__name__)

_CACHE: str | None = None


def _read_macos_platform_uuid() -> str | None:
    """Use ioreg to grab IOPlatformUUID on macOS."""
    try:
        out = subprocess.run(
            ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
            capture_output=True,
            text=True,
            timeout=5.0,
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError) as exc:
        log.debug("ioreg unavailable: %s", exc)
        return None
    if out.returncode != 0:
        return None
    m = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', out.stdout)
    return m.group(1) if m else None


def _read_windows_uuid() -> str | None:
    """Query ``wmic csproduct get UUID`` on Windows."""
    try:
        out = subprocess.run(
            ["wmic", "csproduct", "get", "UUID"],
            capture_output=True,
            text=True,
            timeout=10.0,
            check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError) as exc:
        log.debug("wmic unavailable: %s", exc)
        return None
    if out.returncode != 0:
        return None
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line or line.lower() == "uuid":
            continue
        # Filter out obvious placeholders like "FFFFFFFF-FFFF-FFFF..."
        if line and not line.upper().startswith("FFFFFFFF"):
            return line
    return None


def _read_linux_machine_id() -> str | None:
    for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            data = Path(path).read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if data:
            return data
    return None


def _fallback_random(user_data_dir: Path | None = None) -> str:
    """Generate + persist a random machine id under user_data_dir/.machine-id."""
    if user_data_dir is None:
        # Defer import to avoid circulars.
        from util.paths import user_data_dir as _udir
        user_data_dir = _udir()
    path = Path(user_data_dir) / ".machine-id"
    try:
        existing = path.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    except OSError:
        pass
    new_id = uuid.uuid4().hex
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new_id, encoding="utf-8")
        log.info("machine-id: generated new random id at %s", path)
    except OSError as exc:
        log.warning("machine-id: failed to persist fallback id (%s); using ephemeral", exc)
    return new_id


def get_machine_id(user_data_dir: Path | None = None) -> str:
    """Return a stable machine identifier.

    The result is cached for the lifetime of the process. Sources:
      - macOS → IOPlatformUUID (ioreg)
      - Windows → ``wmic csproduct get UUID``
      - Linux → /etc/machine-id or /var/lib/dbus/machine-id
      - fallback → random UUID persisted under ``user_data_dir/.machine-id``
    """
    global _CACHE
    if _CACHE:
        return _CACHE

    raw: str | None = None
    env_override = os.environ.get("HD_MACHINE_ID")
    if env_override:
        raw = env_override.strip()
    elif sys.platform == "darwin":
        raw = _read_macos_platform_uuid()
    elif sys.platform == "win32":
        raw = _read_windows_uuid()
    elif sys.platform.startswith("linux"):
        raw = _read_linux_machine_id()

    if not raw:
        raw = _fallback_random(user_data_dir)

    _CACHE = raw
    return raw


def _reset_cache_for_tests() -> None:
    """Test hook — clear cached id so tests can swap env/fs state."""
    global _CACHE
    _CACHE = None
