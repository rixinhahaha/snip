# Architecture & Developer Guide

> Role: **Developer** — Code structure, conventions, key decisions, and how things connect.

---

## Tech Stack

| Component | Library | Version |
|-----------|---------|---------|
| Desktop framework | Electron | 33 |
| Annotation canvas | Fabric.js | 7 |
| AI categorization | Local vision LLM | Ollama (bundled binary + minicpm-v model) |
| Semantic embeddings | HuggingFace Transformers.js | all-MiniLM-L6-v2 |
| Image segmentation | SlimSAM | ONNX Runtime |
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
    tray.js                  # Menu-bar tray icon and context menu
    shortcuts.js             # Global keyboard shortcuts (Cmd+Shift+2, Cmd+Shift+F)
    store.js                 # Config persistence, index I/O, fal.ai API key storage
    constants.js             # Shared constants (BASE_WEB_PREFERENCES)
    ollama-manager.js        # Ollama binary download, server start/stop, model pulls
    model-paths.js           # Bundled model path resolution (dev vs packaged)
    organizer/               # AI screenshot organization pipeline
      agent.js               # Ollama vision prompt + response parsing
      worker.js              # Background worker thread for AI processing
      watcher.js             # Chokidar file watcher + pendingFiles queue
      embeddings.js          # HuggingFace transformer embedding generation
    segmentation/            # SAM image segmentation (isolated from organizer)
      segmentation.js        # SAM model orchestration (spawns subprocess)
      segmentation-worker.js # SAM inference in child process (not worker_threads)
    animation/               # 2GIF animation feature (fal.ai cloud API)
      animation.js           # fal.ai API integration (upload, queue, poll, MP4 download)
      gif-encoder-worker.js  # Child process: ffmpeg MP4→frames extraction + GIF/APNG encoding

  renderer/                  # Renderer processes (ES5, no modules)
    index.html / app.js      # Capture overlay — fullscreen transparent region selector
    home.html / home.js      # Gallery, search, settings UI (main window)
    home.css                 # Home window styles
    editor.html / editor-app.js  # Annotation editor
    editor-styles.css        # Editor toolbar and canvas styles
    editor-canvas-manager.js # Fabric.js canvas wrapper (init, export, undo/redo)
    toolbar.js               # Editor toolbar state machine
    theme.css                # ALL theme tokens (Dark, Light, Glass + solid fallback)
    tools/
      tool-utils.js          # Shared: getAccentColor(), hexToRgba(), createMosaicImage()
      rectangle.js           # Rectangle tool (outline/highlight/blur modes)
      textbox.js             # Text annotation tool
      arrow.js               # Arrow annotation tool
      tag.js                 # Tag callout tool (two-click placement)
      blur-brush.js          # Free-draw blur brush
      segment.js             # SAM segmentation tool (click-to-select)
      animate.js             # 2GIF animation tool (preset picker, save/copy panel)

  preload/
    preload.js               # contextBridge — defines window.snip API surface

  native/
    window_utils.mm          # Obj-C++ N-API addon for macOS Space behavior

assets/                      # App icons, tray icons
scripts/                     # Build and generation scripts
  download-ollama.sh           # Download Ollama binary + minicpm-v model
  download-models.js           # Download MiniLM + SlimSAM to vendor/models/
vendor/                      # Downloaded at dev time, bundled at build time
  ollama/                      # Ollama binary + minicpm-v model blobs (~5 GB)
  models/                      # HuggingFace models: MiniLM + SlimSAM (~75 MB)
  (static animation presets inlined in src/main/animation/animation.js)
