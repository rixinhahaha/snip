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
| Diagram rendering | Mermaid.js | 11 |
| macOS glass effects | electron-liquid-glass | 1.1+ |
| Font | Plus Jakarta Sans | variable 200-800 |

---

## Directory Structure

```
src/
  main/                     # Main process (Node.js / CommonJS)
    main.js                  # App lifecycle, window creation, liquid glass init, MCP socket handlers
    capturer.js              # Screen capture via desktopCapturer
    ipc-handlers.js          # Core IPC channel handlers (non-extension)
    extension-registry.js    # Loads extension manifests, registers IPC handlers, manages lifecycle
    socket-server.js         # Unix domain socket server for MCP adapter communication
    extension-sandbox.js     # Manages sandboxed child processes for user extensions
    extension-sandbox-worker.js  # Forked child: blocks dangerous modules, proxies permission APIs
    tray.js                  # Menu-bar tray icon and context menu, rebuildTrayMenu() for live accelerator updates
    shortcuts.js             # Global keyboard shortcuts (Cmd+Shift+2, Cmd+Shift+S, Cmd+Shift+1), reregisterShortcuts() for dynamic rebinding
    store.js                 # Config persistence, index I/O, fal.ai API key storage, aiEnabled flag, reloadConfig(), getShortcuts(), getDefaultShortcuts(), setShortcut(), resetShortcuts()
    constants.js             # Shared constants (BASE_WEB_PREFERENCES)
    auto-updater.js          # Auto-update via electron-updater (check, prompt, download, install)
    ollama-manager.js        # Ollama process lifecycle (spawn/kill on dynamic port, ready/status/model pull)
    model-paths.js           # Model path resolution (addon dir, dev vendor/, legacy bundled)
    addon-manager.js         # Optional AI add-on system: install/remove/status, runtime + model downloads
    addon-model-downloader.js  # Forked helper: downloads HF models using transformers.js from addon runtime
    worker-process.js        # Shared factory for forking isolated child-process workers (used by segmentation, upscaler, embeddings)
    organizer/               # AI screenshot organization pipeline
      agent.js               # Ollama vision prompt + response parsing
      worker.js              # Background worker thread for AI processing
      watcher.js             # Chokidar file watcher + pendingFiles queue + setOllamaHost() + generateEmbeddingForEntry()
      embeddings.js          # Embedding coordinator — delegates to child process worker
      embeddings-worker.js   # Forked child: runs MiniLM embedding inference via transformers.js
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
    transcription/           # Text extraction via native macOS OCR (macOS only)
      transcription.js       # Node.js wrapper: compiles + spawns Swift helper, parses JSON result
      transcribe.swift       # Swift CLI: VNRecognizeTextRequest OCR + Unicode script detection, reads base64 via stdin
    platform/                # Platform abstraction layer — ALL platform checks go through here
      index.js                 # Router: loads correct module based on process.platform
      darwin.js                # macOS: window management, Ollama paths, native addon, Dock hiding
      linux.js                 # Linux: Wayland clipboard, GNOME compositor shortcuts, D-Bus portal, dependency checks
      win32.js                 # Windows: stubs (placeholder)
      shared.js                # Shared POSIX utilities (process kill, socket poll, CLI install paths)
      portal-screenshot.py     # Linux D-Bus XDG Desktop Portal screenshot helper

  extensions/                # Extension manifests + main modules (loaded by extension-registry.js)
    select/extension.json      # Select tool (canvas-tool, no main module)
    rectangle/extension.json   # Rectangle tool (canvas-tool, no main module)
    text/extension.json        # Text tool (canvas-tool, no main module)
    arrow/extension.json       # Arrow tool (canvas-tool, no main module)
    tag/extension.json         # Tag tool (canvas-tool, no main module)
    blur-brush/extension.json  # Blur brush tool (canvas-tool, no main module)
    segment/                   # SAM segmentation + animation (ai-tool)
      extension.json           # Manifest: segment + animate IPC channels
      main.js                  # IPC handlers for segmentation + animation
    upscale/                   # Image upscaling (action-tool)
      extension.json           # Manifest with buttonId override (btn-upscale)
      main.js                  # IPC handler for upscale-image
    transcribe/                # Text extraction (action-tool)
      extension.json
      main.js                  # IPC handler for transcribe-screenshot
    organizer/extension.json   # AI organizer (processor, no toolbar button)
    extensions.json            # Registry of active bundled extensions
    EXTENSIONS.md              # Extension developer guide

  cli/                       # CLI interface (primary tool interface)
    snip.js                    # CLI binary — connects to Unix socket, JSON/text output

  mcp/                       # MCP adapter (thin wrapper around CLI)
    server.js                  # Stdio adapter — spawns CLI for tool calls, direct socket for install_extension/render_diagram

  preload/
    preload.js               # contextBridge — defines window.snip API surface
    diagram-preload.js       # Minimal preload for diagram renderer window (2 IPC methods)

  renderer/                  # Renderer processes (no modules, globals via IIFEs)
    index.html / app.js      # Capture overlay — fullscreen transparent region selector
    styles.css               # Overlay-specific styles (capture selection UI)
    home.html / home.js      # Gallery, search, settings UI (main window)
    home.css                 # Home window styles
    editor.html / editor-app.js  # Annotation editor
    editor-styles.css        # Editor toolbar and canvas styles
    editor-canvas-manager.js # Fabric.js canvas wrapper (init, export, undo/redo)
    extension-loader.js      # Builds toolbar buttons dynamically from extension manifests
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
    diagram.html             # Minimal page for headless Mermaid diagram rendering (hidden BrowserWindow)
    diagram-renderer.js      # Mermaid render IIFE: receives code via IPC, renders SVG, reports dimensions

  native/
    window_utils.mm          # Obj-C++ N-API addon (macOS only): setMoveToActiveSpace (Space behavior), getWindowList (CGWindowList for window snap — individual windows in z-order with PID)

assets/                      # App icons, tray icons
site/                        # Marketing site (GitHub Pages, snipit.dev)
  index.html                   # Landing page
  guide.html                   # Setup guide (permissions, AI setup)
  styles.css                   # Shared styles
  script.js                    # Download links, scroll animations, sparkle canvas
  CNAME                        # Custom domain config (snipit.dev)
  assets/                      # Hero video, screenshots, OG image
scripts/                     # Build and generation scripts
  download-models.js           # Download HF models to vendor/models/ (dev only, not bundled)
  download-node.js             # Download standalone Node.js binary to vendor/node/
  build-runtime-bundle.js      # Build AI runtime tarball for addon system (GitHub release asset)
  afterPack.js                 # electron-builder afterPack hook (strip unused native modules, pre-sign)
  build-signed.sh              # Production build: sign + notarize
  generate-app-icon.js         # Regenerate app icons from SVG template
tests/                       # Vitest unit tests
  setup/
    electron-mock.js           # vi.mock('electron', ...) — shared setup file
    load-iife.js               # VM-based IIFE loader for renderer code
  main/
    store.test.js              # Config + index CRUD (real fs with temp dirs)
    agent.test.js              # processScreenshot (Ollama prototype spy)
    embeddings.test.js         # cosineSimilarity + searchScreenshots
    mcp.test.js                # MCP config, socket server, category gating, path validation
  renderer/
    tool-utils.test.js         # hexToRgba, lineEndpointForTag, nextTagId
  cli/
    cli.test.js                # CLI help, commands, parameter passing, socket, error handling
vendor/                      # Downloaded at dev time (NOT bundled in binary)
  models/                      # HuggingFace models for dev (npm run download-models)
  node/                        # Standalone Node.js binary for child processes (~100 MB)
    arm64/node                   # Apple Silicon (macOS)
    x64/node                     # x86_64 (Linux)
  (static animation presets inlined in src/main/animation/animation.js)
```

