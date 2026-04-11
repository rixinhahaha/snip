# CLAUDE.md — Autonomous Agent Instructions

This project is **fully autonomous**. Claude Code operates independently across all roles: product, design, development, DevOps. Read the relevant role docs before making changes.

---

## Role Documents

| Doc | When to Read |
|-----|-------------|
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | Before adding features, changing UX, or making product decisions. Contains vision, terminology, and product principles. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Before touching CSS, colors, or UI components. Contains the full color system (Dark/Light), component patterns, and glass effect specs. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Before writing code. Contains directory structure, code conventions, IPC channels, data flow, and key architectural constraints. |
| [`docs/DEVOPS.md`](docs/DEVOPS.md) | Before changing build scripts, native modules, or deployment config. Contains build pipeline, signing, and environment setup. |
| [`docs/USER_FLOWS.md`](docs/USER_FLOWS.md) | Before modifying user-facing behavior. Contains step-by-step flows with edge cases — use as acceptance criteria. |
| [`docs/MARKETER.md`](docs/MARKETER.md) | Before editing `site/`, adding media assets, or producing social/marketing content. Contains SEO rules, asset optimization standards, canonical URL rules, and the marketing content library. |

**Read the relevant role doc(s) before starting work.** Don't guess at conventions — they're documented.

---

## Documentation Rules

**MANDATORY**: After **any** code change, you MUST update every affected doc before considering the task complete. This is not optional — stale docs break future sessions.

| What Changed | Docs to Update |
|--------------|----------------|
| CSS / colors / theme variables | `docs/DESIGN.md` color tables + `docs/ARCHITECTURE.md` if new variables added |
| User-facing behavior or UX | `docs/USER_FLOWS.md` flow steps + `docs/PRODUCT.md` if feature scope changed |
| New feature | `docs/PRODUCT.md` feature list + `docs/USER_FLOWS.md` new flow + `docs/ARCHITECTURE.md` if new files/IPC + `README.md` if major |
| Removed feature | Remove from `docs/PRODUCT.md` + `docs/USER_FLOWS.md` + `README.md` |
| Architecture / new files / IPC | `docs/ARCHITECTURE.md` directory tree + IPC table + data flow |
| Build / scripts / native modules | `docs/DEVOPS.md` scripts table + build pipeline |
| Code conventions changed | `docs/ARCHITECTURE.md` conventions section |
| New tool or annotation type | `docs/PRODUCT.md` tool table + `docs/USER_FLOWS.md` new tool flow + `docs/ARCHITECTURE.md` directory tree + `README.md` shortcut table |
| Theme system changes | `docs/DESIGN.md` + `docs/ARCHITECTURE.md` theme system section + `docs/USER_FLOWS.md` §8.4 |
| Marketing site / SEO / media assets | `docs/MARKETER.md` + update `sitemap.xml` lastmod + verify canonical URLs |

### How to Update

1. After finishing code changes, review the table above
2. Open each affected doc and update the specific sections — don't rewrite entire files
3. Keep tables, values, and file paths in sync with the actual code
4. If you added a new file, it must appear in `docs/ARCHITECTURE.md` directory tree
5. If you changed a CSS variable value, the corresponding `docs/DESIGN.md` color table must match

**These docs are the project's memory.** They're how context survives across sessions. Skipping updates means the next session starts with wrong information.

---

## Critical Constraints

These are non-negotiable rules. Violating them causes crashes or broken UX:

### Threading
- **ONNX Runtime crashes in worker_threads.** Embeddings must run on the main thread. SAM runs in a child process (not worker).
- The Ollama worker delegates embedding generation back to main via message passing.

### CSS
- **Never hardcode colors.** All colors come from CSS variables in `src/renderer/theme.css`.
- Two themes exist: `dark`, `light`. Changes must work in both + the solid fallback.
- **All new UI must align with the glass design language** documented in `docs/DESIGN.md`. Before writing CSS, read the design doc for the correct variables, component patterns, and glass effect specs. Reuse existing patterns (e.g. tutorial-modal, toast pill, toolbar button states) rather than inventing new ones.

