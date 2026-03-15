# Marketing & Static Site Guide

> Role: **Marketer / Content Creator** — Static site maintenance, SEO standards, asset optimization, and marketing content production.

---

## Site Overview

The marketing site lives in `site/` and is hosted on GitHub Pages at [snipit.dev](https://snipit.dev).

| File | Purpose |
|------|---------|
| `site/index.html` | Landing page (all features, download CTA) |
| `site/guide.html` | Setup guide (permissions, AI, MCP) |
| `site/styles.css` | Shared styles |
| `site/script.js` | Download link (fetches latest release from GitHub API), sparkle canvas, scroll animations |
| `site/sitemap.xml` | Sitemap — update `lastmod` on every content change |
| `site/robots.txt` | Crawler rules |
| `site/CNAME` | Custom domain config (`snipit.dev`) |
| `site/assets/` | Images and videos |

---

## SEO Rules (Mandatory on Every Site Change)

**Every change to `site/index.html` or `site/guide.html` must update:**

1. **`<meta name="description">`** — reflects current feature set
2. **`<meta property="og:description">`** — 1-2 sentence hook for social sharing
3. **Structured data (`ld+json`)** — keep `featureList` and `softwareVersion` in sync with the app
4. **`sitemap.xml`** — update `lastmod` to today's date on any changed page

**Canonical URL rules (critical for Google Search Console):**
- `index.html` canonical: `https://snipit.dev/` ← **must include trailing slash** (GitHub Pages redirects bare domain to trailing-slash URL; mismatched canonical creates "Page with redirect" and "Alternate page with proper canonical tag" errors in GSC)
- `guide.html` canonical: `https://snipit.dev/guide` ← no trailing slash (directory-style URLs for inner pages)
- `og:url` must match the canonical exactly
- `ld+json "url"` must match the canonical exactly

**When adding a new feature:**
1. Add it to `featureList` in the `ld+json` block
2. Add it to `<meta name="description">` if major
3. Add a section in `index.html` with a `<section>`, `<h2>`, demo video/image, and `alt` text
4. Add it to `site/guide.html` if it requires user setup

---

## Asset Optimization Standards

**MANDATORY before committing any media to `site/assets/`.**

### Videos

Target: H.264, CRF 28, faststart, max 828px wide, no audio.

```bash
# Standard re-encode (portrait video, scale to 828px wide)
ffmpeg -y -i input.mp4 \
  -vf "scale=828:-2" \
  -c:v libx264 -crf 28 \
  -movflags +faststart \
  -an \
  output.mp4

# Landscape / wider video (scale to 960px wide)
ffmpeg -y -i input.mp4 \
  -vf "scale=960:-2" \
  -c:v libx264 -crf 28 \
  -movflags +faststart \
  -an \
  output.mp4
```

**Size budget per video:**
| Use | Max file size | Max width |
|-----|--------------|-----------|
| Hero demo (autoplay) | 1.5 MB | 720px |
| Feature demo (autoplay) | 600 KB | 828px |
| Guide walkthrough (controls) | 2 MB | 1080px |

**After encoding, verify:**
- moov atom before mdat (faststart): `ffprobe -v trace file.mp4 2>&1 | grep -E "'(moov|mdat)'"` → should be `moov` first
- Codec is H.264: `ffprobe -v quiet -show_streams -select_streams v:0 file.mp4 | grep codec_name`

### Images

Target: JPEG for photos/screenshots, PNG only for OG image and icons. Max width = display width.

```bash
# Resize + compress JPEG (use display width, not source width)
ffmpeg -y -i input.jpg -vf "scale=960:-2" -q:v 3 output.jpg

# For a 1200px wide image (search-view, etc.)
ffmpeg -y -i input.jpg -vf "scale=1200:-2" -q:v 3 output.jpg
```

**Size budget per image:**
| Type | Max file size | Width |
|------|--------------|-------|
| Feature screenshot | 150 KB | match display width |
| Hero poster (video fallback) | 150 KB | match video width |
| OG image | 100 KB | 1200×630 |
| Site icon | 50 KB | 512px |

**Never serve an image larger than its display width.** Check `<img width="...">` in the HTML and match.

### Audit command

```bash
# Quick size check for all assets
for f in site/assets/*; do
  size=$(stat -f%z "$f")
  printf "%-40s %8d bytes\n" "${f##*/}" "$size"
done
```

---

## Static Site: HTML Patterns

### Adding a Feature Section

```html
<section aria-labelledby="feature-id">
  <h2 id="feature-id">Feature Name</h2>
  <p>One-sentence description for SEO.</p>

  <!-- Video demo -->
  <video autoplay loop muted playsinline poster="assets/feature-poster.jpg">
    <source src="assets/feature-demo.mp4" type="video/mp4">
  </video>

  <!-- OR static image -->
  <img src="assets/feature.jpg" alt="Descriptive alt text" width="960" height="621" loading="lazy">
</section>
```

Rules:
- Every `<img>` needs `alt`, `width`, `height`, and `loading="lazy"`
- Every `<video>` needs `autoplay loop muted playsinline` and a `poster` attribute
- Every `<section>` needs `aria-labelledby` pointing to its `<h2>`

### Download Link

`script.js` fetches the latest release from `https://api.github.com/repos/rixinhahaha/snip/releases/latest` at runtime. The DMG download link is always up to date — **no manual version update needed** in the HTML when releasing.

---

## Marketing Content Library (`marketing/`)

All marketing assets live in `marketing/`. They are **not served to the web** — they're source files for generating images for social platforms.

### Instagram

| File | Format | Size | Platform Use |
|------|--------|------|-------------|
| `ig-square-1-hero.html` → `ig-square-1-hero.png` | 1080×1080 | Square post | Instagram feed |
| `ig-square-2-capture.html` → `ig-square-2-capture.png` | 1080×1080 | Square post | Instagram feed |
| `ig-square-3-annotate.html` → `ig-square-3-annotate.png` | 1080×1080 | Square post | Instagram feed |
| `ig-square-4-ai.html` → `ig-square-4-ai.png` | 1080×1080 | Square post | Instagram feed |
| `ig-square-5-search.html` → `ig-square-5-search.png` | 1080×1080 | Square post | Instagram feed |
| `ig-carousel-1-hero.html` → `ig-carousel-1-hero.png` | 1080×1080 | Carousel slide | Instagram carousel |
| `ig-feed-features.html` → `ig-feed-features.png` | 1080×1080 | Feature grid | Instagram feed |
| `ig-story-features.html` → `ig-story-features.png` | 1080×1920 | Story | Instagram Stories |
| `ig-square-*-small.png` | 500×500 approx | Compressed | Instagram web |

### ProductHunt

| File | Format | Size | Platform Use |
|------|--------|------|-------------|
| `ph-1-hero.html` | 1270×760 | Gallery image 1 | ProductHunt gallery |
| `ph-2-capture.html` | 1270×760 | Gallery image 2 | ProductHunt gallery |
| `ph-3-ai-organize.html` | 1270×760 | Gallery image 3 | ProductHunt gallery |
| `ph-4-search.html` | 1270×760 | Gallery image 4 | ProductHunt gallery |
| `ph-5-privacy.html` | 1270×760 | Gallery image 5 | ProductHunt gallery |

### Social Banners

| File | Format | Size | Platform Use |
|------|--------|------|-------------|
| `social/linkedin-banner.html` | 1584×396 | LinkedIn cover | LinkedIn page header |
| `social/facebook-banner.html` | 820×312 | Facebook cover | Facebook page header |

---

## Generating Marketing Images from HTML Templates

The `marketing/*.html` files are self-contained HTML canvases designed to be screenshotted at their exact body dimensions.

### Method 1: Browser Screenshot (Recommended)

1. Open the HTML file in Chrome/Safari
2. Open DevTools → set viewport to the canvas dimensions listed above
3. Screenshot at 1× DPI (not Retina) — or divide by 2 if on Retina

### Method 2: Puppeteer / Playwright

```bash
# Install puppeteer globally
npm install -g puppeteer

# Screenshot a file at exact dimensions
node -e "
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080 });
  await page.goto('file://$(pwd)/marketing/instagram/ig-square-1-hero.html');
  await page.screenshot({ path: 'marketing/instagram/ig-square-1-hero.png', fullPage: false });
  await browser.close();
})();
"
```

---

## Brand Consistency for Marketing

**Colors:**

| Role | Value | Use |
|------|-------|-----|
| Accent purple | `#a78bfa` (Violet 400) | Headlines, highlights in dark bg |
| Deep background | `#13101e` | Card/canvas backgrounds |
| White | `#ffffff` | Body text on dark bg |
| Muted white | `rgba(255,255,255,0.45)` | Subtitles, secondary text |
| Glow shadow | `rgba(139,92,246,0.3)` | Icon glow, button shadow |

**Typography:**
- Font: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif`
- Headline weight: 800
- Body weight: 400–500

**Terminology:** Always say "snip" not "screenshot". The app is "Snip". The capture action is "Snip and Annotate".

---

## Checklist: Releasing a New Feature (Marketing Side)

- [ ] Add feature to `featureList` in `index.html` ld+json
- [ ] Update `<meta name="description">` if major
- [ ] Add feature section to `index.html` with demo video/image
- [ ] Update `site/guide.html` if feature requires setup
- [ ] Update `sitemap.xml` `lastmod` dates
- [ ] Optimize any new media assets (CRF 28 video, JPEG resize)
- [ ] Update Instagram square posts if UI changed significantly
- [ ] Update ProductHunt gallery if adding a marquee feature
