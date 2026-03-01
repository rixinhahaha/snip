/**
 * Animation module — uses fal.ai's Wan 2.2 image-to-video API to generate
 * animated GIFs from cutout segments.
 *
 * Pipeline:
 *   1. Composite cutout PNG onto magenta (#FF00FF) chroma-key background
 *   2. Upload composited PNG to fal.ai storage
 *   3. Call Wan 2.2 A14B I2V with preset prompt + composited image
 *   4. Download resulting MP4
 *   5. Extract frames from MP4, chroma-key out magenta per-frame → encode GIF + APNG
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { getFalApiKey, getOllamaModel, getOllamaUrl } = require('../store');

const FAL_MODEL = 'fal-ai/wan/v2.2-a14b/image-to-video';

/**
 * Static animation presets — generic fallback when Ollama AI presets are unavailable.
 * These are intentionally generic (not subject-specific) to work with any cutout.
 */
var STATIC_PRESETS = [
  {
    name: 'breathe', label: 'Breathe',
    description: 'Subtle breathing, gently expanding and contracting',
    prompt: 'The subject gently breathing with subtle movement, soft and alive, slight expansion and contraction, smooth looping motion',
    num_frames: 33, fps: 16
  },
  {
    name: 'sway', label: 'Sway',
    description: 'Gentle swaying side to side like a breeze',
    prompt: 'The subject gently swaying side to side as if in a light breeze, smooth natural movement, soft organic motion',
    num_frames: 49, fps: 16
  },
  {
    name: 'bounce', label: 'Bounce',
    description: 'Playful bouncing up and down',
    prompt: 'The subject bouncing up and down playfully, lively energetic movement, fun bouncing motion with slight squash and stretch',
    num_frames: 33, fps: 16
  },
  {
    name: 'wobble', label: 'Wobble',
    description: 'Jelly-like wobbling and shaking',
    prompt: 'The subject wobbling like jelly, playful shaking motion, fun jiggly movement with slight rotation',
    num_frames: 33, fps: 16
  },
  {
    name: 'float', label: 'Float',
    description: 'Dreamy floating upward with slow drift',
    prompt: 'The subject slowly floating upward with a dreamy drifting motion, weightless and ethereal, gentle rising movement',
    num_frames: 49, fps: 16
  },
  {
    name: 'zoom', label: 'Zoom In',
    description: 'Cinematic slow zoom towards the subject',
    prompt: 'Cinematic slow zoom in towards the subject, camera gradually moving closer, dramatic focus pull effect',
    num_frames: 49, fps: 16
  }
];

/**
 * Check if animation is supported.
 * Returns true only if the user has configured a fal.ai API key in Settings.
 */
function checkSupport() {
  var apiKey = getFalApiKey();
  return { supported: !!apiKey };
}

/**
 * List available animation presets (static fallback for when AI presets are unavailable).
 */
function listPresets() {
  return STATIC_PRESETS.map(function(p) {
    return {
      name: p.name,
      label: p.label,
      description: p.description,
      prompt: p.prompt,
      numFrames: p.num_frames || 33,
      fps: p.fps || 16
    };
  });
}

/**
 * Fetch a URL and return the response body as a Buffer.
 */
