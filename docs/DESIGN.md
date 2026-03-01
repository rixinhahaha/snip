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
| **Background body** | `rgba(25, 12, 50, 0.18)` | Subtle deep-purple wash |
| **Background primary** | `rgba(30, 15, 60, 0.25)` | Main content area (readable tint) |
| **Background secondary** | `rgba(25, 12, 50, 0.38)` | Sidebar (strong structural tint) |
| **Background elevated** | `rgba(40, 20, 80, 0.30)` | Cards/panels (accent-tinted) |
| **Background toolbar** | `rgba(25, 12, 50, 0.35)` | Toolbar with strong tint |
| **Text primary** | `#f0eafa` | Bright lavender body text |
| **Text bright** | `#ffffff` | Headings, active labels |

CSS `backdrop-filter` is disabled (`--glass-blur: 0px`) since the native glass/vibrancy layer handles blur. Enhanced specular highlights and purple-tinted borders provide visual contrast.

### Native Glass Layer (macOS 26+)

On macOS 26 (Tahoe) and later, `electron-liquid-glass` applies a native `NSGlassEffectView` behind the web content in both home and editor windows. This layer is always active regardless of theme — the Dark and Light themes have opaque enough backgrounds to cover it, while the Glass theme's translucent backgrounds reveal it.

**Fallback chain**: Native glass → `vibrancy: 'under-window'` → CSS `backdrop-filter` → solid opaque (no blur support).

### Solid Fallback (No Glass)

When the OS or renderer doesn't support `backdrop-filter`, translucent `rgba()` backgrounds look broken (washed out, unreadable). A `@supports not (backdrop-filter: blur(1px))` block in `theme.css` swaps all surfaces to opaque equivalents.

| Role | Dark solid | Light solid | Glass solid |
|------|-----------|-------------|-------------|
| **Body** | `#0a0a0a` | `#FBF8F2` (cream) | `#0e0a18` (deep purple) |
| **Primary** | `#141414` | `#FFFDF9` | `#140f20` |
| **Secondary** | `#121212` | `#F7F3EC` | `#1a1428` |
| **Elevated** | `#1e1e1e` | `#FFFFFF` | `#221a30` |
| **Toolbar** | `#191919` | `#FFFDF9` | `#181228` |

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

### Fabric.js Selection Controls

Fabric object selection handles (borders, corners) use the theme accent color at canvas init time:

```js
var accent = ToolUtils.getAccentColor(); // reads --accent CSS variable
fabric.FabricObject.ownDefaults.borderColor = accent;
fabric.FabricObject.ownDefaults.cornerColor = accent;
```

This affects all canvas objects (rectangles, arrows, textboxes, blur images).

### AI Assistant Settings (Model Card)

The settings page "AI Assistant" section uses:

- **Current model card**: `--bg-elevated` with `--border-card`, 10px radius. Shows "Active Model" uppercase label, large bold model name, and circular info button.
- **Info tooltip**: Per-theme backgrounds (dark: `rgba(30,30,30,0.95)`, light: `rgba(255,255,255,0.95)`, glass: `rgba(15,8,30,0.85)` with backdrop blur). Positioned below card, `z-index: 20`. Contains a specs table with label column in `--text-secondary` and value column in `--text-primary`.

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
The Settings page "Animation" section uses `fal-api-*` CSS classes:
- **`.fal-api-key-row`**: Flex column layout, 8px gap. Contains the label, input group, status, and hint.
- **`.fal-api-label`**: 12px font, 500 weight, `--text-secondary` color.
- **`.fal-api-input-group`**: Flex row with 8px gap for the input field and save button.
- **`.fal-api-input`**: Flex-grow text input, `--bg-input` background, `--border-input` border, 8px radius. Focus state: `--accent` border.
- **`.fal-api-status`**: 12px status text. `.saved` variant uses `--success` color. `.error` variant uses `--error` color.
- **`.fal-api-hint`**: 12px hint text in `--text-dim`, contains "Get API Key" link.

---

## File Reference

All theme tokens live in `src/renderer/theme.css`. Component styles reference them via `var(--token-name)`. Never use hardcoded color values in component CSS — always use theme variables.

### Shared Utilities (`tool-utils.js`)

- `ToolUtils.getAccentColor()` — reads `--accent` from computed styles at runtime
- `ToolUtils.hexToRgba(hex, alpha)` — converts hex color to rgba string (used by rectangle highlight, segment markers, free-draw eraser)

These replace previously duplicated helper functions across tool files.
