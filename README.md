<p align="center">
  <img src="assets/icon.png" alt="Snip" width="128" height="128"><br><br>
  <a href="https://www.producthunt.com/products/snip-ai-powered-macos-screenshot-tool?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-snip-ai-powered-macos-screenshot-tool-2" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1089620&theme=dark" alt="Snip on Product Hunt" height="40"></a>
</p>

# Snip

**[snipit.dev](https://snipit.dev)**

Visual communication layer between humans and AI agents for macOS and Linux.

Capture and annotate screenshots, render diagrams from code, review agent-generated visuals with approve/request-changes flow — all from the menu bar / system tray. AI organizes and indexes everything for semantic search. CLI and MCP integration let any AI agent use Snip as their visual I/O.

## Install

### macOS (Homebrew)

```bash
brew install --cask rixinhahaha/snip/snip
```

Or download the DMG from [Releases](https://github.com/rixinhahaha/snip/releases) (Apple Silicon).

### Linux

Download from [Releases](https://github.com/rixinhahaha/snip/releases):
- **AppImage** (portable, any distro) — `Snip-x.y.z-x86_64.AppImage`
- **deb** (Ubuntu/Debian) — `Snip-x.y.z-amd64.deb`

## Quick Start (Development)

### macOS

```bash
npm install
npm run rebuild   # compile native modules
npm start         # launch (tray icon appears in menu bar)
```

Requires **macOS 14+**, **Node.js 18+**, and **Xcode CLT** (`xcode-select --install`). macOS 26+ recommended for native Liquid Glass effects.

### Linux

```bash
npm install --ignore-scripts
npm start
```

Requires **Node.js 18+** and a **Wayland** session (X11 is untested). For clipboard persistence, install `wl-copy` (`wl-clipboard` package). For portal-based screenshots, install `python3-gi` (PyGObject).

### Both platforms

For AI-powered organization, install [Ollama](https://ollama.com/download) separately. Snip detects your system Ollama and guides you through setup in Settings.

## How It Works

1. **Cmd+Shift+2** (macOS) / **Ctrl+Shift+2** (Linux) — Fullscreen overlay appears on whichever display the cursor is on, drag to select a region
2. **Annotate** — Rectangle, arrow, text, tag, blur brush, or AI segment tools
3. **Esc** — Copies annotated screenshot to clipboard
4. **Cmd+S** / **Ctrl+S** — Saves to disk + AI organizes in background

Screenshots saved to `~/Documents/snip/screenshots/`. AI renames, categorizes, and indexes them for search.

## Agent Integration (CLI & MCP)

Snip exposes a CLI and MCP server so AI agents can use it as their visual I/O:

```bash
# Render a Mermaid diagram and open for review
echo 'graph LR; A-->B-->C' | snip render --format mermaid --message "Does this flow look right?"

# Render HTML (components, email templates) and open for review
echo '<div style="padding:20px;font-family:sans-serif"><h1>Hello</h1><p>Preview</p></div>' | snip render --format html

# Open an image for agent review
snip open screenshot.png --message "Is the layout correct?"
```

The agent gets structured feedback: `{ status: "approved" | "changes_requested", edited, path, text? }`. The user can annotate spatially, type text feedback, or just approve.

MCP tools: `render_diagram`, `open_in_snip`, `search_screenshots`, `list_screenshots`, `get_screenshot`, `transcribe_screenshot`, `organize_screenshot`, `get_categories`, `install_extension`.

## Key Shortcuts

On Linux, replace Cmd with Ctrl.

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+2 | Capture screenshot |
| Cmd+Shift+1 | Quick Snip (select & copy to clipboard) |
| Cmd+Shift+S | Open semantic search |
| Cmd+S | Save to disk (in editor) |
| Esc / Enter | Copy to clipboard & close (in editor) |
| V / R / T / A / G / B / S | Select / Rectangle / Text / Arrow / Tag / Blur / Segment tools |
| U | Upscale image |
| W | Transcribe text (macOS only) |

## Documentation

| Doc | Role | Contents |
|-----|------|----------|
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | Product Manager | Vision, feature specs, terminology, product principles |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Designer | Color palettes (Dark/Light/Glass), component patterns, glass effects, icon specs |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Developer | Code structure, conventions, IPC channels, data flow, key decisions |
| [`docs/DEVOPS.md`](docs/DEVOPS.md) | DevOps | Build pipeline, signing, native modules, environment setup |
| [`docs/USER_FLOWS.md`](docs/USER_FLOWS.md) | QA / PM | Detailed user flows for every feature, edge cases, test cases |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code | Autonomous agent instructions, role references, documentation rules |

## Tech Stack

Electron 33 / Fabric.js 7 / Mermaid.js 11 / Ollama (local LLM) / HuggingFace Transformers.js / SlimSAM (ONNX) / Chokidar 4 / electron-liquid-glass

### On-Device Models

All AI runs locally — no cloud APIs needed for core features.

| Model | Purpose | By | Link |
|-------|---------|----|------|
| [MiniCPM-V](https://huggingface.co/openbmb/MiniCPM-V) | Vision LLM (naming, tagging, categorizing) | OpenBMB | [HF](https://huggingface.co/openbmb/MiniCPM-V) |
| [SlimSAM-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform) | Object segmentation | Meta AI / Xenova | [HF](https://huggingface.co/Xenova/slimsam-77-uniform) |
| [Swin2SR-lightweight-x2-64](https://huggingface.co/Xenova/swin2SR-lightweight-x2-64) | Image upscaling (2x) | Conde et al. / Xenova | [HF](https://huggingface.co/Xenova/swin2SR-lightweight-x2-64) |
| [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | Semantic search embeddings | Microsoft / Xenova | [HF](https://huggingface.co/Xenova/all-MiniLM-L6-v2) |
| Vision OCR | Text transcription | Apple | Built into macOS (macOS only) |

## License

MIT
