# Adding a New Extension

## Quick Start

1. Create a folder: `src/extensions/my-tool/`
2. Add `extension.json` (manifest)
3. Add `main.js` (backend IPC handlers, optional)
4. Add `renderer.js` (frontend tool logic, optional)
5. Add `"my-tool"` to `src/extensions/extensions.json`
6. Restart the app

That's it. No other files need to change.

---

## Manifest (`extension.json`)

Every extension needs this file. It declares what the extension is and how it integrates.

```json
{
  "name": "my-tool",
  "displayName": "My Tool",
  "type": "canvas-tool",
  "toolId": "my-tool",
  "icon": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\">...</svg>",
  "tooltip": "My Tool (M)",
  "shortcut": "m",
  "toolbarPosition": 10,
  "toolbarGroups": [],
  "renderer": "renderer.js",
  "main": "main.js",
  "ipc": [
    { "channel": "ext:my-tool:do-something", "method": "doSomething" }
  ]
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique identifier. Must match the folder name. |
| `displayName` | string | Human-readable name shown in UI. |
| `type` | string | One of: `canvas-tool`, `ai-tool`, `action-tool`, `processor` |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `toolId` | string | ID for the toolbar button (e.g., `my-tool` creates `tool-my-tool`). Omit for processors. |
| `buttonId` | string | Override the button DOM ID (e.g., `btn-my-tool`). Defaults to `tool-{toolId}`. |
| `icon` | string | SVG markup for the toolbar button. Must start with `<svg`. No `<script>` or event handlers. |
| `tooltip` | string | Hover text for the toolbar button. |
| `shortcut` | string | Single-key shortcut (e.g., `m`). Must not conflict with existing shortcuts. |
| `toolbarPosition` | number | Sort order in toolbar. Existing tools use 1-9. Use 10+ for new tools. |
| `hidden` | boolean | Start with button hidden. Useful when the tool needs a capability check first. |
| `toolbarGroups` | string[] | Contextual control groups to show when this tool is active (e.g., `["stroke-group"]`). Use `[]` if the tool manages its own controls. |
| `renderer` | string | Path to renderer script, relative to this folder. For self-contained extensions, use `"renderer.js"`. |
| `main` | string | Path to backend module, relative to this folder. Must be a filename only (no `..` or `/`). |
| `ipc` | array | IPC channel registrations. Each entry: `{ "channel": "...", "method": "..." }`. |

### Extension Types

| Type | Toolbar button | Tool mode switch | Use case |
|------|---------------|-----------------|----------|
| `canvas-tool` | Yes | Yes (activates on click) | Drawing tools (rectangle, arrow, text) |
| `ai-tool` | Yes | Yes | AI-powered tools (segment) |
| `action-tool` | Yes | No (click triggers action) | One-shot actions (upscale, transcribe) |
| `processor` | No | No | Background processing (organizer) |

---

## Backend Module (`main.js`)

Optional. Only needed if your extension has IPC handlers (communicates between renderer and main process).

```js
let ctx = null;

function init(context) {
  ctx = context;
  // context.getEditorData() — returns the current editor image data
}

async function doSomething(event, params) {
  // Your handler logic here
  return { result: 'done' };
}

module.exports = { init, doSomething };
```

### IPC Channel Naming

New extensions **must** prefix their IPC channels with `ext:`:

```json
{ "channel": "ext:my-tool:do-something", "method": "doSomething" }
```

This ensures channels don't collide with core handlers.

### Lifecycle Hooks

Your `main.js` can export these optional functions:

| Export | Called when | Use case |
|--------|-----------|----------|
| `init(context)` | Extension loaded at startup | Store context reference |
| `warmUp()` | App startup, after all extensions loaded | Pre-load models, warm caches |
| `killWorker()` | App quitting | Clean up child processes |

---

## Renderer Script (`renderer.js`)

Optional. Only needed if your extension has UI in the editor.

Renderer scripts must be IIFEs that attach to `window`:

```js
var MyTool = (function () {
  function attach(canvas) {
    // Called when the tool is activated in the editor
    return {
      activate: function () { /* tool selected */ },
      deactivate: function () { /* tool deselected */ }
    };
  }

  return { attach: attach };
})();
```

### Calling Backend from Renderer

Use the generic IPC bridge — no need to edit `preload.js`:

```js
// Invoke a backend handler
window.snip.invokeExtension('ext:my-tool:do-something', { data: 'hello' })
  .then(function (result) { console.log(result); });