function fetchBuffer(url) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https') ? https : http;
    mod.get(url, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' fetching video'));
      }
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() { resolve(Buffer.concat(chunks)); });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Chroma-key background color: bright magenta (#FF00FF).
// Magenta is used instead of green because green subjects (plants, frogs, clothing)
// would be incorrectly keyed out. Magenta is extremely rare in natural subjects.
var CHROMA_BG = { r: 255, g: 0, b: 255 };

/**
 * Composite a cutout PNG (with transparency) onto a solid magenta background.
 * Magenta allows per-frame chroma-key removal after fal.ai generates the video,
 * so transparency follows the actual animated content even when the subject moves.
 *
 * Uses upng-js to decode/encode PNG without native dependencies.
 */
function compositeOnChromaBackground(pngBuffer) {
  // Resolve upng-js from the project's node_modules
  var UPNG;
  try {
    UPNG = require('upng-js');
  } catch (_) {
    // In packaged app, try unpacked path
    var unpackedPath = path.join(__dirname, '..', '..', '..', 'node_modules', 'upng-js');
    if (unpackedPath.includes('app.asar')) {
      unpackedPath = unpackedPath.replace('app.asar', 'app.asar.unpacked');
    }
    UPNG = require(unpackedPath);
  }

  // Decode PNG to RGBA
  var decoded = UPNG.decode(pngBuffer);
  var rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
  var width = decoded.width;
  var height = decoded.height;

  // Composite onto magenta: result = fg * alpha + magenta * (1 - alpha)
  var composited = new Uint8Array(width * height * 4);
  for (var j = 0; j < width * height; j++) {
    var a = rgba[j * 4 + 3] / 255;
    composited[j * 4]     = Math.round(rgba[j * 4]     * a + CHROMA_BG.r * (1 - a)); // R
    composited[j * 4 + 1] = Math.round(rgba[j * 4 + 1] * a + CHROMA_BG.g * (1 - a)); // G
    composited[j * 4 + 2] = Math.round(rgba[j * 4 + 2] * a + CHROMA_BG.b * (1 - a)); // B
    composited[j * 4 + 3] = 255; // Fully opaque
  }

  // Re-encode as PNG
  var compositedPng = UPNG.encode(
    [composited.buffer],
    width,
    height,
    0 // lossless
  );

  console.log('[Animation] Composited cutout (%dx%d) onto magenta chroma-key background', width, height);

  return {
    pngBuffer: Buffer.from(compositedPng),
    width: width,
    height: height
  };
}

/**
 * Make a JSON request to fal.ai API.
 */
function falRequest(method, urlPath, body) {
  var apiKey = getFalApiKey();
  return new Promise(function(resolve, reject) {
    var bodyStr = body ? JSON.stringify(body) : '';
    var options = {
      hostname: 'queue.fal.run',
      path: urlPath,
      method: method,
      headers: {
        'Authorization': 'Key ' + apiKey,
        'Content-Type': 'application/json'
      }
    };
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        var raw = Buffer.concat(chunks).toString('utf8');
        try {
          var parsed = JSON.parse(raw);
          if (res.statusCode >= 400) {
            return reject(new Error('fal.ai error (' + res.statusCode + '): ' + (parsed.detail || parsed.message || raw)));
          }
          resolve(parsed);
        } catch (e) {
          if (res.statusCode >= 400) {
            return reject(new Error('fal.ai error (' + res.statusCode + '): ' + raw));
          }
          resolve(raw);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body) req.write(bodyStr);
    req.end();
  });
}

/**
 * Upload an image buffer to fal.ai storage and return a URL.
 */
function uploadToFal(imageBuffer, filename) {
  var apiKey = getFalApiKey();
  return new Promise(function(resolve, reject) {
    // Step 1: Get upload URL from fal.ai storage API
    var initBody = JSON.stringify({
      content_type: 'image/png',
      file_name: filename || 'cutout.png'
    });

    var initOptions = {
      hostname: 'rest.fal.ai',
      path: '/storage/upload/initiate?storage_type=fal-cdn-v3',
      method: 'POST',
      headers: {
        'Authorization': 'Key ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(initBody)
      }
    };

    var initReq = https.request(initOptions, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        try {
          var initResult = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode >= 400) {
            return reject(new Error('fal.ai upload init failed: ' + JSON.stringify(initResult)));
          }

          var uploadUrl = initResult.upload_url;
          var fileUrl = initResult.file_url;

          // Step 2: Upload the file to the pre-signed URL
          var parsedUrl = new URL(uploadUrl);
          var uploadOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'PUT',
            headers: {
              'Content-Type': 'image/png',
              'Content-Length': imageBuffer.length
            }
          };

          var uploadReq = https.request(uploadOptions, function(uploadRes) {
            var uploadChunks = [];
            uploadRes.on('data', function(c) { uploadChunks.push(c); });
            uploadRes.on('end', function() {
              if (uploadRes.statusCode >= 400) {
                return reject(new Error('Upload failed: HTTP ' + uploadRes.statusCode));
              }
              resolve(fileUrl);
            });
            uploadRes.on('error', reject);
          });
          uploadReq.on('error', reject);
          uploadReq.write(imageBuffer);
          uploadReq.end();
        } catch (e) {
          reject(new Error('Upload parse error: ' + e.message));
        }
      });
      res.on('error', reject);
    });
    initReq.on('error', reject);
    initReq.write(initBody);
    initReq.end();
  });
}

