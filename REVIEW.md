# Full Codebase Review Report

**Date:** 2026-03-06
**Agents run:** DRY + Modularity, Security Audit, Scope/Dead Code, Performance
**Files reviewed:** 37 source files across `src/` and `site/`
**Verdict:** NEEDS CHANGES

---

## Critical / High (must fix)

### Security

**#1 HIGH -- Unrestricted `shell.openExternal()`**
- **File:** `src/main/ipc-handlers.js:388-390`
- **Issue:** Renderer can open any URL/protocol with no validation. Could be abused to launch arbitrary apps via custom URL schemes.
- **Fix:** Allowlist `https://` and `http://` schemes only.

**#2 MEDIUM -- Arbitrary file access via IPC**
- **File:** `src/main/ipc-handlers.js:366-380,383`
- **Issue:** `get-thumbnail` and `reveal-in-finder` IPC handlers accept arbitrary file paths with no path validation. Renderer can request thumbnails or reveal any file on disk.
- **Fix:** Validate paths are within the screenshots directory.

**#3 MEDIUM -- XSS via innerHTML (OCR languages)**
- **File:** `src/renderer/tools/transcribe.js:99-101`
- **Issue:** OCR language strings inserted via `innerHTML` without sanitization.
- **Fix:** Use `textContent` or sanitize input.

**#4 MEDIUM -- XSS via innerHTML (animation presets)**
- **File:** `src/renderer/tools/animate.js:264-265`
- **Issue:** LLM-generated animation preset labels inserted via `innerHTML` without sanitization.
- **Fix:** Use `textContent` or sanitize input.

**#5 MEDIUM -- API key in plaintext**
- **File:** `src/main/store.js:301-308`
- **Issue:** fal.ai API key stored in plaintext JSON config file.
- **Fix:** Use macOS Keychain via Electron's `safeStorage`.

**#6 MEDIUM -- Sandbox disabled**
- **File:** `src/main/constants.js:9`
- **Issue:** `sandbox: false` weakens Electron defense-in-depth.
- **Fix:** Enable sandbox unless specific APIs require it.

### Functional Bug

**#7 HIGH -- Tray accelerator labels swapped**
- **File:** `src/main/tray.js:67-68`
- **Issue:** `captureAccel` is assigned to Quick Snip and `quickSnipAccel` is assigned to Snip and Annotate. Wrong keyboard shortcuts display in the tray menu.
- **Fix:** Swap the two accelerator assignments.

### Dead Code

**#8 HIGH -- Dead IPC channels**
- **File:** `src/main/ipc-handlers.js:309-321`, `src/preload/preload.js:97-98`
- **Issue:** `close-setup-overlay` and `open-setup-overlay` are fully wired up (preload + IPC handler) but never called from any renderer. The `hide-setup-overlay` message they broadcast also lacks a preload listener.
- **Fix:** Remove the dead channels.

### Performance

**#9 HIGH -- Index file fully read/written on every mutation**
- **File:** `src/main/store.js:221-245`
- **Issue:** `addToIndex()` reads the entire `.index.json` from disk, mutates, and writes it back. With hundreds of entries each carrying 384-dimension embedding arrays, this file can reach 5-10 MB. Every screenshot save, embedding update, and delete triggers this full R/W cycle.
- **Fix:** Cache index in memory, debounce writes to disk.

**#10 HIGH -- Triple readIndex() in delete operations**
- **File:** `src/main/ipc-handlers.js:451-454` (delete-screenshot), `src/main/ipc-handlers.js:473-476` (delete-folder)
- **Issue:** A single delete operation calls `readIndex()` for `before` count, then `removeFromIndex()` internally reads+writes again, then `readIndex()` again for `after` count -- 3 reads and 1 write for one delete.
- **Fix:** Use the return value of `removeFromIndex()` instead of re-reading.

**#11 HIGH -- Synchronous file write blocks main thread**
- **File:** `src/main/ipc-handlers.js:157`
- **Issue:** `fs.writeFileSync()` writes screenshot buffers (potentially several MB) to disk, blocking the main Electron thread.
- **Fix:** Use `fs.promises.writeFile()`.

