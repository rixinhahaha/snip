# CLAUDE.md

## Documentation requirements

After making any code changes, always update the following documentation files to reflect the changes:

- **`README.md`** — Keep the project overview, setup instructions, architecture, and feature list current. Add new features, update changed behavior, and remove references to removed functionality.
- **`USER_FLOWS.md`** — Keep all user flows accurate and complete. When adding a new feature, add a corresponding user flow section. When modifying existing behavior, update the relevant flow steps. When removing a feature, remove its flow.
- **`DESIGN.md`** — Keep the design language and color palette in sync with `src/renderer/theme.css`. When changing accent colors, backgrounds, or component patterns, update the corresponding tables.

## Project overview

Snip is a macOS Electron screenshot app with annotation, AI-powered organization, and semantic search.

## Key architecture decisions

- ONNX Runtime (used by HuggingFace Transformers.js for embeddings) must only run on the main Electron thread. It crashes in worker threads.
- The worker thread handles Claude API calls for screenshot categorization. Embedding generation is delegated back to the main thread via message passing.
- `app.dock.hide()` is used in dev mode to prevent macOS Space switching when capturing screenshots.
- All metadata lives in a single `.index.json` file in the screenshots directory.
- API keys are encrypted via Electron's `safeStorage` and passed to worker threads as decrypted strings (since `safeStorage` is unavailable in workers).

## Design language

See [`DESIGN.md`](./DESIGN.md) for the full color palette, component patterns, and icon specifications. Key principles:

- **Purple accent** — `#8B5CF6` (dark), `#7C3AED` (light). Never use blue for accents.
- **Cream backgrounds in light mode** — warm off-whites (`rgba(252, 250, 245, ...)`) instead of pure white/grey.
- **Liquid Glass aesthetic** — translucent surfaces, backdrop-filter blur, specular highlights.
- All colors come from CSS variables in `src/renderer/theme.css`. Never hardcode color values in component CSS.

## Code conventions

- Renderer JS uses `var` and ES5-style code (no ES modules, no arrow functions) for broad compatibility.
- Main process code uses CommonJS `require()`.
- UI text refers to screenshots as "snips" (not "screenshots").
- The capture action is called "Snip It" in menus and shortcuts.
