# User Flows

Detailed user flows for every feature in Snip. Each flow describes preconditions, steps, expected behavior, and edge cases. Designed to be converted directly into automated and manual test cases.

---

## 1. App Lifecycle

### 1.1 First Launch

**Preconditions:** Fresh install, no config file, no screenshots directory.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `npm start` | App starts, tray icon appears in menu bar |
| 2 | -- | No Dock icon visible (`app.dock.hide()` in dev, `LSUIElement: true` in production) |
| 3 | -- | `~/Documents/snip/screenshots/` directory created automatically |
| 4 | -- | Config file created at `~/Library/Application Support/snip/snip-config.json` with default categories |
| 5 | -- | Home window opens with Gallery page showing "No screenshots yet" empty state |
| 6 | -- | SAM segmentation model begins loading in background (logged: `[Segmentation Worker] Loading SlimSAM model...`) |
| 7 | -- | File watcher starts monitoring screenshots directory (logged: `[Organizer] Watching: ...`) |

### 1.2 Single Instance Lock

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | App is already running | -- |
| 2 | Run `npm start` again | Second instance quits immediately |
| 3 | -- | First instance's home window shows and focuses |

### 1.3 Window-All-Closed Behavior

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Close the home window (red traffic light) | Window closes but app keeps running (tray icon remains) |
| 2 | Click tray icon > "Show Snip" | Home window reopens |

---

## 2. Screenshot Capture

### 2.1 Full Capture Flow (Happy Path)

**Preconditions:** App running, Screen Recording permission granted.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press Cmd+Shift+2 | Home window hides |
| 2 | -- | Screen is captured via `desktopCapturer.getSources()` |
| 3 | -- | Fullscreen transparent overlay appears on current viewport |
| 4 | -- | Overlay covers entire screen including menu bar |
| 5 | -- | Cursor becomes crosshair, hint text visible: "Drag to select a region, then press Enter" |
| 6 | Drag to select a rectangular region | Selection box appears with handles |
| 7 | (Optional) Drag inside selection to reposition | Selection moves without resizing |
| 8 | Press Enter | Overlay closes, editor window opens with cropped image |
| 9 | -- | Editor window is centered on screen, min width 900px |
| 10 | -- | Toolbar visible at top with all tools |

### 2.2 Full-Screen Capture (No Selection)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press Cmd+Shift+2 | Overlay appears |
| 2 | Press Enter immediately (no drag) | Editor opens with full-screen capture |

### 2.3 Cancel Capture

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press Cmd+Shift+2 | Overlay appears |
| 2 | Press Escape | Overlay closes, home window re-shows |

### 2.4 Capture While Editor Is Open

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Editor window is open from a previous capture | -- |
| 2 | Press Cmd+Shift+2 | Editor window focuses (no new capture started) |

### 2.5 macOS Space Switching (Regression Test)

**Preconditions:** App's home window is on Space 1. User is on Space 2.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Switch to Space 2 (different from app's Space) | -- |
| 2 | Press Cmd+Shift+2 | Overlay appears on Space 2 (current viewport) |
| 3 | -- | macOS does NOT switch to Space 1 |
| 4 | -- | Home window is hidden, not visible on any Space |

**Key implementation details:**
- `app.dock.hide()` prevents Dock-based Space switching
- `LSUIElement: true` in production achieves the same
- Native module sets `NSWindowCollectionBehaviorMoveToActiveSpace` on overlay
- `homeWindow.hide()` called before capture

### 2.6 No Screen Recording Permission

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Revoke Screen Recording permission for the app | -- |
| 2 | Press Cmd+Shift+2 | `desktopCapturer.getSources()` throws |
| 3 | -- | Error logged: `[Snip] Screen capture failed: ...` |
| 4 | -- | Home window re-shows via `showHomeWindow()` in catch block |

---

## 3. Annotation Editor

### 3.1 Rectangle Tool

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press R (or click Rectangle in toolbar) | Rectangle tool active, cursor changes |
| 2 | Drag on canvas | Rectangle outline drawn in active color |
| 3 | -- | Mode dropdown visible: Outline (default), Highlight, Blur |
| 4 | -- | Thickness dropdown visible: Thin (2px), Medium (4px), Thick (8px) |

**Rectangle Modes:**

| Mode | Behavior |
|------|----------|
| Outline | Solid stroke, transparent fill |
| Highlight | Semi-transparent colored fill, no stroke |
| Blur | Pixelated/mosaic effect inside rectangle |

**Edge cases:**
- Switching mode while a rectangle is selected updates that rectangle's mode
- Very small drags (< 5px) should still create a visible rectangle

