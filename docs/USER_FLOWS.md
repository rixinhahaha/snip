# User Flows

> Role: **QA / Product Manager** — Step-by-step user flows with preconditions, expected behavior, and edge cases. Use as acceptance criteria and test case definitions.

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
| 8 | -- | Ollama server starts on dedicated port 11435 (logged: `[Ollama] Starting server...`) |
| 9 | -- | If minicpm-v model not found locally: pull begins from Ollama registry with progress bar in Settings |
| 9a | -- | If user has minicpm-v in system Ollama (`~/.ollama/models/`): model blobs symlinked (instant, no download) |

### 1.2 Native Glass Layer Initialization

**Preconditions:** macOS 26+ (Tahoe), `electron-liquid-glass` native addon built.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | App starts | `electron-liquid-glass` module loaded, `isGlassSupported()` and `_addon` checked |
| 2 | -- | If both pass: native glass path used (no `vibrancy` set on windows) |
| 3 | -- | If either fails: `vibrancy: 'under-window'` set on home/editor windows |
| 4 | Home window's `did-finish-load` fires | `liquidGlass.addView()` called with native window handle |
| 5 | -- | If `addView` returns valid ID (>= 0): native glass layer active behind web content |
| 6 | -- | Glass layer is always present; the Glass theme's CSS reveals it via transparent backgrounds |
| 7 | -- | If `addView` fails (returns < 0): `setVibrancy('under-window')` applied as fallback |

**Fallback chain:**
1. Native Liquid Glass (`NSGlassEffectView` via `electron-liquid-glass`)
2. Electron vibrancy (`vibrancy: 'under-window'`)
3. CSS `backdrop-filter: blur()` with translucent backgrounds
4. Solid opaque backgrounds (when `backdrop-filter` unsupported)

### 1.3 Single Instance Lock

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | App is already running | -- |
| 2 | Run `npm start` again | Second instance quits immediately |
| 3 | -- | First instance's home window shows and focuses |

### 1.4 Window-All-Closed Behavior

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
| 2 | -- | Display under the cursor is captured via `desktopCapturer.getSources()` |
| 3 | -- | Fullscreen transparent overlay appears on that display |
| 4 | -- | Overlay covers entire display including menu bar |
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
| 2 | Press Cmd+Shift+2 | Permission pre-check detects `denied` status |
| 3 | -- | Dialog appears: "Snip needs Screen Recording permission to capture snips." |
| 4 | -- | Dialog buttons: "Open System Settings" and "Cancel" |
| 5 | Click "Open System Settings" | macOS System Settings opens to Privacy > Screen Recording |
| 6 | -- | Home window does NOT re-show (permission errors skip home window restore) |

**Edge cases:**
- First launch (`not-determined` status): capture proceeds, macOS shows its native permission prompt
- Blank thumbnails (macOS 15+): secondary check detects blank capture and shows the same dialog
- After granting permission: user must restart Snip for the change to take effect

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
| 3 | Type text | Text appears in active color, selected font and size (default 16px) |
| 4 | -- | Font dropdown visible with system fonts |
| 5 | -- | Font size dropdown: 16 (default), 20, 24, 32, 48px |
| 6 | Press Enter | Exits text editing (finishes writing) |
| 7 | Press Shift+Enter | Inserts a newline within the textbox |
| 8 | Click outside textbox (while selected) | Textbox deselected — no new textbox created |
| 9 | Click on canvas (no textbox selected) | New textbox created at click position |

### 3.3 Arrow Tool

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press A | Arrow tool active |
| 2 | Drag on canvas | Arrow drawn from start to end with arrowhead |
| 3 | -- | Thickness dropdown visible |
| 4 | Change color via picker | Next arrow uses new color |

