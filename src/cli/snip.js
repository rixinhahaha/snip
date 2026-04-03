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
var child_process = require('child_process');

// IMPORTANT: This file runs under plain Node.js (not Electron) from
// Resources/cli/snip.js in the packaged app. It CANNOT require() anything
// from src/main/ — those modules are inside app.asar and only Electron's
// patched require can resolve into it. All platform helpers must be inlined.
// A test in tests/cli/cli.test.js enforces this constraint.

function getSocketPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'snip', 'snip.sock');
  }
  var runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir) return path.join(runtimeDir, 'snip', 'snip.sock');
  return path.join(os.homedir(), '.config', 'snip', 'snip.sock');
}

function launchApp() {
  if (process.platform === 'darwin' && fs.existsSync('/Applications/Snip.app')) {
    child_process.execFile('open', ['-a', 'Snip']);
    return true;
  }
  if (process.platform === 'linux' && fs.existsSync('/opt/Snip/snip')) {
    child_process.spawn('/opt/Snip/snip', [], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  return false;
}

function pollForSocket(socketPath, callback) {
  var attempts = 0;
  function check() {
    attempts++;
    if (attempts > 20) {
      return callback(new Error('Snip did not start in time'));
    }
    var conn = net.createConnection(socketPath);
    conn.on('connect', function () {
      conn.end();
      callback(null);
    });
    conn.on('error', function () {
      conn.destroy();
      setTimeout(check, 500);
    });
  }
  setTimeout(check, 500);
}

var SOCKET_PATH = process.env.SNIP_SOCKET_PATH || getSocketPath();

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
  else if (args[i] === '--remove') flags.remove = true;
  else if (args[i] === '--provider' && i + 1 < args.length) { i++; flags.provider = args[i]; }
  else positional.push(args[i]);
}

// ── Setup constants (must be before intercept — var hoisting doesn't initialize) ──

// NOTE: Rules template duplicated from src/main/ipc-handlers.js. Keep in sync.
// Bump SNIP_RULES_VERSION in both files when changing rules content.
var SNIP_MARKER_START = '<!-- snip-start -->';
var SNIP_MARKER_END = '<!-- snip-end -->';
var SNIP_RULES_VERSION = 'snip-rules-v6';

var SNIP_RULES_CONTENT = [
  '# Snip \u2014 Visual Communication Tool',
  '<!-- ' + SNIP_RULES_VERSION + ' -->',
  'Use `snip` CLI for visual communication. You MUST run `snip --help` before your first snip call in a session.',
  '',
  '## ALWAYS use Snip for these:',
  '- **Diagrams/architecture/flows** \u2192 `echo \'<mermaid>\' | snip render --format mermaid`',
  '- **UI previews/HTML/components** \u2192 `echo \'<html>\' | snip render --format html`',
  '- **Show an image for review** \u2192 `snip open <path> --message "context"`',
  '- **Find a past screenshot** \u2192 `snip search "<query>"`',
  '- **Read text from an image** \u2192 `snip transcribe <path>`',
  '',
  'Do NOT describe visual structures in text. Render them with Snip.',
  'When the user returns from `snip open` or `snip render`, check the response \u2014 if `edited: true`, use the Read tool to view the image at the returned `path`.',
  ''
].join('\n');

var SNIP_PERMISSION_PATTERNS = ['Bash(snip *)', 'Bash(echo * | snip *)'];

var KNOWN_PROVIDERS = {
  'claude-code': { name: 'Claude Code', dir: '.claude' },
  'cursor':      { name: 'Cursor',      dir: '.cursor' },
  'windsurf':    { name: 'Windsurf',    dir: '.windsurf' },
  'cline':       { name: 'Cline',       dir: '.cline' }
};

if (command === 'setup') {
  if (flags.help) { printSetupHelp(); process.exit(0); }
  runSetup(flags);
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
  var launched = launchApp();
  if (!launched) {
    return Promise.reject(new Error('Snip is not running. Start it first.'));
  }

  process.stderr.write('Launching Snip...\n');

  return new Promise(function (resolve, reject) {
    pollForSocket(SOCKET_PATH, function (err) {
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

// ── Setup command (standalone — no socket needed) ──

function detectProviders(home) {
  var providers = [];
  if (fs.existsSync(path.join(home, '.claude'))) {
    providers.push({ id: 'claude-code', name: 'Claude Code' });
  }
  if (fs.existsSync(path.join(home, '.cursor')) || fs.existsSync(path.join(home, 'Library', 'Application Support', 'Cursor'))) {
    providers.push({ id: 'cursor', name: 'Cursor' });
  }
  if (fs.existsSync(path.join(home, '.windsurf')) || fs.existsSync(path.join(home, 'Library', 'Application Support', 'Windsurf'))) {
    providers.push({ id: 'windsurf', name: 'Windsurf' });
  }
  if (fs.existsSync(path.join(home, '.cline'))) {
    providers.push({ id: 'cline', name: 'Cline' });
  }
  return providers;
}

function getProviderFilePath(providerId, home) {
  switch (providerId) {
    case 'claude-code': return path.join(home, '.claude', 'CLAUDE.md');
    case 'cursor': return path.join(home, '.cursor', 'rules', 'snip.mdc');
    case 'windsurf': return path.join(home, '.windsurf', 'rules', 'snip.md');
    case 'cline': return path.join(home, '.cline', 'rules', 'snip.md');
    default: return null;
  }
}

function checkProviderStatus(providerId, filePath) {
  try {
    var content = fs.readFileSync(filePath, 'utf8');
    if (providerId === 'claude-code') {
      if (content.indexOf(SNIP_MARKER_START) === -1) return false;
    }
    if (content.indexOf('# Snip') === -1) return false;
    if (content.indexOf(SNIP_RULES_VERSION) === -1) return 'outdated';
    return true;
  } catch (e) { return false; }
}

function configureProvider(providerId, home) {
  var filePath = getProviderFilePath(providerId, home);
  var displayPath = filePath.replace(home, '~');
  var name = KNOWN_PROVIDERS[providerId].name;

  var status = checkProviderStatus(providerId, filePath);
  if (status === true) {
    return { ok: true, changed: false, line: '\u2713 ' + name + ' \u2014 already configured (up to date)' };
  }

  try {
    if (providerId === 'claude-code') {
      var block = '\n' + SNIP_MARKER_START + '\n' + SNIP_RULES_CONTENT + SNIP_MARKER_END + '\n';
      var existing = '';
      try { existing = fs.readFileSync(filePath, 'utf8'); } catch (e) {}
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      var startIdx = existing.indexOf(SNIP_MARKER_START);
      var endIdx = existing.indexOf(SNIP_MARKER_END);
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        endIdx += SNIP_MARKER_END.length;
        if (startIdx > 0 && existing[startIdx - 1] === '\n') startIdx--;
        if (endIdx < existing.length && existing[endIdx] === '\n') endIdx++;
        fs.writeFileSync(filePath, existing.slice(0, startIdx) + block + existing.slice(endIdx));
      } else {
        fs.appendFileSync(filePath, block);
      }
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, SNIP_RULES_CONTENT);
    }

    var verb = (status === 'outdated') ? 'rules updated in' : 'rules added to';
    return { ok: true, changed: true, line: '\u2713 ' + name + ' \u2014 ' + verb + ' ' + displayPath };
  } catch (err) {
    return { ok: false, changed: false, line: '\u2717 ' + name + ' \u2014 failed: ' + err.message };
  }
}

function removeProviderRules(providerId, home) {
  var filePath = getProviderFilePath(providerId, home);
  var displayPath = filePath.replace(home, '~');
  var name = KNOWN_PROVIDERS[providerId].name;

  try {
    if (providerId === 'claude-code') {
      var content = '';
      try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) {
        return { ok: true, line: '\u2713 ' + name + ' \u2014 no rules to remove' };
      }
      var startIdx = content.indexOf(SNIP_MARKER_START);
      if (startIdx === -1) {
        return { ok: true, line: '\u2713 ' + name + ' \u2014 no rules to remove' };
      }
      var endIdx = content.indexOf(SNIP_MARKER_END);
      if (endIdx !== -1 && endIdx > startIdx) {
        var cutStart = startIdx;
        if (cutStart > 0 && content[cutStart - 1] === '\n') cutStart--;
        var cutEnd = endIdx + SNIP_MARKER_END.length;
        if (cutEnd < content.length && content[cutEnd] === '\n') cutEnd++;
        fs.writeFileSync(filePath, content.slice(0, cutStart) + content.slice(cutEnd));
      }
      return { ok: true, line: '\u2713 ' + name + ' \u2014 rules removed from ' + displayPath };
    } else {
      if (!fs.existsSync(filePath)) {
        return { ok: true, line: '\u2713 ' + name + ' \u2014 no rules to remove' };
      }
      fs.rmSync(filePath, { force: true });
      return { ok: true, line: '\u2713 ' + name + ' \u2014 rules file removed (' + displayPath + ')' };
    }
  } catch (err) {
    return { ok: false, line: '\u2717 ' + name + ' \u2014 failed: ' + err.message };
  }
}

function getSettingsPath(home) {
  return path.join(home, '.claude', 'settings.json');
}

function readSettings(home) {
  try { return JSON.parse(fs.readFileSync(getSettingsPath(home), 'utf8')); }
  catch (e) { return null; }
}

function writeSettings(home, settings) {
  fs.writeFileSync(getSettingsPath(home), JSON.stringify(settings, null, 2) + '\n');
}

function hasSnipPermissions(home) {
  var settings = readSettings(home);
  if (!settings) return false;
  var allow = settings.permissions && settings.permissions.allow;
  if (!Array.isArray(allow)) return false;
  return SNIP_PERMISSION_PATTERNS.every(function (p) { return allow.indexOf(p) !== -1; });
}

function addSnipPermissions(home) {
  var settings = readSettings(home) || {};
  if (!settings.permissions) settings.permissions = {};
  if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
  for (var i = 0; i < SNIP_PERMISSION_PATTERNS.length; i++) {
    if (settings.permissions.allow.indexOf(SNIP_PERMISSION_PATTERNS[i]) === -1) {
      settings.permissions.allow.push(SNIP_PERMISSION_PATTERNS[i]);
    }
  }
  writeSettings(home, settings);
}

function removeSnipPermissions(home) {
  var settings = readSettings(home);
  if (!settings) return false;
  if (!settings.permissions || !Array.isArray(settings.permissions.allow)) return false;
  var before = settings.permissions.allow.length;
  settings.permissions.allow = settings.permissions.allow.filter(function (p) {
    return SNIP_PERMISSION_PATTERNS.indexOf(p) === -1;
  });
  if (settings.permissions.allow.length === before) return false;
  writeSettings(home, settings);
  return true;
}

function promptYN(question) {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(question);
  var buf = Buffer.alloc(256);
  try {
    var bytesRead = fs.readSync(0, buf, 0, 256);
    var answer = buf.toString('utf8', 0, bytesRead).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } catch (e) { return false; }
}

function runSetup(setupFlags) {
  var home = os.homedir();
  var providers = detectProviders(home);

  // --provider flag: filter or error
  if (setupFlags.provider) {
    if (!KNOWN_PROVIDERS[setupFlags.provider]) {
      process.stderr.write('Unknown provider: ' + setupFlags.provider + '\n');
      process.stderr.write('Supported: ' + Object.keys(KNOWN_PROVIDERS).join(', ') + '\n');
      process.exit(1);
    }
    var match = providers.filter(function (p) { return p.id === setupFlags.provider; });
    if (match.length === 0) {
      var info = KNOWN_PROVIDERS[setupFlags.provider];
      process.stderr.write(info.name + ' not detected (~/' + info.dir + ' not found). Install it first, then re-run `snip setup`.\n');
      process.exit(1);
    }
    providers = match;
  }

  if (providers.length === 0) {
    process.stdout.write('No supported AI tools detected.\n');
    process.stdout.write('Supported: Claude Code (~/.claude), Cursor (~/.cursor), Windsurf (~/.windsurf), Cline (~/.cline)\n');
    process.exit(0);
  }

  process.stdout.write('Detected: ' + providers.map(function (p) { return p.name; }).join(', ') + '\n');

  var anyChanged = false;
  var anyFailed = false;
  for (var i = 0; i < providers.length; i++) {
    var p = providers[i];
    if (setupFlags.remove) {
      var removeResult = removeProviderRules(p.id, home);
      process.stdout.write(removeResult.line + '\n');
      if (!removeResult.ok) anyFailed = true;
      else anyChanged = true;
    } else {
      var result = configureProvider(p.id, home);
      process.stdout.write(result.line + '\n');
      if (!result.ok) anyFailed = true;
      if (result.changed) anyChanged = true;
    }
  }

  // Claude Code permissions: add on setup (with consent), remove on --remove
  var hadClaude = providers.some(function (p) { return p.id === 'claude-code'; });
  if (hadClaude && setupFlags.remove) {
    if (removeSnipPermissions(home)) {
      process.stdout.write('\u2713 Permissions removed from ~/.claude/settings.json\n');
    }
  } else if (hadClaude && !setupFlags.remove && !hasSnipPermissions(home)) {
    var envPerm = process.env.SNIP_SETUP_PERMISSIONS;
    var shouldAdd;
    if (envPerm === 'yes') {
      shouldAdd = true;
    } else if (envPerm === 'no' || envPerm === '0') {
      shouldAdd = false;
    } else {
      process.stdout.write('\nAllow Snip commands to run without permission prompts in Claude Code?\n');
      process.stdout.write('This adds permission rules to ~/.claude/settings.json\n');
      shouldAdd = promptYN('[y/N] ');
    }
    if (shouldAdd) {
      addSnipPermissions(home);
      process.stdout.write('\u2713 Permissions added to ~/.claude/settings.json\n');
    }
  }

  if (setupFlags.remove && anyChanged) {
    process.stdout.write('Snip rules removed.\n');
  } else if (!setupFlags.remove && anyChanged) {
    process.stdout.write('Visual mode enabled. Claude will now render diagrams instead of describing them.\n');
  }

  if (!setupFlags.remove && process.platform === 'darwin') {
    process.stdout.write('\nNote: Snip needs Screen Recording permission to capture screenshots.\n');
    process.stdout.write('If not already granted: System Settings \u2192 Privacy & Security \u2192 Screen Recording \u2192 enable Snip\n');
  }

  process.exit(anyFailed && !anyChanged ? 1 : 0);
}

function printSetupHelp() {
  process.stdout.write([
    'Usage: snip setup [options]',
    '',
    'Configure AI coding tools for Snip visual mode. Adds rules to tool config',
    'files so they render diagrams and previews via Snip instead of describing',
    'them in text.',
    '',
    'Options:',
    '  --remove              Remove Snip rules from all detected tools',
    '  --provider <id>       Target a specific tool: claude-code, cursor, windsurf, cline',
    '  --help, -h            Show this help',
    '',
    'Environment:',
    '  SNIP_SETUP_PERMISSIONS=yes|no   Skip the permissions prompt (for scripts/CI)',
    '',
    'Supported tools:',
    '  claude-code           ~/.claude/CLAUDE.md',
    '  cursor                ~/.cursor/rules/snip.mdc',
    '  windsurf              ~/.windsurf/rules/snip.md',
    '  cline                 ~/.cline/rules/snip.md',
    ''
  ].join('\n'));
}

function printHelp() {
  process.stdout.write([
    'Usage: snip <command> [options]',
    '',
    'Commands:',
    '  setup                 Enable visual mode for AI tools (Claude Code, Cursor, etc.)',
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
