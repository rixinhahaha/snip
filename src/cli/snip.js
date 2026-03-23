#!/usr/bin/env node

/**
 * Snip CLI — command-line interface for Snip.
 * Connects to the running Snip app via Unix domain socket.
 * Auto-launches Snip if not running (packaged app only).
 *
 * Usage:
 *   snip search "login form"       Search screenshots
 *   snip list                      List all screenshots
 *   snip get <filepath>            Get screenshot metadata
 *   snip transcribe <filepath>     Extract text (OCR)
 *   snip organize <filepath>       Queue for AI categorization
 *   snip categories                List categories
 *   snip open <filepath>           Open in editor, get annotated result
 *   snip render --format mermaid   Render diagram from stdin, open in editor
 */

var net = require('net');
var path = require('path');
var os = require('os');
var fs = require('fs');
var platform = require('../main/platform');

var SOCKET_PATH = process.env.SNIP_SOCKET_PATH || platform.getSocketPath();

// ── Parse args ──

var args = process.argv.slice(2);
var command = args[0];
var flags = {};
var positional = [];

for (var i = 1; i < args.length; i++) {
  if (args[i] === '--json') flags.json = true;
  else if (args[i] === '--pretty') flags.pretty = true;
  else if (args[i] === '--help' || args[i] === '-h') flags.help = true;
  else if (args[i] === '--format' && i + 1 < args.length) { i++; flags.format = args[i]; }
  else if (args[i] === '--message' && i + 1 < args.length) { i++; flags.message = args[i]; }
  else positional.push(args[i]);
}

if (!command || command === '--help' || command === '-h' || flags.help) {
  printHelp();
  process.exit(0);
}

// ── Command map ──

var COMMANDS = {
  search:        { action: 'search_screenshots', paramName: 'query', needsArg: true },
  list:          { action: 'list_screenshots' },
  get:           { action: 'get_screenshot', paramName: 'filepath', needsArg: true },
  transcribe:    { action: 'transcribe_screenshot', paramName: 'filepath', needsArg: true },
  organize:      { action: 'organize_screenshot', paramName: 'filepath', needsArg: true },
  categories:    { action: 'get_categories' },
  open:          { action: 'open_in_snip', paramName: 'filepath', needsArg: true },
  render:        { action: 'render_diagram', needsStdin: true },
  capture:       { action: 'portal_capture' },
  'show-search': { action: 'show_search' }
};

var cmd = COMMANDS[command];
if (!cmd) {
  process.stderr.write('Unknown command: ' + command + '\n');
  printHelp();
  process.exit(1);
}

// Validate required arg
if (cmd.needsArg && positional.length === 0) {
  process.stderr.write('Missing argument for ' + command + '\n');
  process.exit(1);
}

// Build params
var params = {};
if (cmd.paramName && positional[0]) {
  var val = positional[0];
  if (cmd.paramName === 'filepath') {
    val = path.resolve(val);
  }
  params[cmd.paramName] = val;
}
if (flags.message) params.message = flags.message;

// Execute
if (cmd.needsStdin) {
  if (process.stdin.isTTY) {
    process.stderr.write('Error: ' + command + ' reads from stdin. Pipe diagram code, e.g.:\n');
    process.stderr.write('  echo "graph TD; A-->B" | snip render --format mermaid\n');
    process.exit(1);
  }
  readStdin().then(function (input) {
    if (!input.trim()) {
      process.stderr.write('Error: empty input from stdin\n');
      process.exit(1);
    }
    params.code = input;
    params.format = flags.format || 'mermaid';
    return callSnip(cmd.action, params, false);
  }).then(function (result) {
    formatOutput(command, result);
    process.exit(0);
  }).catch(function (err) {
    process.stderr.write('Error: ' + err.message + '\n');
    process.exit(1);
  });
} else {
  callSnip(cmd.action, params, false).then(function (result) {
    formatOutput(command, result);
    process.exit(0);
  }).catch(function (err) {
    process.stderr.write('Error: ' + err.message + '\n');
    process.exit(1);
  });
}

function readStdin() {
  return new Promise(function (resolve) {
    var chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function (chunk) { chunks.push(chunk); });
    process.stdin.on('end', function () { resolve(chunks.join('')); });
    process.stdin.resume();
  });
}

// ── Socket connection ──

function callSnip(action, params, isRetry) {
  return new Promise(function (resolve, reject) {
    var conn = net.createConnection(SOCKET_PATH);
    var buffer = '';
    var id = 'cli-' + Date.now();

    conn.on('connect', function () {
      var msg = JSON.stringify({ id: id, action: action, params: params || {}, source: 'cli' }) + '\n';
      conn.write(msg);
    });

    conn.on('data', function (chunk) {
      buffer += chunk.toString();
      var newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        var line = buffer.slice(0, newlineIdx).trim();
        conn.end();
        try {
          var response = JSON.parse(line);
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.result);
          }
        } catch (e) {
          reject(new Error('Invalid response from Snip'));
        }
      }
    });

    conn.on('error', function (err) {
      if ((err.code === 'ENOENT' || err.code === 'ECONNREFUSED') && !isRetry && !process.env.SNIP_NO_AUTO_LAUNCH) {
        // Auto-launch Snip and retry
        launchAndRetry(action, params).then(resolve).catch(reject);
      } else if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error('Snip is not running and could not be launched.'));
      } else {
        reject(new Error('Connection failed: ' + err.message));
      }
    });

    // Timeout for long-running commands (open blocks on user interaction)
    if (action !== 'open_in_snip' && action !== 'render_diagram' && action !== 'portal_capture') {
      setTimeout(function () {
        conn.destroy();
        reject(new Error('Request timed out'));
      }, 30000);
    }
  });
}