/**
 * Poll fal.ai queue until job completes or fails.
 *
 * Uses the status_url and response_url returned by the initial submission
 * (these contain the correct base path which differs from the model submission URL).
 * Polls with GET (not POST — POST creates new requests).
 */
function pollQueue(statusUrl, responseUrl, onProgress) {
  // Extract path from full URL for use with falRequest
  var statusPath = new URL(statusUrl).pathname;
  var responsePath = new URL(responseUrl).pathname;

  return new Promise(function(resolve, reject) {
    var pollCount = 0;
    var maxPolls = 120; // 2 minutes max at 1s intervals

    function poll() {
      pollCount++;
      if (pollCount > maxPolls) {
        return reject(new Error('Animation timed out after 2 minutes'));
      }

      falRequest('GET', statusPath)
        .then(function(status) {
          console.log('[Animation] Poll #%d — status: %s', pollCount, status.status);
          if (status.status === 'COMPLETED') {
            // Fetch the actual result
            return falRequest('GET', responsePath)
              .then(resolve);
          } else if (status.status === 'FAILED') {
            return reject(new Error('Animation failed: ' + (status.error || 'Unknown error')));
          } else {
            // IN_QUEUE or IN_PROGRESS
            if (onProgress) {
              var progressData = {
                status: status.status,
                position: status.queue_position || 0,
                pollCount: pollCount
              };
              if (status.status === 'IN_QUEUE') {
                progressData.message = 'In queue' + (status.queue_position ? ' (position ' + status.queue_position + ')' : '') + '…';
                progressData.pct = Math.min(15, pollCount * 2);
              } else {
                progressData.message = 'Generating…';
                progressData.pct = Math.min(90, 15 + pollCount * 3);
              }
              onProgress(progressData);
            }
            setTimeout(poll, 1000);
          }
        })
        .catch(function(err) {
          console.error('[Animation] Poll #%d — error: %s', pollCount, err.message);
          // Retry on transient errors
          if (pollCount < maxPolls) {
            setTimeout(poll, 2000);
          } else {
            reject(err);
          }
        });
    }

    // Start polling after a short delay (generation takes time)
    setTimeout(poll, 2000);
  });
}

/**
 * Extract frames from MP4 buffer and encode as GIF + APNG.
 * Uses ffmpeg-static for frame extraction via the gif-encoder-worker child process.
 *
 * @param {Buffer} mp4Buffer - raw MP4 data
 * @param {number} fps - target frame rate
 * @param {number} loops - GIF loop count (0 = infinite)
 * @param {boolean} useChromaKey - if true, chroma-key out magenta (#FF00FF) per frame
 * @param {function} onProgress - progress callback
 */
