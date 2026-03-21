/**
 * Transcription module — uses macOS Vision framework (VNRecognizeTextRequest)
 * with Unicode script-based language detection for fast native OCR.
 * Compiles a Swift helper on first use, then runs it as a child process.
 *
 * Only available on macOS. Other platforms get a stub that returns an error.
 */
var platform = require('../platform');
if (!platform.canTranscribe()) {
  module.exports = { transcribe: async function () { return { success: false, error: 'OCR is not available on this platform' }; } };
  return;
}

const child_process = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const SWIFT_SRC = path.join(__dirname, 'transcribe.swift');
const COMPILED_DIR = path.join(app.getPath('userData'), 'transcribe-bin');
const COMPILED_BIN = path.join(COMPILED_DIR, 'transcribe');

let compilePromise = null;

/**
 * Compile the Swift helper binary (once, cached across calls).
 */
function ensureCompiled() {
  if (compilePromise) return compilePromise;

  compilePromise = new Promise((resolve, reject) => {
    // Check if already compiled and source hasn't changed
    try {
      const binStat = fs.statSync(COMPILED_BIN);
      let srcPath = SWIFT_SRC;
      if (srcPath.includes('app.asar')) {
        srcPath = srcPath.replace('app.asar', 'app.asar.unpacked');
      }
      const srcStat = fs.statSync(srcPath);
      if (binStat.mtimeMs > srcStat.mtimeMs) {
        return resolve(COMPILED_BIN);
      }
    } catch (_) {}

    fs.mkdirSync(COMPILED_DIR, { recursive: true });

    let srcPath = SWIFT_SRC;
    if (srcPath.includes('app.asar')) {
      srcPath = srcPath.replace('app.asar', 'app.asar.unpacked');
    }

    console.log('[Transcription] Compiling Swift helper...');
    child_process.execFile('swiftc', [
      '-O', srcPath,
      '-o', COMPILED_BIN,
      '-framework', 'Vision',
      '-framework', 'AppKit'
    ], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        compilePromise = null;
        console.error('[Transcription] Swift compile failed:', stderr || err.message);
        reject(new Error('Failed to compile transcription helper: ' + (stderr || err.message)));
      } else {
        console.log('[Transcription] Swift helper compiled successfully');
        resolve(COMPILED_BIN);
      }
    });
  });

  return compilePromise;
}

/**
 * Transcribe text from a base64-encoded image using native macOS OCR.
 * @param {string} base64Image - raw base64 PNG/JPEG (no data URL prefix)
 * @returns {Promise<{success: boolean, text?: string, languages?: string[], error?: string}>}
 */
async function transcribe(base64Image) {
  const bin = await ensureCompiled();

  return new Promise((resolve, reject) => {
    const proc = child_process.execFile(bin, [], {
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024
    }, (err, stdout, stderr) => {
      if (err) {
        console.error('[Transcription] Process failed:', stderr || err.message);
        reject(new Error(stderr || err.message));
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (parseErr) {
        reject(new Error('Failed to parse transcription output'));
      }
    });

    // Send base64 image via stdin
    proc.stdin.write(base64Image);
    proc.stdin.end();
  });
}

module.exports = { transcribe };