**#12 HIGH -- Synchronous directory listing blocks main thread**
- **File:** `src/main/ipc-handlers.js:416-433`
- **Issue:** `fs.readdirSync()` followed by `fs.statSync()` for every entry blocks the main thread.
- **Fix:** Use async `fs.promises` equivalents.

**#13 HIGH -- Animation buffers duplicated over IPC**
- **File:** `src/main/ipc-handlers.js:614`
- **Issue:** `Array.from(result.gifBuffer)` converts Buffers to plain JS number arrays -- a 500 KB GIF becomes ~2-3 MB of JSON. The same data is also sent as base64 data URLs in the same response, meaning animation data crosses IPC twice in different formats.
- **Fix:** Send only the base64 data URLs; remove redundant array fields.

**#14 HIGH -- O(n^2) boundary detection in segmentation**
- **File:** `src/main/segmentation/segmentation-worker.js:79-92,129-157`
- **Issue:** For every `true` pixel in the mask, `isNearEdge()` checks a 5x5 neighborhood. For a 1024x1024 mask with 30% coverage, this is ~7.5M operations.
- **Fix:** Use a two-pass dilation/erosion approach (O(n) with constant factor).

**#15 HIGH -- CRC32 table rebuilt on every PNG encode**
- **File:** `src/main/segmentation/segmentation-worker.js:21-26`, `src/main/upscaler/upscaler-worker.js:57-62`
- **Issue:** The 256-entry CRC32 lookup table is computed from scratch on every `encodeRGBAtoPNG()` call.
- **Fix:** Compute once at module scope.

### DRY / Duplication

**#16 HIGH -- `encodeRGBAtoPNG` copy-pasted verbatim**
- **File:** `src/main/segmentation/segmentation-worker.js:11-48`, `src/main/upscaler/upscaler-worker.js:47-84`
- **Issue:** 38 identical lines including CRC32 table and PNG assembly duplicated between two worker files.
- **Fix:** Extract to `src/main/utils/png-encoder.js`.

**#17 HIGH -- `configureEnv()` duplicated**
- **File:** `src/main/segmentation/segmentation-worker.js:54-66`, `src/main/upscaler/upscaler-worker.js:18-30`
- **Issue:** Transformers.js environment configuration duplicated while `model-paths.js` already has a similar function.
- **Fix:** Consolidate into `model-paths.js` with child-process support.

**#18 HIGH -- Child-process worker spawning boilerplate duplicated**
- **File:** `src/main/segmentation/segmentation.js:16-84`, `src/main/upscaler/upscaler.js:15-88`
- **Issue:** Identical `getWorker()` functions (~40 lines) handling asar path fixup, env setup, fork options, pending request Map, exit/error handling, and `killWorker()`.
- **Fix:** Extract a `ChildProcessPool` utility.

**#19 HIGH -- Tag creation code largely duplicated**
- **File:** `src/renderer/tools/tag.js:286-348`, `src/renderer/tools/segment.js:207-263`
- **Issue:** SegmentTool re-declares TagTool's constants (lines 6-10) and recreates identical tip/line/bubble/textbox objects plus the ~120-line editing lifecycle.
- **Fix:** Extract a shared tag factory into `tool-utils.js`.

**#20 HIGH -- Broadcast-to-all-windows pattern repeated**
- **File:** `src/main/ollama-manager.js`, `src/main/ipc-handlers.js` (5 inline loops), `src/main/tray.js`, `src/main/organizer/watcher.js`
- **Issue:** The same `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(...))` pattern appears 7+ times. `ollama-manager.js` already has a `broadcastToWindows` helper.
- **Fix:** Move the existing helper to a shared utility module and reuse everywhere.

**#21 HIGH -- Index entry creation duplicated**
- **File:** `src/main/organizer/watcher.js:15-27`, `src/main/organizer/worker.js:49-61`, `src/main/organizer/agent.js:155-165`
- **Issue:** Same index entry object shape `{ filename, path, category, name, description, tags, embedding, createdAt }` constructed 3 times.
- **Fix:** Create a factory function in `store.js`.

---

## Medium (should fix)

### Performance

**#22 -- rebuildIndex() after every worker queue item**
- **File:** `src/main/organizer/worker.js:37`
- **Issue:** Full index read+filter+write after each screenshot processed, even though `addToIndex()` just wrote the file. 10 queued screenshots = 10 extra rebuild cycles.
- **Fix:** Defer rebuild to idle time or only remove the single stale entry.

