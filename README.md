# Historian Downloader

Electron + Vite + React 19 + TypeScript desktop app with a Python
(asyncio + stdio JSON-RPC 2.0) sidecar. Targets Proficy iFix and Wonderware
InTouch historians via OS-native adapters, with a mock adapter for dev.

> **Windows x64 only.** Historian OLE DB + `pymssql` + `pywin32` are Windows
> native, and PyInstaller cannot cross-compile. Local dev on macOS/Linux is
> supported against the mock adapter, but every release is built on
> `windows-latest` CI.

See `docs/architecture.md` for the full design, and `docs/rpc-contract.md`
for the JSON-RPC surface the renderer calls into.

## Recommended IDE

- VSCode + ESLint + Prettier

## Project setup

### 1. Install Node deps

```bash
pnpm install
```

### 2. Install Python build deps (only needed for packaging)

The sidecar runs in dev straight from source (`python python/main.py`),
but packaged builds ship a PyInstaller onedir executable. Install the
build toolchain once.

**Recommended — via [uv](https://docs.astral.sh/uv/)**
(≈10× faster than pip, wheel cache baked in):

```bash
# install uv once per machine
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"

# then from the repo root:
pnpm run sidecar:install
```

**Fallback — via pip** (if you can't install uv):

```bash
pnpm run sidecar:install:pip
# or directly:
pip install -r python/requirements-build.txt
```

On macOS with a system Python that rejects global pip
(`externally-managed-environment`), either use `uv` (it creates its own
environment) or a venv:

```bash
python3 -m venv .venv-build
.venv-build/bin/pip install -r python/requirements-build.txt
```

## Development

```bash
pnpm run dev                     # Electron + Vite dev server, spawns python sidecar
pnpm run sidecar:build           # Rebuild the PyInstaller sidecar binary only
HD_FORCE_MOCK=1 pnpm run dev     # force the mock adapter
```

## Building a Windows installer

Release builds must run on Windows (GitHub Actions `windows-latest` or a
local Windows dev box). Cross-compiling from macOS / Linux is not supported.

```bash
pnpm run build:win       # → dist/historiandownloader-<ver>-setup.exe
pnpm run build:unpack    # electron-builder --dir, debug pack (no installer)
pnpm run sidecar:clean   # rm -rf python/build-temp + resources/hd-sidecar
```

All `build:*` scripts run `sidecar:clean` → `sidecar:build` first to
prevent cross-platform PyInstaller output from contaminating the installer.

### Artifact layout

- `resources/hd-sidecar/hd-sidecar.exe` + `resources/hd-sidecar/_internal/` — PyInstaller onedir sidecar
- `out/` — electron-vite compiled main / preload / renderer
- `dist/` — electron-builder output (`*-setup.exe` + `latest.yml` + `*.blockmap`)

Inside the installed app:

```
%LOCALAPPDATA%\Programs\historiandownloader\resources\hd-sidecar\hd-sidecar.exe
```

`src/main/sidecar/resolve-binary.ts` resolves this path via
`process.resourcesPath` in prod.

### SmartScreen note

The installer is currently **unsigned**, so Windows SmartScreen will show
"Windows protected your PC" on first run. Click **More info → Run
anyway**. Subsequent auto-updates don't re-prompt once the user has
approved the binary once. An EV code-signing cert removes this warning
entirely (TODO below).

## Auto-update

The app ships `electron-updater` + `publish: github` (owner:
`ryanhe919`, repo: `historian_downloader`).

- On launch, the main process silently checks for updates and downloads
  them in the background (`src/main/auto-update.ts`).
- The **帮助 → 检查更新** menu triggers a manual check and toasts the
  result; after a background download finishes, a **立即重启并安装**
  entry appears in the same menu.

## Continuous integration

`.github/workflows/release.yml` fires on `v*` tag push (and on
`workflow_dispatch`):

- Builds the PyInstaller sidecar on `windows-latest` (Python 3.11 x64)
- Builds the renderer + main (`electron-vite build`)
- Packages with `electron-builder --win --publish never` (unsigned)
- Uploads `*-setup.exe` + `*.blockmap` + `latest.yml` to the matching
  GitHub Release via `softprops/action-gh-release`

electron-updater consumes `latest.yml` from that Release on every client
launch.

Release flow:

```bash
# 1. bump version
npm version patch --no-git-tag-version   # or set manually
git commit -am "chore: release v1.2.0"

# 2. tag + push
git tag v1.2.0
git push --follow-tags
```

## TODO — code signing

- [ ] Obtain a Windows EV code-signing cert; add `CSC_LINK` /
      `CSC_KEY_PASSWORD` as GitHub Actions secrets; flip
      `win.signAndEditExecutable: true` in `electron-builder.yml`. This
      removes the SmartScreen warning and makes auto-update signature
      verification meaningful.
