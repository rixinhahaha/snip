# Snip Design Language

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

### Solid Fallback (No Glass)

When the OS or renderer doesn't support `backdrop-filter`, translucent `rgba()` backgrounds look broken (washed out, unreadable). A `@supports not (backdrop-filter: blur(1px))` block in `theme.css` swaps all surfaces to opaque equivalents.

| Role | Dark solid | Light solid |
|------|-----------|-------------|
| **Body** | `#0a0a0a` | `#FBF8F2` (cream) |
| **Primary** | `#141414` | `#FFFDF9` |
| **Secondary** | `#121212` | `#F7F3EC` |
| **Elevated** | `#1e1e1e` | `#FFFFFF` |
| **Toolbar** | `#191919` | `#FFFDF9` |

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

---

## File Reference

All theme tokens live in `src/renderer/theme.css`. Component styles reference them via `var(--token-name)`. Never use hardcoded color values in component CSS — always use theme variables.

### Shared Utilities (`tool-utils.js`)

- `ToolUtils.getAccentColor()` — reads `--accent` from computed styles at runtime
- `ToolUtils.hexToRgba(hex, alpha)` — converts hex color to rgba string (used by rectangle highlight, segment markers, free-draw eraser)

These replace previously duplicated helper functions across tool files.
