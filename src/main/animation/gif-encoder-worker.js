/**
 * GIF encoder worker — extracts frames from an MP4 file using ffmpeg-static
 * and encodes them as GIF (gifenc) + APNG (upng-js).
 *
 * Runs as a child process forked from the main animation module.
 * Receives: { type: 'encode', mp4Path, fps, loops, maxDuration, useChromaKey }
 * Sends:    { type: 'progress', data: { frame, totalFrames } }
 *           { type: 'result', data: { gifBuffer, apngBuffer, frameCount, width, height } }
 *           { type: 'error', error: string }
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');

/**
 * Get the ffmpeg binary path. In packaged app, it may be in Resources.
 */
function getFfmpegPath() {
  try {
    return require('ffmpeg-static');
  } catch (_) {
    // Packaged app fallback
    var resourcesPath = process.env.SNIP_RESOURCES_PATH || path.join(__dirname, '..', '..', '..');
    return path.join(resourcesPath, 'ffmpeg');
  }
}

/**
 * Extract frames from MP4 using ffmpeg. Returns array of PNG buffers.
 */
function extractFrames(mp4Path, fps, maxDuration) {
  return new Promise(function(resolve, reject) {
    var ffmpeg = getFfmpegPath();
    var tmpDir = path.join(os.tmpdir(), 'snip-frames-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    // Build ffmpeg args: extract frames as raw RGBA
    var args = [
      '-i', mp4Path,
      '-t', String(maxDuration || 3),           // Trim to maxDuration seconds
      '-vf', 'fps=' + (fps || 16) + ',scale=-1:-1',  // Target FPS
      '-pix_fmt', 'rgba',                        // Output as RGBA
      '-f', 'rawvideo',                          // Raw video output
      '-v', 'error',                             // Quiet
      'pipe:1'                                    // Output to stdout
    ];

    // First, get video dimensions
    var probeArgs = [
      '-i', mp4Path,
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      '-f', 'null', '-'
    ];

    // Use ffprobe-like approach: extract one frame to get dimensions
    var dimArgs = [
      '-i', mp4Path,
      '-vframes', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      '-v', 'error',
      'pipe:1'
    ];

    var dimProc = child_process.spawn(ffmpeg, dimArgs);
    var dimChunks = [];
    dimProc.stdout.on('data', function(chunk) { dimChunks.push(chunk); });
    dimProc.on('close', function() {
      // Parse PNG to get dimensions
      var pngBuf = Buffer.concat(dimChunks);
      if (pngBuf.length < 24) {
        return reject(new Error('Failed to read video dimensions'));
      }

      // PNG header: width at offset 16 (4 bytes BE), height at offset 20 (4 bytes BE)
      var width = pngBuf.readUInt32BE(16);
      var height = pngBuf.readUInt32BE(20);

      console.log('[GIF Worker] Video dimensions: %dx%d', width, height);

      // Now extract all frames as raw RGBA
      var frameArgs = [
        '-i', mp4Path,
        '-t', String(maxDuration || 3),
        '-vf', 'fps=' + (fps || 16),
        '-pix_fmt', 'rgba',
        '-f', 'rawvideo',
        '-v', 'error',
        'pipe:1'
      ];

      var proc = child_process.spawn(ffmpeg, frameArgs);
      var rawChunks = [];
      proc.stdout.on('data', function(chunk) { rawChunks.push(chunk); });
      proc.stderr.on('data', function(data) {
        console.error('[GIF Worker] ffmpeg:', data.toString());
      });

      proc.on('close', function(code) {
        if (code !== 0) {
          return reject(new Error('ffmpeg exited with code ' + code));
        }

        var rawData = Buffer.concat(rawChunks);
        var frameSize = width * height * 4; // RGBA
        var frameCount = Math.floor(rawData.length / frameSize);

        console.log('[GIF Worker] Extracted %d frames (%d bytes each)', frameCount, frameSize);

        var frames = [];
        for (var i = 0; i < frameCount; i++) {
          frames.push(new Uint8Array(rawData.buffer, rawData.byteOffset + i * frameSize, frameSize));
        }

        resolve({ frames: frames, width: width, height: height });
      });

      proc.on('error', function(err) {
        reject(new Error('ffmpeg spawn error: ' + err.message));
      });
    });

    dimProc.on('error', function(err) {
      reject(new Error('ffmpeg dimension probe error: ' + err.message));
    });
  });
}

/**
 * Encode frames to GIF using gifenc.
 */
function encodeGIF(frames, width, height, fps, loops) {
  var gifenc = require('gifenc');
  var encoder = gifenc.GIFEncoder();
  var delay = Math.round(1000 / fps);

  for (var i = 0; i < frames.length; i++) {
    var rgba = frames[i];
    var palette = gifenc.quantize(rgba, 256, { format: 'rgba4444' });
    var indexed = gifenc.applyPalette(rgba, palette, 'rgba4444');

    // Find transparent index
    var transparentIndex = -1;
    for (var p = 0; p < palette.length; p++) {
      if (palette[p][3] < 128) {
        transparentIndex = p;
        break;
      }
    }

    encoder.writeFrame(indexed, width, height, {
      palette: palette,
      delay: delay,
      repeat: loops,
      transparent: transparentIndex >= 0,
      transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
      dispose: 2
    });
  }

  encoder.finish();
  return Buffer.from(encoder.bytes());
}

/**
 * Encode frames to APNG using upng-js.
 */
function encodeAPNG(frames, width, height, fps) {
  var UPNG = require('upng-js');
  var delay = Math.round(1000 / fps);

  var bufs = frames.map(function(f) {
    return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength);
  });
  var delays = frames.map(function() { return delay; });

  var apngData = UPNG.encode(bufs, width, height, 0, delays);
  return Buffer.from(apngData);
}

