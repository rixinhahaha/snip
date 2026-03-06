# Snip Design Language

> Role: **Designer** — Color palettes, component patterns, glass effects, and icon specs. This is the source of truth for all visual decisions.

---

## Philosophy

Snip uses a **Liquid Glass** aesthetic — translucent surfaces with subtle blur, specular highlights, and layered depth. The palette centers on **purple** as the primary accent, shifting between vibrant purple (dark mode) and softer lavender (light mode) for warmth and personality.

---

## Color Palette

### Dark Theme

| Role | Value | Usage |
|------|-------|-------|
| **Accent** | `#8B5CF6` (Violet 500) | Buttons, active states, focus rings, links |
| **Accent hover** | `#7C3AED` (Violet 600) | Button hover, pressed states |
| **Accent bg** | `rgba(139, 92, 246, 0.15)` | Active nav items, badges, subtle fills |
| **Accent active** | `rgba(139, 92, 246, 0.7)` | Pressed/active toolbar buttons |
| **Background primary** | `rgba(20, 20, 20, 0.75)` | Main content area |
| **Background secondary** | `rgba(18, 18, 18, 0.8)` | Sidebar |
| **Background elevated** | `rgba(40, 40, 40, 0.7)` | Cards, dropdowns, inputs |
| **Text primary** | `#e0e0e0` | Body text |
| **Text bright** | `#ffffff` | Headings, active labels |
| **Text muted** | `#555` | Placeholders, secondary info |
| **Toast processing** | `#C4B5FD` (Violet 300) | Loading/processing indicators |

### Light Theme

| Role | Value | Usage |
|------|-------|-------|
| **Accent** | `#7C3AED` (Violet 600) | Buttons, active states, focus rings |
| **Accent hover** | `#6D28D9` (Violet 700) | Button hover, pressed states |
| **Accent bg** | `rgba(124, 58, 237, 0.08)` | Active nav items, badges, subtle fills |
| **Background body** | `rgba(252, 250, 245, 0.9)` | Warm cream base |
| **Background primary** | `rgba(255, 253, 250, 0.7)` | Main content area (cream-tinted white) |
| **Background secondary** | `rgba(250, 247, 242, 0.8)` | Sidebar (warm off-white) |
| **Background elevated** | `rgba(255, 255, 255, 0.75)` | Cards, dropdowns |
| **Hover** | `rgba(139, 92, 246, 0.06)` | Hover states have a subtle violet tint |
| **Text primary** | `#1a1a1a` | Body text |
| **Text bright** | `#000000` | Headings, active labels |
| **Toast processing** | `#7C3AED` | Loading/processing indicators |

### Shared

| Role | Value |
|------|-------|
| **Success** | `#22c55e` (dark) / `#16a34a` (light) |
| **Error** | `#ef4444` (dark) / `#dc2626` (light) |
| **Error bg** | `rgba(239, 68, 68, 0.15)` (dark) / `rgba(220, 38, 38, 0.12)` (light) |
| **Accent glow** | `0 2px 8px rgba(139, 92, 246, 0.3)` (dark) / `0 2px 8px rgba(124, 58, 237, 0.3)` (light) |
| **Font** | Plus Jakarta Sans (variable weight 200-800) |

---

## App Icon

| Theme | Background | Scissors | Sparkles |
|-------|------------|----------|----------|
| **Dark** | `#0f0a1e` → `#1a1030` gradient | Blue-indigo gradient (`#93c5fd` → `#6366f1`) | Light blue (`#93c5fd`) |
| **Light** | Cream → lavender gradient (`#FBF5EE` → `#EDE5F8`) | Purple gradient (`#A78BFA` → `#6D28D9`) | Violet (`#8B5CF6`) |

Both icons use a squircle shape (`rx="22.5"` on a 100x100 viewBox).

---

## Glass Effects (Liquid Glass)

- **Blur**: 24px `backdrop-filter` on all translucent surfaces
- **Specular highlight**: Top edge `inset 0 1px 0 0` glow simulates light refraction
- **Shadows**: Multi-layer — outer shadow for depth + inner glow for glass edge
- **Borders**: Semi-transparent, never fully opaque

### Glass Theme

The **Glass** theme (`[data-theme="glass"]`) is a third theme option with lavender/purple-tinted translucent surfaces. It reveals the native `NSGlassEffectView` (macOS 26+) or vibrancy material through purple-tinted backgrounds. Uses light text (like Dark) but with a distinct violet palette.

