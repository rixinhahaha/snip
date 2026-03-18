# Product Guide

> Role: **Product Manager** — Feature specs, user-facing behavior, and product decisions.
>
> See also: [`USER_FLOWS.md`](USER_FLOWS.md) for detailed step-by-step flows and acceptance criteria.

---

## Vision

Snip is a **menu-bar-only** macOS screenshot tool that makes capturing, annotating, and finding screenshots effortless. Every screenshot is automatically analyzed by AI, given a descriptive name, sorted into categories, and made searchable via natural language.

The app should feel **invisible until needed** — a global shortcut captures, a quick annotation pass adds context, and the screenshot is instantly on your clipboard and organized for later.

---

## Target User

Power users on macOS who take 5-50 screenshots per day: developers, designers, PMs, support engineers. They paste screenshots into Slack, Jira, Notion, and docs constantly. They never find old screenshots because they're buried in `~/Desktop` with timestamps as names.

---

## Core Value Props

1. **Fastest capture-to-clipboard** — Two keystrokes: Cmd+Shift+2 to capture, Esc to copy annotated image to clipboard. Under 5 seconds.
2. **Smart organization** — AI names, categorizes, and tags every saved screenshot. No manual filing.
3. **Semantic search** — Find any screenshot by describing what was in it. "slack message about deployment" finds the right one.
4. **Native feel** — Liquid Glass UI, tray-only app, no Dock icon, works across macOS Spaces without switching.

---

## Feature Set

### Capture
- **Global shortcut** (Cmd+Shift+2): Fullscreen overlay, click a window to snap-select it, or drag to select a custom region — completes immediately on mouse-up
- **Quick Snip** (Cmd+Shift+1): Same overlay with window/region selection, copies result directly to clipboard without opening the annotation editor
- **Full-screen capture**: Press Enter without selecting
- Works across macOS Spaces without switching desktops
- Home window hides during capture to stay out of the way

### Annotation Tools
| Tool | Key | Description |
|------|-----|-------------|
| Select | V | Move, resize, delete annotations |
| Rectangle | R | Outline, highlight, or blur modes |
| Text | T | Editable text with font/size pickers |
| Arrow | A | Point at things |
| Tag | G | Two-click callout: draggable label group + draggable anchor tip with leader line |
| Blur Brush | B | Paint to pixelate sensitive info |
| Segment | S | AI-powered object selection (SlimSAM) — Apply Cutout or Tag Segment (4-color palette: Red/Yellow/Green/Blue) |
| Animate | — | Animate a segment cutout into GIF/APNG via fal.ai cloud API |
| Upscale | — | On-device 2x image upscaling via ONNX model (Swin2SR) |

### Canvas Navigation
- **Pinch-to-zoom** on trackpad or **⌘+scroll** to zoom toward cursor
- **⌘+** / **⌘-** to zoom in/out, **⌘0** to reset to fit
- **Two-finger scroll** or scroll wheel to pan
- **Space+drag** or middle-click drag to pan
- Zoom indicator shown in bottom-right corner when zoomed/panned
- **?** help button (bottom-right) opens a canvas navigation guide modal

### Save & Export
- **Esc/Enter/Done**: Copy annotated PNG to clipboard, close editor
- **Cmd+S/Save**: Save JPEG to disk + copy PNG to clipboard + queue for AI

### AI Organization
- Local vision LLM (via Ollama) analyzes each saved screenshot — runs entirely on-device
- Returns: category, descriptive name, tags, description
- File renamed and moved to category subfolder
- 384-dim embedding generated for semantic search (HuggingFace Transformers.js, also local)
- New categories auto-registered with AI-generated descriptions; notification is informational only
- Default model: `minicpm-v` (8B, Metal-accelerated on Apple Silicon) — pulled on first launch via Ollama's API. Ollama is not bundled; users install it separately or via the in-app setup wizard.

### Transcribe Text
- Editor toolbar button uses native macOS Vision framework (VNRecognizeTextRequest) with Unicode script-based language detection to extract visible text and identify languages
- Near-instant, works offline without any model — uses built-in macOS OCR
- Results displayed in a collapsible side panel: language badges, extracted text, and copy-to-clipboard button
- Cached per editor session — first click runs OCR, subsequent opens are instant

### Animation (Animate)
- Requires internet connection and a fal.ai API key (configured in Settings > Animation)
- Uses fal.ai Wan 2.2 image-to-video cloud API with text-based animation prompts
- AI-generated presets: Ollama (minicpm-v) analyzes the cutout and suggests 3 animation motions tailored to the subject (e.g., "wag tail" for a dog, "sway in wind" for a plant). Falls back to 6 static presets (Breathe, Sway, Bounce, Wobble, Float, Zoom In) if Ollama is unavailable.
- Custom prompt mode: users can type their own animation description instead of picking a preset
- All animations capped at 4 seconds maximum
- Generates at 480p resolution, costs approximately $0.08-0.15 per animation
- Pipeline: composite cutout onto magenta background → upload to fal.ai → submit job to queue → poll for result → download MP4 → extract frames via ffmpeg → chroma-key magenta out per-frame → encode as GIF + APNG
- Output formats: GIF (256 colors, 1-bit transparency) and APNG (full color, 8-bit alpha)
- Result panel keyboard shortcuts: Enter or Cmd+S saves GIF, R redoes with another preset, Esc discards
- Animations saved to `~/Documents/snip/screenshots/animations/` (not processed by AI organizer)

