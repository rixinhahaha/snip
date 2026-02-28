/**
 * Segmentation worker — runs SAM inference in an isolated child process
 * spawned with the system Node.js binary to avoid ONNX SIGTRAP in Electron's V8.
 */
const zlib = require('zlib');

let model = null;
let processor = null;
let envConfigured = false;

function encodeRGBAtoPNG(rgbaData, width, height) {
  const rowBytes = width * 4;
  const srcBuf = Buffer.from(rgbaData.buffer, rgbaData.byteOffset, rgbaData.byteLength);
  const filtered = Buffer.alloc(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + rowBytes)] = 0;
    srcBuf.copy(filtered, y * (1 + rowBytes) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const deflated = zlib.deflateSync(filtered);

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, checksum]);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 6;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, makeChunk('IHDR', ihdrData), makeChunk('IDAT', deflated), makeChunk('IEND', Buffer.alloc(0))]);
}

/**
 * Configure Transformers.js env for bundled models.
 * The parent process passes SNIP_MODELS_PATH and SNIP_PACKAGED via env.
 */
async function configureEnv() {
  if (envConfigured) return;
  envConfigured = true;
  const { env } = await import('@huggingface/transformers');
  if (process.env.SNIP_MODELS_PATH) {
    env.cacheDir = process.env.SNIP_MODELS_PATH;
    console.log('[Segmentation Worker] Model cache: ' + env.cacheDir);
  }
  if (process.env.SNIP_PACKAGED === '1') {
    env.allowRemoteModels = false;
    console.log('[Segmentation Worker] Remote downloads disabled (bundled)');
  }
}

async function loadModel() {
  if (model && processor) return { model, processor };
  await configureEnv();
  const { SamModel, AutoProcessor } = await import('@huggingface/transformers');
  console.log('[Segmentation Worker] Loading SlimSAM model...');
  model = await SamModel.from_pretrained('Xenova/slimsam-77-uniform');
  processor = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
  console.log('[Segmentation Worker] Model loaded');
  return { model, processor };
}

function isNearEdge(maskData, w, h, idx, thickness) {
  const x = idx % w;
  const y = Math.floor(idx / w);
  for (let dy = -thickness; dy <= thickness; dy++) {
    for (let dx = -thickness; dx <= thickness; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) return true;
      if (!maskData[ny * w + nx]) return true;
    }
  }
  return false;
}

async function generateMask(rgbaPixels, imgWidth, imgHeight, points, cssWidth, cssHeight) {
  const { RawImage } = await import('@huggingface/transformers');
  const { model: samModel, processor: samProcessor } = await loadModel();

  const rawImage = new RawImage(new Uint8ClampedArray(rgbaPixels), imgWidth, imgHeight, 4);

  const scaleX = imgWidth / cssWidth;
  const scaleY = imgHeight / cssHeight;
  const input_points = [points.map(p => [Math.round(p.x * scaleX), Math.round(p.y * scaleY)])];
  const input_labels = [points.map(p => p.label !== undefined ? p.label : 1)];

  const inputs = await samProcessor(rawImage, { input_points, input_labels });
  const outputs = await samModel(inputs);

  const masks = await samProcessor.post_process_masks(
    outputs.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes
  );

  const scores = outputs.iou_scores.data;
  let bestIdx = 0;
  for (let i = 1; i < 3; i++) {
    if (scores[i] > scores[bestIdx]) bestIdx = i;
  }

  const maskTensor = masks[0][0][bestIdx];
  const maskData = maskTensor.data;
  const h = imgHeight;
  const w = imgWidth;

  // Blue-tinted fill with diagonal-stripe marching-ants outline
  const maskRGBA = new Uint8ClampedArray(w * h * 4);
  const OUTLINE_THICKNESS = 2;

  for (let i = 0; i < w * h; i++) {
    if (maskData[i]) {
      // Check if this pixel is on the boundary
      if (isNearEdge(maskData, w, h, i, OUTLINE_THICKNESS)) {
        // Squiggly outline: alternate blue/white based on position for a dashed look
        const px = i % w;
        const py = Math.floor(i / w);
        // Create a diagonal stripe pattern for a "marching ants" / squiggly effect
        const stripe = ((px + py) % 8) < 4;
        if (stripe) {
          // Blue
          maskRGBA[i * 4] = 59;
          maskRGBA[i * 4 + 1] = 130;
          maskRGBA[i * 4 + 2] = 246;
          maskRGBA[i * 4 + 3] = 240;
        } else {
          // White
          maskRGBA[i * 4] = 255;
          maskRGBA[i * 4 + 1] = 255;
          maskRGBA[i * 4 + 2] = 255;
          maskRGBA[i * 4 + 3] = 240;
        }
      } else {
        // Interior fill: very subtle blue tint
        maskRGBA[i * 4] = 59;
        maskRGBA[i * 4 + 1] = 130;
        maskRGBA[i * 4 + 2] = 246;
        maskRGBA[i * 4 + 3] = 40;
      }
    }
  }

  // Create cutout (original pixels where mask is true)
  const cutoutRGBA = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (maskData[i]) {
      cutoutRGBA[i * 4] = rgbaPixels[i * 4];
      cutoutRGBA[i * 4 + 1] = rgbaPixels[i * 4 + 1];
      cutoutRGBA[i * 4 + 2] = rgbaPixels[i * 4 + 2];
      cutoutRGBA[i * 4 + 3] = 255;
    }
  }

  const maskPNG = encodeRGBAtoPNG(maskRGBA, w, h);
  const cutoutPNG = encodeRGBAtoPNG(cutoutRGBA, w, h);

  const maskDataURL = 'data:image/png;base64,' + maskPNG.toString('base64');
  const cutoutDataURL = 'data:image/png;base64,' + cutoutPNG.toString('base64');

  return {
    maskDataURL,
    cutoutDataURL,
    score: scores[bestIdx],
    width: w,
    height: h
  };
}

process.on('message', async (msg) => {
  if (msg.type === 'warm-up') {
    try {
      await loadModel();
      process.send({ type: 'warm-up-done' });
    } catch (err) {
      console.error('[Segmentation Worker] Warm-up failed:', err.message);
    }
    return;
  }
  if (msg.type === 'generate-mask') {
    try {
      const { rgbaBuffer, imgWidth, imgHeight, points, cssWidth, cssHeight } = msg;
      const result = await generateMask(
        new Uint8Array(rgbaBuffer),
        imgWidth, imgHeight,
        points,
        cssWidth, cssHeight
      );
      process.send({ id: msg.id, type: 'result', data: result });
    } catch (err) {
      console.error('[Segmentation Worker] Error:', err);
      process.send({ id: msg.id, type: 'error', error: err.message });
    }
  }
});

// Signal ready
process.send({ type: 'ready' });