**#23 -- GIF thumbnails read entire file synchronously**
- **File:** `src/main/ipc-handlers.js:369-372`
- **Issue:** GIF files (potentially several MB) are read with `fs.readFileSync()` and base64-encoded on the main thread.
- **Fix:** Use async read; consider generating a static first-frame thumbnail.

**#24 -- Sequential embedding generation**
- **File:** `src/main/ipc-handlers.js:495-504`
- **Issue:** Embeddings generated one at a time in a `for` loop with `await` in `refresh-index`.
- **Fix:** Process in small parallel batches (3-5 at a time).

**#25 -- Full-resolution screenshots sent to Ollama**
- **File:** `src/main/organizer/agent.js:52-53`
- **Issue:** Screenshots are base64-encoded at full resolution for LLM categorization. High-DPI images can be 5-10 MB as base64. The animation module already has `downscaleForVision()` capping at 384px.
- **Fix:** Downscale to ~512-768px before sending to Ollama.

**#26 -- Synchronous config writes on every setting change**
- **File:** `src/main/store.js:67-71`
- **Issue:** `saveConfig()` uses `fs.writeFileSync()` and is called on every individual setting mutation.
- **Fix:** Debounce writes or use async I/O.

**#27 -- getAccentColor() forces style recalculation on every mouse move**
- **File:** `src/renderer/tools/tool-utils.js:123-125`, `src/renderer/tools/selection.js:5-6,78`
- **Issue:** `getComputedStyle()` is called inside the selection `draw()` function, which fires on every mouse move during selection.
- **Fix:** Cache the accent color; invalidate only on theme change.

**#28 -- Thumbnails loaded eagerly**
- **File:** `src/renderer/home.js:166-167` (folder grid), `src/renderer/home.js:1035-1037` (search results)
- **Issue:** All thumbnails trigger IPC calls simultaneously. 50+ images = 50+ concurrent thumbnail IPC calls.
- **Fix:** Use `IntersectionObserver` for lazy loading.

### Dead Code

**#29 -- Dead `probeArgs` variable**
- **File:** `src/main/animation/gif-encoder-worker.js:50-57`
- **Issue:** Defined but never used, leftover from earlier ffprobe approach.
- **Verdict:** Remove.

**#30 -- Leaked `tmpDir` creation**
- **File:** `src/main/animation/gif-encoder-worker.js:35-36`
- **Issue:** Creates empty temp directory on every GIF encode, never uses or cleans it.
- **Verdict:** Remove.

**#31 -- Unused `screenshotsDir`**
- **File:** `src/renderer/home.js:15,50`
- **Issue:** Assigned from IPC but never read.
- **Verdict:** Remove.

**#32 -- Unused `upscaleCleanup`**
- **File:** `src/renderer/editor-app.js:104,170`
- **Issue:** Stores cleanup function but never calls it -- potential resource leak.
- **Verdict:** Call on cleanup or remove.

**#33 -- Dead `canvasW`/`canvasH` reassignment**
- **File:** `src/renderer/editor-app.js:308-309`
- **Issue:** Values written but never read after.
- **Verdict:** Remove.

### DRY / Duplication

**#34 -- Theme init boilerplate duplicated**
- **File:** `src/renderer/home.js:4-11`, `src/renderer/editor-app.js:12-18`
- **Issue:** Identical 6-line theme initialization code.
- **Fix:** Extract to a shared `initTheme()` utility.

**#35 -- Shortcut registration repeated**
- **File:** `src/main/shortcuts.js:15-83`
- **Issue:** Same 20-line try/catch/fallback block repeated 3 times.
- **Fix:** Extract `registerOneShortcut()` helper.

**#36 -- Undo cascade logic duplicated**
- **File:** `src/renderer/editor-app.js:826-836,1145-1156`
- **Issue:** Identical undo logic between toolbar `onUndo` callback and `Cmd+Z` handler.
- **Fix:** Extract `performUndo()` function.

**#37 -- `showSearchPage` reimplements existing utility**
- **File:** `src/main/main.js:342-354`
- **Issue:** Reimplements `sendToHomeWindow` inline instead of calling the existing function.
- **Fix:** Call `sendToHomeWindow('navigate-to-search')`.