---

## Testing

**Framework:** Vitest 3.x with `pool: 'vmThreads'` (required for `vi.mock()` to intercept CJS `require()` calls).

**Run:** `npm test` (single run), `npm run test:watch` (watch mode), `npm run test:coverage` (coverage report).

**CI:** GitHub Actions on `ubuntu-latest` with `npm ci --ignore-scripts` (skips native module compilation). Runs on push to `main` and PRs to `main`.

**Key mocking patterns:**

| Pattern | Used For | Why |
|---------|----------|-----|
| `vi.spyOn(Ollama.prototype, 'chat')` | Ollama API calls in agent.js | Prototype spy intercepts all instances; `vi.mock('ollama')` doesn't reliably intercept CJS `require()` from other CJS modules |
| `store.setExternalPaths(tmpDir, configPath)` | Store functions in agent.js | Configures real store to use temp dirs instead of Electron paths; avoids `require('electron')` |
| `vi.spyOn(store, 'readIndex')` | Store calls in embeddings.js | Spy on real module instance for lazy `require('../store')` inside function bodies |
| `vi.mock('@huggingface/transformers')` | Embedding pipeline | ESM package — `vi.mock()` intercepts ESM imports reliably |
| `parentPort.postMessage` filtering | agent.js notification messages | Agent sends `'notification'`/`'tags-changed'` messages on parentPort which confuse tinypool's IPC |
| `new Function(source + '\nreturn Name;')` | Renderer IIFE tools | `const` declarations in IIFEs don't become context properties in `vm.runInContext` |