### 3.4 Tag Tool

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press G (or click Tag in toolbar) | Tag tool active, cursor becomes crosshair |
| 2 | -- | Font and font size dropdowns visible in toolbar |
| 3 | Click on canvas (first click) | Tip dot placed at click position |
| 4 | -- | Dashed preview line follows cursor from tip to mouse |
| 5 | -- | Ghost bubble rectangle follows cursor |
| 6 | Move mouse away from tip | Preview line and bubble update in real-time |
| 7 | Click on canvas (second click) | Final tag created: tip dot + leader line + text bubble |
| 8 | -- | Text editing mode entered immediately with "Label" selected |
| 9 | Type label text | Text appears in bubble, bubble auto-sizes on editing exit |
| 10 | Press Enter | Text editing exits, all parts grouped as one object |
| 11 | Press Shift+Enter | Inserts a newline in the tag label |
| 12 | Click outside or press Escape | Also exits editing and re-groups tag |

**Double-click editing:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Switch to Select tool (V) | -- |
| 2 | Double-click an existing tag | Tag ungroups, text enters editing mode |
| 3 | Edit the text | -- |
| 4 | Click outside or press Escape | Tag re-groups with updated text, bubble auto-sized |

**Edge cases:**
- Second click too close to first (< 20px): placement cancelled, returns to idle
- Press Escape during placement (after first click): preview objects removed, returns to idle
- Switching tools mid-placement: preview objects cleaned up automatically
- Undo (Cmd+Z) removes the entire tag group in one step
- Color/font/size changes apply to selected tag group

### 3.5 Blur Brush Tool

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press B | Blur brush active |
| 2 | Drag/paint on canvas | Pixelated mosaic effect applied |
| 3 | -- | Brush size dropdown: Small (10px), Medium (20px), Large (40px) |

### 3.6 Segment Tool (AI)

**Preconditions:** System has 4GB+ RAM and a system Node.js binary available.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press S | Segment tool active (only visible if supported) |
| 2 | -- | First use: tutorial modal explains click, shift+click, tag, and cutout |
| 3 | Click on an object in the image | Loading indicator while SAM processes |
| 4 | -- | Segmentation mask overlay appears on the object |
| 5 | Shift+click to refine | Additional points added, mask recalculated |
| 6 | Press Enter / Apply Cutout | Background replaced with cutout (existing behavior) |
| 7 | Press T / Tag Segment | Highlight overlay + tag bubble placed; textbox enters editing |
| 7a | Shift+T | Outline mode: colored border ring instead of highlight fill |
| 7b | Type label, press Enter | Exits editing; overlay + tag parts grouped into selectable annotation |
| 7c | Shift+Enter while editing | Inserts newline in tag label |
| 8 | Press Escape / Cancel | Mask discarded |

**Tag Segment modes:**
- **Highlight (T):** Translucent color fill over the mask area (30% opacity, uses active tag color)
- **Outline (Shift+T):** Colored border ring tracing the mask contour (3px width)
- Both modes attach a tag bubble (tip + leader line + label) at the center-top of the mask
- Double-click the tag group to re-edit the label text
- Tag color comes from the active tag color swatch in the toolbar

**Edge cases:**
- Segment tool hidden if `checkSegmentSupport()` returns false (< 4GB RAM or no system Node)
- Image resized to max 1024px before sending to SAM
- BGRA to RGBA conversion handled for Electron's native image format

### 3.7 2GIF Animation (After Segment)

