/**
 * Upscaler worker — runs image upscaling in an isolated child process
 * using Transformers.js pipeline('image-to-image') with Swin2SR (2x)
 * or APISR (4x) models.
 *
 * Spawned with system Node.js binary (not Electron's) because ONNX
 * runtime crashes inside Electron's V8.
 */
const zlib = require('zlib');

let pipeline2x = null;
let pipeline4x = null;
let envConfigured = false;

const MODEL_2X = 'Xenova/swin2SR-lightweight-x2-64';
const MODEL_4X = 'Xenova/4x_APISR_GRL_GAN_generator-onnx';

/**
 * Configure Transformers.js env for bundled models.
 */
async function configureEnv() {
  if (envConfigured) return;
  envConfigured = true;
  const { env } = await import('@huggingface/transformers');
  if (process.env.SNIP_MODELS_PATH) {
    env.cacheDir = process.env.SNIP_MODELS_PATH;
    console.log('[Upscaler Worker] Model cache: ' + env.cacheDir);
  }
  if (process.env.SNIP_PACKAGED === '1') {
    env.allowRemoteModels = false;
    console.log('[Upscaler Worker] Remote downloads disabled (bundled)');
  }
}

async function getPipeline(scale) {
  await configureEnv();
  const { pipeline } = await import('@huggingface/transformers');

  if (scale === 4) {
    if (!pipeline4x) {
      console.log('[Upscaler Worker] Loading 4x model...');
      pipeline4x = await pipeline('image-to-image', MODEL_4X);
      console.log('[Upscaler Worker] 4x model loaded');
    }
    return pipeline4x;
  } else {
    if (!pipeline2x) {
      console.log('[Upscaler Worker] Loading 2x model...');
      pipeline2x = await pipeline('image-to-image', MODEL_2X);
      console.log('[Upscaler Worker] 2x model loaded');
    }
    return pipeline2x;
  }
}

/**
 * Encode RGBA pixel data to a minimal PNG buffer (same approach as segmentation worker).
 */
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

async function upscaleImage(imageBase64, scale) {
  const pipe = await getPipeline(scale);

  // Send progress: model loaded, starting inference
  process.send({ type: 'progress', stage: 'inferencing', percent: 30 });

  const result = await pipe(imageBase64);

  process.send({ type: 'progress', stage: 'encoding', percent: 80 });

  // result is a RawImage — extract pixel data
  const { RawImage } = await import('@huggingface/transformers');
  let outputImage;
  if (result instanceof RawImage) {
    outputImage = result;
  } else if (result.image) {
    outputImage = result.image;
  } else {
    outputImage = result;
  }

  // Convert RawImage pixel data to PNG via manual encoding (Node.js has no DOM Blob)
  const w = outputImage.width;
  const h = outputImage.height;
  const channels = outputImage.channels;

  // Ensure RGBA (some models output RGB without alpha)
  let rgba;
  if (channels === 3) {
    rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = outputImage.data[i * 3];
      rgba[i * 4 + 1] = outputImage.data[i * 3 + 1];
      rgba[i * 4 + 2] = outputImage.data[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    rgba = new Uint8ClampedArray(outputImage.data);
  }

  const pngBuf = encodeRGBAtoPNG(rgba, w, h);
  const dataURL = 'data:image/png;base64,' + pngBuf.toString('base64');

  return { dataURL, width: w, height: h };
}

process.on('message', async (msg) => {
  if (msg.type === 'upscale') {
    try {
      process.send({ type: 'progress', stage: 'loading', percent: 10 });

      const result = await upscaleImage(msg.imageBase64, msg.scale);

      process.send({ type: 'progress', stage: 'done', percent: 100 });
      process.send({ id: msg.id, type: 'result', data: result });
    } catch (err) {
      console.error('[Upscaler Worker] Error:', err);
      process.send({ id: msg.id, type: 'error', error: err.message });
    }
  }
});

// Signal ready
process.send({ type: 'ready' });
