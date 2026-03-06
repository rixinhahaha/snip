# Architecture & Developer Guide

> Role: **Developer** — Code structure, conventions, key decisions, and how things connect.

---

## Tech Stack

| Component | Library | Version |
|-----------|---------|---------|
| Desktop framework | Electron | 33 |
| Annotation canvas | Fabric.js | 7 |
| AI categorization | Local vision LLM | Ollama (system install, managed process on dynamic port, model pulled on first launch) |
| Semantic embeddings | HuggingFace Transformers.js | all-MiniLM-L6-v2 |
| Image segmentation | SlimSAM | ONNX Runtime |
| Image upscaling | Swin2SR (2x) | ONNX Runtime via Transformers.js |
| Animation (fal.ai) | Wan 2.2 I2V via fal.ai cloud API | HTTPS queue API (requires API key) |
| Video frame extraction | ffmpeg-static | Bundled ffmpeg binary |
| GIF encoding | gifenc | ~9KB pure JS |
| APNG encoding | upng-js | ~170KB pure JS |
| File watching | Chokidar | 4 |
| Native bridge | Node-API (N-API) | node-addon-api 8 |
| macOS glass effects | electron-liquid-glass | 1.1+ |
| Font | Plus Jakarta Sans | variable 200-800 |

---

## Directory Structure

```
src/
  main/                     # Main process (Node.js / CommonJS)
    main.js                  # App lifecycle, window creation, liquid glass init
    capturer.js              # Screen capture via desktopCapturer
    ipc-handlers.js          # All IPC channel handlers
    tray.js                  # Menu-bar tray icon and context menu, rebuildTrayMenu() for live accelerator updates
    shortcuts.js             # Global keyboard shortcuts (Cmd+Shift+2, Cmd+Shift+S, Cmd+Shift+1), reregisterShortcuts() for dynamic rebinding
    store.js                 # Config persistence, index I/O, fal.ai API key storage, aiEnabled flag, reloadConfig(), getShortcuts(), getDefaultShortcuts(), setShortcut(), resetShortcuts()
    constants.js             # Shared constants (BASE_WEB_PREFERENCES)
    ollama-manager.js        # Ollama process lifecycle (spawn/kill on dynamic port, ready/status/model pull)
    model-paths.js           # Bundled model path resolution (dev vs packaged)
    organizer/               # AI screenshot organization pipeline
      agent.js               # Ollama vision prompt + response parsing
      worker.js              # Background worker thread for AI processing
      watcher.js             # Chokidar file watcher + pendingFiles queue + setOllamaHost() + generateEmbeddingForEntry()
      embeddings.js          # HuggingFace transformer embedding generation
    node-binary.js           # Shared findNodeBinary() utility for child processes
    segmentation/            # SAM image segmentation (isolated from organizer)
      segmentation.js        # SAM model orchestration (spawns subprocess, uses node-binary.js)
      segmentation-worker.js # SAM inference in child process (not worker_threads)
    upscaler/                # On-device image upscaling (2x)
      upscaler.js            # Child process orchestrator (like segmentation.js)
      upscaler-worker.js     # Transformers.js image-to-image pipeline in child process
    animation/               # 2GIF animation feature (fal.ai cloud API)
      animation.js           # fal.ai API integration (upload, queue, poll, MP4 download)
      gif-encoder-worker.js  # Child process: ffmpeg MP4→frames extraction + GIF/APNG encoding
    transcription/           # Text extraction via native macOS OCR
      transcription.js       # Node.js wrapper: compiles + spawns Swift helper, parses JSON result
      transcribe.swift       # Swift CLI: VNRecognizeTextRequest OCR + Unicode script detection, reads base64 via stdin

  renderer/                  # Renderer processes (no modules, globals via IIFEs)
    index.html / app.js      # Capture overlay — fullscreen transparent region selector
    styles.css               # Overlay-specific styles (capture selection UI)
    home.html / home.js      # Gallery, search, settings UI (main window)
    home.css                 # Home window styles
    editor.html / editor-app.js  # Annotation editor
    editor-styles.css        # Editor toolbar and canvas styles
    editor-canvas-manager.js # Fabric.js canvas wrapper (init, export, undo/redo)
    toolbar.js               # Editor toolbar state machine
    theme.css                # ALL theme tokens (Dark, Light, Glass + solid fallback)
    tools/
      tool-utils.js          # Shared: SEGMENT_OUTLINE_WIDTH, SEGMENT_OVERLAY_OPACITY, getAccentColor(), hexToRgba(), createMosaicImage(), recolorMaskWithOutline() (highlight fill + dilation outline), nextTagId(), lineEndpointForTag()
      selection.js           # Selection tool (move, resize, multi-select)
      rectangle.js           # Rectangle tool (outline/highlight/blur modes)
      textbox.js             # Text annotation tool
      arrow.js               # Arrow annotation tool
      tag.js                 # Tag callout tool (two-click, linked label group + tip/line)
      blur-brush.js          # Free-draw blur brush
      segment.js             # SAM segmentation tool (click-to-select, tag segment, cutout)
      animate.js             # 2GIF animation tool (preset picker, save/copy panel)
      transcribe.js          # TranscribeTool IIFE — text extraction side panel (native macOS OCR)

  preload/
    preload.js               # contextBridge — defines window.snip API surface

  native/
    window_utils.mm          # Obj-C++ N-API addon: setMoveToActiveSpace (Space behavior), getWindowList (CGWindowList for window snap — merges sub-windows by PID)

assets/                      # App icons, tray icons
site/                        # Marketing site (GitHub Pages, snipit.dev)
  index.html                   # Landing page
  guide.html                   # Setup guide (permissions, AI setup)
  styles.css                   # Shared styles
  script.js                    # Download links, scroll animations, sparkle canvas
  CNAME                        # Custom domain config (snipit.dev)
  assets/                      # Hero video, screenshots, OG image
scripts/                     # Build and generation scripts
  download-models.js           # Download MiniLM + SlimSAM + Swin2SR to vendor/models/
  download-node.js             # Download standalone Node.js binary to vendor/node/
  afterPack.js                 # electron-builder afterPack hook (strip unused native modules, pre-sign)
  build-signed.sh              # Production build: sign + notarize
  generate-app-icon.js         # Regenerate app icons from SVG template
vendor/                      # Downloaded at dev time, bundled at build time
  models/                      # HuggingFace models: MiniLM + SlimSAM (~75 MB)
  node/                        # Standalone Node.js binary for SAM subprocess (~100 MB)
    arm64/node                   # Apple Silicon
  (static animation presets inlined in src/main/animation/animation.js)
```