function extractAndEncode(mp4Buffer, fps, loops, useChromaKey, onProgress) {
  var child_process = require('child_process');

  var workerScript = path.join(__dirname, 'gif-encoder-worker.js');
  if (workerScript.includes('app.asar')) {
    workerScript = workerScript.replace('app.asar', 'app.asar.unpacked');
  }

  return new Promise(function(resolve, reject) {
    // Write MP4 to temp file
    var os = require('os');
    var tmpDir = os.tmpdir();
    var tmpMp4 = path.join(tmpDir, 'snip-anim-' + Date.now() + '.mp4');
    fs.writeFileSync(tmpMp4, mp4Buffer);

    var workerProc = child_process.fork(workerScript, [], {
      stdio: ['pipe', 'inherit', 'inherit', 'ipc']
    });

    workerProc.on('message', function(msg) {
      if (msg.type === 'progress' && onProgress) {
        onProgress(msg.data);
      } else if (msg.type === 'result') {
        // Clean up temp file
        try { fs.unlinkSync(tmpMp4); } catch (_) {}
        resolve({
          gifBuffer: Buffer.from(msg.data.gifBuffer),
          apngBuffer: Buffer.from(msg.data.apngBuffer),
          frameCount: msg.data.frameCount,
          width: msg.data.width,
          height: msg.data.height
        });
      } else if (msg.type === 'error') {
        try { fs.unlinkSync(tmpMp4); } catch (_) {}
        reject(new Error(msg.error));
      }
    });

    workerProc.on('exit', function(code) {
      if (code !== 0 && code !== null) {
        try { fs.unlinkSync(tmpMp4); } catch (_) {}
        reject(new Error('GIF encoder worker exited with code ' + code));
      }
    });

    workerProc.on('error', function(err) {
      try { fs.unlinkSync(tmpMp4); } catch (_) {}
      reject(err);
    });

    workerProc.send({
      type: 'encode',
      mp4Path: tmpMp4,
      fps: fps || 16,
      loops: loops || 0,
      maxDuration: 4, // Trim to 4 seconds max
      useChromaKey: !!useChromaKey
    });
  });
}

/**
 * Maximum animation duration in seconds.
 * Videos longer than this will be trimmed during GIF encoding.
 */
var MAX_DURATION_SECONDS = 4;

/**
 * Generate animated GIF from a cutout using fal.ai.
 *
 * @param {string} cutoutDataURL - data:image/png;base64,... of the cutout
 * @param {string} presetName - name of the text preset (breathe, sway, etc.) or '_custom' for custom prompt
 * @param {object} options - { fps, loops, customPrompt }
 * @param {function} onProgress - progress callback({ message, pct, status })
 * @returns {Promise<{ gifBuffer, apngBuffer, frameCount, width, height }>}
 */