**#38 -- Delete handlers share 90% logic**
- **File:** `src/main/ipc-handlers.js:442-482`
- **Issue:** `delete-screenshot` and `delete-folder` IPC handlers are nearly identical.
- **Fix:** Extract common path-validation + trash + index-update helper.

**#39 -- saveGIF and saveAPNG near-identical**
- **File:** `src/renderer/tools/animate.js:351-384`
- **Issue:** Two functions differ only in format name and buffer field.
- **Fix:** Extract `saveFormat(bufferField, format, label)`.

**#40 -- Category creation functions overlap**
- **File:** `src/main/store.js:139-214`
- **Issue:** `addCustomCategory` and `addCustomCategoryWithDescription` share most logic.
- **Fix:** Have the former delegate to the latter.

---

## Low (consider)

### Security

**#41 -- Path traversal in save operations**
- **File:** `src/main/ipc-handlers.js`
- **Issue:** Timestamp in `save-screenshot`/`save-animation` filename not validated. Low risk since timestamp is generated server-side.

**#42 -- No URL scheme validation on Ollama config**
- **File:** `src/main/ipc-handlers.js`
- **Issue:** User-configured Ollama URL accepted without scheme validation.

**#43 -- IPC listener leak**
- **File:** `src/preload/preload.js`
- **Issue:** Some IPC listeners don't return cleanup functions. Minor in practice since each renderer has its own process.

**#44 -- Ollama download security**
- **File:** `src/main/ollama-manager.js`
- **Issue:** HTTP redirect following without scheme validation; no integrity check on downloaded Ollama archive.

### Performance

**#45 -- Ollama status polling without backoff**
- **File:** `src/renderer/home.js:427`
- **Issue:** Polls every 1s indefinitely. Could use exponential backoff when status is stable.

**#46 -- Sparkle animation runs indefinitely**
- **File:** `site/script.js:220-257`
- **Issue:** `requestAnimationFrame` loop never pauses when hero section is scrolled out of view.
- **Fix:** Use `IntersectionObserver` to pause when not visible.

### Dead Code

**#47 -- Unused `lastScroll` variable**
- **File:** `site/script.js:16,25`
- **Issue:** Assigned but never read.
- **Verdict:** Remove.

### DRY / Structural

**#48 -- Asar path fixup repeated**
- **File:** Multiple files
- **Issue:** `app.asar` -> `app.asar.unpacked` pattern repeated 4 times.

**#49 -- `getAccentColor` reimplemented**
- **File:** `src/renderer/tools/selection.js:4-6`
- **Issue:** Reimplemented when `ToolUtils` already provides it.

**#50 -- Timestamp formatting duplicated**
- **File:** Multiple files
- **Issue:** Timestamp formatting for filenames duplicated 3 times.

**#51 -- `ipc-handlers.js` is a 730-line monolith**
- **File:** `src/main/ipc-handlers.js`
- **Issue:** Handles 35+ IPC channels across 6+ domains. Consider splitting into domain-specific handler modules.

**#52 -- `editor-app.js` handles too many concerns**
- **File:** `src/renderer/editor-app.js`
- **Issue:** 1193 lines handling zoom, upscale, tools, tags, keyboard, and save.

**#53 -- `home.js` handles too many concerns**
- **File:** `src/renderer/home.js`
- **Issue:** 1500+ lines handling files, search, settings, and setup overlay in one IIFE.

**#54 -- Liquid glass logic duplicated**
- **File:** `src/main/main.js:172-187,254-275`
- **Issue:** Same `addView` call, options, and fallback pattern duplicated for home and editor windows.
- **Fix:** Extract `applyLiquidGlass(window)` helper.

---

## Recommended Fix Order

1. **Security #1** -- `shell.openExternal` allowlist (5 min, highest risk)
2. **Bug #7** -- Tray accelerator swap (1 line fix)
3. **Security #2** -- Path validation on `get-thumbnail`/`reveal-in-finder`
4. **Security #3-4** -- XSS fixes (`innerHTML` -> `textContent`)
5. **Performance #9-12** -- Sync I/O -> async, index caching
6. **DRY #16-18** -- Extract shared PNG encoder + child process pool
7. **Dead code #8, #29-33** -- Remove unused code
8. Everything else by severity
