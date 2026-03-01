# DevOps & Build Guide

> Role: **DevOps** — Build pipeline, signing, distribution, native modules, and environment setup.

---

## Prerequisites

| Requirement | Why |
|-------------|-----|
| **macOS** 10.13+ | Electron target platform (macOS 26+ for Liquid Glass) |
| **Node.js** 18+ | System Node.js required for SAM segmentation subprocess |
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

# Download Ollama binary (run once, ~70 MB)
npm run download-ollama

# Download HuggingFace models (run once, ~75 MB total)
#   - MiniLM (~23 MB) — embedding model for semantic search
#   - SlimSAM (~50 MB) — segmentation model for object selection
# Note: minicpm-v (~5 GB) is NOT bundled — it is pulled automatically
# on first launch via Ollama's client.pull() API
npm run download-models

# Launch in dev mode (verbose logging)
npm run dev

# Launch normally
npm start
```

The app runs as a **tray-only** process (no Dock icon). Look for the scissors icon in the menu bar.

---

## Scripts

| Command | What It Does |
|---------|--------------|
| `npm start` | Launch Snip via Electron |
| `npm run dev` | Launch with `ELECTRON_ENABLE_LOGGING=1` for verbose console output |
| `npm run rebuild` | `electron-rebuild` — recompile all native modules for Electron's Node ABI |
| `npm run prebuild` | `node-gyp rebuild` — compile just the `window_utils.node` addon |
| `npm run build` | Full build: `node-gyp rebuild` + `electron-builder --mac` + ad-hoc sign |
| `npm run sign:adhoc` | Ad-hoc `codesign` for local use (no Developer ID needed) |
| `./scripts/build-signed.sh` | Production build: loads `.env` creds, validates cert, builds + signs + notarizes |
| `node scripts/generate-app-icon.js` | Regenerate `assets/icon.png` and `assets/icon.icns` from SVG template |
| `npm run download-ollama` | Download Ollama binary to `vendor/ollama/` (~70 MB) |
| `npm run download-models` | Download HuggingFace models: MiniLM (~23 MB), SlimSAM (~50 MB). Note: minicpm-v is pulled at runtime, not bundled. |
| `npm run download-all` | `download-ollama` + `download-models` in one command |
| `npm run download-all` | Run both download scripts |

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
   - Removes unused native modules (`canvas`, `sharp`, `@img/*`)
   - Strips non-macOS ONNX Runtime binaries
   - Removes wrong-arch `electron-liquid-glass` prebuilds
   - Pre-signs remaining `.node`, `.dylib`, `.so`, `.metallib` files (including bundled Ollama binary)
4. No `CSC_LINK` detected -> `sign:adhoc` runs `codesign --force --deep --sign -`
5. Output: `dist/mac-arm64/Snip.app` + `.dmg`

### Production Build (Signed + Notarized)

**Requires** a `.env` file in project root:

```env
CSC_LINK=<base64-encoded .p12 certificate>
CSC_KEY_PASSWORD=<certificate password>
APPLE_ID=<your Apple ID email>
APPLE_ID_PASSWORD=<app-specific password>
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
4. `afterPack` hook cleans unused modules, removes wrong-arch prebuilds, pre-signs all native binaries + Ollama binary
5. App submitted to Apple notary service
6. Notarization ticket stapled to DMG on success
7. Output: signed + notarized `dist/*.dmg`

**Error cases**:
- Wrong cert type -> build exits early with error
- Missing env vars -> build exits listing what's missing
- Notarization rejected -> Apple error log with specific binary paths

---

## Data Directories

| Data | Path | Created By |
|------|------|------------|
| Screenshots | `~/Documents/snip/screenshots/` | `initStore()` on first launch |
| Category subfolders | `~/Documents/snip/screenshots/<category>/` | AI agent when organizing |
| Index | `~/Documents/snip/screenshots/.index.json` | Store module |
| Config | `~/Library/Application Support/snip/snip-config.json` | Electron defaults |
| Ollama binary | `vendor/ollama/ollama` (dev) / `Resources/ollama/ollama` (packaged) | Bundled — `npm run download-ollama` |
| Ollama models (runtime) | `~/Library/Application Support/snip/ollama/models/` | Pulled on first launch via `client.pull()`, or symlinked from `~/.ollama/models/` |
| HF models (MiniLM + SlimSAM) | `vendor/models/` (dev) / `Resources/models/` (packaged) | Bundled — `npm run download-models --hf` (~75 MB) |
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
| SAM segment tool hidden | Needs 4GB+ RAM and system Node.js (not Electron's bundled one) |
| Animation (2GIF) fails | Check fal.ai API key is set in Settings → Animation, and internet connection is available |
| `electron-liquid-glass` fails | Only works on macOS 26+; older macOS falls back to vibrancy |
| App switches Spaces on capture | Ensure `app.dock.hide()` is running and native module built |
| Glass theme looks opaque | Native glass layer failed — check console for `[Snip] Liquid glass` messages |
