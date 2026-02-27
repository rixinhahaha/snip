# Snip

macOS screenshot tool with annotation and AI-powered organization.

Capture a region of your screen, annotate it with rectangles, arrows, text, blur, or AI segmentation, then save. An AI agent (Claude) automatically categorizes, names, and tags each screenshot. Semantic search lets you find screenshots by description.

## Prerequisites

- **macOS** 10.13+
- **Node.js** 18+ (system install via Homebrew/NVM/FNM required for SAM segmentation)
- **Xcode Command Line Tools** (`xcode-select --install`) for native module compilation
- **Screen Recording permission** granted to Electron/Snip in System Settings > Privacy & Security

## Quick Start

```bash
npm install
npm run rebuild   # compile native window_utils module
npm start         # launch the app
```

On first launch macOS will prompt for **Screen Recording** permission. Grant it, then restart the app. Snip runs as a **menu-bar tray icon** (no Dock icon).

### Configure the AI Organizer (optional)

1. Click the tray icon > **Show Snip** > **Settings**
2. Paste your Anthropic API key
3. Optionally add custom categories (defaults: code, chat, web, design, documents, terminal, other)

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Launch Snip |
| `npm run dev` | Launch with verbose Electron logging |
| `npm run build` | Package as macOS DMG via electron-builder |
| `npm run rebuild` | Recompile native modules for current Electron ABI |

## Usage

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+2 | Capture screenshot |
| Cmd+Shift+F | Open search |

### Capture Flow

1. Press **Cmd+Shift+2** -- a fullscreen overlay appears on the current viewport
2. **Drag** to select a region (or press Enter to capture the full screen)
3. The annotation **editor** opens with your crop

### Annotation Tools

| Key | Tool | Description |
|-----|------|-------------|
| V | Select | Click to select, move, and resize annotations |
| R | Rectangle | Drag to draw. Modes: Outline, Highlight, Blur |
| T | Text | Click to place editable text. Click outside to deselect. Font and size selectors |
| A | Arrow | Drag to draw an arrow |
| B | Blur Brush | Paint to pixelate/blur sensitive areas |
| S | Segment | AI-powered object selection (click on an object) |

The toolbar includes a **color picker**, **stroke width** selector, and **mode** toggles for the rectangle tool. Selection handles use the theme accent color.

### Editor Shortcuts

| Key | Action |
|-----|--------|
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Delete / Backspace | Remove selected annotation |
| Cmd+S | Save to disk (also copies to clipboard) |
| Esc / Enter | Copy to clipboard and close |

### Saving

- **Esc / Enter / Done** -- copies the annotated screenshot to your clipboard and closes
- **Cmd+S / Save** -- saves as JPEG to `~/Documents/snip/screenshots/`, copies to clipboard, and queues for AI organization

### AI Organization

When an API key is configured, saved screenshots are automatically:
1. Analyzed by Claude Haiku to understand the content
2. Renamed with a descriptive name (e.g. `slack-deployment-discussion.jpg`)
3. Moved into a category subfolder (e.g. `screenshots/code/`)
4. Indexed with tags, description, and a 384-dimensional embedding for semantic search

If Claude suggests a new category, a macOS notification appears to approve it.

### Search

Open search via the tray menu or **Cmd+Shift+F**. Results are ranked by semantic similarity using local embeddings (no API calls during search). Falls back to text matching if no embeddings exist. You can also click tags in the tag cloud to filter by tag.

## Architecture

```
src/
  main/               # Main process
    main.js            # App lifecycle, window management
    capturer.js        # Screen capture via desktopCapturer
    ipc-handlers.js    # All IPC channel handlers
    tray.js            # Menu-bar tray icon and menu
    shortcuts.js       # Global keyboard shortcuts
    store.js           # Config persistence, encrypted API key, index
    constants.js       # Shared constants
    organizer/
      agent.js         # Claude API screenshot analysis
      worker.js        # Background worker thread
      watcher.js       # Chokidar file watcher + pendingFiles queue
      embeddings.js    # HuggingFace transformer embeddings
      segmentation.js  # SAM model orchestration (subprocess)
      segmentation-worker.js  # SAM inference in child process
  renderer/            # Renderer processes
    index.html / app.js         # Capture overlay + region selection
    home.html / home.js         # Gallery, search, settings UI
    editor.html / editor-app.js # Annotation editor
    toolbar.js                  # Editor toolbar state
    editor-canvas-manager.js    # Fabric.js canvas wrapper
    tools/                      # Annotation tool implementations
  preload/
    preload.js         # Context bridge (IPC API surface)
  native/
    window_utils.mm    # Objective-C++ module for macOS Space behavior
```

### Windows

| Window | Purpose | Lifecycle |
|--------|---------|-----------|
| **Overlay** | Fullscreen transparent capture + region selection | Created per capture, destroyed after crop |
| **Home** | Gallery browser, search, settings | Persistent, hidden during capture |
| **Editor** | Annotation canvas with toolbar | Created per edit session, destroyed on close |

### Background Processing

- **Worker thread** (`worker.js`) processes screenshots via Claude API without blocking the UI.
- **SAM subprocess** (`segmentation-worker.js`) runs in a child process because ONNX Runtime crashes inside Electron's V8.
- **File watcher** (`watcher.js`) monitors `~/Documents/snip/screenshots/` for new files. Only app-saved files (tracked via `pendingFiles` set) trigger AI processing; external file operations (renames, copies) are indexed without calling the agent.

## Data Storage

| Item | Location |
|------|----------|
| Screenshots | `~/Documents/snip/screenshots/<category>/` |
| Index | `~/Documents/snip/screenshots/.index.json` |
| Config | `~/Library/Application Support/snip/snip-config.json` |
| API key | Encrypted via Electron `safeStorage` (macOS Keychain) |

## Native Module

`src/native/window_utils.mm` exposes `setMoveToActiveSpace(handle)` which sets `NSWindowCollectionBehaviorMoveToActiveSpace` on the overlay window. Combined with `app.dock.hide()` (and `LSUIElement: true` in production), this ensures the capture overlay appears on the user's active Space without switching desktops.

Built via `node-gyp` (triggered by `npm run rebuild`). Requires Xcode CLT.

## Tech Stack

| Component | Library |
|-----------|---------|
| Desktop framework | Electron 33 |
| Annotation canvas | Fabric.js 7 |
| AI categorization | Claude Haiku (Anthropic SDK) |
| Semantic embeddings | HuggingFace Transformers.js (all-MiniLM-L6-v2) |
| Image segmentation | SlimSAM (ONNX Runtime) |
| File watching | Chokidar 4 |
| Native bridge | Node-API (N-API) |
| macOS effects | electron-liquid-glass |

## Build

```bash
npm run build
```

Produces a universal `.dmg` (arm64 + x86_64) in the `dist/` folder.

## License

MIT