---

## Windows

| Window | File | Purpose | Lifecycle |
|--------|------|---------|-----------|
| **Overlay** | `index.html` | Fullscreen transparent region selection | Pre-warmed hidden at startup; reused per capture, destroyed after crop, then re-pre-warmed |
| **Home** | `home.html` | Gallery, search, settings | Persistent singleton, hidden during capture |
| **Editor** | `editor.html` | Annotation canvas + toolbar | Pre-warmed hidden at startup; reused per capture (resized + shown), destroyed on close, then re-pre-warmed |

All windows share:
- `titleBarStyle: 'hiddenInset'` with custom traffic light positioning (macOS); standard title bar on Linux
- `transparent: true`, `backgroundColor: '#00000000'` (macOS); standard window chrome on Linux
- Native Liquid Glass layer (macOS 26+) or vibrancy fallback; no native effects on Linux
- Theme via `data-theme` attribute on `<html>`

---

## Key Architecture Decisions

### Platform Abstraction
All platform-specific code is centralized in `src/main/platform/`. The `index.js` router loads the correct module based on `process.platform` — no other file in the codebase checks `process.platform` directly. Platform modules export a common interface (window management, Ollama paths, clipboard, shortcuts, tray icon, etc.) with platform-specific implementations. Linux targets Wayland sessions (X11 is untested).

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

On macOS, the in-app installer (`installOllama()`) downloads `Ollama-darwin.zip` from ollama.com, extracts `Ollama.app`, moves it to `/Applications/`, then calls `startOllama()` to spawn the managed server (does NOT launch the Ollama GUI app). Progress is pushed to all BrowserWindows via `webContents.send('ollama-install-progress', progress)`. On Linux, auto-install is not supported — the user must install Ollama manually (`curl -fsSL https://ollama.com/install.sh | sh`).

Model pull uses `client.pull({ model, stream: true })` with per-digest progress accumulation, pushed via `webContents.send('ollama-pull-progress', progress)`. If the server is down during a pull, `pullModel()` attempts to restart the managed instance via `startOllama()`.

All AI runs locally — no cloud API calls (except fal.ai for animations).

### HuggingFace Models (Optional Add-ons)
HuggingFace/Transformers.js models are **not bundled** in the app binary. They are optional add-ons downloaded on demand through Settings → Add-ons. The shared AI runtime (`@huggingface/transformers` + `onnxruntime-node`) and models are stored in `~/Library/Application Support/snip/addons/`. In development, `vendor/models/` can be used (populated by `npm run download-models`).

Three add-ons are available:
- **Segment** — Xenova/slimsam-77-uniform (~38 MB) — SAM image segmentation
- **Upscale** — Xenova/swin2SR-lightweight-x2-64 (~8 MB) — 2x image super-resolution
- **Smart Search** — Xenova/all-MiniLM-L6-v2 (~97 MB) — semantic search embeddings

The add-on system is managed by `src/main/addon-manager.js`. First add-on install downloads the shared AI runtime (~60 MB tarball from GitHub releases), then the model from HuggingFace.

### ONNX Runtime in Child Processes
All ONNX inference (segmentation, upscaling, embeddings) runs in **child processes** (`child_process.fork`), not the main Electron process, because ONNX Runtime crashes in Electron's V8. Workers use a standalone Node.js binary located via `src/main/node-binary.js`. The parent passes `NODE_PATH` pointing to the addon runtime's `node_modules/` so workers can find `@huggingface/transformers`.

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

