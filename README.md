# Historian Downloader

Electron + Vite + React 19 + TypeScript desktop app with a Python
(asyncio + stdio JSON-RPC 2.0) sidecar. Targets Proficy iFix and Wonderware
InTouch historians via OS-native adapters, with a mock adapter for dev.

See `docs/architecture.md` for the full design, and `docs/rpc-contract.md`
for the JSON-RPC surface the renderer calls into.

## Recommended IDE

- VSCode + ESLint + Prettier

## Project setup

### 1. Install Node deps

```bash
pnpm install
```

### 2. Install Python build deps (only needed for packaging — dev doesn't need this)

The sidecar runs in dev straight from source (`python3 python/main.py`),
but packaged builds ship a PyInstaller onefile executable. Install the
build toolchain once:

```bash
pip install -r python/requirements-build.txt
# or, via the project's extra:
pip install -e 'python[build]'
```

On macOS with a system Python that rejects global pip (`externally-managed-environment`),
create a venv:

```bash
python3 -m venv .venv-build
.venv-build/bin/pip install -r python/requirements-build.txt
```

On Windows you additionally need `pywin32` and `pymssql` for the real
Proficy/SQL Server adapters; `requirements-build.txt` already gates them
with `sys_platform == "win32"` markers, so a single `pip install -r`
picks them up.

## Development

```bash
pnpm run dev                     # Electron + Vite dev server, spawns python3 sidecar
pnpm run sidecar:build           # Rebuild the PyInstaller sidecar binary only
HD_FORCE_MOCK=1 pnpm run dev     # force the mock adapter
```

## Building distributables

All `build:*` scripts first rebuild the sidecar with PyInstaller, then
invoke `electron-builder` for the target OS.

```bash
pnpm run build:mac       # → dist/*.dmg + dist/mac/Historian Downloader.app
pnpm run build:win       # → dist/*-setup.exe (run on Windows only)
pnpm run build:linux     # → dist/*.AppImage
pnpm run build:unpack    # electron-builder --dir, no installer (debug pack)
pnpm run sidecar:clean   # rm -rf python/build-temp resources/hd-sidecar
```

### Build artifact layout

- `resources/hd-sidecar/hd-sidecar(.exe)` — PyInstaller onefile sidecar
- `out/` — electron-vite compiled main / preload / renderer
- `dist/` — electron-builder output (dmg / exe / zip / blockmaps + `mac-arm64/*.app`)

Inside the packaged app, the sidecar lands at:

```
# macOS
dist/mac-arm64/Historian Downloader.app/Contents/Resources/hd-sidecar/hd-sidecar

# Windows
dist/win-unpacked/resources/hd-sidecar/hd-sidecar.exe
```

`src/main/sidecar/resolve-binary.ts` resolves this path via
`process.resourcesPath` in prod.

## Continuous integration

`.github/workflows/build.yml` runs on every push and via
`workflow_dispatch`. It matrix-builds on `macos-latest` and
`windows-latest`, produces unsigned artifacts, and uploads them via
`actions/upload-artifact@v4` (downloadable from the workflow run page).
PyInstaller can't cross-compile, so each OS runs its own sidecar build.

To download: open the workflow run → Summary → Artifacts →
`hd-macos-latest` / `hd-windows-latest`.

## TODO — signing, notarization, publishing

- [ ] Obtain an Apple Developer ID Application certificate; add
      `CSC_LINK` / `CSC_KEY_PASSWORD` + `APPLE_ID` /
      `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` as GitHub secrets;
      flip `mac.notarize: true` in `electron-builder.yml`.
- [ ] Obtain a Windows EV code-signing cert; add `CSC_LINK` /
      `CSC_KEY_PASSWORD` secrets; flip `win.signAndEditExecutable: true`.
- [ ] Replace the placeholder `publish.url` in `electron-builder.yml`
      with a real auto-update endpoint (S3 / generic HTTPS / GitHub
      Releases) and add a tag-triggered `release.yml` workflow that
      calls `electron-builder --publish always`.
- [ ] Fill in `build/entitlements.mac.plist` with whatever real
      entitlements the shipped sidecar actually needs (currently the
      JIT + unsigned-exec-memory + dyld-env trio copied from the
      Electron template).
