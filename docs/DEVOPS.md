# DevOps & Build Guide

> Role: **DevOps** — Build pipeline, signing, distribution, native modules, and environment setup.

---

## Prerequisites

### macOS

| Requirement | Why |
|-------------|-----|
| **macOS** 14+ | Electron target platform |
| **Node.js** 18+ | Used during development; a standalone Node.js binary is bundled for the packaged app |
| **Xcode CLT** | `xcode-select --install` — compiles native `window_utils.node` addon |
| **Screen Recording permission** | Required for `desktopCapturer` — grant in System Settings > Privacy |

### Linux

| Requirement | Why |
|-------------|-----|
| **Wayland session** | X11 is untested; Wayland is the supported display server |
| **Node.js** 18+ | Used during development |
| **wl-clipboard** | `wl-copy` persists clipboard after window close on Wayland |
| **python3-gi** (PyGObject) | Portal-based screenshot fallback via D-Bus |
| **GNOME** (recommended) | Compositor shortcuts registered via gsettings; other DEs use Electron native shortcuts (may fail on Wayland) |

---

## Environment Setup

```bash
# Clone and install
git clone <repo>
cd snip
npm install

# Compile native modules for Electron's ABI
npm run rebuild

# (Optional) Download HuggingFace models for local dev (~150 MB total)
# Models are NOT bundled in the binary — downloaded on demand via Settings → Add-ons.
# Only needed for dev if you want to test AI features without using the addon system.
npm run download-models

# Download Node.js binary for child process workers (run once, ~100 MB)
npm run download-node

# Launch in dev mode (verbose logging)
npm run dev

# Launch normally
npm start
```

The app runs as a **tray-only** process (no Dock icon). Look for the scissors icon in the menu bar.

