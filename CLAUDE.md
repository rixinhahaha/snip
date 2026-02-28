# CLAUDE.md — Autonomous Agent Instructions

This project is **fully autonomous**. Claude Code operates independently across all roles: product, design, development, DevOps. Read the relevant role docs before making changes.

---

## Role Documents

| Doc | When to Read |
|-----|-------------|
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | Before adding features, changing UX, or making product decisions. Contains vision, terminology, and product principles. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Before touching CSS, colors, or UI components. Contains the full color system (Dark/Light/Glass), component patterns, and glass effect specs. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Before writing code. Contains directory structure, code conventions, IPC channels, data flow, and key architectural constraints. |
| [`docs/DEVOPS.md`](docs/DEVOPS.md) | Before changing build scripts, native modules, or deployment config. Contains build pipeline, signing, and environment setup. |
| [`docs/USER_FLOWS.md`](docs/USER_FLOWS.md) | Before modifying user-facing behavior. Contains step-by-step flows with edge cases — use as acceptance criteria. |

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
| Theme system changes | `docs/DESIGN.md` + `docs/ARCHITECTURE.md` theme system section + `docs/USER_FLOWS.md` §8.3 |

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
- Three themes exist: `dark`, `light`, `glass`. Changes must work in all three + the solid fallback.

### Renderer Code Style
- **ES5 only** in renderer JS: use `var`, no arrow functions, no `import`/`export`.
- Main process uses standard CommonJS `require()`.

### Naming
- UI text says **"snip"** not "screenshot". The capture action is **"Snip It"**.

### Purple Brand
- Accent color is **purple/violet**. Never blue. See `docs/DESIGN.md` for exact values per theme.

### Liquid Glass
- The native `NSGlassEffectView` layer is always active on macOS 26+. Dark/Light themes cover it with opaque backgrounds. The Glass theme reveals it.
- `--glass-blur: 0px` in Glass theme because the native layer handles blur.

---

## Project Overview

**Snip** is a macOS Electron screenshot app. Menu-bar only (no Dock icon). Capture via global shortcut, annotate with Fabric.js tools, save with AI-powered organization via local Ollama LLM, find later via semantic search.

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
| Ollama manager | `src/main/ollama-manager.js` |
| Ollama binary (bundled) | `vendor/ollama/ollama` (dev) / `Resources/ollama/ollama` (packaged) |
| Ollama models (bundled) | `vendor/ollama/models/` (dev) / `Resources/ollama/models/` (packaged) |
| Ollama models (runtime) | `~/Library/Application Support/snip/ollama/models/` |
| Config | `~/Library/Application Support/snip/snip-config.json` |
| Screenshots | `~/Documents/snip/screenshots/` |
| Index | `~/Documents/snip/screenshots/.index.json` |

### Running the App
```bash
npm run dev    # Electron with verbose logging
npm start      # Normal launch
npm run build  # Package as macOS DMG
```
