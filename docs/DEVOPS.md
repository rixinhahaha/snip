# DevOps & Build Guide

> Role: **DevOps** — Build pipeline, signing, distribution, native modules, and environment setup.

---

## Prerequisites

| Requirement | Why |
|-------------|-----|
| **macOS** 10.13+ | Electron target platform (macOS 26+ for Liquid Glass) |
| **Node.js** 18+ | Used during development; a standalone Node.js binary is bundled for the packaged app |
| **Xcode CLT** | `xcode-select --install` — compiles native `window_utils.node` addon |
| **Screen Recording permission** | Required for `desktopCapturer` — grant in System Settings > Privacy |

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
| `npm run build` | Full build for arm64: `node-gyp rebuild` + `electron-builder --mac --arm64` + ad-hoc sign |
| `npm run sign:adhoc` | Ad-hoc `codesign` for local use (no Developer ID needed) |
| `./scripts/build-signed.sh` | Production build (arm64): loads `.env` creds, validates cert, builds + signs + notarizes |
| `node scripts/generate-app-icon.js` | Regenerate `assets/icon.png` and `assets/icon.icns` from SVG template |
| `npm run download-models` | Download HuggingFace models to `vendor/models/` for dev use. NOT bundled in binary — users download via Settings → Add-ons. |
| `node scripts/build-runtime-bundle.js` | Build the AI runtime tarball (`dist/snip-ai-runtime-darwin-arm64.tar.gz`) for GitHub release. Contains transformers.js + onnxruntime stripped to arm64-only. |
| `npm run download-node` | Download standalone Node.js 22 LTS binary (~100 MB) for SAM segmentation subprocess (arm64 only). |

---

## Native Module: `window_utils.node`

**Source**: `src/native/window_utils.mm` (Objective-C++ / N-API)

**Purpose**: Exposes `setMoveToActiveSpace(nativeWindowHandle)` which sets `NSWindowCollectionBehaviorMoveToActiveSpace` on the capture overlay. This prevents macOS from switching Spaces when the overlay activates.

**Build**: Compiled via `node-gyp` using the `binding.gyp` config in the project root.

| Context | Addon Location |
|---------|---------------|
| Development | `build/Release/window_utils.node` |
| Packaged app | `Snip.app/Contents/Resources/native/window_utils.node` (via `extraResources`) |

If the addon is missing, the app still works but the capture overlay may appear on the wrong Space.

---

## Liquid Glass Native Module: `electron-liquid-glass`

**npm package**: `electron-liquid-glass` (prebuild native addon)

**Purpose**: Applies a native `NSGlassEffectView` behind web content on macOS 26+ (Tahoe). Provides the frosted-glass backdrop that the Glass theme reveals.

**Loading** (in `main.js`):
```js
let liquidGlass = null;
try {
  const lg = require('electron-liquid-glass');
  if (lg.isGlassSupported() && lg._addon) liquidGlass = lg;
} catch { /* not available */ }
```

**Usage**: `liquidGlass.addView(nativeWindowHandle, { cornerRadius: 12, tintColor: '#22000008' })` called after `did-finish-load` on home and editor windows. Falls back to `setVibrancy('under-window')` if addView fails.

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
   - Removes wrong-arch `electron-liquid-glass` prebuilds
   - Pre-signs remaining `.node`, `.dylib` files and the bundled Node.js binary
4. No `CSC_LINK` detected -> `sign:adhoc` runs `codesign --force --deep --sign -`
5. Output: `dist/mac-{arch}/Snip.app` + `Snip-{version}-{arch}.dmg`

### DMG Naming Convention

DMGs use the format `Snip-{version}-{arch}.dmg` (configured via `artifactName` in `electron-builder.yml`):

| Architecture | Example |
|-------------|---------|
| Apple Silicon | `Snip-1.0.9-arm64.dmg` |

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
4. `afterPack` hook copies bundled Node.js binary, cleans unused modules, removes wrong-arch prebuilds, pre-signs native binaries
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

The workflow:
1. Downloads HuggingFace models and the Node.js binary
2. Builds arm64 DMG + ZIP (with models and Node.js bundled), signs with Developer ID, and notarizes with Apple
3. Publishes directly to GitHub Releases via `electron-builder --publish always` (uploads DMG, ZIP, `latest-mac.yml` for auto-update)
4. Generates release notes via `gh release edit --generate-notes`
5. Auto-updates the Homebrew cask (with retry loop for asset availability)

### Homebrew

Users install via:

```bash
brew install --cask rixinhahaha/snip/snip
```

The cask is hosted at [`rixinhahaha/homebrew-snip`](https://github.com/rixinhahaha/homebrew-snip). The `update-cask` job in the release workflow automatically updates the cask version and checksums after each release.

---

## Data Directories

| Data | Path | Created By |
|------|------|------------|
| Screenshots | `~/Documents/snip/screenshots/` | `initStore()` on first launch |
| Category subfolders | `~/Documents/snip/screenshots/<category>/` | AI agent when organizing |
| Index | `~/Documents/snip/screenshots/.index.json` | Store module |
| Config | `~/Library/Application Support/snip/snip-config.json` | Electron defaults |
| Ollama binary | `/usr/local/bin/ollama`, `/opt/homebrew/bin/ollama`, or `/Applications/Ollama.app/Contents/Resources/ollama` | User-installed (or installed via in-app setup wizard) |
| Ollama models | `~/.ollama/models/` | Shared with system Ollama; minicpm-v pulled on first launch |
| AI add-on models | `vendor/models/` (dev) / `~/Library/Application Support/snip/addons/models/` (user) | Downloaded on demand via Settings → Add-ons |
| AI runtime (transformers.js + onnxruntime) | `node_modules/` (dev) / `~/Library/Application Support/snip/addons/runtime/` (user) | Downloaded on demand with first add-on install |
| Node.js binary (SAM subprocess) | `vendor/node/{arch}/node` (dev) / `Resources/node/node` (packaged) | Bundled — `npm run download-node` (~100 MB) |
| Animation presets | Inlined in `src/main/animation/animation.js` | 6 static text-prompt presets (fallback when Ollama AI presets unavailable) |

---

## Electron Configuration

| Setting | Value | Why |
|---------|-------|-----|
| `app.dock.hide()` | Dev mode | Prevents Space switching on window activate |
| `LSUIElement: true` | Production (Info.plist) | Same as dock.hide but for packaged app |
| `titleBarStyle` | `hiddenInset` | Custom traffic light position |
| `transparent: true` | All windows | Required for glass/vibrancy effects |
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
| `electron-liquid-glass` fails | Only works on macOS 26+; older macOS falls back to vibrancy |
| App switches Spaces on capture | Ensure `app.dock.hide()` is running and native module built |
| Glass theme looks opaque | Native glass layer failed — check console for `[Snip] Liquid glass` messages |