function launchAndRetry(action, params) {
  var launched = platform.launchApp();
  if (!launched) {
    return Promise.reject(new Error('Snip is not running. Start it first.'));
  }

  process.stderr.write('Launching Snip...\n');

  return new Promise(function (resolve, reject) {
    platform.pollForSocket(SOCKET_PATH, function (err) {
      if (err) return reject(err);
      callSnip(action, params, true).then(resolve).catch(reject);
    });
  });
}

// ── Output formatting ──

function formatOutput(command, result) {
  if (command === 'transcribe') {
    if (result && result.text) {
      process.stdout.write(result.text + '\n');
    } else if (result && result.success === false) {
      process.stderr.write('Transcription failed: ' + (result.error || 'unknown error') + '\n');
      process.exit(1);
    } else {
      printJson(result);
    }
    return;
  }

  if (command === 'capture') {
    if (result && result.cancelled) {
      process.exit(0);
    }
    // Capture results follow the same format as open/render
  }

  if (command === 'capture' || command === 'open' || command === 'render') {
    if (!result) {
      printJson({ status: 'error', message: 'No result from editor' });
      return;
    }

    var outPath = result.outputPath || null;
    if (!outPath && result.dataURL) {
      var tmpDir = path.join(os.homedir(), 'Documents', 'snip', 'screenshots', '.tmp');
      fs.mkdirSync(tmpDir, { recursive: true });
      var prefix = command === 'render' ? 'rendered-' : 'annotated-';
      var filename = prefix + Date.now() + '.png';
      outPath = path.join(tmpDir, filename);
      var raw = Buffer.from(result.dataURL.split(',')[1], 'base64');
      fs.writeFileSync(outPath, raw);
    }

    var status = result.action || 'done';
    var output = { status: status };
    if (result.edited !== undefined) output.edited = result.edited;
    if (outPath) output.path = outPath;
    if (result.text) output.text = result.text;

    if (result.edited) {
      output.message = 'See annotations at path.';
    }

    printJson(output);
    return;
  }

  if (command === 'get') {
    if (result && result.metadata) {
      printJson(result.metadata);
    } else {
      printJson(result);
    }
    return;
  }

  if (command === 'organize') {
    if (result && result.queued) {
      process.stdout.write('Queued for AI categorization: ' + result.filepath + '\n');
    } else {
      printJson(result);
    }
    return;
  }

  printJson(result);
}

function printJson(data) {
  if (flags.pretty) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(data) + '\n');
  }
}

function printHelp() {
  process.stdout.write([
    'Usage: snip <command> [options]',
    '',
    'Commands:',
    '  search <query>        Search screenshots by description. Returns JSON array.',
    '  list                  List all saved screenshots with metadata. Returns JSON array.',
    '  get <filepath>        Get metadata for a specific screenshot. Returns JSON.',
    '  transcribe <filepath> Extract text from an image via OCR. Returns plain text.',
    '  organize <filepath>   Queue screenshot for AI categorization.',
    '  categories            List all categories. Returns JSON array.',
    '  open <filepath>       Open image in editor for annotation/review. Blocks until',
    '                        user finishes. Returns JSON: { status, edited, path, text }',
    '  render --format <fmt> Render content from stdin, open in editor. Blocks until',
    '                        user finishes. Returns JSON: { status, edited, path, text }',
    '',
    'Options:',
    '  --format <fmt>        Render format: mermaid or html',
    '  --message <text>      Context message shown to user during review',
    '  --pretty              Pretty-print JSON output',
    '  --help, -h            Show this help',
    '',
    'Review mode:',
    '  `open` and `render` open Snip\'s editor with a review panel. The user can',
    '  approve, request changes, or annotate the image. The response includes:',
    '    status  "approved" or "changes_requested"',
    '    edited  true if user annotated the image',
    '    path    path to the (possibly annotated) image file',
    '    text    optional feedback text from the user',
    '',
    'HTML rendering tips:',
    '  Rendering is sandboxed: no <script> or <canvas> JS will execute.',
    '  Use pure HTML, CSS, and inline SVG only.',
    '',
    '  Sizing:',
    '    - Fragments are wrapped in `body { display: inline-block }` (shrink-to-fit)',
    '    - For fixed-size designs (posters, cards), send a full <!DOCTYPE html>',
    '      document with explicit body dimensions: `body { width: 800px; height: 1100px; }`',
    '    - Center content with a max-width inner container, not body padding',
    '    - Use fixed grid widths (200px 200px) not 1fr — no viewport width context',
    '',
    '  Resources:',
    '    - <style> tags and inline styles only — external stylesheets won\'t load',
    '    - Google Fonts via @import may work but have a 500ms load timeout',
    '    - <img> tags with external URLs have the same 500ms timeout',
    '',
    'Snip auto-launches if not running.',
    '',
    'Examples:',
    '  snip search "error message"',
    '  snip list | jq \'.[].name\'',
    '  snip transcribe screenshot.png',
    '  snip open mockup.png --message "Does this look right?"',
    '  echo "graph TD; A-->B" | snip render --format mermaid',
    '  echo "<h1>Hello</h1>" | snip render --format html --message "Preview"',
    ''
  ].join('\n'));
}
