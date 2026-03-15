const path = require('path');
const fs = require('fs');
const { nativeImage, Notification } = require('electron');

let ctx = null;

function init(context) {
  ctx = context;
}

// ── Segmentation ──

async function checkSupport() {
  const { checkSupport } = require('../../main/segmentation/segmentation');
  return checkSupport();
}

async function segmentAtPoint(event, { points, cssWidth, cssHeight }) {
  const { generateMask } = require('../../main/segmentation/segmentation');
  const editorData = ctx.getEditorData();

  if (!editorData || !editorData.croppedDataURL) {
    throw new Error('No editor image available for segmentation');
  }

  // Decode the data URL to a buffer, then create nativeImage from buffer
  var dataURL = editorData.croppedDataURL;
  var base64Data = dataURL.replace(/^data:image\/\w+;base64,/, '');
  var imgBuffer = Buffer.from(base64Data, 'base64');
  const image = nativeImage.createFromBuffer(imgBuffer);
  let size = image.getSize();

  if (!size.width || !size.height) {
    throw new Error('Failed to decode editor image for segmentation');
  }

  // Resize to max 1024px on longest side (saves memory, SAM resizes internally anyway)
  const MAX_DIM = 1024;
  let resized = image;
  if (size.width > MAX_DIM || size.height > MAX_DIM) {
    const scale = MAX_DIM / Math.max(size.width, size.height);
    resized = image.resize({
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale)
    });
    size = resized.getSize();
  }

  // Convert BGRA bitmap to RGBA
  const bitmap = resized.toBitmap();
  const rgba = new Uint8Array(bitmap.length);
  for (let i = 0; i < bitmap.length; i += 4) {
    rgba[i] = bitmap[i + 2];
    rgba[i + 1] = bitmap[i + 1];
    rgba[i + 2] = bitmap[i];
    rgba[i + 3] = bitmap[i + 3];
  }

  return generateMask(rgba, size.width, size.height, points, cssWidth, cssHeight);
}

function warmUp() {
  const { warmUp } = require('../../main/segmentation/segmentation');
  warmUp();
}

function killWorker() {
  const { killWorker } = require('../../main/segmentation/segmentation');
  killWorker();
}

// ── Animation (downstream of segment cutout) ──

async function checkAnimateSupport() {
  const { checkSupport } = require('../../main/animation/animation');
  return checkSupport();
}

async function listPresets() {
  const { listPresets } = require('../../main/animation/animation');
  return listPresets();
}

async function generatePresets(event, { cutoutBase64 }) {
  try {
    const { generatePresets, listPresets } = require('../../main/animation/animation');
    var aiPresets = await generatePresets(cutoutBase64);
    if (aiPresets && aiPresets.length > 0) {
      new Notification({ title: 'Snip', body: 'AI presets ready — ' + aiPresets.length + ' animations suggested' }).show();
      return { source: 'ai', presets: aiPresets };
    }
    return { source: 'static', presets: listPresets() };
  } catch (err) {
    console.warn('[Animation] AI preset generation failed:', err.message);
    const { listPresets } = require('../../main/animation/animation');
    return { source: 'static', presets: listPresets() };
  }
}

async function animateCutout(event, { cutoutDataURL, presetName, options }) {
  const { generateAnimation } = require('../../main/animation/animation');

  var result = await generateAnimation(
    cutoutDataURL,
    presetName,
    options || { fps: 16, loops: 0 },
    function (progress) {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('animate-progress', progress);
      }
    }
  );

  new Notification({ title: 'Snip', body: 'GIF ready — ' + result.frameCount + ' frames generated' }).show();

  var gifB64 = Buffer.from(result.gifBuffer).toString('base64');
  var apngB64 = Buffer.from(result.apngBuffer).toString('base64');

  return {
    gifDataURL: 'data:image/gif;base64,' + gifB64,
    apngDataURL: 'data:image/png;base64,' + apngB64,
    gifBuffer: Array.from(result.gifBuffer),
    apngBuffer: Array.from(result.apngBuffer),
    frameCount: result.frameCount,
    width: result.width,
    height: result.height
  };
}

async function saveAnimation(event, { buffer, format, timestamp }) {
  const { getScreenshotsDir } = require('../../main/store');
  var screenshotsDir = getScreenshotsDir();
  var animationsDir = path.join(screenshotsDir, 'animations');
  fs.mkdirSync(animationsDir, { recursive: true });

  var ext = format === 'apng' ? 'png' : 'gif';
  var safeTimestamp = String(timestamp).replace(/[^a-zA-Z0-9_\-]/g, '_');
  var filename = safeTimestamp + '.' + ext;
  var filepath = path.join(animationsDir, filename);

  var buf = Buffer.from(buffer);
  fs.writeFileSync(filepath, buf);
  console.log('[Snip] Saved animation: animations/%s (%s KB)', filename, (buf.length / 1024).toFixed(1));

  return filepath;
}

module.exports = {
  init, checkSupport, segmentAtPoint, warmUp, killWorker,
  checkAnimateSupport, listPresets, generatePresets, animateCutout, saveAnimation
};