---

## Windows

| Window | File | Purpose | Lifecycle |
|--------|------|---------|-----------|
| **Overlay** | `index.html` | Fullscreen transparent region selection | Pre-warmed hidden at startup; reused per capture, destroyed after crop, then re-pre-warmed |
| **Home** | `home.html` | Gallery, search, settings | Persistent singleton, hidden during capture |
| **Editor** | `editor.html` | Annotation canvas + toolbar | Pre-warmed hidden at startup; reused per capture (resized + shown), destroyed on close, then re-pre-warmed |

All windows share:
- `titleBarStyle: 'hiddenInset'` with custom traffic light positioning
- `transparent: true`, `backgroundColor: '#00000000'`
- Native Liquid Glass layer (macOS 26+) or vibrancy fallback
- Theme via `data-theme` attribute on `<html>`

---

## Key Architecture Decisions

### Managed Ollama Process
Ollama is **NOT bundled** — the user installs it separately (from [ollama.com](https://ollama.com/download) or via the in-app installer). The LLM model (`minicpm-v`, ~5 GB) is pulled on first launch. Models are stored in Ollama's standard location (`~/.ollama/models/`).

Snip **owns the Ollama server lifecycle** — it spawns a dedicated `ollama serve` process on a dynamically-assigned port at app start, and kills it on app quit. The process is NOT detached, so it dies with the parent even on a crash.

On startup, `ollama-manager.js` runs `startOllama()` which:
1. **Finds the binary** — `findOllamaBinary()` checks CLI paths (`/usr/local/bin/ollama`, `/opt/homebrew/bin/ollama`) then the binary inside `/Applications/Ollama.app/Contents/Resources/ollama`
2. **Not found** — sets status to `not_installed`, the inline setup overlay prompts the user to install
3. **Finds a free port** — `findFreePort()` binds to port 0 and reads the assigned port
4. **Spawns `ollama serve`** — with env `OLLAMA_HOST=127.0.0.1:<port>`, NOT detached, NOT unref'd
5. **Waits for health check** — `waitForServer()` polls the new URL
6. **Pushes host URL via message passing** — calls `watcher.setOllamaHost(host)` which forwards to the worker thread, which calls `agent.setOllamaHost(host)` to set a module-level override

On quit, `stopOllama()` sends SIGTERM to the managed process, waits up to 3s, then SIGKILL as fallback. Resets `managedHost`, `client`, and all state.

The active Ollama host URL is communicated via **message passing** (not env vars): `ollama-manager.js` → `watcher.js:setOllamaHost()` → worker thread → `agent.js:setOllamaHost()`. The agent's `createClient()` reads the `ollamaHostOverride` module variable first, falling back to the user-configured URL. The animation module uses `ollamaManager.getClient()` directly.

The in-app installer (`installOllama()`) downloads `Ollama-darwin.zip` from ollama.com, extracts `Ollama.app`, moves it to `/Applications/`, then calls `startOllama()` to spawn the managed server (does NOT launch the Ollama GUI app). Progress is pushed to all BrowserWindows via `webContents.send('ollama-install-progress', progress)`.

Model pull uses `client.pull({ model, stream: true })` with per-digest progress accumulation, pushed via `webContents.send('ollama-pull-progress', progress)`. If the server is down during a pull, `pullModel()` attempts to restart the managed instance via `startOllama()`.

All AI runs locally — no cloud API calls (except fal.ai for animations).

### Bundled HuggingFace Models
All Transformers.js models are **pre-downloaded and bundled** — no runtime download needed. They live in `vendor/models/` (dev) or `Resources/models/` (packaged). The `model-paths.js` module resolves the correct cache directory and disables remote downloads in the packaged app:
- **Xenova/all-MiniLM-L6-v2** (~23 MB quantized) — semantic search embeddings
- **Xenova/slimsam-77-uniform** (~50 MB) — SAM image segmentation
- **Xenova/swin2SR-lightweight-x2-64** (~5.7 MB q4) — 2x image upscaling

### ONNX Runtime Threading
ONNX Runtime (via Transformers.js) **crashes in worker_threads**. Embeddings must run on the main Electron thread. The worker thread handles Ollama API calls, then delegates embedding generation back to main via message passing.

### SAM and Upscaler in Child Processes
The segmentation model (SlimSAM) and the upscaler model (Swin2SR 2x) both run in **child processes** (`child_process.fork`), not worker threads, because ONNX Runtime crashes in Electron's V8 worker context. Both use a standalone Node.js binary (not Electron's) located via the shared `findNodeBinary()` utility in `src/main/node-binary.js`. A bundled Node.js binary is included in the packaged app (`Resources/node/node`) so these features work without requiring users to install developer tools. In development, `vendor/node/{arch}/node` is checked first, then system Node.js installs (NVM, homebrew, PATH, FNM). The parent passes `SNIP_MODELS_PATH` and `SNIP_PACKAGED` env vars so the worker uses bundled models.

The upscaler uses Transformers.js `image-to-image` pipeline with the Swin2SR quantized ONNX model (~5.7 MB). Input images are decoded from base64 data URLs to `RawImage` objects using sharp before being passed to the pipeline. Output is capped at 3840x2160 to prevent memory issues. The upscale button is disabled after use to prevent repeated upscaling.

### fal.ai Cloud Animation
The Animate feature uses the **fal.ai Wan 2.2 A14B image-to-video API** instead of a local model. This requires an internet connection and a fal.ai API key (set in Settings). When the user clicks Animate, Ollama's minicpm-v vision model analyzes the cutout and generates 3 AI-tailored animation presets (e.g., "wag tail" for a dog). If Ollama is unavailable, it falls back to 6 static presets inlined in `animation.js`. Users can also enter a custom animation prompt. All animations are capped at **4 seconds maximum** (enforced via `MAX_DURATION_SECONDS` in `animation.js` and `maxDuration` in `gif-encoder-worker.js`). The pipeline:

1. Cutout PNG composited onto magenta (#FF00FF) background (prevents fal.ai from hallucinating scenery; magenta chosen over green so green subjects aren't incorrectly keyed out)
2. Composited PNG uploaded to fal.ai storage via HTTPS
3. Job submitted to `fal-ai/wan/v2.2-a14b/image-to-video` queue API with a text prompt (from preset or custom user input)
4. Queue polled for completion (typically 15-60 seconds)
5. Resulting MP4 downloaded
6. `ffmpeg-static` extracts raw RGBA frames from the MP4 in a child process (`gif-encoder-worker.js`)
7. Per-frame chroma-key removes magenta background → transparent (handles subject movement dynamically)
8. Frames encoded as GIF (`gifenc`, 1-bit transparency) and APNG (`upng-js`, full 8-bit alpha)

Custom prompts and AI-generated presets both use preset name `_custom` and pass the prompt text via `options.customPrompt`. AI presets can also specify `options.numFrames` (33 for short motions, 49 for flowing ones). The `num_frames` parameter falls back to `fps × MAX_DURATION_SECONDS` (capped at 65) if not specified.

AI preset generation uses the `generate-animation-presets` IPC channel, which calls `generatePresets()` in `animation.js`. The cutout image is downscaled to 384px max dimension via `downscaleForVision()` (using Electron's `nativeImage.resize`) before being sent to Ollama — full resolution isn't needed for subject identification and this dramatically reduces inference time. The Ollama call uses `num_predict: 512` to cap output tokens and `keep_alive: '10m'` to keep the model warm between calls. The response is validated and normalized before being returned to the renderer. If Ollama is not running, the IPC handler returns static presets inlined in `animation.js` instead. Presets are cached in the renderer within the same cutout session — clicking "Redo" reuses cached presets instantly without re-calling Ollama. The cache clears when `setCutoutData()` or `clearCutoutData()` is called with a new cutout.

All fal.ai communication uses raw Node.js `https` module (no SDK). Users must provide their own fal.ai API key in Settings > Animation. The key is stored in `snip-config.json`. If no key is configured, the Animate button does not appear. Cost is approximately $0.08-0.15 per animation at 480p resolution.

Saved animations go to `~/Documents/snip/screenshots/animations/` subdirectory, which is excluded from AI organizer processing (watcher's `depth: 0` skips subdirectories, and `.gif` extensions aren't in the watcher's allow list). The result panel supports keyboard shortcuts: Enter or Cmd+S saves GIF (and auto-closes the panel), R redoes with another preset, Esc discards. The Settings page shows an Animation section with a fal.ai API key input (password field with show/hide toggle and save button) and an info panel with provider, resolution, duration, output formats, save location, and AI preset availability status.

### Single Index File
All screenshot metadata lives in `~/Documents/snip/screenshots/.index.json`. Simple, atomic, easy to debug. No database.

### Pre-warmed Windows (Overlay + Editor)
Both the capture overlay and the annotation editor are **pre-warmed** at app startup: hidden BrowserWindows are created off-screen (`x: -9999`, `show: false`) and load their respective HTML files. When the user triggers a capture, the pre-warmed overlay is repositioned and shown instantly (~0ms) instead of creating and loading a fresh window (~120-350ms). Similarly, the editor window has Fabric.js (310KB) and all tool scripts pre-parsed, so opening the editor after capture only needs to push image data and show the window. After each window closes, a new hidden instance is pre-warmed for the next use. If a pre-warmed window isn't ready, a fresh window is created as fallback.

The editor uses **push-based initialization**: the main process sends `editor-image-data` via `webContents.send()` to the pre-warmed renderer, which initializes the Fabric canvas on receipt. A pull fallback (`get-editor-image` IPC) exists for non-prewarmed windows.

The screen capture (`desktopCapturer.getSources()`) runs **in parallel** with overlay window preparation via `Promise.all()`. The captured image is stored as a `NativeImage` reference — the expensive `toDataURL()` serialization is **deferred** until crop time when the renderer requests it via `getCaptureImage()` IPC.

### Dock Hidden
`app.dock.hide()` in dev mode (and `LSUIElement: true` in production) prevents macOS from switching Spaces when the app's windows activate. The native module sets `NSWindowCollectionBehaviorMoveToActiveSpace` on the overlay.

### pendingFiles Gate
Only app-saved files trigger AI processing. The `pendingFiles` Set in `watcher.js` tracks files written by the app. External file operations (manual renames, copies from Finder) are indexed with basic metadata but skip the Ollama agent.

---

## Code Conventions

### Renderer (No Modules)
- Prefer `var` for consistency, but `let`/`const` are acceptable
- No ES modules — everything is IIFE or global
- Fabric.js is loaded as a `<script>` tag, not imported
- All tools attach to `window` via IIFEs (e.g., `window.RectangleTool = { ... }`)

### Main Process
- CommonJS `require()`
- Standard Node.js conventions

### CSS
- **All colors via CSS variables** from `theme.css` — never hardcode hex/rgb in component CSS
- Three themes: `[data-theme="dark"]`, `[data-theme="light"]`, `[data-theme="glass"]`
- Solid fallback via `@supports not (backdrop-filter: blur(1px))`
- See [`DESIGN.md`](DESIGN.md) for the full color system

### Naming
- UI text says "snip" not "screenshot"
- The capture action is "Snip and Annotate"
- Variables use camelCase
- CSS classes use kebab-case

### Shared Utilities
- `ToolUtils.getAccentColor()` — reads `--accent` CSS variable (don't duplicate)
- `ToolUtils.hexToRgba(hex, alpha)` — color conversion (don't duplicate)
- `ToolUtils.createMosaicImage()` — pixelation for blur effects
- `ToolUtils.SEGMENT_OUTLINE_WIDTH` — outline ring thickness (10px) for segment highlights
- `ToolUtils.SEGMENT_OVERLAY_OPACITY` — opacity (0.35) for segment highlight overlays

### Tag Linkage System
Tags (both regular and segment tags) consist of multiple Fabric.js objects linked by a shared `_snipTagId` (e.g., `'snip-tag-1'`). Each part has a `_snipTagRole` to identify it:

| Property | Set On | Values | Purpose |
|----------|--------|--------|---------|
| `_snipTagId` | all parts | `'snip-tag-N'` | Groups tip, line, label group (and overlay for segment tags) |
| `_snipTagRole` | tip, line, overlay | `'tip'`, `'line'`, `'overlay'` | Identifies the part's role for targeted updates |
| `_snipTagType` | label group | `true` | Marks the group as a tag (for selection, editing, toolbar) |
| `_snipTagColor` | label group | hex color | Current tag color (synced to all parts on change) |
| `_snipSegmentTag` | label group | `true` | Marks as a segment tag (has overlay + mask) |
| `_snipMaskURL` | label group | data URL | Original SAM mask for overlay recoloring |

During text editing, temporary `_snipEditingTagId` / `_snipEditingTagColor` markers are set on the textbox and bubble rect so toolbar color changes propagate correctly. `_applyTagColor()` in `editor-app.js` finds all linked parts by ID and updates them. The `object:moving` handler in `editor-app.js` updates the leader line when either the label group or the tip anchor is dragged.

---

## IPC Channels

The preload script (`preload.js`) exposes `window.snip` with these methods:

| Method | Direction | Purpose |
|--------|-----------|---------|
| `getScreenPermission()` | R -> M | Check Screen Recording permission status (`granted`, `denied`, `not-determined`) |
| `requestScreenPermission()` | R -> M | Trigger macOS native Screen Recording prompt via lightweight `desktopCapturer.getSources()` call; returns new status |
| `restartApp()` | R -> M | Relaunch and exit the app (used after granting Screen Recording permission) |
| `getAiEnabled()` / `setAiEnabled(val)` | R -> M | AI opt-in flag (`true`, `false`, or `undefined` on first launch) |
| `getOllamaConfig()` / `setOllamaConfig(cfg)` | R -> M | Ollama model/URL settings |
| `getOllamaStatus()` | R -> M | Server running? Model ready? Pull progress? |
| `getOllamaPullProgress()` | R -> M | Current model download progress |
| `onOllamaPullProgress(cb)` | M -> R | Real-time model pull progress push events |
| `getTheme()` / `setTheme(t)` | R -> M | Theme persistence |
| `onThemeChanged(cb)` | M -> R | Theme broadcast listener |
| `onEditorImageData(cb)` | M -> R | Push cropped capture to pre-warmed editor (primary path) |
| `getEditorImage()` | R -> M | Get cropped capture for editor (fallback for non-prewarmed) |
| `getCaptureImage()` | R -> M | Get captured screenshot as dataURL (deferred from capture time) |
| `showNotification(body)` | R -> M | Show floating toast notification (auto-dismisses) |
| `copyToClipboard(dataURL)` | R -> M | Write PNG to system clipboard |
| `saveScreenshot(dataURL, ts)` | R -> M | Save JPEG + queue for AI |
| `closeEditor()` | R -> M | Close editor window |
| `resizeEditor(width)` | R -> M | Widen editor for toolbar |
| `getSystemFonts()` | R -> M | List installed fonts |
| `checkSegmentSupport()` | R -> M | Check SAM availability |
| `segmentAtPoint(data)` | R -> M | Run SAM segmentation at click points |
| `getScreenshotIndex()` | R -> M | Get full search index |
| `getThumbnail(path)` | R -> M | Get thumbnail data URL |
| `revealInFinder(path)` | R -> M | Reveal file in Finder |
| `searchScreenshots(query)` | R -> M | Semantic/text search with relevance scores |
| `refreshIndex()` | R -> M | Prune stale entries + regenerate missing embeddings |
| `getScreenshotsDir()` | R -> M | Get screenshots directory path |
| `listFolder(subdir)` | R -> M | List folder contents |
| `openScreenshotsFolder()` | R -> M | Open screenshots dir in Finder |
| `deleteScreenshot(path)` | R -> M | Move screenshot to Trash + remove from index |
| `deleteFolder(path)` | R -> M | Move folder to Trash + remove entries from index |
| `onNavigateToSearch(cb)` | M -> R | Navigate to search page |
| `onTagsChanged(cb)` | M -> R | Tags/categories changed (live refresh in settings) |
| `getCategories()` / `addCategory()` / `removeCategory()` | R -> M | Category management |
| `getTagsWithDescriptions()` | R -> M | All tags with descriptions for settings |
| `setTagDescription(tag, desc)` | R -> M | Update tag description |
| `addCategoryWithDescription(name, desc)` | R -> M | Add category with description |
| `checkOllamaModel()` | R -> M | Check if configured model is available |
| `getAnimationConfig()` / `setAnimationConfig(cfg)` | R -> M | fal.ai API key settings |
| `checkAnimateSupport()` | R -> M | Check animation availability (true only if fal.ai API key configured) |
| `listAnimationPresets()` | R -> M | List static text-based animation presets (fallback) |
| `generateAnimationPresets(base64)` | R -> M | Generate AI-tailored presets via Ollama vision (falls back to static) |
| `animateCutout(data)` | R -> M | Generate GIF/APNG via fal.ai API |
| `onAnimateProgress(cb)` | M -> R | Animation progress (upload, queue, generate, encode) |
| `saveAnimation(data)` | R -> M | Save GIF/APNG to disk |
| `transcribeScreenshot()` | R -> M | Native macOS OCR via Vision framework — text extraction and language detection |
| `upscaleImage(data)` | R -> M | Upscale image 2x via Swin2SR ONNX model in child process |
| `onUpscaleProgress(cb)` | M -> R | Upscale progress push events |
| `openExternalUrl(url)` | R -> M | Open URL in default browser |
| `installOllama()` | R -> M | Download and install Ollama from ollama.com |
| `pullOllamaModel()` | R -> M | Pull the configured model (minicpm-v) |
| `onOllamaInstallProgress(cb)` | M -> R | Real-time install progress (downloading, extracting, installing, launching) |
| `onOllamaStatusChanged(cb)` | M -> R | Ollama status broadcast (installed, running, modelReady) |
| `onShowSetupOverlay(cb)` | M -> R | Main process triggers inline setup overlay in home window |
| `getShortcuts()` | R -> M | Returns merged default+custom shortcuts |
| `getDefaultShortcuts()` | R -> M | Returns default shortcuts |
| `setShortcut(id, keys)` | R -> M | Saves a single shortcut override |
| `resetShortcuts()` | R -> M | Deletes all custom shortcuts, restores defaults |
| `onShortcutsChanged(cb)` | M -> R | Broadcast event when shortcuts change (re-registers global shortcuts) |

*(R = Renderer, M = Main)*

---

## Data Flow: Screenshot Lifecycle

```
[User presses Cmd+Shift+2]
  -> capturer.js runs desktopCapturer + overlay prep in parallel
  -> NativeImage stored (dataURL deferred), pre-warmed overlay repositioned + shown
  -> user drags + presses Enter
  -> renderer calls getCaptureImage() to get dataURL on demand
  -> cropped image sent to editor via IPC

[User annotates + presses Cmd+S]
  -> editor exports JPEG + saves to ~/Documents/snip/screenshots/
  -> watcher.js detects new file
  -> pendingFiles.has(path) == true -> send to worker
  -> worker.js calls local Ollama vision model with base64 image
  -> model returns { category, name, description, tags }
  -> file renamed + moved to category subfolder
  -> main thread generates embedding from metadata
  -> index entry written to .index.json

[User searches "login form"]
  -> home.js calls embeddings.js to encode query
  -> cosine similarity against all indexed embeddings
  -> top 20 results displayed
```

### Transcription Data Flow

```
[User clicks "Transcribe Text" in editor toolbar]
  -> transcribe.js calls window.snip.transcribeScreenshot()
  -> preload.js sends 'transcribe-screenshot' IPC to main
  -> ipc-handlers.js calls transcription.js
  -> transcription.js compiles transcribe.swift (cached) and spawns the Swift helper
  -> editor image passed as base64 via stdin to the Swift process
  -> Swift helper decodes image, runs VNRecognizeTextRequest (macOS Vision framework)
  -> recognized text analyzed via Unicode script ranges (CJK, Hangul, Kana, Latin, Cyrillic) for language detection
  -> Swift helper outputs JSON result (languages array + extracted text) to stdout
  -> transcription.js parses JSON, returns { languages: [...], text } to renderer
  -> result displayed in side panel, cached in TranscribeTool for the editor session
  -> subsequent clicks skip OCR call and reopen panel instantly
```

---

## Theme System

Themes flow through the entire stack:

```
User clicks theme button in Settings (or tray menu)
  -> home.js calls window.snip.setTheme('glass')
  -> ipc-handlers.js stores in config
  -> broadcastTheme() sends 'theme-changed' to all windows
  -> each window sets document.documentElement.dataset.theme
  -> CSS variables activate via [data-theme="glass"] selector
  -> Fabric.js selection colors re-read via ToolUtils.getAccentColor()
```

The native Liquid Glass layer is always present (macOS 26+). Dark and Light themes cover it with opaque backgrounds. Glass theme reveals it via translucent purple-tinted backgrounds.

---

## File Locations

| Data | Dev Path | Packaged Path |
|------|----------|---------------|
| Screenshots | `~/Documents/snip/screenshots/<category>/` | same |
| Animations | `~/Documents/snip/screenshots/animations/` | same |
| Index | `~/Documents/snip/screenshots/.index.json` | same |
| Config | `~/Library/Application Support/snip/snip-config.json` | same |

**Config fields of note:**

| Field | Type | Description |
|-------|------|-------------|
| `aiEnabled` | `boolean \| undefined` | `undefined` on first launch (triggers AI choice screen), `true` if user opted in, `false` if user opted out. When `false`, Ollama is not started and AI organization is skipped entirely. |

| Ollama binary | `/usr/local/bin/ollama`, `/opt/homebrew/bin/ollama`, or `/Applications/Ollama.app/Contents/Resources/ollama` | same (user-installed) |
| Ollama models | `~/.ollama/models/` | same (shared with system Ollama) |
| HF models (MiniLM + SlimSAM + Swin2SR) | `vendor/models/` | `Resources/models/` |
| Animation presets | Inlined in `src/main/animation/animation.js` | same (bundled in asar) |