### Undo Flow
- **Every new tool must consider the undo flow.** The editor has a layered undo system: annotations undo first (object stack), then crop (crop undo stack), then segment cutout, then upscale. New tools that modify the background image or canvas dimensions must implement their own undo method (like `undoCrop()` or `undoCutout()`), save pre-operation state, and integrate into the undo priority chain in both `onUndo` callback and the Cmd+Z keydown handler in `editor-app.js`. Tools that only add Fabric objects get undo for free via the annotation stack.

### Renderer Code Style
- **No ES modules** in renderer JS: prefer `var`, no `import`/`export`. All tools attach to `window` via IIFEs.
- Main process uses standard CommonJS `require()`.

### Naming
- UI text says **"snip"** not "screenshot". The capture action is **"Snip and Annotate"**.

### Purple Brand
- Accent color is **purple/violet**. Never blue. See `docs/DESIGN.md` for exact values per theme.

### Marketing Site (`site/`)
- **Maximize SEO on every change.** When editing `site/index.html`, always update structured data (`ld+json`), meta description, Open Graph tags, and `featureList` to reflect new or changed features.
- Optimize all media assets for web (compress images to JPG, convert video to MP4 with `crf 28`, remove originals after conversion).
- Use semantic HTML (`section`, `h2`/`h3`, `alt` text on images, `aria-label` on interactive elements).

### Releases
- **Before creating a new release tag**, always bump the version in **both** `package.json` and `package-lock.json` (run `npm install --package-lock-only` to sync the lock file). Commit the version bump before tagging.
- The marketing site's download link is **dynamic** — `site/script.js` fetches the latest release from GitHub's API at runtime. No manual version update is needed; it automatically points to the newest DMG once the release workflow completes.

---

## Project Overview

**Snip** is a cross-platform Electron app (macOS and Linux) — the visual communication layer between humans and AI agents. Menu-bar / system tray only (no Dock icon on macOS). Capture via global shortcut, annotate with Fabric.js tools, render diagrams via Mermaid, review agent-generated visuals with approve/request-changes flow. AI-powered organization via local Ollama LLM, semantic search. Linux support targets Wayland sessions (X11 is untested).

### Key Paths
| What | Where |
|------|-------|
| Main process entry | `src/main/main.js` |
| Theme tokens | `src/renderer/theme.css` |
| Home window | `src/renderer/home.html` + `home.js` + `home.css` |
| Editor window | `src/renderer/editor.html` + `editor-app.js` + `editor-styles.css` |
| Annotation tools | `src/renderer/tools/*.js` |
| Preload (IPC bridge) | `src/preload/preload.js` |
| AI agent | `src/main/organizer/agent.js` + `worker.js` |
| Extension registry | `src/main/extension-registry.js` |
| Extensions (bundled) | `src/extensions/` + `extensions.json` |
| Extensions (user) | `~/Library/Application Support/snip/extensions/` |
| CLI | `src/cli/snip.js` |
| MCP adapter | `src/mcp/server.js` (wraps CLI, direct socket for `render_diagram`) |
| Diagram renderer | `src/renderer/diagram.html` + `diagram-renderer.js` + `src/preload/diagram-preload.js` |
| Extension sandbox | `src/main/extension-sandbox.js` + `extension-sandbox-worker.js` |
| Ollama manager | `src/main/ollama-manager.js` |
| Ollama (system) | `/Applications/Ollama.app` or `/usr/local/bin/ollama` (user-installed) |
| Ollama models | `~/.ollama/models/` (managed by system Ollama) |
| Config | `~/Library/Application Support/snip/snip-config.json` |
| Screenshots | `~/Documents/snip/screenshots/` |
| Index | `~/Documents/snip/screenshots/.index.json` |

### Running the App
```bash
npm run dev    # Electron with verbose logging
npm start      # Normal launch
npm run build        # Package as macOS DMG
npm run build:linux  # Package as Linux AppImage + deb
```