### Extension System
Tools and features are defined as extensions in `src/extensions/{name}/extension.json`. Each manifest declares:

| Field | Purpose |
|-------|---------|
| `name` | Unique identifier |
| `type` | `canvas-tool`, `ai-tool`, `action-tool`, or `processor` |
| `toolId` | DOM button ID suffix (e.g., `select` → `tool-select`) |
| `buttonId` | Optional override for the button ID (e.g., `btn-upscale`) |
| `icon` | SVG markup for the toolbar button |
| `shortcut` | Keyboard shortcut key |
| `toolbarPosition` | Sort order in toolbar (1-based) |
| `hidden` | Start hidden (e.g., segment waits for device check) |
| `toolbarGroups` | Contextual control groups to show when active (e.g., `["stroke-group"]`) |
| `main` | Path to Node.js module with IPC handlers (relative to extension dir, must be a basename — no `..` allowed) |
| `ipc` | Array of `{ channel, method }` mappings from IPC channel to exported function |

**Startup flow:**
1. `extension-registry.loadAll()` reads `extensions.json` for bundled extensions, then scans `~/Library/Application Support/snip/extensions/` for user extensions. User extensions are tagged `_source: 'user'` and restricted to `action-tool`/`processor` types with `ext:` prefixed channels.
2. `extension-registry.setContext()` provides shared context (e.g., `getEditorData`)
3. Core IPC handlers register first (protects channels from squatting), then `extension-registry.registerIpcHandlers()` registers extension handlers. Builtin extensions use in-process `require()`. User extensions run in sandboxed child processes via `extension-sandbox.js`.
4. `extension-registry.warmUp()` calls `warmUp()` on builtin extensions that export it (e.g., SAM model pre-loading)
5. On quit, `extension-registry.killWorkers()` calls `killWorker()` on builtin extensions and kills all sandboxed user extension processes

**Renderer side:** `extension-loader.js` receives the manifest array via `editor-image-data` IPC, builds toolbar buttons into `#toolbar-tools`, and provides helpers for shortcut maps and toolbar group visibility.

Extensions with `toolbarGroups: []` manage their own contextual controls (e.g., segment.js shows `segment-color-group` manually during cutout tagging, not on tool selection).

### MCP Server
An MCP (Model Context Protocol) server exposes Snip's capabilities to external AI agents (e.g., Claude Desktop). Two components:

1. **Unix domain socket** (`socket-server.js`) — listens at `~/Library/Application Support/snip/snip.sock` (chmod 600). Accepts newline-delimited JSON messages with `{ id, action, params }`. Registered actions: `search_screenshots`, `list_screenshots`, `get_screenshot`, `transcribe_screenshot`, `organize_screenshot`, `get_categories`, `open_in_snip`, `render_diagram`, `install_extension`. The `open_in_snip` and `render_diagram` actions open the editor, block until the user finishes annotating, and return the edited PNG via a `pendingMcpResolve` promise resolved by the `editor-result` IPC channel.

2. **Snip CLI** (`src/cli/snip.js`) — primary interface. Commands: `search`, `list`, `get`, `transcribe`, `organize`, `categories`, `open`, `render`. Auto-launches Snip if not running. Connects to the socket, prints JSON/text to stdout. The `render` command reads diagram code from stdin. AI agents call this via bash.

3. **MCP stdio adapter** (`src/mcp/server.js`) — thin wrapper that spawns the CLI for tool calls. Speaks MCP JSON-RPC 2.0 over stdio. Uses direct socket only for `install_extension` (complex JSON params), `open_in_snip` with `imageDataURL` (too large for CLI args), and `render_diagram` (diagram code can be large). Configure in Claude Desktop:
```json
{
  "mcpServers": {
    "snip": {
      "command": "node",
      "args": ["/path/to/snip/src/mcp/server.js"]
    }
  }
}
```

**Security:** Library, transcribe, and organize MCP tools validate that paths are inside the screenshots directory (`path.resolve` + `startsWith` check). `open_in_snip` intentionally accepts any local file path (restricted to PNG/JPEG by extension check, size-capped at 15 MB) since it's designed for uploading external images to annotate. The socket buffer is capped at 16 MB per connection, and MCP Content-Length is capped at 10 MB. The `open_in_snip` action validates base64 length before decoding (max ~15 MB raw). The `editor-result` IPC channel validates `event.sender.id` against the editor window's `webContentsId` to prevent other windows from resolving the pending upload promise.