**Note:** Ollama is NOT bundled. Install it separately from [ollama.com](https://ollama.com/download) or let the in-app setup wizard install it for you on first launch. The minicpm-v model (~5 GB) is pulled on first launch via Ollama's API. Snip spawns its own dedicated `ollama serve` process on a dynamic port — it does NOT use or interfere with any existing Ollama server the user may be running.

---

## Scripts

| Command | What It Does |
|---------|--------------|
| `npm start` | Launch Snip via Electron |
| `npm run dev` | Launch with `ELECTRON_ENABLE_LOGGING=1` for verbose console output |
| `npm run rebuild` | `electron-rebuild` — recompile all native modules for Electron's Node ABI |
| `npm run prebuild` | `node-gyp rebuild` — compile just the `window_utils.node` addon |
| `npm run build` | Full macOS build for arm64: `node-gyp rebuild` + `electron-builder --mac --arm64` + ad-hoc sign |
| `npm run build:linux` | Linux build for x64: `electron-builder --linux --x64` (AppImage + deb) |
| `npm run sign:adhoc` | Ad-hoc `codesign` for local macOS use (no Developer ID needed) |
| `./scripts/build-signed.sh` | Production macOS build (arm64): loads `.env` creds, validates cert, builds + signs + notarizes |
| `node scripts/generate-app-icon.js` | Regenerate `assets/icon.png` and `assets/icon.icns` from SVG template |
| `npm run download-models` | Download HuggingFace models to `vendor/models/` for dev use. NOT bundled in binary — users download via Settings → Add-ons. |
| `node scripts/build-runtime-bundle.js` | Build the AI runtime tarball for GitHub release. Supports `--platform darwin\|linux` and `--arch arm64\|x64`. Contains transformers.js + onnxruntime stripped to target platform. |
| `npm run download-node` | Download standalone Node.js 22 LTS binary (~100 MB) for SAM segmentation subprocess. Supports `--platform` and `--arch` flags for cross-platform builds. |

---

## Native Module: `window_utils.node` (macOS only)

**Source**: `src/native/window_utils.mm` (Objective-C++ / N-API)

**Purpose**: Exposes `setMoveToActiveSpace(nativeWindowHandle)` which sets `NSWindowCollectionBehaviorMoveToActiveSpace` on the capture overlay. This prevents macOS from switching Spaces when the overlay activates.

**Build**: Compiled via `node-gyp` using the `binding.gyp` config in the project root.

| Context | Addon Location |
|---------|---------------|
| Development | `build/Release/window_utils.node` |
| Packaged app | `Snip.app/Contents/Resources/native/window_utils.node` (via `extraResources`) |

If the addon is missing, the app still works but the capture overlay may appear on the wrong Space.

---

## Build Pipeline

### Local Build (Ad-Hoc Signed)

```bash
npm run build
```

1. `node-gyp rebuild` compiles `window_utils.node`
2. `electron-builder --mac` packages the app
3. `afterPack` hook in `electron-builder.yml`:
   - Copies arch-specific bundled Node.js binary to `Resources/node/node`
   - Removes unused native modules (`canvas`)
   - Strips non-macOS ONNX Runtime binaries
   - Pre-signs remaining `.node`, `.dylib` files and the bundled Node.js binary
4. No `CSC_LINK` detected -> `sign:adhoc` runs `codesign --force --deep --sign -`
5. Output: `dist/mac-{arch}/Snip.app` + `Snip-{version}-{arch}.dmg`

### Linux Build

```bash
npm run build:linux
```

1. `electron-builder --linux --x64` packages the app
2. `afterPack` hook copies arch-specific bundled Node.js binary to `resources/node/node` (no codesigning)
3. Output: `dist/Snip-{version}-x86_64.AppImage` + `dist/Snip-{version}-amd64.deb`

### Artifact Naming Convention

All artifacts use the format `Snip-{version}-{arch}.{ext}` (configured via `artifactName` in `electron-builder.yml`):

| Platform | Architecture | Example |
|----------|-------------|---------|
| macOS | Apple Silicon | `Snip-1.2.0-arm64.dmg` |
| Linux | x64 | `Snip-1.2.0-x86_64.AppImage` |
| Linux | x64 | `Snip-1.2.0-amd64.deb` |
| Linux | arm64 | `Snip-1.2.0-arm64.deb` |

### Production Build (Signed + Notarized)

**Requires** a `.env` file in project root:

```env
CSC_LINK=<base64-encoded .p12 certificate>
CSC_KEY_PASSWORD=<certificate password>
APPLE_ID=<your Apple ID email>
APPLE_APP_SPECIFIC_PASSWORD=<app-specific password>
APPLE_TEAM_ID=<your team ID>
```

**Certificate**: Must be a **"Developer ID Application"** certificate (not "Apple Development" or "Apple Distribution"). Create at [developer.apple.com](https://developer.apple.com/account/resources/certificates/list).

To base64-encode the .p12:
```bash
base64 -i certificate.p12 | tr -d '\n' | pbcopy
```

**Build**:
```bash
./scripts/build-signed.sh
```

1. Loads `.env` credentials, validates cert type
2. `npm run prebuild` compiles native addon
3. `electron-builder --mac` assembles + signs with Developer ID cert
4. `afterPack` hook copies bundled Node.js binary, cleans unused modules, pre-signs native binaries
5. App submitted to Apple notary service
6. Notarization ticket stapled to DMG on success
7. Output: signed + notarized `dist/Snip-{version}-{arch}.dmg`

**Error cases**:
- Wrong cert type -> build exits early with error
- Missing env vars -> build exits listing what's missing
- Notarization rejected -> Apple error log with specific binary paths

---

## Distribution

### GitHub Releases

Push a `v*` tag to trigger the Release workflow (`.github/workflows/release.yml`):

```bash
git tag v1.0.9
git push origin v1.0.9
```

The workflow runs three jobs:

**1. build-macos** (macOS arm64):
1. Builds AI runtime bundle and downloads Node.js binary for darwin-arm64
2. Builds arm64 DMG + ZIP, signs with Developer ID, notarizes with Apple
3. Publishes to GitHub Releases via `electron-builder --publish always` (creates draft release, uploads DMG, ZIP, `latest-mac.yml`)
4. Uploads `snip-ai-runtime-darwin-arm64.tar.gz` for AI add-on system
5. Generates release notes via `gh release edit --generate-notes`, marks release as non-draft

**2. build-linux** (depends on build-macos, matrix: x64 + arm64):
1. Builds AI runtime bundle and downloads Node.js binary for each arch
2. Builds with `electron-builder --linux --publish never` (x64: AppImage + deb; arm64: deb only — ARM64 AppImage dropped due to AppImageKit libz.so bug #964)
3. Uploads all Linux artifacts via `gh release upload` (AppImage, deb, `latest-linux.yml`, runtime tarball)

**Note:** Linux uses `--publish never` + `gh release upload` instead of `--publish always` because electron-builder refuses to upload to a non-draft release (the macOS job already published it).

**3. update-cask** (depends on build-macos, skips beta/alpha/rc):
1. Auto-updates the Homebrew cask with new version and checksums

### Homebrew

Users install via:

```bash
brew install --cask rixinhahaha/snip/snip
```

The cask is hosted at [`rixinhahaha/homebrew-snip`](https://github.com/rixinhahaha/homebrew-snip). The `update-cask` job in the release workflow automatically updates the cask version and checksums after each release.

---

## Data Directories

### Cross-platform

| Data | Path | Created By |
|------|------|------------|
| Screenshots | `~/Documents/snip/screenshots/` | `initStore()` on first launch |
| Category subfolders | `~/Documents/snip/screenshots/<category>/` | AI agent when organizing |
| Index | `~/Documents/snip/screenshots/.index.json` | Store module |
| Ollama models | `~/.ollama/models/` | Shared with system Ollama; minicpm-v pulled on first launch |
| Node.js binary (SAM subprocess) | `vendor/node/{arch}/node` (dev) / `Resources/node/node` (packaged) | Bundled — `npm run download-node` (~100 MB) |
| Animation presets | Inlined in `src/main/animation/animation.js` | 6 static text-prompt presets (fallback when Ollama AI presets unavailable) |

### macOS-specific paths

| Data | Path |
|------|------|
| Config | `~/Library/Application Support/snip/snip-config.json` |
| MCP Socket | `~/Library/Application Support/snip/snip.sock` |
| AI add-on models | `~/Library/Application Support/snip/addons/models/` |
| AI runtime | `~/Library/Application Support/snip/addons/runtime/` |
| Ollama binary | `/usr/local/bin/ollama`, `/opt/homebrew/bin/ollama`, or `/Applications/Ollama.app/Contents/Resources/ollama` |

### Linux-specific paths

| Data | Path |
|------|------|
| Config | `~/.config/snip/snip-config.json` |
| MCP Socket | `$XDG_RUNTIME_DIR/snip/snip.sock` (fallback: `~/.config/snip/snip.sock`) |
| AI add-on models | `~/.local/share/snip/addons/models/` |
| AI runtime | `~/.local/share/snip/addons/runtime/` |
| Ollama binary | `/usr/local/bin/ollama`, `/usr/bin/ollama`, `/snap/bin/ollama` |

---

## Electron Configuration

| Setting | Value | Why |
|---------|-------|-----|
| `app.dock.hide()` | Dev mode (macOS) | Prevents Space switching on window activate |
| `LSUIElement: true` | Production (macOS, Info.plist) | Same as dock.hide but for packaged app |
| `titleBarStyle` | `hiddenInset` (macOS) | Custom traffic light position (standard title bar on Linux) |
| `transparent: true` | All windows | Required for vibrancy effects |
| `backgroundColor` | `#00000000` | Fully transparent behind web content |
| `singleInstanceLock` | Enabled | Second launch focuses existing instance |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm run rebuild` fails | Install Xcode CLT: `xcode-select --install` |
| No tray icon visible | Check `assets/tray-iconTemplate.png` exists (Template suffix = auto dark/light) |
| Screen capture blank | Grant Screen Recording permission, restart app |
| SAM segment tool hidden | Needs 4GB+ RAM. Run `npm run download-node` to bundle the Node.js binary (auto-detected in packaged app). Falls back to system Node.js if bundled binary not found. |
| Animation (Animate) fails | Check fal.ai API key is set in Settings → Animation, and internet connection is available |
| App switches Spaces on capture | Ensure `app.dock.hide()` is running and native module built (macOS only) |
| **Linux: Clipboard doesn't persist** | Install `wl-clipboard` package (`sudo apt install wl-clipboard`) |
| **Linux: Screenshot capture fails** | Install `python3-gi` (`sudo apt install python3-gi gir1.2-glib-2.0`) for portal support |
| **Linux: Global shortcut doesn't work** | On Wayland/GNOME, shortcuts use compositor (gsettings). On other DEs, Electron native shortcuts may not work — configure shortcuts in your DE's settings. |
| **Linux: Tray icon missing** | Some DEs require an app indicator extension (e.g., GNOME needs `gnome-shell-extension-appindicator`) |