async function generateAnimation(cutoutDataURL, presetName, options, onProgress) {
  var apiKey = getFalApiKey();
  if (!apiKey) {
    throw new Error('No fal.ai API key configured. Add your key in Settings > Animation.');
  }

  var prompt;
  var numFrames;
  var fps;

  if (presetName === '_custom') {
    // Custom prompt mode
    if (!options.customPrompt || !options.customPrompt.trim()) {
      throw new Error('Please enter a prompt describing the animation.');
    }
    prompt = options.customPrompt.trim();
    fps = options.fps || 16;
    // Use explicit numFrames if provided (AI presets), otherwise cap at MAX_DURATION_SECONDS
    numFrames = options.numFrames || Math.min(fps * MAX_DURATION_SECONDS, 65);
    console.log('[Animation] Starting fal.ai generation with custom prompt');
  } else {
    // Preset mode — look up from inline static presets
    var preset = STATIC_PRESETS.find(function(p) { return p.name === presetName; });
    if (!preset) {
      throw new Error('Preset not found: ' + presetName);
    }
    prompt = preset.prompt;
    fps = preset.fps || options.fps || 16;
    // Cap preset num_frames to MAX_DURATION_SECONDS too
    numFrames = Math.min(preset.num_frames || 33, fps * MAX_DURATION_SECONDS);
    console.log('[Animation] Starting fal.ai generation with preset "%s"', presetName);
  }

  if (onProgress) onProgress({ message: 'Uploading image…', pct: 5, status: 'UPLOADING' });

  // 2. Convert data URL to PNG buffer.
  //    The cutout has a transparent background — fal.ai will hallucinate scenery
  //    if we send transparency. So we composite onto a magenta (#FF00FF) background
  //    before upload, then chroma-key each frame after to restore transparency.
  //    Magenta is chosen over green because green subjects (plants, frogs, etc.)
  //    would be incorrectly keyed out. Per-frame chroma-key (not a static mask)
  //    ensures transparency follows the subject even when it moves.
  var base64Data = cutoutDataURL.replace(/^data:image\/\w+;base64,/, '');
  var imageBuffer = Buffer.from(base64Data, 'base64');

  // Composite cutout onto magenta chroma-key background
  var composited = compositeOnChromaBackground(imageBuffer);
  var imageUrl = await uploadToFal(composited.pngBuffer, 'cutout.png');
  console.log('[Animation] Image uploaded to fal.ai:', imageUrl);

  if (onProgress) onProgress({ message: 'Starting generation…', pct: 10, status: 'SUBMITTING' });

  // 3. Submit job to fal.ai queue
  var negativePrompt = 'distortion, morphing, deformation, extra limbs, extra body parts, ' +
    'disfigured, mutated, ugly, blurry, low quality, watermark, text, ' +
    'unrealistic proportions, melting, stretching, warping, ' +
    'duplicate, clone, split body, merged body parts, ' +
    'background change, new background, scenery, environment, landscape, ' +
    'background replacement, color shift';

  var submission = await falRequest('POST', '/' + FAL_MODEL, {
    image_url: imageUrl,
    prompt: prompt,
    negative_prompt: negativePrompt,
    num_frames: numFrames,
    frames_per_second: fps,
    resolution: '480p',
    aspect_ratio: '1:1',
    num_inference_steps: 27,
    guidance_scale: 3.5,
    enable_safety_checker: false
  });

  var falRequestId = submission.request_id;
  var statusUrl = submission.status_url;
  var responseUrl = submission.response_url;
  console.log('[Animation] fal.ai job submitted, request_id:', falRequestId);

  if (!statusUrl || !responseUrl) {
    throw new Error('fal.ai submission did not return status/response URLs');
  }

  if (onProgress) onProgress({ message: 'Generating video…', pct: 15, status: 'IN_QUEUE' });

  // 4. Poll for completion (using URLs from submission, with GET method)
  var result = await pollQueue(statusUrl, responseUrl, onProgress);

  if (!result.video || !result.video.url) {
    throw new Error('fal.ai returned no video URL');
  }

  console.log('[Animation] Video generated:', result.video.url);
  if (onProgress) onProgress({ message: 'Downloading video…', pct: 92, status: 'DOWNLOADING' });

  // 5. Download MP4
  var mp4Buffer = await fetchBuffer(result.video.url);
  console.log('[Animation] MP4 downloaded: %d KB', (mp4Buffer.length / 1024).toFixed(1));

  if (onProgress) onProgress({ message: 'Encoding GIF…', pct: 95, status: 'ENCODING' });

  // 6. Extract frames, chroma-key out magenta background per-frame, encode GIF + APNG
  var encoded = await extractAndEncode(mp4Buffer, fps, options.loops || 0, true, function(encProgress) {
    if (onProgress) {
      onProgress({
        message: 'Encoding frame ' + encProgress.frame + '/' + encProgress.totalFrames + '…',
        pct: 95 + Math.round((encProgress.frame / encProgress.totalFrames) * 5),
        status: 'ENCODING'
      });
    }
  });

  console.log('[Animation] Complete: %d frames, GIF %d KB, APNG %d KB',
    encoded.frameCount,
    (encoded.gifBuffer.length / 1024).toFixed(1),
    (encoded.apngBuffer.length / 1024).toFixed(1)
  );

  return encoded;
}

/**
 * Ollama prompt for generating animation presets from a cutout image.
 * Instructs minicpm-v to analyze the subject and suggest physically plausible motions.
 */
var AI_PRESET_PROMPT =
  'Look at this cutout image. Identify the subject.\n\n' +
  'Suggest exactly 3 animation motions that would look natural for THIS subject.\n\n' +
  'Examples:\n' +
  '- A cat: stretch, flick tail, yawn\n' +
  '- A flower: bloom, sway in wind, breathe\n' +
  '- A person: wave, nod, turn head\n' +
  '- A logo: pulse, rotate, bounce\n\n' +
  'Return ONLY a JSON object (no markdown, no code blocks):\n' +
  '{\n' +
  '  "subject": "<what the subject is, 2-4 words>",\n' +
  '  "presets": [\n' +
  '    {\n' +
  '      "name": "<kebab-case-id>",\n' +
  '      "label": "<Short 1-2 Word Label>",\n' +
  '      "description": "<6-8 word description>",\n' +
  '      "prompt": "<animation prompt, 15-25 words describing the motion>",\n' +
  '      "num_frames": 33,\n' +
  '      "fps": 16\n' +
  '    }\n' +
  '  ]\n' +
  '}\n\n' +
  'Rules:\n' +
  '- label: 1-2 words max, e.g. "Stretch", "Tail Wag", "Nod"\n' +
  '- prompt: start with "The subject" or "The <type>", describe smooth natural motion\n' +
  '- Only the subject should move, background stays unchanged\n' +
  '- Use 33 frames for short motions, 49 for longer/flowing motions\n' +
  '- Do NOT include an icon field';