```

---

## Windows

| Window | File | Purpose | Lifecycle |
|--------|------|---------|-----------|
| **Overlay** | `index.html` | Fullscreen transparent region selection | Created per capture, destroyed after crop |
| **Home** | `home.html` | Gallery, search, settings | Persistent singleton, hidden during capture |
| **Editor** | `editor.html` | Annotation canvas + toolbar | Created per edit, destroyed on close |

All windows share:
- `titleBarStyle: 'hiddenInset'` with custom traffic light positioning
- `transparent: true`, `backgroundColor: '#00000000'`
- Native Liquid Glass layer (macOS 26+) or vibrancy fallback
- Theme via `data-theme` attribute on `<html>`

---

## Key Architecture Decisions

### Bundled Ollama
The Ollama binary and default model (`minicpm-v`, ~5 GB) are **bundled with the app** — no runtime download needed. The binary lives in `vendor/ollama/` (dev) or `Resources/ollama/` (packaged). On first launch, bundled model files are copied to a writable user data directory (`~/Library/Application Support/snip/ollama/models/`). The server is spawned directly via `child_process.spawn` and stops on quit. All AI runs locally — no cloud API calls.

### Bundled HuggingFace Models
Both Transformers.js models are **pre-downloaded and bundled** — no runtime download needed. They live in `vendor/models/` (dev) or `Resources/models/` (packaged). The `model-paths.js` module resolves the correct cache directory and disables remote downloads in the packaged app:
- **Xenova/all-MiniLM-L6-v2** (~23 MB quantized) — semantic search embeddings
- **Xenova/slimsam-77-uniform** (~50 MB) — SAM image segmentation

### ONNX Runtime Threading
ONNX Runtime (via Transformers.js) **crashes in worker_threads**. Embeddings must run on the main Electron thread. The worker thread handles Ollama API calls, then delegates embedding generation back to main via message passing.

### SAM in Child Process
The segmentation model (SlimSAM) runs in a **child process** (`child_process.fork`), not a worker thread, because ONNX Runtime also crashes in Electron's V8 worker context. The child process uses the system-installed Node.js binary (not Electron's). The parent passes `SNIP_MODELS_PATH` and `SNIP_PACKAGED` env vars so the worker uses bundled models.

### fal.ai Cloud Animation
The 2GIF animation feature uses the **fal.ai Wan 2.2 A14B image-to-video API** instead of a local model. This requires an internet connection and a fal.ai API key (set in Settings). When the user clicks 2GIF, Ollama's minicpm-v vision model analyzes the cutout and generates 3 AI-tailored animation presets (e.g., "wag tail" for a dog). If Ollama is unavailable, it falls back to 6 static presets inlined in `animation.js`. Users can also enter a custom animation prompt. All animations are capped at **4 seconds maximum** (enforced via `MAX_DURATION_SECONDS` in `animation.js` and `maxDuration` in `gif-encoder-worker.js`). The pipeline:

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

All fal.ai communication uses raw Node.js `https` module (no SDK). Users must provide their own fal.ai API key in Settings > Animation. The key is stored in `snip-config.json`. If no key is configured, the 2GIF button does not appear. Cost is approximately $0.08-0.15 per animation at 480p resolution.

Saved animations go to `~/Documents/snip/screenshots/animations/` subdirectory, which is excluded from AI organizer processing (watcher's `depth: 0` skips subdirectories, and `.gif` extensions aren't in the watcher's allow list). The result panel supports keyboard shortcuts: Enter or Cmd+S saves GIF (and auto-closes the panel), R redoes with another preset, Esc discards. The Settings page shows an Animation section with a fal.ai API key input (password field with show/hide toggle and save button) and an info panel with provider, resolution, duration, output formats, save location, and AI preset availability status.

### Single Index File
All screenshot metadata lives in `~/Documents/snip/screenshots/.index.json`. Simple, atomic, easy to debug. No database.

### Dock Hidden
`app.dock.hide()` in dev mode (and `LSUIElement: true` in production) prevents macOS from switching Spaces when the app's windows activate. The native module sets `NSWindowCollectionBehaviorMoveToActiveSpace` on the overlay.

### pendingFiles Gate
Only app-saved files trigger AI processing. The `pendingFiles` Set in `watcher.js` tracks files written by the app. External file operations (manual renames, copies from Finder) are indexed with basic metadata but skip the Ollama agent.

---

## Code Conventions

### Renderer (ES5)
- Use `var` (not `let`/`const`)
- No arrow functions in tool files
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
- The capture action is "Snip It"
- Variables use camelCase
- CSS classes use kebab-case

### Shared Utilities
- `ToolUtils.getAccentColor()` — reads `--accent` CSS variable (don't duplicate)
- `ToolUtils.hexToRgba(hex, alpha)` — color conversion (don't duplicate)
- `ToolUtils.createMosaicImage()` — pixelation for blur effects

---

## IPC Channels

The preload script (`preload.js`) exposes `window.snip` with these methods:

| Method | Direction | Purpose |
|--------|-----------|---------|
| `getOllamaConfig()` / `setOllamaConfig(cfg)` | R -> M | Ollama model/URL settings |
| `getOllamaStatus()` | R -> M | Server running? Available models? |
| `getTheme()` / `setTheme(t)` | R -> M | Theme persistence |
| `onThemeChanged(cb)` | M -> R | Theme broadcast listener |
| `getEditorImage()` | R -> M | Get cropped capture for editor |
| `copyToClipboard(dataURL)` | R -> M | Write PNG to system clipboard |
| `saveScreenshot(dataURL, ts)` | R -> M | Save JPEG + queue for AI |
| `closeEditor()` | R -> M | Close editor window |
| `resizeEditor(width)` | R -> M | Widen editor for toolbar |
| `getSystemFonts()` | R -> M | List installed fonts |
| `checkSegmentSupport()` | R -> M | Check SAM availability |
| `segmentImage(data)` | R -> M | Run SAM segmentation |
| `getAnimationConfig()` / `setAnimationConfig(cfg)` | R -> M | fal.ai API key settings |
| `checkAnimateSupport()` | R -> M | Check animation availability (true only if fal.ai API key configured) |
| `listAnimationPresets()` | R -> M | List static text-based animation presets (fallback) |
| `generateAnimationPresets(base64)` | R -> M | Generate AI-tailored presets via Ollama vision (falls back to static) |
| `animateCutout(data)` | R -> M | Generate GIF/APNG via fal.ai API |
| `onAnimateProgress(cb)` | M -> R | Animation progress (upload, queue, generate, encode) |
| `saveAnimation(data)` | R -> M | Save GIF/APNG to disk |
| `openExternalUrl(url)` | R -> M | Open URL in default browser |

*(R = Renderer, M = Main)*

---

## Data Flow: Screenshot Lifecycle

```
[User presses Cmd+Shift+2]
  -> capturer.js captures screen via desktopCapturer
  -> overlay window shows fullscreen for region selection
  -> user drags + presses Enter
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
| Ollama binary | `vendor/ollama/ollama` | `Resources/ollama/ollama` |
| Ollama models (bundled) | `vendor/ollama/models/` | `Resources/ollama/models/` |
| Ollama models (writable) | — | `~/Library/Application Support/snip/ollama/models/` |
| HF models (MiniLM + SlimSAM) | `vendor/models/` | `Resources/models/` |
| Animation presets | Inlined in `src/main/animation/animation.js` | same (bundled in asar) |