### 3.2 Text Tool

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press T | Text tool active |
| 2 | Click on canvas | Editable text box created at click position |
| 3 | Type text | Text appears in active color, selected font and size |
| 4 | -- | Font dropdown visible with system fonts |
| 5 | -- | Font size dropdown: 16, 20, 24, 32, 48px |
| 6 | Click outside textbox (while selected) | Textbox deselected — no new textbox created |
| 7 | Click on canvas (no textbox selected) | New textbox created at click position |

### 3.3 Arrow Tool

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press A | Arrow tool active |
| 2 | Drag on canvas | Arrow drawn from start to end with arrowhead |
| 3 | -- | Thickness dropdown visible |
| 4 | Change color via picker | Next arrow uses new color |

### 3.4 Blur Brush Tool

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press B | Blur brush active |
| 2 | Drag/paint on canvas | Pixelated mosaic effect applied |
| 3 | -- | Brush size dropdown: Small (10px), Medium (20px), Large (40px) |

### 3.5 Segment Tool (AI)

**Preconditions:** System has 4GB+ RAM and a system Node.js binary available.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press S | Segment tool active (only visible if supported) |
| 2 | -- | First use: tutorial modal appears explaining usage |
| 3 | Click on an object in the image | Loading indicator while SAM processes |
| 4 | -- | Segmentation mask overlay appears on the object |
| 5 | Shift+click to refine | Additional points added, mask recalculated |
| 6 | Press Enter / Accept | Mask applied to canvas as annotation |
| 7 | Press Escape / Reject | Mask discarded |

**Edge cases:**
- Segment tool hidden if `checkSegmentSupport()` returns false (< 4GB RAM or no system Node)
- Image resized to max 1024px before sending to SAM
- BGRA to RGBA conversion handled for Electron's native image format

### 3.6 Select Tool

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press V | Select tool active |
| 2 | Click on annotation | Object selected with handles |
| 3 | Drag selected object | Object moves |
| 4 | Drag handles | Object resizes |
| 5 | Press Delete/Backspace | Selected object removed |

### 3.7 Color Picker

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click color picker input in toolbar | Native color picker opens |
| 2 | Select a color | Active color updates |
| 3 | Draw new annotation | Uses newly selected color |

### 3.8 Undo / Redo

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Draw an annotation | Object appears on canvas |
| 2 | Press Cmd+Z | Object removed (undo) |
| 3 | Press Cmd+Shift+Z | Object restored (redo) |
| 4 | Draw after undo | Redo stack cleared |

### 3.9 Toolbar Minimum Width

**Preconditions:** Capture a very small region (e.g. 50x50px).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Capture small region, editor opens | Window width >= 900px (`TOOLBAR_MIN_WIDTH`) |
| 2 | -- | All toolbar controls visible and accessible |
| 3 | -- | Toolbar horizontally centered in window |
| 4 | Select Rectangle tool | Mode and Thickness dropdowns appear, still fit in toolbar |

---

## 4. Save and Export

### 4.1 Copy to Clipboard (Esc / Enter / Done)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Make annotations in editor | -- |
| 2 | Press Esc (or Enter, or click Done) | Annotated image exported as PNG |
| 3 | -- | PNG copied to system clipboard |
| 4 | -- | Editor window closes |
| 5 | Paste in another app | Annotated image appears |

### 4.2 Save to Disk (Cmd+S)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Make annotations in editor | -- |
| 2 | Press Cmd+S (or click Save) | Image exported as JPEG (92% quality) |
| 3 | -- | Saved to `~/Documents/snip/screenshots/<timestamp>.jpg` |
| 4 | -- | File queued for AI organization via `queueNewFile()` |
| 5 | -- | PNG also copied to clipboard |
| 6 | -- | macOS notification shown: "Screenshot saved" |
| 7 | -- | Editor remains open (user can continue editing or close) |

### 4.3 Save Without API Key

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | No API key configured | -- |
| 2 | Save screenshot via Cmd+S | File saved to screenshots root directory |
| 3 | -- | Basic index entry created: `category: 'other'`, filename as name, `embedding: null` |
| 4 | -- | No AI agent called, no rename, no categorization |

---

## 5. AI Organization Pipeline

### 5.1 Agent Processing (Happy Path)

**Preconditions:** API key configured, file saved by app.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Screenshot saved via Cmd+S | File written to screenshots directory |
| 2 | -- | `queueNewFile(filepath)` adds path to `pendingFiles` set |
| 3 | -- | Chokidar detects `add` event |
| 4 | -- | `pendingFiles.has(filepath)` returns true, file sent to worker |
| 5 | -- | Worker reads file as base64, calls Claude Haiku API with image |
| 6 | -- | Claude returns JSON: `{ category, name, description, tags }` |
| 7 | -- | File renamed: `<category>/<sanitized-name>.jpg` |
| 8 | -- | Embedding generated from `name + description + tags` |
| 9 | -- | Index entry created with all metadata |