/**
 * Downscale a base64 PNG to a max dimension using Electron's nativeImage.
 * Vision models don't need full resolution for subject identification —
 * 384px is sufficient and dramatically reduces inference time.
 *
 * @param {string} base64Png - raw base64 PNG data (no data URL prefix)
 * @param {number} maxDim - maximum width or height in pixels
 * @returns {string} resized base64 PNG (no prefix)
 */
function downscaleForVision(base64Png, maxDim) {
  var { nativeImage } = require('electron');
  var img = nativeImage.createFromBuffer(Buffer.from(base64Png, 'base64'));
  var size = img.getSize();

  // Only resize if larger than maxDim
  if (size.width <= maxDim && size.height <= maxDim) {
    return base64Png;
  }

  var scale = maxDim / Math.max(size.width, size.height);
  var newW = Math.round(size.width * scale);
  var newH = Math.round(size.height * scale);
  var resized = img.resize({ width: newW, height: newH, quality: 'good' });

  console.log('[Animation] Downscaled cutout for vision: %dx%d → %dx%d', size.width, size.height, newW, newH);
  return resized.toPNG().toString('base64');
}

/**
 * Generate AI-tailored animation presets by analyzing a cutout image with Ollama.
 *
 * @param {string} cutoutBase64 - raw base64 PNG data (no data URL prefix)
 * @returns {Promise<Array|null>} array of 3 preset objects, or null if Ollama unavailable
 */
async function generatePresets(cutoutBase64) {
  // Check Ollama readiness
  var ollamaManager = require('../ollama-manager');
  var ready = await ollamaManager.isReady();
  if (!ready) {
    console.log('[Animation] Ollama not ready, falling back to static presets');
    return null;
  }

  var { Ollama } = require('ollama');
  var ollama = new Ollama({ host: getOllamaUrl() });
  var model = getOllamaModel();

  // Downscale image for faster vision inference (384px max — sufficient for subject ID)
  var resizedBase64 = downscaleForVision(cutoutBase64, 384);

  console.log('[Animation] Generating AI presets with %s...', model);

  var response = await ollama.chat({
    model: model,
    messages: [{
      role: 'user',
      content: AI_PRESET_PROMPT,
      images: [resizedBase64]
    }],
    format: 'json',
    stream: false,
    options: {
      num_predict: 512,   // Cap output tokens — JSON response is ~300 tokens
      temperature: 0.7    // Slightly lower temp for more consistent structured output
    },
    keep_alive: '10m'     // Keep model loaded for 10 minutes (avoids cold-start on redo)
  });

  // Parse response
  var text = response.message.content.trim();
  var jsonMatch = text.match(/\{[\s\S]*\}/);
  var result = JSON.parse(jsonMatch ? jsonMatch[0] : text);

  // Validate
  if (!result.presets || !Array.isArray(result.presets) || result.presets.length === 0) {
    console.warn('[Animation] AI returned no presets, falling back');
    return null;
  }

  // Normalize and cap at 3
  var presets = result.presets.slice(0, 3).map(function(p) {
    return {
      name: (p.name || 'motion').replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      label: p.label || 'Motion',
      description: p.description || '',
      prompt: p.prompt || '',
      numFrames: Math.min(p.num_frames || 33, 16 * MAX_DURATION_SECONDS),
      fps: p.fps || 16
    };
  });

  console.log('[Animation] AI generated %d presets for subject: %s',
    presets.length, result.subject || 'unknown');

  return presets;
}

module.exports = { generateAnimation, checkSupport, listPresets, generatePresets };