| Role | Value | Usage |
|------|-------|-------|
| **Accent** | `#A78BFA` (Violet 400) | Lighter purple for glass contrast |
| **Accent hover** | `#8B5CF6` (Violet 500) | Hover/pressed states |
| **Background body** | `rgba(22, 10, 42, 0.24)` | Subtle deep-purple wash |
| **Background primary** | `rgba(22, 10, 42, 0.34)` | Main content area (readable tint) |
| **Background secondary** | `rgba(22, 10, 42, 0.44)` | Sidebar (strong structural tint) |
| **Background elevated** | `rgba(28, 14, 55, 0.42)` | Cards/panels (accent-tinted) |
| **Background toolbar** | `rgba(22, 10, 42, 0.40)` | Toolbar with strong tint |
| **Text primary** | `#f0eafa` | Bright lavender body text |
| **Text muted** | `#9a90b0` | Secondary labels (~4.2:1 contrast) |
| **Text bright** | `#ffffff` | Headings, active labels |

CSS `backdrop-filter` is disabled (`--glass-blur: 0px`) since the native glass/vibrancy layer handles blur. Enhanced specular highlights and purple-tinted borders provide visual contrast.

### Native Glass Layer (macOS 26+)

On macOS 26 (Tahoe) and later, `electron-liquid-glass` applies a native `NSGlassEffectView` behind the web content in both home and editor windows. This layer is always active regardless of theme — the Dark and Light themes have opaque enough backgrounds to cover it, while the Glass theme's translucent backgrounds reveal it.

**Fallback chain**: Native glass → `vibrancy: 'under-window'` → CSS `backdrop-filter` → solid opaque (no blur support).

### Solid Fallback (No Glass)

When the OS or renderer doesn't support `backdrop-filter`, translucent `rgba()` backgrounds look broken (washed out, unreadable). A `@supports not (backdrop-filter: blur(1px))` block in `theme.css` swaps all surfaces to opaque equivalents.

| Role | Dark solid | Light solid | Glass solid |
|------|-----------|-------------|-------------|
| **Body** | `#0a0a0a` | `#FBF8F2` (cream) | `#100c1c` (deep purple) |
| **Primary** | `#141414` | `#FFFDF9` | `#161128` |
| **Secondary** | `#121212` | `#F7F3EC` | `#1e1630` |
| **Elevated** | `#1e1e1e` | `#FFFFFF` | `#261e38` |
| **Toolbar** | `#191919` | `#FFFDF9` | `#1c1430` |

The fallback also:
- Sets `--glass-blur` to `0px`
- Reduces specular/inner-glow intensity (no blur = no refraction to simulate)
- Slightly increases border opacity for surface separation without blur
- Increases overlay opacity to compensate for missing blur dimming

**Design principle**: Solid fallback should look intentionally flat and clean, not like a broken glass theme. Think of it as a "matte" variant — same palette, same accent colors, just without translucency.

---

## Component Patterns

### Toolbar Buttons (Editor)

All toolbar buttons use a unified color system — no hardcoded colors.

| State | Icon Color | Background | Extra |
|-------|-----------|------------|-------|
| **Default** | `--text-secondary` | transparent | — |
| **Hover** | `--text-primary` | `--bg-hover-strong` | `box-shadow: var(--glass-inner-glow)` |
| **Active tool** | `white` | `--accent-active` | `box-shadow: var(--glass-inner-glow), var(--accent-glow)` |

Action buttons (Save, Done, etc.) follow the same default/hover pattern. Tooltips appear below buttons with `top: calc(100% + 6px)`, white text on dark background.

### Upscale Button + Dropdown (Editor)

The **Upscale** button sits in the action area (between Reset and Save). It uses `.action-btn.upscale` styling: `--bg-hover` background, `--text-secondary` icon. Click toggles a dropdown below with 2x/4x options.

**Dropdown** (`.upscale-dropdown`): glass panel with `--bg-toast` background, `--glass-specular` border, 10px radius. Options are full-width buttons; hover shows `--accent-bg` with `--accent` text.

**Disabled state** (`.upscale.disabled`): `opacity: 0.4; pointer-events: none`. Applied after upscale completes to prevent double-upscale.

**Progress overlay** (`.upscale-progress`): same pattern as animation progress — centered fixed panel, 260px wide, glass background, pulsing icon, text label, and accent-colored progress bar (4px track). Stages: "Loading model..." → "Upscaling..." → "Encoding result...".

### Fabric.js Selection Controls

Fabric object selection handles (borders, corners) use the theme accent color at canvas init time:

