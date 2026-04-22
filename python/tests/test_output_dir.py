"""Tests for :mod:`services.writers` output-dir handling.

Covers the three invariants that the Wave 4 bug-fix relies on:

1. ``~`` / ``$HOME`` is expanded to the user's home directory
   (so the tilde does not become a literal directory component).
2. Relative paths are resolved to absolute paths so the sidecar's
   output does not depend on its current working directory.
3. A read-only parent surfaces as :class:`errors.OutputDirUnwritable`
   (mapped to JSON-RPC code ``-32023``).
"""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

import pytest

from rpc import errors
from services.writers import ensure_output_dir, resolve_output_dir

# ---------------------------------------------------------------------------
# resolve_output_dir — pure path resolution (no filesystem side effects)
# ---------------------------------------------------------------------------


def test_resolve_expands_tilde(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    # On some platforms pathlib uses USERPROFILE / HOMEDRIVE+HOMEPATH; override
    # those too so the assertion is deterministic.
    monkeypatch.setenv("USERPROFILE", str(tmp_path))

    resolved = resolve_output_dir("~/foo")
    assert resolved == tmp_path / "foo"
    assert "~" not in str(resolved)


def test_resolve_absolutizes_relative(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    resolved = resolve_output_dir("sub/dir")
    assert resolved.is_absolute()
    assert (
        resolved == (tmp_path / "sub" / "dir").resolve()
        or resolved == tmp_path / "sub" / "dir"
    )


def test_resolve_preserves_absolute(tmp_path):
    resolved = resolve_output_dir(str(tmp_path / "already" / "abs"))
    assert resolved == tmp_path / "already" / "abs"


# ---------------------------------------------------------------------------
# ensure_output_dir — creates the directory and probes writability
# ---------------------------------------------------------------------------


def test_ensure_creates_directory(tmp_path):
    target = tmp_path / "created" / "nested"
    out = ensure_output_dir(target)
    assert out.exists() and out.is_dir()
    # Probe file cleaned up.
    assert not (out / ".hd_write_probe").exists()


def test_ensure_expands_tilde(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    out = ensure_output_dir("~/exports/historian")
    assert out == tmp_path / "exports" / "historian"
    assert out.exists()


@pytest.mark.skipif(
    sys.platform == "win32",
    reason="POSIX permission bits — Windows ACLs behave differently",
)
def test_ensure_raises_when_unwritable(tmp_path):
    # Make a directory, then drop all write permissions on its parent so we
    # cannot create or probe inside it.
    parent = tmp_path / "ro_parent"
    parent.mkdir()
    child = parent / "child"
    child.mkdir()
    # Remove write perms from child so the probe file cannot be written.
    child.chmod(stat.S_IRUSR | stat.S_IXUSR)
    try:
        # Root bypasses permission checks — skip if running as root.
        if os.geteuid() == 0:  # type: ignore[attr-defined]
            pytest.skip("running as root — permission bits are ignored")
        with pytest.raises(errors.OutputDirUnwritable) as exc:
            ensure_output_dir(child)
        assert exc.value.code == errors.OUTPUT_DIR_UNWRITABLE
        assert str(child) in exc.value.message
    finally:
        child.chmod(stat.S_IRWXU)