### Upscale (2x)
- On-device 2x image upscaling using Swin2SR ONNX model (~5.7 MB) — no cloud API needed
- Single-click toolbar button — applies result directly (no preview step)
- Output capped at 3840x2160 to prevent memory issues
- Progress overlay shown during processing ("Upscaling (2x)...")
- Upscale button disabled after use (prevents repeated upscaling)
- Undoable via ⌘Z (restores pre-upscale image, dimensions, and annotations)
- Runs in a child process (same pattern as SAM segmentation) using bundled Node.js binary

### Search
- **Cmd+Shift+S**: Semantic search using local embeddings (no API calls)
- Falls back to text matching without embeddings
- Tag cloud for quick filtering
- Overlay-style result cards with name, category badge, and match score percentage
- Refresh button to prune stale entries and regenerate missing embeddings

### Gallery
- Browse screenshots by category folders
- Thumbnails with hover-to-delete (screenshots and folders)
- Click to reveal in Finder
- Refresh button to sync index with files on disk and regenerate embeddings

### Settings
- **Save Location**: Choose where snips are saved on disk. Configurable during onboarding or from Settings. When changing, users can copy, move, or start fresh with existing snips. Defaults to `~/Documents/snip/screenshots/`
- AI Assistant status and model info
- Animation settings: fal.ai API key input, info panel (provider, resolution, max duration, output formats, save location, AI preset status)
- Three themes: Dark, Light, Glass
- Custom category management (live-updated when AI auto-registers new categories)
- **Custom Keybindings**: Users can customize 3 global shortcuts (Capture, Quick Snip, and Search) from the Settings page. Click the edit icon next to a shortcut to enter recording mode, then press a modifier+key combo. Conflict detection prevents duplicate bindings. "Reset All to Defaults" restores original shortcuts. Editor tool shortcuts and OS shortcuts are displayed read-only for reference.
- Full keyboard shortcuts reference table
- **MCP Server**: Toggle to enable/disable the MCP (Model Context Protocol) server. When enabled, exposes Snip's library and tools to external AI agents (e.g., Claude Desktop) via a Unix domain socket. Per-tool toggles control which capabilities are exposed (Library, Upload, Transcribe, Organize). Copy-to-clipboard button provides the JSON config snippet needed for Claude Desktop.
- **Extensions**: Lists user-installed extensions with name, type, and permissions. Install button opens a folder picker to load a new extension (shows a manifest preview and permission approval dialog before installing). Uninstall button removes extension and kills its sandbox process.

### MCP Integration
- When MCP is enabled, external AI agents can search screenshots, list and retrieve files, transcribe text, trigger AI organization, open files in the editor, and install extensions
- MCP server runs as a stdio process (`src/mcp/server.js`) that bridges to Snip's Unix socket
- Per-category toggles in Settings control which tools are exposed

### Tray Menu
- Quick Snip, Snip and Annotate, Search Snips, Open Snip, Theme submenu (Dark / Light / Glass), Quit Snip

---

## Terminology

| Term | Meaning |
|------|---------|
| **Snip** | A screenshot (never say "screenshot" in the UI) |
| **Snip and Annotate** | The capture action that opens the annotation editor (menu item and tray label) |
| **Category** | AI-assigned folder: code, chat, web, design, documents, terminal, personal, fun, other |
| **Tag** | AI-assigned keyword for search/filtering |
| **Glass** | The translucent Liquid Glass theme on macOS 26+ |

---

## Product Principles

1. **Clipboard-first**: Most users want the screenshot on their clipboard immediately. Saving to disk is secondary.
2. **Zero-config by default**: On first launch, Snip proactively requests Screen Recording permission (with restart if granted), then guides Ollama install and model download. Works without AI if user skips setup.
3. **AI is optional**: Users choose during onboarding whether to enable AI. The app works fully without it — capture, annotate, save, and browse all function normally. Only smart naming, tagging, and organization require AI. Users who opted out can enable AI later from Settings.
4. **Non-intrusive**: Tray-only, no Dock icon, no Space switching, hides during capture.
5. **AI is invisible labor**: Users don't "invoke AI" — it just happens in the background after save.
6. **Purple, always purple**: The brand color is violet/purple. Never blue. See [`DESIGN.md`](DESIGN.md).

---

## Future Considerations

- Screenshot history timeline
- Team sharing / cloud sync