### Auto-Update
The packaged app checks for updates via `electron-updater` against GitHub Releases. The flow:

1. 10 seconds after `app.whenReady()`, `auto-updater.js` calls `autoUpdater.checkForUpdates()` (packaged builds only)
2. If a newer version exists, a dialog prompts "Download?" — `autoDownload` is `false`, no silent downloads
3. User clicks Download → ZIP downloaded in background from GitHub Releases
4. Download complete → dialog prompts "Restart Now?" with "Later" as default
5. User clicks Restart Now → `pendingInstall` flag set → `quitAndInstall()` called → `will-quit` handler skips `e.preventDefault()` and does synchronous cleanup only → app relaunches with new version
6. Re-checks every 12 hours for long-running tray sessions

The `publish` config in `electron-builder.yml` points to `rixinhahaha/snip` GitHub Releases. The release workflow builds macOS DMG + ZIP and Linux AppImage + deb. macOS uses `--publish always` which uploads artifacts and a `latest-mac.yml` manifest. Linux uses `--publish never` with manual `gh release upload`, which also uploads a `latest-linux.yml` manifest. `electron-updater` fetches the appropriate manifest to detect new versions. On macOS, code signature verification happens automatically. On Linux, auto-update works for AppImage format only (deb users must update manually).

### Single Index File
All screenshot metadata lives in `~/Documents/snip/screenshots/.index.json`. Simple, atomic, easy to debug. No database.

### Pre-warmed Windows (Overlay + Editor)
Both the capture overlay and the annotation editor are **pre-warmed** at app startup: hidden BrowserWindows are created off-screen (`x: -9999`, `show: false`) and load their respective HTML files. When the user triggers a capture, the pre-warmed overlay is repositioned and shown instantly (~0ms) instead of creating and loading a fresh window (~120-350ms). Similarly, the editor window has Fabric.js (310KB) and all tool scripts pre-parsed, so opening the editor after capture only needs to push image data and show the window. After each window closes, a new hidden instance is pre-warmed for the next use. If a pre-warmed window isn't ready, a fresh window is created as fallback.

The editor uses **push-based initialization**: the main process sends `editor-image-data` via `webContents.send()` to the pre-warmed renderer, which initializes the Fabric canvas on receipt. A pull fallback (`get-editor-image` IPC) exists for non-prewarmed windows.

The screen capture (`desktopCapturer.getSources()`) runs **in parallel** with overlay window preparation via `Promise.all()`. The captured image is stored as a `NativeImage` reference — the expensive `toDataURL()` serialization is **deferred** until crop time when the renderer requests it via `getCaptureImage()` IPC.