### 5.2 Filename Uniqueness

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Claude suggests name `api-response` | -- |
| 2 | `code/api-response.jpg` already exists | -- |
| 3 | -- | File saved as `code/api-response-1.jpg` (counter suffix) |

### 5.3 New Category Suggestion

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Claude returns `newCategory: true` with an unknown category | -- |
| 2 | -- | macOS notification: "New category suggested: <name>. Click to add." |
| 3 | User clicks notification | Category added to config, screenshot moved to new category folder |

### 5.4 External File Operations (No Agent)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | User manually renames a file in screenshots directory | Chokidar fires `unlink` + `add` events |
| 2 | -- | `pendingFiles.has(filepath)` returns false (not app-saved) |
| 3 | -- | Basic index entry created: `category: 'other'`, no agent called |

### 5.5 Agent Error / API Failure

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | API key valid but API call fails (network error, rate limit) | -- |
| 2 | -- | Error caught in worker.js catch block |
| 3 | -- | If file exists on disk: basic index entry created |
| 4 | -- | Error logged: `[Worker] Error processing ...` |
| 5 | -- | Worker continues processing next file in queue |

### 5.6 Worker Crash Recovery

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Worker thread crashes unexpectedly | -- |
| 2 | -- | `worker.on('exit')` fires in watcher.js |
| 3 | -- | New worker spawned after 2-second delay |
| 4 | -- | Decrypted API key passed to new worker via `workerData` |

---

## 6. Search

### 6.1 Semantic Search (With Embeddings)

**Preconditions:** Screenshots indexed with embeddings (API key was configured when they were saved).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press Cmd+Shift+F (or click Search in sidebar) | Search page shown |
| 2 | Type query: "login form" | -- |
| 3 | -- | Query embedding generated via HuggingFace transformer |
| 4 | -- | Cosine similarity calculated against all indexed embeddings |
| 5 | -- | Top 20 results shown sorted by similarity score |
| 6 | -- | Result count badge shows number of matches |
| 7 | Click a result | File revealed in Finder |

### 6.2 Text Fallback Search (No Embeddings)

**Preconditions:** Screenshots indexed without embeddings (no API key when saved).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Type query in search | -- |
| 2 | -- | Query split into words, matched against name + description + tags + category |
| 3 | -- | Results sorted by word-match score |

### 6.3 Tag Search

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | On Search page, view tag cloud below search input | Tags from indexed screenshots shown as clickable chips |
| 2 | Click a tag chip | Search results filtered to screenshots with that tag |
| 3 | -- | Selected tag highlighted with accent color |
| 4 | Click the same tag again | Tag deselected, results cleared |

### 6.4 Empty States

| Condition | Expected Display |
|-----------|-----------------|
| No index exists | "No screenshots indexed yet" message |
| Query returns no results | "No results" message |
| Empty query | All screenshots shown (or no results) |

---

## 7. Gallery / Home Page

### 7.1 Browse Screenshots

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open home window, Gallery tab active | -- |
| 2 | -- | Category folders shown as grid items |
| 3 | Click a category folder | Navigate into folder, thumbnails of screenshots shown |
| 4 | -- | Breadcrumb updates to show current path |
| 5 | Click breadcrumb root | Navigate back to category list |

### 7.2 Refresh Index

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click refresh button (top-right) | Index re-synced with files on disk |
| 2 | -- | New files added, deleted files removed from index |

### 7.3 Open in Finder

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Open in Finder" button | Finder opens at `~/Documents/snip/screenshots/` (or current subfolder) |

### 7.4 Delete Screenshot

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Hover over a screenshot thumbnail | Circular X button appears (bottom-right) |
| 2 | Click the X button | File moved to macOS Trash |
| 3 | -- | Entry removed from index |
| 4 | -- | Thumbnail removed from gallery |

**Alternative:** Right-click thumbnail > "Move to Trash" context menu also works.

### 7.5 Open Image in Finder

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click a screenshot thumbnail | File revealed in Finder |

---

## 8. Settings

### 8.1 API Key Management

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to Settings page | API key input field shown (masked) |
| 2 | Enter API key, click Save (floppy icon) | Key encrypted via `safeStorage.encryptString()` |
| 3 | -- | Stored as base64 in `encryptedApiKey` config field |
| 4 | -- | Plaintext `anthropicApiKey` field deleted if present (migration) |
| 5 | -- | Worker thread receives updated key via `update-api-key` message |
| 6 | -- | Save icon briefly changes to checkmark confirmation |
| 7 | Click Show/Hide (eye icon) | Key toggled between masked and visible |