/**
 * Chroma-key out magenta (#FF00FF) background from a frame.
 * Makes magenta pixels transparent, with a smooth falloff for pixels
 * that are near-magenta (anti-aliased edges, slight color bleed from encoding).
 *
 * Magenta is used instead of green because green subjects (plants, frogs,
 * green clothing) would be incorrectly keyed out. Magenta is extremely rare
 * in natural subjects — it's the standard VFX fallback.
 *
 * Detection logic:
 *   - Pure magenta (#FF00FF): R high, G low, B high → fully transparent
 *   - Near-magenta: partially transparent (soft edge)
 *   - Everything else: fully opaque
 */
function chromaKeyMagenta(frame, width, height) {
  var result = new Uint8Array(frame.length);
  result.set(frame);

  for (var i = 0; i < width * height; i++) {
    var idx = i * 4;
    var r = result[idx];
    var g = result[idx + 1];
    var b = result[idx + 2];

    // Magenta = high R + high B + low G.
    // Measure how "magenta" this pixel is by checking that R and B are both
    // high while G is low. The key metric is how much G stays below R and B.
    var minRB = Math.min(r, b);
    var magentaScore = minRB - g; // Higher = more magenta

    if (magentaScore > 80 && minRB > 150) {
      // Strongly magenta — fully transparent
      result[idx] = 0;
      result[idx + 1] = 0;
      result[idx + 2] = 0;
      result[idx + 3] = 0;
    } else if (magentaScore > 40 && minRB > 100) {
      // Partially magenta — soft edge (semi-transparent)
      var alpha = Math.max(0, Math.min(255, 255 - Math.round((magentaScore - 40) * (255 / 40))));
      result[idx + 3] = alpha;

      // Remove magenta spill from RGB to avoid pink fringing
      if (alpha > 0) {
        // Reduce R and B toward G level proportionally to transparency
        var spillFactor = 1 - alpha / 255;
        var spillR = Math.max(0, r - g) * spillFactor;
        var spillB = Math.max(0, b - g) * spillFactor;
        result[idx]     = Math.max(0, Math.round(r - spillR));
        result[idx + 2] = Math.max(0, Math.round(b - spillB));
      } else {
        result[idx] = 0;
        result[idx + 1] = 0;
        result[idx + 2] = 0;
      }
    }
    // else: not magenta, leave fully opaque
  }

  return result;
}

// Message handler
process.on('message', async function(msg) {
  if (msg.type !== 'encode') return;

  try {
    console.log('[GIF Worker] Starting frame extraction from:', msg.mp4Path);

    // Extract frames
    var result = await extractFrames(msg.mp4Path, msg.fps, msg.maxDuration);
    var frames = result.frames;
    var width = result.width;
    var height = result.height;

    // Chroma-key out magenta background per-frame (restores transparency dynamically)
    if (msg.useChromaKey) {
      console.log('[GIF Worker] Chroma-keying magenta background from %d frames (%dx%d)', frames.length, width, height);
      for (var m = 0; m < frames.length; m++) {
        frames[m] = chromaKeyMagenta(frames[m], width, height);
      }
    }

    console.log('[GIF Worker] Encoding %d frames to GIF...', frames.length);

    // Send progress for encoding
    for (var i = 0; i < frames.length; i++) {
      process.send({
        type: 'progress',
        data: { frame: i + 1, totalFrames: frames.length }
      });
    }

    // Encode GIF
    var gifBuffer = encodeGIF(frames, width, height, msg.fps || 16, msg.loops || 0);
    console.log('[GIF Worker] GIF encoded: %d KB', (gifBuffer.length / 1024).toFixed(1));

    // Encode APNG
    var apngBuffer = encodeAPNG(frames, width, height, msg.fps || 16);
    console.log('[GIF Worker] APNG encoded: %d KB', (apngBuffer.length / 1024).toFixed(1));

    process.send({
      type: 'result',
      data: {
        gifBuffer: Array.from(gifBuffer),
        apngBuffer: Array.from(apngBuffer),
        frameCount: frames.length,
        width: width,
        height: height
      }
    });
  } catch (err) {
    console.error('[GIF Worker] Error:', err.message);
    process.send({
      type: 'error',
      error: err.message
    });
  }
});

console.log('[GIF Worker] Ready');