### Dock Hidden (macOS) / Tray-Only (Linux)
On macOS, `app.dock.hide()` in dev mode (and `LSUIElement: true` in production) prevents macOS from switching Spaces when the app's windows activate. The native module sets `NSWindowCollectionBehaviorMoveToActiveSpace` on the overlay. On Linux, the app runs as a system tray icon only — no Dock equivalent exists. The platform layer's `hideFromDock()` is a no-op on Linux.

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
| `getAiEnabled()` / `setAiEnabled(val)` | R -> M | AI organization toggle (`true` or `false`; defaults to `false`) |
| `getOllamaConfig()` / `setOllamaConfig(cfg)` | R -> M | Ollama model/URL settings |
| `getOllamaStatus()` | R -> M | Server running? Model ready? Pull progress? |
| `getOllamaPullProgress()` | R -> M | Current model download progress |
| `onOllamaPullProgress(cb)` | M -> R | Real-time model pull progress push events |
| `getTheme()` / `setTheme(t)` | R -> M | Theme persistence |
| `onThemeChanged(cb)` | M -> R | Theme broadcast listener |
| `openEditor(data)` | R -> M | Open editor with image data (used by overlay renderer) |
| `onEditorImageData(cb)` | M -> R | Push cropped capture to pre-warmed editor (primary path) |
| `getEditorImage()` | R -> M | Get cropped capture for editor (fallback for non-prewarmed) |
| `onScreenshotCaptured(cb)` | M -> R | Push captured screenshot data to overlay renderer |
| `closeOverlay()` | R -> M | Close the capture overlay window |
| `getCaptureImage()` | R -> M | Get captured screenshot as dataURL (deferred from capture time) |
| `showNotification(body)` | R -> M | Show floating toast notification (auto-dismisses) |
| `copyToClipboard(dataURL)` | R -> M | Write PNG to system clipboard |
| `saveScreenshot(dataURL, ts)` | R -> M | Save JPEG + queue for AI |
| `closeEditor()` | R -> M | Close editor window |
| `resizeEditor(minWidth)` | R -> M | Widen editor to minimum width |
| `getSystemFonts()` | R -> M | List installed fonts |
| `checkSegmentSupport()` | R -> M | Check SAM availability |
| `segmentAtPoint(data)` | R -> M | Run SAM segmentation at click points |
| `getScreenshotIndex()` | R -> M | Get full search index |
| `getThumbnail(path)` | R -> M | Get thumbnail data URL |
| `revealInFinder(path)` | R -> M | Reveal file in Finder |
| `searchScreenshots(query)` | R -> M | Semantic/text search with relevance scores |
| `refreshIndex()` | R -> M | Prune stale entries + regenerate missing embeddings |
| `getScreenshotsDir()` | R -> M | Get screenshots directory path (respects custom location) |
| `getDefaultScreenshotsDir()` | R -> M | Get default screenshots path (`~/Documents/snip/screenshots/`) |
| `chooseScreenshotsDir()` | R -> M | Open native folder picker for save location; returns path or null |
| `setScreenshotsDir(newDir, migration)` | R -> M | Change save location with migration (`copy`, `move`, or `none`). Restarts file watcher |
| `onScreenshotsDirChanged(cb)` | M -> R | Push event when save location changes |
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
| `getMcpConfig()` | R -> M | Get MCP enabled state + per-category toggles |
| `setMcpConfig(config)` | R -> M | Update MCP UI visibility + category toggles (socket always runs) |
| `getMcpClientConfig()` | R -> M | Get resolved `command`+`args` JSON for MCP client config (dev vs packaged paths) |
| `onMcpConfigChanged(cb)` | M -> R | Push event when MCP config changes |
| `invokeExtension(channel, ...args)` | R -> M | Generic extension IPC bridge (ext: prefix enforced) |
| `onExtensionEvent(channel, cb)` | M -> R | Listen for extension push events (ext: prefix enforced, returns cleanup fn) |
| `sendEditorResult(dataURL)` | R -> M | Send edited image (or null for cancel) back to MCP `open_in_snip` handler |
| `getUserExtensions()` | R -> M | List user-installed extensions (name, type, permissions) |
| `removeUserExtension(name)` | R -> M | Remove a user extension (kills sandbox, deletes files) |
| `installExtensionFromFolder()` | R -> M | Open folder picker, validate, show approval dialog, install |
| `onUserExtensionsChanged(cb)` | M -> R | Push event when user extensions are added/removed |
| `installCli()` | R -> M | Write shell wrapper to `/usr/local/bin/snip`, `~/.local/bin/snip`, or `~/bin/snip` |
| `checkCliInstalled()` | R -> M | Check if CLI wrapper exists |
| `detectAiProviders()` | R -> M | Scan for installed AI tools (Claude Code, Cursor, Windsurf, Cline) |
| `configureAiProvider(id)` | R -> M | Write Snip rules to a detected AI provider's config |
| `removeAiProvider(id)` | R -> M | Remove Snip rules from an AI provider's config |
| `checkAiProviderStatus(id)` | R -> M | Check if Snip rules are configured for a provider |
| `uninstallCli()` | R -> M | Remove CLI wrapper from all candidate paths |

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

### Diagram Rendering Data Flow

