<p align="center">
  <img src="assets/icon.png" alt="Snip" width="128" height="128"><br><br>
  <a href="https://www.producthunt.com/products/snip-ai-powered-macos-screenshot-tool?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-snip-ai-powered-macos-screenshot-tool-2" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1089620&theme=dark" alt="Snip on Product Hunt" height="40"></a>
  &nbsp;&nbsp;
  <a href="https://github.com/sponsors/rixinhahaha"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github&style=for-the-badge&logoSize=auto" alt="Sponsor" height="54"></a>
</p>

# Snip

**Visual mode for Claude Code.** Also works with Cursor, Windsurf, Cline, and any AI coding CLI.

Install Snip, run `snip setup`, and your AI coding agent starts rendering diagrams and previews instead of describing them in text. Architecture? Sequence diagram. Data model? ER diagram. UI component? Rendered preview. All visual, all automatic.

You review what Claude renders — approve it, or annotate directly on screen. Circle what's wrong, add an arrow, write a note. Claude sees your annotations and iterates.

<p align="center">
  <img src="assets/demo.gif" alt="Snip demo — agent renders a diagram, user reviews and approves" width="720">
</p>

## How It Works

Snip runs as a menu bar / system tray app with a CLI that any AI coding agent can call directly:

```bash
# Claude writes a Mermaid diagram to a file, then renders it for your review
snip render --format mermaid < architecture.mmd

# Claude renders an HTML component preview
snip render --format html < preview.html

# Open any image for annotated review
snip open screenshot.png --message "Is the layout correct?"

# Search your screenshot library
snip search "login page error"
```

The agent gets structured JSON back: `{ status: "approved" | "changes_requested", edited, path, text }`. You can annotate spatially, type text feedback, or just approve.

Built for **Claude Code**. Also works with Cursor, Windsurf, Cline, and anything that can run a shell command. Ships an [MCP server](#mcp-server) for agents without shell access.

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

## Use with Claude Code

```bash
snip setup
```

That's it. `snip setup` configures Claude Code to use visual output automatically — rules, the `/diagram` skill, and permissions. Next time you ask Claude about architecture, data models, or flows, it renders a diagram instead of describing it in text.

Try `/diagram` in any Claude Code conversation to visualize what you're discussing.

## CLI Reference

| Command | What it does |
|---------|-------------|
| `snip setup` | Enable visual mode for Claude Code (and Cursor, Windsurf, Cline) |
| `snip render --format mermaid` | Render Mermaid diagram from stdin, open for review |
| `snip render --format html` | Render HTML from stdin, open for review |
| `snip open <path>` | Open any image for annotated review |
| `snip search <query>` | Search screenshot library by description |
| `snip transcribe <path>` | Extract text from an image via OCR |
| `snip list` | List all saved screenshots with metadata |
| `snip get <path>` | Get metadata for a specific screenshot |
| `snip organize <path>` | Queue screenshot for AI categorization |
| `snip categories` | List all categories |

All review commands (`render`, `open`) block until the user finishes and return structured JSON.

## MCP Server

For agents without shell access (Claude Desktop, hosted environments), Snip also ships an MCP server:

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

The MCP server exposes the same capabilities: `render_diagram`, `open_in_snip`, `search_screenshots`, `list_screenshots`, `get_screenshot`, `transcribe_screenshot`, `organize_screenshot`, `get_categories`, `install_extension`.

## Also a Screenshot Tool

Snip is a full screenshot + annotation app on its own:

- **Cmd+Shift+2** (macOS) / **Ctrl+Shift+2** (Linux) — Capture with region select or window snap
- **Cmd+Shift+1** / **Ctrl+Shift+1** — Quick Snip (capture straight to clipboard)
- **Annotate** — Rectangle, arrow, text, tag, blur brush, AI segment
- **Esc** — Copy to clipboard and close
- **Cmd+S** — Save to disk + AI organizes in background

AI organization uses a local vision LLM (via [Ollama](https://ollama.com/download)) to name, categorize, and tag every saved screenshot. Semantic search finds any screenshot by describing what was in it.

## Key Shortcuts

On Linux, replace Cmd with Ctrl.

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+2 | Capture screenshot |
| Cmd+Shift+1 | Quick Snip (select & copy to clipboard) |
| Cmd+Shift+S | Open semantic search |
| Cmd+S | Save to disk (in editor) |
| Esc / Enter | Copy to clipboard & close (in editor) |
| V / C / R / T / A / G / B / S | Select / Crop / Rectangle / Text / Arrow / Tag / Blur / Segment tools |
| Cmd+Z | Undo (annotations first, then crop, then segment cutout) |

## Development

```bash
npm install
npm run rebuild   # compile native modules (macOS)
npm start         # launch (tray icon appears)
```

Requires **macOS 14+** or **Linux (Wayland)**, **Node.js 18+**.

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | Vision, feature specs, terminology |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Color palettes, component patterns, glass effects |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Code structure, IPC channels, data flow |
| [`docs/DEVOPS.md`](docs/DEVOPS.md) | Build pipeline, signing, native modules |
| [`docs/USER_FLOWS.md`](docs/USER_FLOWS.md) | Step-by-step flows, edge cases, test cases |

## Tech Stack

Electron 33 / Fabric.js 7 / Mermaid.js 11 / Ollama (local LLM) / HuggingFace Transformers.js / SlimSAM (ONNX)

All AI runs locally — no cloud APIs needed for core features.

## License

MIT