**Preconditions:** Segment tool used, cutout accepted (Apply Cutout). Internet connection available. fal.ai API key must be configured in Settings > Animation.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Accept a segment cutout (Enter / Apply Cutout) | Cutout applied to canvas background |
| 2 | -- | Purple "2GIF" button appears at bottom center |
| 3 | Click "2GIF" button | Preset picker panel appears with "✨ Generating presets" loading state while Ollama analyzes cutout |
| 3a | -- | After ~3-5 seconds: loading replaced with 3 AI-tailored animation presets + "✨ AI" badge on title |
| 3b | -- | If Ollama unavailable: 6 static presets shown instead (no badge), seamless fallback |
| 4 | -- | Presets shown as a single-column list (label + description per row) |
| 4a | -- | Below presets: divider with "or describe your own" text, text input + go button |
| 5a | Click a preset | Panel closes, progress overlay appears with spark animations |
| 5b | Type custom prompt + click go / press Enter | Panel closes, progress overlay appears (uses `_custom` preset name) |
| 6 | -- | Progress: "Uploading image..." (5%) |
| 7 | -- | Progress: "Starting generation..." (10%) |
| 8 | -- | Progress: "In queue (position N)..." (10-15%) |
| 9 | -- | Progress: "Generating..." (15-90%, polled every 1s from fal.ai queue API) |
| 10 | -- | Progress: "Downloading video..." (92%) |
| 11 | -- | Progress: "Encoding GIF..." / "Encoding frame X/N..." (95-100%) |
| 12 | Generation complete | Result panel appears with animated GIF preview |
| 13 | -- | Buttons: "Save GIF", "Save APNG", "Redo", "Discard" |
| 14 | -- | Keyboard: Enter or Cmd+S saves GIF, R redoes, Esc discards |
| 15 | Click "Save GIF" (or Enter / Cmd+S) | GIF saved to `~/Documents/snip/screenshots/animations/<timestamp>.gif` |
| 16 | Click "Save APNG" | APNG saved as `~/Documents/snip/screenshots/animations/<timestamp>.png` |
| 17 | Click "Redo" (or R) | Result panel closes, preset picker reopens for another generation |
| 18 | Click "Discard" (or Esc) | Result panel closes, animation discarded |