```
[Agent pipes Mermaid code: echo 'graph TD; A-->B' | snip render --format mermaid]
  -> CLI reads stdin, sends { action: 'render_diagram', params: { code, format } } via socket
  -> main.js render_diagram handler calls renderDiagramToImage(code, format)
  -> hidden BrowserWindow created (4096x4096, show:false) with diagram-preload.js
  -> diagram.html loads mermaid.min.js from node_modules
  -> main sends code via 'render-diagram-code' IPC to diagram renderer
  -> diagram-renderer.js calls mermaid.render(), injects SVG, measures dimensions
  -> sends 'diagram-rendered' IPC back with { success, width, height }
  -> main calls webContents.capturePage(rect) -> NativeImage -> PNG data URL
  -> diagram window destroyed
  -> editor window opened with rendered PNG (reuses open_in_snip editor flow)
  -> user annotates diagram in editor
  -> Esc/Enter closes editor, 'editor-result' IPC returns annotated data URL
  -> annotated image saved to .tmp/, path returned to CLI via socket
  -> CLI outputs { status: 'done', path, message }
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

On macOS 26+, the native Liquid Glass layer is always present. Dark and Light themes cover it with opaque backgrounds. Glass theme reveals it via translucent purple-tinted backgrounds. On Linux, there is no native glass layer — the Glass theme uses CSS `backdrop-filter` where supported by the Wayland compositor, falling back to solid backgrounds.

---

## File Locations

| Data | Dev Path | Packaged Path |
|------|----------|---------------|
| Screenshots | `~/Documents/snip/screenshots/<category>/` (default, configurable via `screenshotsDir`) | same |
| Animations | `<screenshotsDir>/animations/` | same |
| Index | `<screenshotsDir>/.index.json` | same |
| Config | macOS: `~/Library/Application Support/snip/snip-config.json`; Linux: `~/.config/snip/snip-config.json` | same |
| MCP Socket | macOS: `~/Library/Application Support/snip/snip.sock`; Linux: `$XDG_RUNTIME_DIR/snip/snip.sock` | same |
| User Extensions | macOS: `~/Library/Application Support/snip/extensions/`; Linux: `~/.local/share/snip/extensions/` | same |

**Config fields of note:**

| Field | Type | Description |
|-------|------|-------------|
| `aiEnabled` | `boolean` | `false` by default (set during first launch onboarding). `true` if user enabled from Settings. When `false`, Ollama is not started and AI organization is skipped entirely. |
| `mcpEnabled` | `boolean` | Controls MCP config visibility in Settings UI. Socket server always runs. Default `false`. |
| `mcpCategories` | `object` | Per-category toggles: `{ library, upload, transcribe, organize }`. Each is boolean, all default to `true`. Controls which MCP tools are active. |
| `ollamaModel` | `string` | Ollama model name. Default `'minicpm-v'`. |
| `ollamaUrl` | `string` | Ollama server URL. Default `'http://127.0.0.1:11434'`. |
| `theme` | `string` | Active theme: `'dark'`, `'light'`, or `'glass'`. Default `'dark'`. |
| `shortcuts` | `object` | Custom shortcut overrides keyed by action ID (e.g. `{ "capture": "CommandOrControl+Shift+2" }`). Only overridden shortcuts are stored; defaults come from `DEFAULT_SHORTCUTS` in `store.js`. |
| `falApiKey` | `string` | fal.ai API key for cloud animation. Empty string if not configured. |
| `tagDescriptions` | `object` | Custom descriptions per tag/category name (e.g. `{ "code": "Code editors and terminals" }`). Used by the AI organizer prompt. |
| `screenshotsDir` | `string \| undefined` | Custom save location for screenshots. When `undefined` or absent, defaults to `~/Documents/snip/screenshots/`. Set during onboarding or from Settings. |

| Ollama binary | macOS: `/usr/local/bin/ollama`, `/opt/homebrew/bin/ollama`, `/Applications/Ollama.app/...`; Linux: `/usr/local/bin/ollama`, `/usr/bin/ollama`, `/snap/bin/ollama` | same (user-installed) |
| Ollama models | `~/.ollama/models/` | same (shared with system Ollama) |
| HF models (add-ons) | `vendor/models/` (dev) | macOS: `~/Library/Application Support/snip/addons/models/`; Linux: `~/.local/share/snip/addons/models/` |
| AI runtime (transformers.js + onnxruntime) | `node_modules/` (dev) | macOS: `~/Library/Application Support/snip/addons/runtime/`; Linux: `~/.local/share/snip/addons/runtime/` |
| Animation presets | Inlined in `src/main/animation/animation.js` | same (bundled in asar) |
