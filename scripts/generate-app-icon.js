/**
 * generate-app-icon.js
 * Generates assets/icon.png (1024×1024) and assets/icon.icns using
 * the same scissors geometry as the tray icon, styled with a dark
 * gradient background and blue-indigo gradient scissors.
 *
 * Usage: node scripts/generate-app-icon.js
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SIZE = 1024;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// ── Squircle clip — transparent corners to match macOS icon shape ─────────────
{
  const R = SIZE * 0.2248; // ~22.5% radius approximates macOS squircle
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(0, 0, SIZE, SIZE, R);
  } else {
    // Fallback for older canvas builds
    ctx.moveTo(R, 0);
    ctx.lineTo(SIZE - R, 0); ctx.arcTo(SIZE, 0, SIZE, R, R);
    ctx.lineTo(SIZE, SIZE - R); ctx.arcTo(SIZE, SIZE, SIZE - R, SIZE, R);
    ctx.lineTo(R, SIZE); ctx.arcTo(0, SIZE, 0, SIZE - R, R);
    ctx.lineTo(0, R); ctx.arcTo(0, 0, R, 0, R);
    ctx.closePath();
  }
  ctx.clip();
}

// ── Background ────────────────────────────────────────────────────────────────
const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
bg.addColorStop(0,   '#0f0a1e');
bg.addColorStop(0.5, '#1a1030');
bg.addColorStop(1,   '#0d0818');
ctx.fillStyle = bg;
ctx.fillRect(0, 0, SIZE, SIZE);

// Subtle indigo radial glow in centre
const glow = ctx.createRadialGradient(SIZE / 2, SIZE * 0.42, 0, SIZE / 2, SIZE * 0.42, SIZE * 0.52);
glow.addColorStop(0,   'rgba(99,102,241,0.28)');
glow.addColorStop(0.5, 'rgba(59,130,246,0.10)');
glow.addColorStop(1,   'rgba(0,0,0,0)');
ctx.fillStyle = glow;
ctx.fillRect(0, 0, SIZE, SIZE);

// ── Shared gradients ──────────────────────────────────────────────────────────
// Blade gradient (blue → indigo)
const bladeGrad = ctx.createLinearGradient(0, -280, 0, 180);
bladeGrad.addColorStop(0,   '#93c5fd');
bladeGrad.addColorStop(0.5, '#3b82f6');
bladeGrad.addColorStop(1,   '#6366f1');

// Handle gradient
const handleGrad = ctx.createLinearGradient(-60, -60, 60, 60);
handleGrad.addColorStop(0, '#818cf8');
handleGrad.addColorStop(1, '#6366f1');

// ── Draw helpers ──────────────────────────────────────────────────────────────
function drawBlade(angle) {
  ctx.save();
  ctx.rotate(angle);

  const pivotW = 30;   // half-width at pivot
  const tipW   = 7;    // half-width at tip
  const tipY   = -290; // tip distance above pivot

  ctx.beginPath();
  ctx.moveTo(-pivotW, 0);
  ctx.bezierCurveTo(-pivotW - 6, -100, -tipW - 4, -200, -tipW, tipY);
  ctx.lineTo(tipW, tipY);
  ctx.bezierCurveTo(tipW + 4, -200, pivotW + 6, -100, pivotW, 0);
  ctx.closePath();
  ctx.fillStyle = bladeGrad;
  ctx.fill();

  // Edge highlight
  ctx.beginPath();
  ctx.moveTo(-pivotW, 0);
  ctx.bezierCurveTo(-pivotW - 6, -100, -tipW - 4, -200, -tipW, tipY);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Central shine
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.bezierCurveTo(-2, -120, 0, -210, 0, tipY + 10);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.restore();
}

function drawHandle(angle) {
  ctx.save();
  ctx.rotate(angle);

  // Outer ring
  ctx.beginPath();
  ctx.ellipse(0, 180, 94, 116, 0, 0, Math.PI * 2);
  ctx.strokeStyle = handleGrad;
  ctx.lineWidth = 28;
  ctx.stroke();

  // Inner subtle fill
  ctx.beginPath();
  ctx.ellipse(0, 180, 66, 88, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(99,102,241,0.12)';
  ctx.fill();

  // Inner rim highlight
  ctx.beginPath();
  ctx.ellipse(-10, 162, 34, 42, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.restore();
}

// ── Main scissors ─────────────────────────────────────────────────────────────
ctx.save();
ctx.translate(SIZE / 2, SIZE * 0.52);
ctx.rotate(-15 * Math.PI / 180);

const SPREAD = 20 * Math.PI / 180;

// Draw handles first (below blades in z-order)
drawHandle( SPREAD);
drawHandle(-SPREAD);

// Draw blades
drawBlade( SPREAD);
drawBlade(-SPREAD);

// Pivot circle (on top)
ctx.beginPath();
ctx.arc(0, 0, 38, 0, Math.PI * 2);
ctx.fillStyle = handleGrad;
ctx.fill();
ctx.strokeStyle = 'rgba(255,255,255,0.25)';
ctx.lineWidth = 5;
ctx.stroke();

// Pivot inner highlight
ctx.beginPath();
ctx.arc(-4, -5, 14, 0, Math.PI * 2);
ctx.fillStyle = 'rgba(255,255,255,0.32)';
ctx.fill();

ctx.restore();

// ── Sparkle decorations ───────────────────────────────────────────────────────
function drawStar(x, y, r, opacity) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#93c5fd';
  ctx.globalAlpha = opacity;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.bezierCurveTo( r * 0.15, -r * 0.32,  r * 0.32, -r * 0.15,  r,  0);
  ctx.bezierCurveTo( r * 0.32,  r * 0.15,  r * 0.15,  r * 0.32,  0,  r);
  ctx.bezierCurveTo(-r * 0.15,  r * 0.32, -r * 0.32,  r * 0.15, -r,  0);
  ctx.bezierCurveTo(-r * 0.32, -r * 0.15, -r * 0.15, -r * 0.32,  0, -r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

drawStar(220, 200, 22, 0.70);
drawStar(800, 240, 18, 0.60);
drawStar(180, 600, 14, 0.50);
drawStar(840, 700, 12, 0.45);

// Bright tip sparkle (where blades cross near top)
drawStar(430, 145, 30, 0.90);
ctx.save();
ctx.beginPath();
ctx.arc(430, 145, 42, 0, Math.PI * 2);
const sparkGlow = ctx.createRadialGradient(430, 145, 0, 430, 145, 42);
sparkGlow.addColorStop(0,   'rgba(255,255,255,0.85)');
sparkGlow.addColorStop(0.4, 'rgba(147,197,253,0.35)');
sparkGlow.addColorStop(1,   'rgba(0,0,0,0)');
ctx.fillStyle = sparkGlow;
ctx.fill();
ctx.restore();

// Secondary sparkle
drawStar(590, 175, 20, 0.65);
ctx.save();
ctx.beginPath();
ctx.arc(590, 175, 24, 0, Math.PI * 2);
const sg2 = ctx.createRadialGradient(590, 175, 0, 590, 175, 24);
sg2.addColorStop(0, 'rgba(255,255,255,0.7)');
sg2.addColorStop(1, 'rgba(0,0,0,0)');
ctx.fillStyle = sg2;
ctx.fill();
ctx.restore();

// Small dot sparkles
const dots = [
  [300, 250, 3.5], [720, 200, 3], [160, 450, 2.5],
  [860, 500, 3  ], [400, 140, 3.5], [620, 180, 2.5],
  [250, 150, 2.5], [770, 160, 2  ], [140, 320, 2  ],
  [880, 380, 2.5], [200, 750, 2  ], [830, 820, 2  ],
];
dots.forEach(([x, y, r]) => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.globalAlpha = 0.50;
  ctx.fill();
  ctx.restore();
});

// ── Save PNG ──────────────────────────────────────────────────────────────────
const assetsDir = path.join(__dirname, '..', 'assets');
const pngOut    = path.join(assetsDir, 'icon.png');
fs.writeFileSync(pngOut, canvas.toBuffer('image/png'));
console.log('✓ Wrote', pngOut);

// ── Generate .icns via macOS sips + iconutil ──────────────────────────────────
const iconset = path.join(__dirname, 'icon.iconset');
fs.mkdirSync(iconset, { recursive: true });

// iconutil expects these exact filenames
const sizes = [16, 32, 128, 256, 512];
sizes.forEach(s => {
  const name1x = path.join(iconset, `icon_${s}x${s}.png`);
  const name2x = path.join(iconset, `icon_${s}x${s}@2x.png`);
  execSync(`/usr/bin/sips -z ${s} ${s} "${pngOut}" --out "${name1x}" > /dev/null 2>&1`);
  execSync(`/usr/bin/sips -z ${s * 2} ${s * 2} "${pngOut}" --out "${name2x}" > /dev/null 2>&1`);
});
// 1024×1024 only has a @2x variant in the iconset
execSync(`/usr/bin/sips -z 1024 1024 "${pngOut}" --out "${path.join(iconset, 'icon_512x512@2x.png')}" > /dev/null 2>&1`);

const icnsOut = path.join(assetsDir, 'icon.icns');
execSync(`/usr/bin/iconutil -c icns "${iconset}" -o "${icnsOut}"`);

// Clean up temporary iconset dir
fs.rmSync(iconset, { recursive: true, force: true });
console.log('✓ Wrote', icnsOut);
console.log('\nDone! Quit and relaunch the app to see the updated dock icon.');
