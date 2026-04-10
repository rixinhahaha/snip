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
| 5 | -- | Home window opens; if first launch and Screen Recording not granted, permission view shown first (see §8.0) |
| 5a | -- | If permission granted (or skipped), shows save location view (§8.0.1), then CLI install (§8.0.2), then Welcome screen |
| 6 | -- | SAM segmentation model begins loading in background (logged: `[Segmentation Worker] Loading SlimSAM model...`) |
| 7 | -- | File watcher starts monitoring screenshots directory (logged: `[Organizer] Watching: ...`) |
| 8 | -- | AI disabled by default — Ollama is not started on first launch |
| 8a | -- | User can enable AI later from Settings, which triggers Ollama install/model download (see §8.1, §8.2) |

### 1.2 Single Instance Lock

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
| 2 | -- | Screen capture (`desktopCapturer.getSources()`) and overlay window prep run in parallel; pre-warmed overlay is reused if available |
| 3 | -- | Fullscreen transparent overlay appears on that display |
| 4 | -- | Overlay covers entire display including menu bar |
| 5 | -- | Cursor becomes crosshair, hint text visible: "Click to screenshot the selected window · Drag to capture an area · Esc to cancel". Aspect ratio bar visible below hint with presets: Free (default), 1:1, 4:3, 3:2, 16:9, 5:4 |
| 5a | Move cursor over a window | Window highlighted with accent border and owner/title label (only windows with ≥50×50 visible area shown). Hint text hides when cursor is near the bottom bar area |
| 5b | Click a ratio preset on the bar | Selected ratio becomes active (purple highlight). Subsequent drags are constrained to that ratio. Clicking the bar does not start a selection |
| 6a | Click on a highlighted window | Window captured immediately, overlay closes, editor opens with cropped image |
| 6b | Drag to select a rectangular region | Selection constrained to active aspect ratio (if set). Drag direction determines orientation — horizontal drag = landscape, vertical = portrait. Dimension label shows "W × H (ratio)" (e.g. "640 × 360 (16:9)"). Ratio bar fades during drag, reappears on mouse-up. On mouse-up, overlay closes and editor opens with cropped image |
| 9 | -- | Editor window is centered on screen, min width 900px |
| 10 | -- | Toolbar visible at top with all tools |

### 2.2 Full-Screen Capture (No Selection)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press Cmd+Shift+2 | Overlay appears |
| 2 | Press Enter (no drag) | Editor opens with full-screen capture |

### 2.3 Cancel Capture

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press Cmd+Shift+2 | Overlay appears |
| 2 | Press Escape | Overlay closes, home window re-shows |
| 2a | (Alt) Switch away (Cmd+Tab, click another app) | Overlay auto-dismisses — stale screenshot is discarded |

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

### 2.3 Quick Snip (Select & Copy to Clipboard)

**Preconditions:** App running, Screen Recording permission granted.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press Cmd+Shift+1 (default) | Same capture overlay appears with window highlight, region selection, and aspect ratio bar |
| 2 | Click a window or drag a region | Cropped image copied directly to clipboard on mouse-up — no annotation editor opens. Aspect ratio constraints apply if a ratio preset is selected |
| 3 | -- | Floating toast "✓ Copied to clipboard" appears top-center, auto-dismisses after ~1.4s |

**Edge cases:**
- Esc cancels the selection and closes the overlay (same as regular capture)
- Enter with no selection copies full screen to clipboard (with toast confirmation)
- If Screen Recording permission not granted: permission dialog shown (same as regular capture)
- Shortcut is customizable from Settings > Keyboard Shortcuts

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
| 2 | Click on empty canvas | Editable text box created at click position with placeholder "Type here" selected |
| 3 | Type text | Text replaces placeholder; appears in active color, selected font and size (scaled to image width, clamped 12–48px) |
| 4 | -- | Font dropdown visible with system fonts |
| 5 | -- | Font size dropdown: 16, 20, 24, 32, 48px |
| 6 | Press Enter | Exits text editing and switches to Select (cursor) mode |
| 7 | Press Shift+Enter | Inserts a newline within the textbox |
| 8 | Press Escape | Exits editing, keeps textbox selected (can press Delete to remove) |
| 9 | Click outside textbox (while editing) | Exits editing, textbox deselected |
| 10 | Click on existing annotation (while text tool active) | Click ignored — no textbox created on top of existing objects |
| 11 | Don't type, click elsewhere / press Enter / Escape / switch tool | Empty/placeholder textbox auto-removed |
| 12 | In Select mode, click on a textbox | First click selects; second click enters editing; toolbar shows font controls |

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
| 10 | Press Enter | Text editing exits; switches to Select (cursor) mode with label selected |
| 11 | Press Shift+Enter | Inserts a newline in the tag label |
| 12 | Click outside or press Escape | Also exits editing and creates the tag |

**Draggable tag labels:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Select a tag's label group | Label (bubble + text) selected, tip dot stays fixed |
| 2 | Drag the label | Bubble moves freely; leader line stretches from tip to label edge |
| 3 | Click the tip anchor | Tip circle selected with color-matched border outline |
| 4 | Drag the tip anchor | Tip moves freely; leader line stretches from tip to label edge |
| 5 | Release | Line connects tip to nearest edge of label bubble |

**Click-to-edit (in Select mode):**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Switch to Select tool (V) | -- |
| 2 | Click an existing tag | First click: selects the label; toolbar shows tag color swatches + font controls |
| 3 | Click the selected tag again | Label ungroups, text enters editing mode; tag color swatches remain visible |
| 4 | Edit the text | Bubble auto-resizes as user types |
| 5 | Change tag color (via swatch) while editing | Bubble, tip, line, and overlay (if segment tag) update in real-time |
| 6 | Press Enter | Label re-groups with updated text; switches to Select (cursor) mode |
| 7 | Press Shift+Enter | Inserts newline in label text |
| 8 | Double-click an existing tag | Also enters editing mode (shortcut for steps 2-3) |