**Pipeline detail:**
1. Cutout PNG composited onto magenta (#FF00FF) background — prevents fal.ai from hallucinating scenery (magenta chosen over green so green subjects aren't keyed out)
2. Composited PNG uploaded to fal.ai storage (pre-signed URL)
3. Job submitted to `fal-ai/wan/v2.2-a14b/image-to-video` queue API with text prompt (from preset or custom user input)
4. Queue polled every 1 second until COMPLETED or FAILED (2-minute timeout)
5. Resulting MP4 video downloaded (capped at 4 seconds max)
6. `ffmpeg-static` extracts raw RGBA frames in `gif-encoder-worker.js` child process
7. Per-frame chroma-key removes magenta pixels → transparent (tracks subject movement dynamically)
8. Frames encoded as GIF + APNG

**AI-generated presets:**
- When user clicks 2GIF, cutout image sent to Ollama (minicpm-v) for analysis
- Ollama returns 3 animation suggestions tailored to the subject (e.g., "wag tail" for a dog)
- AI presets use `_custom` preset name internally, passing the AI prompt via `options.customPrompt`
- "✨ AI" badge shown on panel title when AI presets are active
- Falls back to 6 static presets (inlined in `animation.js`) if Ollama is not running or fails
- "✨ Generating presets" loading text shown while waiting for Ollama (~3-5 seconds)
- **Preset caching**: presets are cached within the same cutout session. Clicking "Redo" reuses cached presets instantly without re-calling Ollama. Cache clears when a new cutout is created.

**Custom prompt:**
- User types a free-form animation description (e.g., "gently swaying in the wind")
- Input limited to 200 characters, submitted with Enter key or arrow button
- Uses preset name `_custom` with `options.customPrompt` containing the text
- `num_frames` capped at `fps × 4` (max 65) to enforce 4-second limit
- Empty prompts show toast: "Enter a prompt describing the animation"

**GIF vs APNG:**
- GIF: 256 colors, 1-bit transparency (may have jagged edges on cutout boundary)
- APNG: full 24-bit color, 8-bit alpha (smooth transparent edges, larger file)

**Edge cases:**
- 2GIF button only appears after accepting a segment cutout, not during any other tool use
- 2GIF button only appears when fal.ai API key is configured (checked via `checkAnimateSupport()`)
- Cancel in preset picker returns to showing the 2GIF button
- `checkAnimateSupport()` returns `{ supported: true }` only if a fal.ai API key is stored in config
- Animation times out after 2 minutes of polling with an error message
- Transient API errors during polling are retried automatically
- All animations (preset or custom) capped at 4 seconds maximum
- Result panel: Enter or Cmd+S saves GIF, R redoes, Esc discards
- Animations saved to `animations/` subdirectory, not processed by the AI organizer (watcher has `depth: 0`, skips subdirectories; also only watches `.jpg`/`.jpeg`/`.png` extensions)


### 3.8 Select Tool

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press V | Select tool active |
| 2 | Click on annotation | Object selected with handles |
| 3 | Drag selected object | Object moves |
| 4 | Drag handles | Object resizes |
| 5 | Press Delete/Backspace | Selected object removed |

### 3.9 Color Picker

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click color picker input in toolbar | Native color picker opens |
| 2 | Select a color | Active color updates |
| 3 | Draw new annotation | Uses newly selected color |

### 3.10 Undo / Redo

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Draw an annotation | Object appears on canvas |
| 2 | Press Cmd+Z | Object removed (undo) |
| 3 | Press Cmd+Shift+Z | Object restored (redo) |
| 4 | Draw after undo | Redo stack cleared |

### 3.11 Toolbar Minimum Width

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

### 4.3 Save Without Ollama Ready

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ollama server not running or model not yet downloaded | -- |
| 2 | Save screenshot via Cmd+S | File saved to screenshots root directory |
| 3 | -- | Basic index entry created: `category: 'other'`, filename as name, `embedding: null` |
| 4 | -- | No AI agent called, no rename, no categorization |

---

## 5. AI Organization Pipeline

### 5.1 Agent Processing (Happy Path)

**Preconditions:** Ollama server running with vision model downloaded, file saved by app.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Screenshot saved via Cmd+S | File written to screenshots directory |
| 2 | -- | `queueNewFile(filepath)` adds path to `pendingFiles` set |
| 3 | -- | Chokidar detects `add` event |
| 4 | -- | `pendingFiles.has(filepath)` returns true, file sent to worker |
| 5 | -- | Worker reads file as base64, calls local Ollama vision model with image |
| 6 | -- | Ollama returns JSON: `{ category, name, description, tags }` |
| 7 | -- | File renamed: `<category>/<sanitized-name>.jpg` |
| 8 | -- | Embedding generated from `name + description + tags` |
| 9 | -- | Index entry created with all metadata |

### 5.2 Filename Uniqueness

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ollama suggests name `api-response` | -- |
| 2 | `code/api-response.jpg` already exists | -- |
| 3 | -- | File saved as `code/api-response-1.jpg` (counter suffix) |

### 5.3 New Category Suggestion

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ollama returns `newCategory: true` with an unknown category | -- |
| 2 | -- | macOS notification: "New category suggested: <name>. Click to add." |
| 3 | User clicks notification | Category added to config, screenshot moved to new category folder |

### 5.4 External File Operations (No Agent)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | User manually renames a file in screenshots directory | Chokidar fires `unlink` + `add` events |
| 2 | -- | `pendingFiles.has(filepath)` returns false (not app-saved) |
| 3 | -- | Basic index entry created: `category: 'other'`, no agent called |

### 5.5 Agent Error / Ollama Failure

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ollama server running but model call fails (timeout, OOM) | -- |
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

---

## 6. Search

### 6.1 Semantic Search (With Embeddings)

**Preconditions:** Screenshots indexed with embeddings (Ollama was running when they were saved).

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

**Preconditions:** Screenshots indexed without embeddings (Ollama not running when saved).

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

### 8.1 AI Assistant Settings

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to Settings page | "AI Assistant" section shown |
| 2 | -- | Status dot: green "Running" if Ollama server is active, red "Starting..." if not |
| 3 | -- | **Current model card**: shows active model name (minicpm-v) with info (ⓘ) button |
| 4 | Click info button on model card | Tooltip appears below card showing specs table (model, parameters, size, quantization, description) |
| 5 | Click outside tooltip | Tooltip dismisses |

### 8.2 Ollama First Launch & Model Download

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | First app launch | Ollama server spawns on dedicated port 11435 (auto-finds next available port if taken) |
| 2 | -- | `ensureModel()` checks if minicpm-v exists in Snip's model store |
| 3a | Model found in Snip's store | Status shows "Running" immediately |
| 3b | Model found in system Ollama (`~/.ollama/models/`) | Blobs symlinked to Snip's store (instant), status shows "Running" |
| 3c | Model not found anywhere | Download begins from Ollama registry |
| 4 | -- | Settings shows "Downloading AI model..." with progress bar |
| 5 | -- | Progress bar shows percentage + downloaded MB / total MB |
| 6 | -- | Progress pushed in real-time via `ollama-pull-progress` IPC events |
| 7 | Download completes | Progress bar disappears, status shows "Running" |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| No internet on first launch | Pull fails gracefully, status shows error. App works for capture/annotate, no AI organization. |
| Pull interrupted (app quit mid-download) | On next launch, `ensureModel()` re-runs and resumes the download |
| Port 11435 taken (user's own Ollama or other service) | Auto-finds next available port (11436–11445). If all taken, `startupError` set. |
| User has system Ollama on port 11434 | No conflict — Snip uses its own port (11435+). Both run independently. |

### 8.3 Theme Toggle

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Dark, Light, or Glass button in Settings | Theme changes immediately |
| 2 | -- | `data-theme` attribute updated on `<html>` (`dark`, `light`, or `glass`) |
| 3 | -- | Preference saved to config |
| 4 | -- | All open windows receive `theme-changed` IPC event |
| 5 | Select Glass theme | Backgrounds become lavender-tinted translucent, native glass/vibrancy visible |
| 6 | -- | CSS `backdrop-filter` disabled (native layer handles blur) |
| 7 | Select Dark or Light theme | Standard opaque backgrounds restored, glass layer hidden |

### 8.4 Category Management

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | View tag list in Settings | All categories shown with descriptions (defaults: code, chat, web, design, documents, terminal, personal, fun, other) |
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
| `build/Release/window_utils.node` missing (dev) | Warning logged, capture still works but overlay may appear on wrong Space |
| `Resources/native/window_utils.node` missing (packaged) | Same behavior — addon loaded from `extraResources` path in packaged app, `build/Release/` path in dev |

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

---

## 13. Build & Distribution

### 13.1 Local Build (Unsigned / Ad-Hoc)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `npm run build` | `node-gyp rebuild` compiles `window_utils.node` |
| 2 | -- | `electron-builder --mac` packages the app |
| 3 | -- | `afterPack` hook removes unused native modules (canvas, sharp) and non-macOS onnxruntime binaries |
| 4 | -- | No `CSC_LINK` detected — `sign:adhoc` runs `codesign --force --deep --sign -` |
| 5 | -- | DMG output in `dist/` (ad-hoc signed, not notarized) |

### 13.2 Signed + Notarized Build

**Preconditions:** `.env` file with `CSC_LINK` (base64 .p12 of "Developer ID Application" cert), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run `./scripts/build-signed.sh` | Credentials loaded from `.env` |
| 2 | -- | Certificate validated — must be "Developer ID Application" |
| 3 | -- | `npm run prebuild` compiles native addon |
| 4 | -- | `electron-builder --mac` assembles app directory |
| 5 | -- | `afterPack` hook runs: removes canvas/sharp/@img, strips non-macOS onnxruntime binaries, pre-signs remaining `.node`/`.dylib` files |
| 6 | -- | electron-builder signs the full app bundle with Developer ID cert |
| 7 | -- | App submitted to Apple notary service, stapled on success |
| 8 | -- | Signed + notarized DMG output in `dist/` |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Wrong cert type (Apple Development) | Build script exits early with clear error message |
| Missing env vars | Build script exits early listing missing vars |
| Notarization rejected | electron-builder shows Apple's error log with specific binary paths |