// Listen for events from backend
window.snip.onExtensionEvent('ext:my-tool:progress', function (data) {
  console.log('Progress:', data);
});
```

The `ext:` prefix is enforced — channels without it are rejected.

---

## Registry (`extensions.json`)

The top-level `src/extensions/extensions.json` lists which extensions are active:

```json
[
  "select",
  "rectangle",
  "my-tool"
]
```

Only folders listed here are loaded. This lets you have WIP extensions in the folder without them being loaded.

---

## Examples

### Minimal: toolbar-only tool (no backend)

```
src/extensions/highlighter/
  extension.json
  renderer.js
```

`extension.json`:
```json
{
  "name": "highlighter",
  "displayName": "Highlighter",
  "type": "canvas-tool",
  "toolId": "highlighter",
  "icon": "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 2L2 22h20z\"/></svg>",
  "tooltip": "Highlighter (H)",
  "shortcut": "h",
  "toolbarPosition": 10,
  "toolbarGroups": ["stroke-group"],
  "renderer": "renderer.js"
}
```

### Backend-only processor (no toolbar)

```
src/extensions/auto-tagger/
  extension.json
  main.js
```

`extension.json`:
```json
{
  "name": "auto-tagger",
  "displayName": "Auto Tagger",
  "type": "processor",
  "main": "main.js",
  "ipc": [
    { "channel": "ext:auto-tagger:tag-image", "method": "tagImage" }
  ]
}
```

### Full extension with backend + renderer

```
src/extensions/color-picker/
  extension.json
  main.js
  renderer.js
```

---

## Constraints

- **No ES modules** in renderer scripts. Use `var`, IIFEs, attach to `window`.
- **No `..` in `main` field**. The backend module path must be a basename (e.g., `main.js`).
- **SVG icons only**. The `icon` field must start with `<svg`. Script tags and event handlers are stripped.
- **`ext:` prefix required** for new IPC channels. The generic bridge rejects channels without it.
- **Colors via CSS variables**. Never hardcode hex values. Use `var(--accent)`, `var(--text-primary)`, etc. from `theme.css`.

---

## User-Installed Extensions

Extensions installed via MCP `install_extension` or the "Install from Folder" button in Settings run in a **sandboxed child process**, not in the main Electron process.

### Restrictions

- **Allowed types:** `action-tool` and `processor` only. `canvas-tool` and `ai-tool` are not supported.
- **No renderer scripts.** User extensions cannot inject scripts into the editor.
- **All IPC channels must use the `ext:` prefix.**

### Blocked Modules

The following Node.js modules are blocked inside the sandbox:

`fs`, `child_process`, `net`, `http`, `https`, `http2`, `tls`, `dns`, `dgram`, `cluster`, `worker_threads`, `vm`, `v8`, `perf_hooks`, `electron`, `os`, `module`

The blocklist is frozen via `Object.defineProperty` — extensions cannot override it.

Safe modules like `path`, `crypto`, `buffer`, `url`, `querystring` are available.

### Permissions

To access files or the network, declare permissions in your manifest:

```json
{
  "permissions": ["screenshots:read", "temp:write"]
}
```

| Permission | API | Description |
|-----------|-----|-------------|
| `screenshots:read` | `context.api.readScreenshot(filepath)` | Read a screenshot file (path must be inside the screenshots directory) |
| `temp:write` | `context.api.writeTemp(filename, data)` | Write to a per-extension temp directory (cleaned on restart) |

Permissions are shown to the user in the approval dialog before installation.

### Sandbox Guarantees

- Extensions **cannot** read or write arbitrary files
- Extensions **cannot** spawn processes or make network requests
- Extensions **cannot** access Electron APIs or modify app state
- Extensions **cannot** override the module blocklist (it's frozen via `Object.defineProperty`)
- Each IPC call has a **30-second timeout** — extensions that hang are killed and restarted
- The approval dialog **requires explicit user consent** before any extension is installed