**Edge cases:**
- Second click too close to first (< 20px): placement cancelled, returns to idle
- Press Escape during placement (after first click): preview objects removed, returns to idle
- Switching tools mid-placement: preview objects cleaned up automatically
- Undo (Cmd+Z) removes the entire tag (label group + linked tip + line) in one step
- Redo (Cmd+Shift+Z) restores the tag with all linked parts
- Color/font/size changes apply to selected label group and linked parts (tip, line); bubble auto-resizes on font/size change
- Delete/Backspace removes the label group and all linked parts

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
| 6 | Press Enter / Apply Cutout | Background replaced with cutout; switches to Select mode |
| 7 | Press T / Tag Segment | Highlight overlay + tag bubble placed; textbox enters editing |
| 7a | Type label, press Enter | Exits editing; switches to Select mode with label selected |
| 7b | Shift+Enter while editing | Inserts newline in tag label |
| 7c | Drag the label or tip | Label and tip are both draggable; leader line stretches between them |
| 8 | Press Escape / Cancel | Mask discarded |

**Tag Segment overlay:**
- **Highlight (T):** Translucent color fill + outline ring over the mask area (35% opacity, 10px outline via dilation)
- **Segment color palette** is limited to 4 colors: Red (#EF4444), Yellow (#EAB308), Green (#22C55E), Blue (#3B82F6) — separate from the regular tag palette
- Attaches a tag bubble (tip + leader line + label) at the center of the mask
- Label group (bubble + text) and tip anchor are both independently draggable with dynamic leader line
- Double-click the label group to re-edit the label text
- After completing cutout or tagging, editor switches to Select (cursor) mode

**Editing segment tags after creation:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click a segment tag label | Label selected; segment color swatches (Red / Green / Blue) + font controls shown in toolbar |
| 2 | Change segment color swatch | Overlay, tip, line, and bubble all update to new color in real-time |
| 3 | Change font size | Tag bubble auto-resizes to match new font size |
| 4 | Click the selected tag again | Text enters editing mode; segment color swatches remain visible |
| 5 | Edit the label text | Bubble auto-resizes; color changes still work during editing |
| 6 | Press Enter | Exits editing; switches to Select mode with updated tag |

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
| 6 | Click already-selected textbox | Enters text editing mode; toolbar shows font controls |
| 7 | Click already-selected tag | Enters tag editing mode; toolbar shows tag color + font controls |
| 8 | Click already-selected segment tag | Enters editing; toolbar shows segment colors (Red/Green/Blue) + font |
| 9 | Press Enter while editing | Exits editing and stays in Select mode |
| 10 | Press Shift+Enter while editing | Inserts newline |

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

### 3.11 Toolbar Overflow & Window Resize

**Preconditions:** Editor open with any screenshot.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Editor opens | Window sized to fit image (min 600×400). Toolbar centered with save/done/cancel pinned to right of tools. |
| 2 | Resize window narrower | Toolbar tools region scrolls horizontally. Save/done/cancel always visible. Fade gradient appears on scroll region edge. |
| 3 | Scroll/swipe on toolbar | Tools scroll horizontally. Vertical scroll wheel converts to horizontal scroll. |
| 4 | Resize window wider | Fade gradient disappears when all tools fit. |
| 5 | Switch tools | Active tool scrolls into view. Contextual controls appear; overflow recalculates. |
| 6 | Resize window | Image re-fits to new viewport (zoom-to-fit). |

### 3.12 Transcribe Text

**Preconditions:** Editor open with a screenshot. macOS with Vision framework available.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Transcribe" button (or press W) in editor toolbar | Side panel opens to the right of the canvas |
| 2 | -- | Loading spinner shown briefly while native OCR processes |
| 3 | -- | Screenshot sent via `transcribe-screenshot` IPC channel to native macOS Vision framework (VNRecognizeTextRequest) |
| 4 | -- | Vision framework returns extracted text; Unicode script analysis detects languages |
| 5 | -- | Panel displays: language badges at top, extracted text below |
| 6 | Click "Copy" button or press Enter | Extracted text copied to system clipboard; Enter also closes the panel |
| 7 | Click panel close button (or press Escape) | Panel closes, editor returns to normal layout |
| 8 | Click "Transcribe Text" button again | Panel reopens instantly with cached results (no OCR call) |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| No text detected in screenshot | Panel shows message indicating no text was found |
| Swift helper compilation fails | Error state shown in panel |
| Cache invalidation | Cache is per editor session; opening a new editor starts fresh |

### 3.13 Upscale (2x)

**Preconditions:** Editor open with a captured image.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the Upscale button in the toolbar | Progress overlay appears ("Loading model...") |
| 2 | -- | Child process spawns with bundled Node.js binary, loads Swin2SR ONNX model |
| 3 | -- | Progress updates to "Upscaling (2x)..." |
| 4 | -- | Upscaled image replaces the canvas background directly |
| 5 | -- | Upscale button becomes disabled (prevents re-upscaling) |
| 6 | Annotate and save/copy as normal | Upscaled image exported at new resolution |
| 7 | ⌘Z or Undo button | Reverts to pre-upscale state (image, dimensions, annotations) |
| 8 | Reset All button | Also reverts upscale along with all annotations, re-enables upscale button |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Image would exceed 3840x2160 after 2x upscaling | Notification shown, upscale blocked |
| No bundled Node.js binary available | Upscale not available (same as SAM fallback) |
| Child process crashes during upscaling | Error shown, canvas unchanged |
| Upscale already applied | Button disabled, cannot upscale again |

### 3.14 Canvas Zoom & Pan

**Preconditions:** Editor open with a captured image.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Pinch-to-zoom on trackpad | Canvas zooms toward cursor; zoom indicator appears in bottom-right |
| 2 | ⌘+scroll wheel | Canvas zooms in/out |
| 3 | ⌘+ / ⌘- | Zoom in/out by 25% steps |
| 4 | ⌘0 | Reset to fit-to-viewport zoom with no pan offset |
| 5 | Two-finger scroll (trackpad) or scroll wheel | Pan canvas in any direction |
| 6 | Space + drag | Pan canvas (cursor shows grab hand) |
| 7 | Middle-click drag | Pan canvas |
| 8 | Left-click drag on empty canvas (Select tool) | Pan canvas (cursor shows grabbing hand) |
| 9 | Resize editor window | Image re-fits to new viewport (zoom resets to fit) |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Zoom exceeds 800% or below 25% | Clamped to min/max bounds |
| Space pressed while editing a textbox | Space types a character (pan disabled) |
| Export while zoomed in | Exported at full resolution regardless of view zoom |
| Zoom indicator at 100% fit | Indicator hidden |

---

## 4. Save and Export

### 4.1 Copy to Clipboard (Esc / Enter / Done)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Make annotations in editor | -- |
| 2 | Press Esc (or Enter, or click Done) | Annotated image exported as PNG |
| 3 | -- | PNG copied to system clipboard |
| 4 | -- | Editor window closes |
| 5 | -- | Floating toast "✓ Copied to clipboard" appears top-center, auto-dismisses after ~1.4s |
| 6 | Paste in another app | Annotated image appears |

### 4.2 Save to Disk (Cmd+S)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Make annotations in editor | -- |
| 2 | Press Cmd+S (or click Save) | Image exported as JPEG (92% quality) |
| 3 | -- | Saved to `~/Documents/snip/screenshots/<timestamp>.jpg` |
| 4 | -- | File queued for AI organization via `queueNewFile()` |
| 5 | -- | PNG also copied to clipboard |
| 6 | -- | Editor window closes |
| 7 | -- | Floating toast "✓ Saved & copied to clipboard" appears top-center, auto-dismisses after ~1.4s |

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

### 5.3 New Category Auto-Registration

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ollama returns a category not in the configured list | -- |
| 2 | -- | Category auto-registered in config with AI-generated description via `addCustomCategoryWithDescription()` |
| 3 | -- | macOS notification: "Created '<name>' category" (informational only) |
| 4 | -- | `tags-changed` IPC event broadcast to all windows |
| 5 | -- | Settings tag list refreshes in real-time to include the new category |

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
| 1 | Press Cmd+Shift+S (or click Search in sidebar) | Search page shown |
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
| 1 | Click refresh button (top-right of gallery or search view) | `refreshIndex()` IPC called |
| 2 | -- | Stale entries pruned (files deleted outside the app) |
| 3 | -- | Missing embeddings regenerated for entries with name/description but no embedding |
| 4 | -- | Gallery/search view reloads with updated data |

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

### 7.6 Delete Folder

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In gallery root, hover a category folder | Circular X button appears (bottom-right, same pattern as screenshot delete) |
| 2 | Click the X button | Confirm dialog: "Delete folder '<name>' and all its contents?" |
| 3 | User confirms | Folder moved to macOS Trash via `shell.trashItem()` |
| 4 | -- | All index entries for files in that folder removed |
| 5 | -- | Gallery view refreshes |

---

## 8. Settings

### 8.0 Screen Recording Permission

Snip checks Screen Recording permission **on every launch** (not just the first). If permission is not granted, the permission view is shown regardless of whether onboarding has been completed. No permission state is saved to config — `systemPreferences.getMediaAccessStatus('screen')` is queried live.

**Any launch — Permission not granted:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | App launches | Permission check via `systemPreferences.getMediaAccessStatus('screen')` |
| 2 | Status is `not-determined` | Overlay shows Screen Recording view with **"Allow"** button |
| 3 | Click "Allow" (or press Enter) | Triggers `desktopCapturer.getSources()` → macOS shows native permission dialog |
| 4a | User allows | **"Restart Snip"** button shown with hint "Restart is needed for Screen Recording to take effect." |
| 4b | User denies | Switches to denied state: **"Open System Settings"** + **"Restart Snip"** buttons + hint |
| 5 | Click "Restart Snip" | App relaunches via `app.relaunch(); app.exit(0)` |
| 6 | After restart, permission = `granted` | Permission view skipped. First launch → Save Location (§8.0.1). Returning user → no overlay |

**Permission already granted:**

| Condition | Expected Behavior |
|-----------|-------------------|
| `getMediaAccessStatus('screen')` returns `granted` | Permission view skipped. First launch → Save Location (§8.0.1). Returning user → no overlay |

**Denied state:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Permission status is `denied` | Shows "Open System Settings" + "Restart Snip" buttons |
| 2 | Click "Open System Settings" | Opens `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture` |
| 3 | User enables Snip in System Settings, clicks "Restart Snip" | App relaunches → permission granted → view skipped |
| 4 | If still denied after restart | Same permission view shown again |

**Skip (Esc):**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Press Esc or click "Skip for now" on first launch | Proceeds to Save Location step (§8.0.1) |
| 1b | Press Esc or click "Skip for now" on subsequent launch | Overlay dismissed |
| 2 | User tries to capture without permission | Home window opens with permission view (no native dialog) |

**Capture-time permission check:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | User presses capture shortcut without Screen Recording permission | Capture fails (blank/empty image detected in `capturer.js`) |
| 2 | -- | Home window opens and shows the permission view |
| 3 | User grants permission and restarts | Capture works normally |

### 8.0.1 Save Location

After the Screen Recording permission step (or if permission is already granted), the user is shown a save location picker.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Permission granted or skipped | Overlay shows "Save Location" view with current default path (`~/Documents/snip/screenshots/`) |
| 2a | Click "Choose Folder" (or press Enter) | Native macOS folder picker opens |
| 3a | User selects a folder | Path saved to config as `screenshotsDir`; `aiEnabled` set to `false`; proceeds to CLI install (§8.0.2) |
| 3b | User cancels folder picker | Stays on save location view (no change) |
| 2b | Click "Use default" (or press Esc) | Warning shown briefly: "Snips will be saved to the default location shown above." After 1.5s, `aiEnabled` set to `false`; proceeds to CLI install (§8.0.2) |

### 8.0.2 CLI Installation

After the Save Location step, the user is offered CLI installation to enable AI coding tool integration. If CLI is already installed (verified by checking for our wrapper signature), this step is auto-skipped.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Save Location step completes | Checks `checkCliInstalled()` |
| 1a | CLI already installed (returns `true`) | Auto-skip to Welcome screen |
| 1b | CLI not installed (returns `false` or `'stale'`) | Show CLI Install view |
| 2 | CLI Install view shown | Terminal icon + "Install CLI" title + tool badges (Claude Code, Cursor, Windsurf, Cline) |
| 3a | Click "Install" (or press Enter) | Calls `installCli()`, creates shell wrapper at `/usr/local/bin/snip` (or fallback) |
| 4a | Install succeeds | Green checkmark with install path shown. Detects AI providers |
| 4a-i | Providers detected (Claude Code, Cursor, etc.) | Provider rows shown with "Configure" buttons. "Continue" button replaces "Skip" |
| 4a-ii | Click "Configure" on a provider | Snip rules added to that provider's config file. Button changes to "Remove" |
| 4a-iii | Click "Continue" (or press Enter) | Proceeds to Welcome screen |
| 4a-iv | No providers detected | Auto-advances to Welcome after 1.5s |
| 4b | Install fails | Error message shown inline with "Try again" button |
| 3b | Click "Skip for now" (or press Esc) | Proceeds to Welcome screen |

**Changing Save Location from Settings (§8.4.1):**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Change" button in Save Location settings section | Native macOS folder picker opens |
| 2 | User selects a new folder | If existing snips exist: migration dialog shown (see below). If no snips: directory switched immediately |
| 3 | Migration dialog offers three options: | |
| 3a | **Copy snips** | All files copied to new location, originals remain. Index paths rewritten |
| 3b | **Move snips** | All files moved to new location, originals removed. Index paths rewritten |
| 3c | **Start fresh** | New empty library at new location. Old files untouched |
| 4 | After migration completes | File watcher restarted on new directory. Settings path display updated. File grid refreshed |

### 8.1 AI Organization (Settings-Only)

AI organization is **disabled by default**. On first launch, `aiEnabled` is set to `false` automatically (no choice screen is shown). Users can enable AI later from Settings.

**With AI disabled (default):**

| Condition | Expected Behavior |
|-----------|-------------------|
| App starts | Ollama skipped entirely — no spawn, no health check |
| -- | No setup overlay shown |
| -- | Screenshots indexed with basic metadata only (filename, `category: 'other'`, no AI naming/tagging) |
| -- | AI details hidden in Settings page (toggle is OFF) |

**Enabling AI from Settings:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | User toggles AI Organization ON in Settings | `aiEnabled` set to `true`; Ollama starts; checklist shown |
| 2 | User clicks "Set up" button | Setup overlay opens with steps view (install/running/model) |
| 3 | -- | Ollama install/running/model flow proceeds normally (see §8.2) |

**With AI enabled (subsequent launches):**

| Condition | Expected Behavior |
|-----------|-------------------|
| Ollama fully ready | Normal startup, no overlay |
| Ollama not fully ready | Setup overlay shows install/running/model steps (see §8.2) |

### 8.2 Setting Up Your AI Assistant (Inline Overlay)

The setup wizard appears as a **full-window inline overlay** inside the home window (not a separate popup). It can be opened from the Settings "Set up" button when AI is enabled.

**Overlay structure:** Five views — Permission (first launch, if not granted), CLI Install (first launch, if not already installed), Steps (install/running/model), Welcome, Failed. Only one visible at a time. Step cards show numbered indicators (pending -> active -> done with checkmark).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | User clicks "Set up" in Settings (with AI enabled) | Inline overlay covers home window with step-by-step wizard |
| 2 | -- | App auto-detects current Ollama state and shows appropriate step |

**Step: Install Ollama**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ollama not detected on system | Step 1 card active with "Install Ollama" button |
| 2 | Click "Install Ollama" | Download begins, progress bar animates with accent gradient fill |
| 3 | -- | Progress: Downloading → Extracting → Installing → Launching |
| 4 | -- | Ollama.app moved to `/Applications/` and launched automatically |
| 5 | -- | Auto-advances to running step, then model step |

**Step: Ollama Running**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ollama installed but starting | Step 2 active with spinner "Waiting for Ollama to start..." |
| 2 | -- | Auto-advances when server responds |

**Step: Download Model**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ollama running but minicpm-v not found | Step 3 card active with "Download MiniCPM-V" button |
| 2 | Click "Download MiniCPM-V" | Model pull begins (~5 GB), progress bar shows MB / total MB |
| 3 | Download completes | Transitions to Welcome screen |

**Welcome Screen**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | All steps complete | Welcome view: purple magic wand SVG with pop-in animation, "Welcome to Snip" title |
| 2 | -- | Sparkle particles float upward in background (circles and 4-point stars) |
| 3 | Click "Get Started" or press Enter | Overlay dismissed, user lands on gallery |

**Failed Screen**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | 3+ consecutive errors during install/download | Failed view: "Snip works great without AI too" |
| 2 | Click "Continue without AI" | Overlay dismissed, app works normally without AI |
| 3 | Click "Try again" | Resets failure count, returns to appropriate setup step |

**Settings "Set up" Button**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to Settings page | Checklist shows installed/running/model status |
| 2 | If not all ready, "Set up" button visible | Click reopens inline overlay at correct step |
| 3 | If all ready | "Set up" button hidden, model info card shown |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| No internet during install/pull | Inline error with retry button. After 3 failures → failed screen |
| Ollama installed but not running | Auto-started; overlay shows spinner while waiting |
| Skip button clicked | Overlay dismissed, setup continues in background |
| "Continue in background" | Shown when download is active, dismisses overlay |
| App works without Ollama | Capture/annotate work normally, no AI organization |

### 8.3 AI Organization Settings

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to Settings page | "AI Features" section shown with Organization subsection and AI Organization toggle |
| 2 | Toggle AI Organization off | Organization details hidden, Snip Tags subsection hidden, saved to config |
| 3 | Toggle AI Organization on | Organization details shown with Ollama checklist, Snip Tags subsection shown |
| 4 | -- | Checklist shows three items: Ollama installed, Ollama running, Model downloaded |
| 5 | Each item shows ✓ (ready) or ○ (pending) | Based on live `get-ollama-status` IPC result |
| 6 | If not all ready | "Set up" button visible → click opens setup overlay |
| 7 | If all ready | "Set up" button hidden, model info card shown |
| 8 | Click ⓘ on model info card | Tooltip toggles with specs: Model, Host, Parameters, Size, Quantization, Description |
| 9 | Click ⓘ again or click elsewhere | Tooltip dismissed |

### 8.4 Theme Toggle

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Dark or Light button in Settings | Theme changes immediately |
| 2 | -- | `data-theme` attribute updated on `<html>` (`dark` or `light`) |
| 3 | -- | Preference saved to config |
| 4 | -- | All open windows receive `theme-changed` IPC event |

### 8.5 Category Management

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | View tag list in Settings | All categories shown with descriptions (defaults: code, chat, web, design, documents, terminal, personal, fun, other) |
| 2 | Type a new category name, click Add | Category added to custom list |
| 3 | -- | Tag row appears with editable description textarea |
| 4 | Edit a tag description (textarea) | Auto-resizes as text grows |
| 5 | -- | Description saved when focus leaves textarea |
| 6 | Click remove (X) on a custom tag | Tag removed from config |
| 7 | -- | Built-in tags cannot be removed |

### 8.6 Keyboard Shortcuts Reference

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Scroll down in Settings page | Keyboard shortcuts table shown |
| 2 | -- | Continuous table (no divider rows) |
| 3 | -- | All shortcuts listed with descriptions |

### 8.7 Custom Keybindings

**Preconditions:** App running, Settings page visible.

The Shortcuts section shows two groups: **configurable shortcuts** (2 global shortcuts with edit icons) and **read-only shortcuts** (tool shortcuts and OS shortcuts, non-interactive, 60% opacity).

**Configurable shortcuts** (3 global):
- Capture (Cmd+Shift+2), Quick Snip (Cmd+Shift+1), Search (Cmd+Shift+S)

**Read-only shortcuts** (displayed for reference):
- 7 editor tool shortcuts: Select (V), Rectangle (R), Text (T), Arrow (A), Tag (G), Blur Brush (B), Segment (S)
- OS shortcuts: Enter, Esc, Cmd+S, Cmd+Z, Cmd+Shift+Z, Delete
- GIF Preview shortcuts: Save GIF, Redo animation, Discard animation

**Recording a global shortcut:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the edit (pencil) icon next to a global shortcut | Key display enters recording mode: purple pulsing border, edit icon highlights |
| 2 | -- | Key display text changes to "Press key…" |
| 3 | Press a modifier+key combo (e.g., Cmd+Shift+3) | Shortcut saves immediately, display shows new key combo |
| 4 | -- | Global shortcut re-registers with the new binding via `reregisterShortcuts()` |
| 5 | -- | Tray menu rebuilt with updated accelerator labels |
| 6 | -- | `shortcuts-changed` event broadcast to all windows |

**Cancel recording:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | While in recording mode, press Escape | Recording cancelled, original shortcut restored |

**Conflict detection:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Record a key combo already assigned to the other global shortcut | Error state: red border, "Used by [name]" message |
| 2 | -- | Conflicting shortcut is not saved |
| 3 | Press a key without modifier | Error state: "Needs modifier" message |

**Reset all shortcuts:**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Reset to Default" button | All custom shortcuts deleted, defaults restored |
| 2 | -- | "Restored defaults" status message fades in briefly |
| 3 | -- | Global shortcuts re-registered with default bindings |
| 4 | -- | Tray menu rebuilt with default accelerator labels |
| 5 | -- | `shortcuts-changed` event broadcast to all windows |

**Persistence:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Custom shortcuts saved | Stored in `snip-config.json`, persist across app restarts |
| Config missing shortcuts | Falls back to built-in defaults |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Read-only shortcut rows | Displayed at 60% opacity, no edit icon, non-interactive |
| Click edit icon while already recording another | Ignored — only one recording at a time |
| Global shortcut registration fails (malformed accelerator) | Falls back to default shortcut, error logged |

---

## 9. Tray Menu

### 9.1 Tray Interactions

| Action | Expected Result |
|--------|-----------------|
| Click tray icon | Tray menu appears |
| "Snip and Annotate" menu item | Triggers capture (same as Cmd+Shift+2) |
| "Quick Snip" menu item | Opens capture overlay in quick-snip mode — select & copy to clipboard (same as Cmd+Shift+1) |
| "Search Snips" menu item | Opens search page (same as Cmd+Shift+S) |
| "Open Snip" menu item | Opens/focuses home window |
| "Quit Snip" menu item | App quits, global shortcuts unregistered |

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
| Full Retina screen capture (e.g. 3456x2234 physical pixels) | Editor window uses up to 100% of screen work area |
| Image exceeds editor viewport | Canvas zoomed to fit via `setZoom()` — annotations draw at visible scale |
| -- | Export compensates for zoom (`dpr / zoom`) to produce full physical-resolution output |
| -- | Canvas uses CSS dimensions, not physical pixels |

### 12.6 Window Snap Selection

| Condition | Expected Behavior |
|-----------|-------------------|
| Browser or multi-pane app (Chrome, VS Code, etc.) | Sub-windows merged by PID into single bounding rect — full app window highlighted |
| Window partially off-screen | Snap rect includes the off-screen portion; crop clamps to captured image bounds |
| Overlay offset from display origin (menu bar / notch) | Window list coordinates adjusted by overlay offset before rendering |
| Click threshold on Retina display | Drag threshold is DPI-aware (5 × devicePixelRatio physical pixels) |

### 12.7 Concurrent Captures

| Condition | Expected Behavior |
|-----------|-------------------|
| Press Cmd+Shift+1 or Cmd+Shift+2 while overlay is already showing | No action (overlay already visible) |
| Press Cmd+Shift+2 while editor is open | Editor window focuses, no new capture |
| Press Cmd+Shift+1 while editor is open | Quick Snip overlay opens (bypasses editor check) |

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

---

## 14. MCP Server

### 14.1 Enable MCP Server

**Preconditions:** App running, home window open, Settings tab active.

Note: The Unix domain socket server (`~/Library/Application Support/snip/snip.sock`, chmod 600) **always runs** regardless of this toggle — the CLI depends on it. This toggle controls **UI visibility** of MCP settings, not the socket lifecycle.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Scroll to "MCP Server" section in Settings | Section visible with status dot (gray = toggle off) and toggle switch |
| 2 | Toggle the MCP switch on | Status dot turns green |
| 3 | -- | Category toggles expand (Library Access, Open in Snip, Transcribe, Organize — all enabled by default) |
| 4 | -- | Client config block expands showing JSON with `command` and `args` for Claude Desktop |
| 5 | Click "Copy" | JSON config copied to clipboard; button text changes to "Copied!" for 1.5s |
| 6 | Toggle off | Category toggles and config block collapse; status dot turns gray |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Client config path differs in packaged vs dev | `getMcpClientConfig()` returns absolute path to packaged `server.js` in `Resources/`, or dev path relative to project root |
| Config changed externally (e.g., via MCP command) | UI refreshes automatically via `onMcpConfigChanged` listener |

### 14.2 Configure MCP Tool Categories

**Preconditions:** MCP server enabled (§14.1).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click the toggle next to "Transcribe" | Toggle turns off; `mcpCategories.transcribe` set to `false` in config |
| 2 | -- | `transcribe_screenshot` MCP tool is no longer registered on the socket server |
| 3 | Re-enable "Transcribe" toggle | Tool re-registered |

### 14.3 Use MCP from External AI Agent (Claude Desktop)

**Preconditions:** MCP enabled, Claude Desktop configured with the copied JSON config.

The MCP adapter (`src/mcp/server.js`) is a **thin CLI wrapper** — it spawns `snip <command>` for most tool calls and reads stdout. It falls back to direct socket for `install_extension` (complex JSON params), `open_in_snip` with `imageDataURL` (too large for CLI args), and `render_diagram` (diagram code can be large). The adapter auto-detects stdio framing (Content-Length headers vs newline-delimited JSON).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Claude Desktop launches `node src/mcp/server.js` via stdio | MCP adapter starts, spawns CLI subprocesses for tool calls |
| 2 | Agent calls `list_screenshots` | Returns JSON array of screenshot metadata from index |
| 3 | Agent calls `search_screenshots` with a query | Returns top-matching screenshots with similarity scores |
| 4 | Agent calls `get_screenshot` with a path | Returns metadata JSON (name, category, tags — dataURL stripped) |
| 5 | Agent calls `transcribe_screenshot` with a path | Returns OCR text via macOS Vision framework |
| 6 | Agent calls `organize_screenshot` with a path | Returns queued status: `{ queued: true, filepath }` |
| 7 | Agent calls `open_in_snip` with a local file path | Snip opens the file in the annotation editor; call blocks until user finishes |
| 7a | -- | User annotates and saves | Returns file path to annotated image |
| 7b | -- | User presses Esc/cancels | Error returned to agent |
| 8 | Agent calls `install_extension` with manifest + code | Extension validated, approval dialog shown to user (uses direct socket) |
| 9 | Agent calls `render_diagram` with Mermaid code | Snip renders diagram to PNG, opens in editor; call blocks until user finishes annotating |
| 9a | -- | User annotates and saves | Returns file path to annotated diagram |
| 9b | -- | User cancels | Error returned to agent |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Path traversal in `get_screenshot` | `path.resolve` + `startsWith(screenshotsDir)` check rejects out-of-dir paths |
| `open_in_snip` with non-image file | Rejected by extension check (PNG/JPEG only) |
| `open_in_snip` with file > 15 MB | Rejected with size error before decoding |
| `render_diagram` with invalid Mermaid syntax | Error returned: "Mermaid syntax error: {details}" |
| `render_diagram` with unsupported format | Error returned: "Unsupported format: X" |
| `render_diagram` render timeout (> 30s) | Error returned: "Diagram rendering timed out" |
| Socket buffer overflow (> 16 MB message) | Connection closed |
| MCP tool called when category disabled | Returns error indicating tool is not enabled |
| Client sends Content-Length framing | Adapter auto-detects and responds with Content-Length framing |
| Client sends newline-delimited JSON | Adapter auto-detects and responds with newline-delimited JSON |

---

## 15. Diagram Rendering & Review Mode

### 15.1 Render Mermaid Diagram via CLI

**Preconditions:** Snip app running (or will auto-launch).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Agent pipes Mermaid code: `echo 'graph LR; A-->B-->C' \| snip render --format mermaid --message "Does this look right?"` | CLI reads stdin, sends `render_diagram` to socket |
| 2 | -- | Hidden BrowserWindow renders Mermaid to SVG, `capturePage()` captures as PNG |
| 3 | -- | Editor opens with rendered PNG in Review Mode |
| 4 | -- | Review panel at bottom shows agent's message, text input, Approve / Request Changes buttons |
| 5 | User reviews diagram, optionally annotates and/or types feedback | Annotations drawn on canvas, text entered in input |
| 6 | User clicks Approve or Request Changes | Structured result returned to CLI |
| 7 | -- | CLI outputs JSON: `{ "status": "approved", "edited": false, "path": "..." }` |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Invalid Mermaid syntax | Error returned immediately: "Mermaid syntax error: {details}" |
| Empty stdin | CLI exits 1: "empty input from stdin" |
| TTY stdin (no pipe) | CLI exits 1 with usage hint |
| `--format` omitted | Defaults to `mermaid` |
| Unsupported format | Error: "Unsupported format: X (supported: mermaid)" |
| Editor already busy | Error: "Editor is busy with another upload" |
| Rendering takes > 30s | Timeout error, diagram window destroyed |
| Diagram code > 100 KB | Error: "Diagram code too large" |

### 15.2 Review Mode (MCP Editor Sessions)

**Preconditions:** Editor opened via MCP (`open_in_snip` or `render_diagram`).

When the editor opens via an agent action, it enters Review Mode automatically. The toolbar Done/Save buttons become non-closing (copy/save for user's own use). Cancel is hidden. A review panel appears at the bottom.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Editor opens via MCP | Review panel appears at bottom with agent's context message (if provided) |
| 2 | -- | Toolbar: annotation tools available, Copy (tick) and Save are non-closing, Cancel hidden |
| 3a | User clicks **Approve** (or ⌘+Enter or Enter) | Returns `{ status: "approved", edited: false/true, path }` |
| 3b | User types text + clicks **Request Changes** | Returns `{ status: "changes_requested", edited: false/true, path, text: "..." }` |
| 3c | User annotates + clicks **Approve** | Returns `{ status: "approved", edited: true, path }` with annotations in the image |
| 3d | User annotates + types text + clicks **Request Changes** | Returns `{ status: "changes_requested", edited: true, path, text: "..." }` |
| 4 | -- | `message: "See annotations at path."` included only when `edited: true` |

**Keyboard shortcuts in Review Mode:**

| Key | Action |
|-----|--------|
| ⌘+Enter | Approve (includes text if typed) |
| Enter (not in text input) | Approve |
| Enter (in text input) | Request Changes with text |
| Esc (in text input) | Blur text input |
| Esc (not in input) | No-op (use buttons to finish) |

---

## 16. Extensions

### 16.1 Install User Extension from Folder

**Preconditions:** App running, Settings tab active, scrolled to "Extensions" section.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Install Extension from Folder…" | macOS folder picker dialog opens |
| 2 | Select a folder containing `extension.json` | Manifest is read and validated |
| 3 | -- | Approval dialog shows extension name, type, requested IPC channels (`ext:` prefixed), and permissions |
| 4 | Click "Allow" | Extension folder copied to `~/Library/Application Support/snip/extensions/<name>/` |
| 5 | -- | `extension-registry` loads extension, starts sandboxed child process via `extension-sandbox.js` |
| 6 | -- | Extension appears in the extensions list (name + type pill) |
| 7 | -- | Status label shows "Installed" briefly then fades |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Folder has no `extension.json` | Error: "No extension.json found" |
| Manifest has invalid type (e.g., `canvas-tool`) | Rejected — user extensions only allowed `action-tool` or `processor` |
| Extension channel missing `ext:` prefix | Rejected — user extension channels must be prefixed `ext:` |
| Extension name conflicts with existing | Error: name already installed |
| User clicks "Deny" in approval dialog | Installation cancelled, no files copied |

### 16.2 Uninstall User Extension

**Preconditions:** At least one user extension installed (§15.1).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Hover over an extension row in the list | Remove (trash) icon appears on the right |
| 2 | Click the remove icon | Confirmation or immediate removal |
| 3 | -- | Sandbox process for that extension killed |
| 4 | -- | Extension folder deleted from `~/Library/Application Support/snip/extensions/<name>/` |
| 5 | -- | Extension removed from the list |

### 16.3 Extension Sandbox Security

| Scenario | Expected Behavior |
|----------|------------------|
| Extension tries to `require('fs')` | Blocked — module allowlist rejects dangerous built-ins (`fs`, `net`, `child_process`, `http`, `https`, etc.) |
| Extension calls a non-`ext:`-prefixed IPC channel | Rejected by registry — user extensions can only handle `ext:*` channels |
| Extension tries to access core Snip IPC channels | Core handlers registered first; extension registration attempt for those channels silently skipped |
| Sandbox process crashes | Registry detects exit, marks extension as inactive, logs error |

---

## 16. CLI

### 16.1 Install CLI

**Preconditions:** App running, home window open, Settings tab active.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Scroll to "AI Workflow" section in Settings | "Install CLI" button visible |
| 2 | Click "Install CLI" | Shell wrapper written to first writable path: `/usr/local/bin/snip`, `~/.local/bin/snip`, or `~/bin/snip` |
| 3 | -- | Button changes to "CLI Installed ✓" (disabled/success state) |
| 4 | -- | Install path displayed (e.g., "Installed at /usr/local/bin/snip") |
| 5 | -- | If path is not in default `$PATH`, shows hint: "add to your shell: `export PATH=...`" |
| 6 | -- | AI Providers section appears below (see §17) |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| `/usr/local/bin` not writable | Falls back to `~/.local/bin/snip`, then `~/bin/snip` |
| All paths fail | Error message shown |
| CLI already installed but stale (points to moved binary) | Button shows "Update CLI" instead of "Install CLI" |
| CLI already installed and valid | Button shows "CLI Installed ✓" on page load |

### 16.2 Use CLI from Terminal

**Preconditions:** CLI installed (§16.1), Snip app running (or packaged app available for auto-launch).

| Command | Output |
|---------|--------|
| `snip search "login form"` | JSON array of matching screenshots with similarity scores |
| `snip list` | JSON array of all screenshot metadata |
| `snip get <filepath>` | JSON metadata for that screenshot (no dataURL) |
| `snip transcribe <filepath>` | Plain text (not JSON) — extracted OCR text |
| `snip organize <filepath>` | Human-readable message: "Queued for AI categorization: <path>" |
| `snip categories` | JSON array of category names |
| `snip open <filepath>` | Blocks until user finishes editing; returns JSON `{ status, path, message }` |
| `snip --help` or `snip -h` | Usage text with all commands and examples |
| `snip` (no args) | Same as `--help`, exits 0 |

**Flags:**

| Flag | Effect |
|------|--------|
| `--pretty` | Pretty-print JSON output (indented) |
| `--help`, `-h` | Show help text |

**Error handling:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Unknown command (e.g., `snip foobar`) | Exits 1, stderr: "Unknown command: foobar" + help text |
| Missing required argument (e.g., `snip search`) | Exits 1, stderr: "Missing argument for search" |
| Snip not running, no packaged app | Exits 1, stderr: "Snip is not running and could not be launched." |
| Server returns error | Exits 1, stderr: error message from server |
| Relative filepath argument | Resolved to absolute path before sending to server |

### 16.3 CLI Auto-Launch

**Preconditions:** CLI installed, Snip not running, `/Applications/Snip.app` exists.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Run any CLI command (e.g., `snip list`) | CLI attempts socket connection, gets ENOENT/ECONNREFUSED |
| 2 | -- | Detects `/Applications/Snip.app` exists |
| 3 | -- | Prints "Launching Snip..." to stderr |
| 4 | -- | Runs `open -a Snip` |
| 5 | -- | Polls for socket file every 500ms (up to 20 attempts = 10s) |
| 6 | -- | Socket appears, CLI retries the original command |
| 7 | -- | Command executes and returns result |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| No packaged app installed | Error: "Snip is not running. Start it with: npm start" |
| `SNIP_NO_AUTO_LAUNCH=1` env var set | Auto-launch disabled; immediate error if socket not found |
| Socket doesn't appear within 10s | Error: "Snip did not start in time" |
| Auto-launch succeeds but command fails | Error from the command itself (not the launch) |

### 16.4 Uninstall CLI

**Preconditions:** CLI installed (§16.1), Settings tab active.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "CLI Installed ✓" button | CLI wrapper removed from all candidate paths (`/usr/local/bin/snip`, `~/.local/bin/snip`, `~/bin/snip`) |
| 2 | -- | Button reverts to "Install CLI" |
| 3 | -- | AI Providers section hides |
| 4 | -- | Status message: "CLI removed" (auto-hides after 4s) |

---

## 17. AI Workflow Integration

### 17.1 Detect AI Providers

**Preconditions:** CLI installed (§16.1), Settings tab active.

After CLI installation, the app scans for installed AI coding tools and shows them in the AI Providers section.

| Provider | Detection Method |
|----------|-----------------|
| Claude Code | `~/.claude/CLAUDE.md` exists (or `~/.claude/` directory) |
| Cursor | `~/.cursor/` directory exists |
| Windsurf | `~/.windsurf/` directory exists |
| Cline | VS Code Cline extension directory exists |

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | CLI installed or Settings page loads with CLI already installed | App calls `detectAiProviders()` |
| 2 | -- | Each detected provider shown as a row with name and target config path |
| 3 | -- | For each provider, app calls `checkAiProviderStatus(id)` to determine if already configured |
| 4 | -- | Unconfigured providers show "Configure" button; configured providers show "Remove" button |

### 17.2 Configure AI Provider

**Preconditions:** Provider detected (§17.1), not yet configured.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Configure" on a provider row | Snip CLI instructions appended to provider's config file |
| 2 | -- | Claude Code: marker block added to `~/.claude/CLAUDE.md` with `snip` CLI usage instructions |
| 2a | -- | Cursor: rules written to `.cursorrules` file |
| 2b | -- | Windsurf: rules written to Windsurf config |
| 2c | -- | Cline: rules written to Cline config |
| 3 | -- | Button changes to "Remove" |
| 4 | -- | Status shows where config was written (e.g., "Added to ~/.claude/CLAUDE.md") |

**Edge cases:**

| Condition | Expected Behavior |
|-----------|-------------------|
| Config file doesn't exist yet | File created with Snip rules |
| Config file already has Snip marker block | Block replaced with updated content (idempotent) |
| Provider uninstalled between detect and configure | Error shown |

### 17.3 Remove AI Provider Configuration

**Preconditions:** Provider configured (§17.2).

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Remove" on a configured provider row | Snip marker block removed from provider's config file |
| 2 | -- | Button reverts to "Configure" |
| 3 | -- | Rest of config file preserved (only Snip block removed) |

---

## 18. Auto-Update

### 18.1 Update Available

**Preconditions:** Packaged app installed from DMG, internet connection, newer version published to GitHub Releases.

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | App launches | Auto-update check runs 10 seconds after startup |
| 2 | -- | Checks `latest-mac.yml` on GitHub Releases for newer version |
| 3 | -- | If newer version found: app brought to front, dialog shows "Snip X.Y.Z is available. Download?" |
| 4a | Click "Download" | ZIP downloads in background; no progress UI |
| 4b | Click "Later" (default) | Dialog dismissed; re-checks in 12 hours |
| 5 | Download complete | Dialog shows "Snip X.Y.Z has been downloaded. Restart now?" |
| 6a | Click "Restart Now" | App quits, replaces itself, relaunches with new version |
| 6b | Click "Later" (default) | Dialog dismissed; re-prompted on next check |

### 18.2 No Update Available

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | App launches, 10s passes | Checks GitHub Releases |
| 2 | -- | Current version matches latest |
| 3 | -- | Logs "[AutoUpdate] Up to date"; no dialog shown |
| 4 | -- | Re-checks every 12 hours silently |

### 18.3 Update Check Failures

| Condition | Expected Behavior |
|-----------|-------------------|
| No internet connection | Error logged; app continues normally; retries in 12h |
| GitHub API rate limited | Error logged; retries in 12h |
| `latest-mac.yml` missing from release | Error logged; auto-update silently disabled until next check |
| Code signature mismatch on downloaded ZIP | electron-updater rejects the update; error logged |
| App not packaged (dev mode) | Auto-updater not initialized (`app.isPackaged` guard) |
| User quits within 10s of launch | Timeout cleared in `will-quit` handler; no update check |
| Dialog open when 12h re-check fires | Re-check skipped (dialogOpen guard) |
| Download in progress when 12h re-check fires | Re-check skipped (isDownloading guard) |