### 8.2 API Key Migration (Legacy Plaintext)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Config has `anthropicApiKey` (plaintext) but no `encryptedApiKey` | -- |
| 2 | App starts, `initStore()` runs | Plaintext key encrypted and stored as `encryptedApiKey` |
| 3 | -- | `anthropicApiKey` field deleted from config |

### 8.3 Theme Toggle

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Dark/Light toggle in Settings | Theme changes immediately |
| 2 | -- | `data-theme` attribute updated on `<html>` |
| 3 | -- | Preference saved to config |
| 4 | -- | All open windows receive `theme-changed` IPC event |

### 8.4 Category Management

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | View tag list in Settings | All categories shown with descriptions |
| 2 | Type a new category name, click Add | Category added to custom list |
| 3 | -- | Tag row appears with editable description textarea |
| 4 | Edit a tag description (textarea) | Auto-resizes as text grows |
| 5 | -- | Description saved when focus leaves textarea |
| 6 | Click remove (X) on a custom tag | Tag removed from config |
| 7 | -- | Built-in tags cannot be removed |

### 8.5 Keyboard Shortcuts Reference

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Scroll down in Settings page | Keyboard shortcuts table shown |
| 2 | -- | Continuous table (no divider rows) |
| 3 | -- | All shortcuts listed with descriptions |

---

## 9. Tray Menu

### 9.1 Tray Interactions

| Action | Expected Result |
|--------|-----------------|
| Click tray icon | Tray menu appears |
| "Capture Screenshot" menu item | Triggers capture (same as Cmd+Shift+2) |
| "Search" menu item | Opens search page (same as Cmd+Shift+F) |
| "Show Snip" menu item | Opens/focuses home window |
| "Quit" menu item | App quits, global shortcuts unregistered |

---

## 10. Sidebar Navigation

### 10.1 Navigation and Tooltips

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Home window open | Sidebar visible on left with three nav icons |
| 2 | Hover over a nav icon | CSS tooltip appears to the right of the icon |
| 3 | -- | Tooltip shows: "Saved", "Search", or "Settings" |
| 4 | Click a nav icon | Corresponding page shown, icon gets `active` class |

### 10.2 Sidebar Logo

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Look at sidebar header | Snip logo visible: scissors on dark squircle background |
| 2 | -- | Logo matches the macOS Dock/app icon design |

---

## 11. App Icon

### 11.1 Icon Consistency

| Context | Expected Icon |
|---------|---------------|
| macOS Dock (dev mode) | Hidden (no Dock icon) |
| macOS Dock (production) | Squircle with dark gradient, blue-indigo scissors, sparkles |
| Menu bar tray | Black scissors on transparent (Template icon, auto dark/light) |
| Sidebar logo | Mini version of app icon on dark squircle |
| About / Finder | `.icns` with squircle scissors design |

### 11.2 Icon Regeneration

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `node scripts/generate-app-icon.js` | `assets/icon.png` written (1024x1024, squircle clip) |
| 2 | -- | `assets/icon.icns` written (all required sizes) |
| 3 | -- | Corners transparent (squircle mask applied) |

---

## 12. Edge Cases and Error Handling

### 12.1 No Screenshots Directory

| Condition | Expected Behavior |
|-----------|-------------------|
| `~/Documents/snip/screenshots/` doesn't exist | Created by `initStore()` with `mkdirSync({ recursive: true })` |

### 12.2 Corrupt Index File

| Condition | Expected Behavior |
|-----------|-------------------|
| `.index.json` is invalid JSON | `loadIndex()` catches parse error, returns empty array |

### 12.3 Native Module Not Built

| Condition | Expected Behavior |
|-----------|-------------------|
| `build/Release/window_utils.node` missing | Warning logged, capture still works but overlay may appear on wrong Space |

### 12.4 SAM Model Not Available

| Condition | Expected Behavior |
|-----------|-------------------|
| Less than 4GB RAM or no system Node.js | `checkSegmentSupport()` returns `{ supported: false }` |
| -- | Segment tool hidden from toolbar |

### 12.5 Large Image Capture

| Condition | Expected Behavior |
|-----------|-------------------|
| Full Retina screen capture (e.g. 3456x2234 physical pixels) | Editor window capped at 90% of screen width/height |
| -- | Canvas uses CSS dimensions, not physical pixels |

### 12.6 Concurrent Captures

| Condition | Expected Behavior |
|-----------|-------------------|
| Press Cmd+Shift+2 while overlay is already showing | No action (overlay already visible) |
| Press Cmd+Shift+2 while editor is open | Editor window focuses, no new capture |