```js
var accent = ToolUtils.getAccentColor(); // reads --accent CSS variable
fabric.FabricObject.ownDefaults.borderColor = accent;
fabric.FabricObject.ownDefaults.cornerColor = accent;
```

This affects all canvas objects (rectangles, arrows, textboxes, blur images).

### Setting Up Your AI Assistant (Inline Overlay)

The setup wizard is an **inline overlay** (`#setup-overlay`) inside the home window — `position: fixed; inset: 0; z-index: 100`. Fully opaque per-theme backgrounds: dark `#111113`, light `#f5f3ef`, glass `rgba(20,20,24,0.92)` with 40px backdrop blur.

**Three views** (one visible at a time):

1. **Steps view** — centered header (purple SVG magic wand icon with sparkle accents, title, subtitle) with 3 step cards. Step cards: `--bg-elevated` with `--border-card`, 12px radius. Numbered indicators (28px circles): pending (default border), active (`--accent` border/bg), done (`--success` bg with white checkmark). Action areas per step contain buttons, progress bars, or spinner.

2. **Welcome view** — large purple SVG magic wand (64px, filled at 15% opacity, `setup-pop-in` animation: scale 0.5→1 with bounce easing), "Welcome to Snip" title (24px, 700 weight), accent glow button (`box-shadow: 0 0 20px rgba(139,92,246,0.4)`).

3. **Failed view** — muted SVG magic wand icon (`--text-muted` stroke), "Snip works great without AI too" title, description text, two buttons (primary "Continue without AI" + secondary "Try again").

**Sparkle particles** (`#setup-sparkles`): Randomly positioned divs with `sparkle-float` keyframe (opacity 0 → 0.8 → 0, translateY upward, scale 0.5→1.2). Two shapes: circles (`border-radius: 50%`) and 4-point stars (`clip-path: polygon(...)`). Color: `var(--accent)`. Spawned every ~400ms during welcome screen; burst of 30 on transition to welcome.

- **Progress bar**: 5px track in `--bg-tertiary` with accent gradient fill (`linear-gradient(90deg, --accent, --accent-hover)`) and subtle purple glow (`box-shadow: 0 0 8px rgba(139,92,246,0.3)`).
- **Error state**: flex row with `--error-bg` background, error text in `--error`, retry button with `--error` border.
- **Screen transitions**: `setup-fade-in` keyframe (opacity 0→1, translateY 10px→0, 0.35s ease).

**Settings page** (when overlay is not showing):
- **Current model card** (ready state): `--bg-elevated` with `--border-card`, 10px radius. Shows "Active Model" uppercase label, large bold model name, and circular info button.
- **Info tooltip**: Per-theme backgrounds (dark: `rgba(30,30,30,0.95)`, light: `rgba(255,255,255,0.95)`, glass: `rgba(15,8,30,0.90)` with backdrop blur). Positioned below card, `z-index: 20`. Contains a specs table with label column in `--text-secondary` and value column in `--text-primary`.

### Buttons
- **Primary**: Solid accent fill, white text, rounded corners (8px)
- **Secondary**: Transparent with subtle border, text in dim color
- **Icon buttons**: 32px square, 6px radius, transparent bg with border

### Cards
- Elevated background, 10px radius, 1px border
- Hover: accent-colored border, slight translateY(-2px) lift, card shadow

### Tags/Chips
- Pill shape (14px radius), small font (11px), border + transparent bg
- Active state: accent border + accent-bg fill + accent text

### Inputs
- Transparent background with subtle border
- Focus: accent-colored border

### 2GIF Button & Panels
- **2GIF button**: Fixed bottom-center, accent background, white bold text, accent glow shadow. Scale(1.05) on hover.
- **Preset panel**: Fixed bottom-center, 340px wide, glass background with backdrop blur, 14px radius. Contains a 2-column grid of preset buttons + custom prompt section below.
- **Preset buttons**: `--bg-input` background, `--border-input` border, 10px radius. Hover: accent-bg fill with accent border and glow. Each button has an emoji icon + bold label row on top, small description text below.
- **Custom prompt section**: Divider line with "or describe your own" text centered between two lines, then a flex row containing a text input (8px radius, `--bg-input` fill, accent border on focus) + accent-filled go button (34×34px, 8px radius, arrow icon).
- **Result panel**: Same glass panel as preset picker. Contains GIF preview (max 200px, 8px radius) + action buttons row.
- **Action buttons**: accent-filled for Save GIF/APNG, input-filled for Copy GIF. Standard `--text-secondary` cancel link for Done.

