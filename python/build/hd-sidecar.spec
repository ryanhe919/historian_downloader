# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Historian Downloader Python sidecar.

Build command (from repo root):
    cd python && python -m PyInstaller build/hd-sidecar.spec \\
        --noconfirm --distpath ../resources --workpath build-temp --clean

Outputs an ONEDIR bundle at ``<repo>/resources/hd-sidecar/`` — the
top-level executable is ``resources/hd-sidecar/hd-sidecar(.exe)`` and
all its compiled extensions + shared libraries sit alongside it
(in a ``_internal`` subdir on PyInstaller >= 6).

Why onedir and not onefile?
  PyInstaller onefile packs everything into a single self-extracting
  exe that unpacks to ``%TEMP%\\_MEIxxxxxx`` on every launch.  On
  Windows this has two nasty production failure modes:

    1. First-run cold start takes 10–30 s — Windows Defender's
       real-time scan hits every freshly unpacked .pyd / .dll — and
       the Electron RPC handshake often times out against this.
    2. Some AV / EDR products block the bootloader's self-extraction
       as "suspicious behaviour" and the sidecar never even reaches
       main.py.  The "sidecar not connected" banner observed in
       v0.0.7 matched this failure mode exactly.

  Onedir has none of this — exe + deps live on disk next to the
  installer, startup is millisecond-grade, and debugging is easier
  (you can ``ls`` the folder to verify what shipped).

The spec is cross-platform: ``sys.platform`` branches below select
the hidden imports / icon appropriate for the current builder host.
(PyInstaller itself cannot cross-compile; each target OS must run
its own build, but this one spec is reused on macOS / Windows /
Linux CI runners.)
"""

# pyright: reportUndefinedVariable=false

from __future__ import annotations

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
# ``SPECPATH`` is injected by PyInstaller and points to the directory
# containing this spec file (``<repo>/python/build``).
SPEC_DIR = Path(SPECPATH).resolve()  # noqa: F821  (injected)
PYTHON_DIR = SPEC_DIR.parent                 # <repo>/python
REPO_ROOT = PYTHON_DIR.parent                # <repo>
ENTRY_SCRIPT = str(PYTHON_DIR / "main.py")
DIST_DIR = str(REPO_ROOT / "resources")  # onedir: COLLECT appends "hd-sidecar/"
WORK_DIR = str(PYTHON_DIR / "build-temp")

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"

if not IS_WIN:
    import warnings

    warnings.warn(
        "hd-sidecar.spec: building on a non-Windows host. The product ships "
        "Windows-only; this bundle is for local development only and must "
        "NOT be committed or shipped. Production builds run on windows-latest CI.",
        stacklevel=1,
    )

# --------------------------------------------------------------------------- #
# Hidden imports
# --------------------------------------------------------------------------- #
# Base: stdlib modules PyInstaller sometimes fails to see because they are
# imported lazily by our sidecar.
hiddenimports: list[str] = [
    "asyncio",
    "sqlite3",
    # main.py imports this via a try/except ImportError block, which some
    # older PyInstaller versions skip. The file itself is generated at
    # build time by scripts/write-python-version.mjs.
    "_generated_version",
]

# cryptography (used by ``util/crypto.py`` for AES-GCM).  The Rust bindings
# and AEAD primitives are imported dynamically; PyInstaller needs the hints.
hiddenimports += [
    "cryptography",
    "cryptography.hazmat.bindings._rust",
    "cryptography.hazmat.primitives.ciphers.aead",
]
# Pull in the full cryptography submodule graph to be safe across versions.
try:
    hiddenimports += collect_submodules("cryptography.hazmat")
except Exception:  # noqa: BLE001 — best-effort
    pass

# Windows-only: Proficy (pywin32 / ADODB) + SQL Server (pymssql).
if IS_WIN:
    hiddenimports += [
        "win32com",
        "win32com.client",
        "pythoncom",
        "pywintypes",
        "pymssql",
    ]

# --------------------------------------------------------------------------- #
# Excludes — trim the binary size.  The sidecar never needs these.
# --------------------------------------------------------------------------- #
excludes: list[str] = [
    "tkinter",
    "matplotlib",
    "numpy",
    "pandas",
    "PIL",
    "IPython",
]

# --------------------------------------------------------------------------- #
# Icon (optional, only used by Windows exe / macOS .app — we ship onefile
# so this only matters on Windows for the exe resource).
# --------------------------------------------------------------------------- #
icon_path: str | None = None
if IS_WIN:
    candidate = REPO_ROOT / "build" / "icon.ico"
    icon_path = str(candidate) if candidate.exists() else None
elif IS_MAC:
    candidate = REPO_ROOT / "build" / "icon.icns"
    icon_path = str(candidate) if candidate.exists() else None

# --------------------------------------------------------------------------- #
# Analysis / PYZ / EXE
# --------------------------------------------------------------------------- #
block_cipher = None

# --------------------------------------------------------------------------- #
# Data files — non-code assets that the sidecar reads at runtime.
# --------------------------------------------------------------------------- #
# storage/db.py loads SQL migrations via Path(__file__).parent / "migrations".
# Without an explicit ``datas`` entry, PyInstaller ships only .py files and
# the sidecar blows up at startup with "missing migration: .../001_init.sql".
datas: list[tuple[str, str]] = [
    (str(PYTHON_DIR / "storage" / "migrations"), "storage/migrations"),
]

a = Analysis(  # noqa: F821
    [ENTRY_SCRIPT],
    pathex=[str(PYTHON_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)  # noqa: F821

# ONEDIR: EXE contains only the bootloader + entrypoint script archive;
# all dynamic libs / .pyd / data files are collected by COLLECT into
# the sibling ``_internal`` directory.  Do NOT pass a.binaries /
# a.zipfiles / a.datas to EXE here — that's the onefile pattern.
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="hd-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    # ``strip`` removes symbol tables; disabled on Windows (not supported by
    # MSVC toolchain) and kept on for Unix to shrink the binary.
    strip=not IS_WIN,
    # UPX is disabled — it routinely trips Windows Defender / SmartScreen
    # heuristics and corrupts Windows PE binaries in subtle ways.
    upx=False,
    upx_exclude=[],
    # ``console=True`` is mandatory: Electron speaks to us over stdin/stdout
    # pipes, which are lost when the executable is a GUI (windowed) subsystem
    # on Windows.  The black console window is hidden by Electron's
    # ``spawn(..., { windowsHide: true })`` / ``CREATE_NO_WINDOW`` flag.
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path,
)

# COLLECT emits ``<distpath>/<name>/`` containing the exe above plus
# every native dependency.  ``name='hd-sidecar'`` + ``--distpath
# ../resources`` (see package.json) ⇒ final layout is
# ``resources/hd-sidecar/hd-sidecar.exe`` + ``resources/hd-sidecar/_internal/``.
coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=not IS_WIN,
    upx=False,
    upx_exclude=[],
    name="hd-sidecar",
)

# Tell PyInstaller where to drop the final artifact.  These variables are
# consulted by the CLI when not overridden via ``--distpath`` / ``--workpath``.
DISTPATH = DIST_DIR  # noqa: F841
WORKPATH = WORK_DIR  # noqa: F841

# Make the output directory exists early — PyInstaller will create it, but
# this avoids surprises when the first build runs on a fresh clone.
os.makedirs(DIST_DIR, exist_ok=True)