### Animation Settings (home.css)
The Settings page "Animation" section uses `animation-api-key-*` CSS classes:
- **`.animation-api-key-row`**: Flex column layout, 8px gap. Contains the label, input group, status, and help text.
- **`.animation-api-key-label`**: 12px font, 500 weight, `--text-secondary` color.
- **`.animation-api-key-input-group`**: Flex row with 8px gap for the input field, toggle, and save button.
- **`.animation-api-key-input`**: Flex-grow password input, `--bg-input` background, `--border-input` border, 8px radius. Focus state: `--accent` border.
- **`.animation-api-key-toggle`**: Eye icon button to show/hide API key.
- **`.animation-api-key-save`**: Save button with `--accent` background.
- **`.animation-api-key-status`**: 12px status text. `.saved` variant uses `--success` color. `.error` variant uses `--error` color.
- **`.animation-api-key-help`**: 12px help text in `--text-dim`, contains "Get API Key" link.

### Shortcut Key Display & Edit Button (home.css)

The Settings page shows keyboard shortcuts with a key display span and, for configurable global shortcuts, a pencil edit button:

**Key display (`.shortcut-row-key`):**

| State | Border | Background | Text | Extra |
|-------|--------|------------|------|-------|
| **Default** | `--kbd-border` | `--kbd-bg` | `--kbd-text` | — |
| **Recording** | `--accent` | `--accent-bg` | `--accent` | Pulsing border animation, text shows "Press key…" (global shortcuts only) |
| **Conflict** | `--error` | `--error-bg` | `--error` | Error message replaces key text |
| **Read-only** | `--kbd-border` | `--kbd-bg` | `--kbd-text` | `opacity: 0.6`, non-interactive (tool + OS shortcuts) |

**Edit button (`.shortcut-edit-btn`):**

| State | Border | Background | Color | Extra |
|-------|--------|------------|-------|-------|
| **Default** | `--border-card` | transparent | `--text-secondary` | Only shown on configurable rows |
| **Hover** | `--accent` | `--bg-hover` | `--accent` | — |
| **Recording** | `--accent` | `--accent-bg` | `--accent` | Matches key display recording state |

### Search Result Cards (home.css)
Search results use overlay-style cards with hardcoded colors (intentional — overlays sit on top of image content, not app background):
- **`.search-result-card`**: `position: relative`, `border-radius: 10px`, `overflow: hidden`. Fixed 220px row height.
- **`.search-result-thumbnail`**: Fills entire card (`width: 100%; height: 100%`), `object-fit: cover`.
- **`.search-result-info`**: Absolute-positioned overlay at bottom with gradient (`transparent` → `rgba(0,0,0,0.75)`).
- **`.search-result-name`**: White text, 12px, 500 weight.
- **`.search-result-category`**: Purple pill badge (`rgba(139,92,246,0.3)` background, `#c4b5fd` text).
- **`.search-result-score`**: Match percentage pill (`rgba(255,255,255,0.15)` background, `rgba(255,255,255,0.7)` text).

### Floating Toast (Main Process)

A small borderless `BrowserWindow` that appears top-center after copy/save actions and auto-dismisses. Created in `ipc-handlers.js` via `showFloatingToast()`, triggered by the `show-notification` IPC channel.

| Property | Dark | Light | Glass |
|----------|------|-------|-------|
| **Background** | `rgba(20,20,20,0.7)` | `rgba(255,253,250,0.85)` | `rgba(22,10,42,0.75)` |
| **Text** | `#e0e0e0` | `#1a1a1a` | `#f0eafa` |
| **Checkmark** | `#8B5CF6` | `#7C3AED` | `#A78BFA` |
| **Border** | `rgba(255,255,255,0.08)` | `rgba(124,58,237,0.15)` | `rgba(167,139,250,0.25)` |
| **Blur** | 24px | 24px | 0px (native glass) |

Animation: fade-in (0.25s ease, translateY -6→0), fade-out (0.3s ease after 1.1s delay). Window is `focusable: false`, `ignoreMouseEvents: true`, auto-destroyed after 1.6s. Size: 260×48px.

---

## File Reference

All theme tokens live in `src/renderer/theme.css`. Component styles reference them via `var(--token-name)`. Never use hardcoded color values in component CSS — always use theme variables.

### Shared Utilities (`tool-utils.js`)

- `ToolUtils.getAccentColor()` — reads `--accent` from computed styles at runtime
- `ToolUtils.hexToRgba(hex, alpha)` — converts hex color to rgba string (used by rectangle highlight, segment markers, free-draw eraser)

These replace previously duplicated helper functions across tool files.
