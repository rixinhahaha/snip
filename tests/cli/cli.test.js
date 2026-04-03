import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import net from 'net';

var CLI_PATH = join(__dirname, '..', '..', 'src', 'cli', 'snip.js');
var NODE_PATH = process.execPath;

let tmpDir;
let socketPath;
let server;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'snip-cli-test-'));
  socketPath = join(tmpDir, 'test.sock');
});

afterEach(() => {
  if (server) { server.close(); server = null; }
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ──

function runCli(args, opts) {
  return new Promise((resolve) => {
    var env = { ...process.env, SNIP_SOCKET_PATH: socketPath, SNIP_NO_AUTO_LAUNCH: '1' };
    if (opts && opts.env) Object.assign(env, opts.env);
    execFile(NODE_PATH, [CLI_PATH].concat(args), {
      env: env,
      timeout: (opts && opts.timeout) || 10000
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code || 1) : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

function startTestServer(handlers) {
  return new Promise((resolve) => {
    server = net.createServer(function (conn) {
      let buffer = '';
      conn.on('data', function (chunk) {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          var line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            var msg = JSON.parse(line);
            handleMsg(conn, msg, handlers);
          } catch {
            conn.write(JSON.stringify({ id: null, error: 'Invalid JSON' }) + '\n');
          }
        }
      });
      conn.on('error', function () {});
    });

    async function handleMsg(conn, msg, handlers) {
      var id = msg.id != null ? msg.id : null;
      var action = msg.action;
      var params = msg.params || {};
      if (!action) { conn.write(JSON.stringify({ id, error: 'Missing action' }) + '\n'); return; }
      var handler = handlers[action];
      if (!handler) { conn.write(JSON.stringify({ id, error: 'Unknown action' }) + '\n'); return; }
      try {
        var result = await handler(params);
        conn.write(JSON.stringify({ id, result }) + '\n');
      } catch (err) {
        conn.write(JSON.stringify({ id, error: err.message }) + '\n');
      }
    }

    server.listen(socketPath, function () {
      resolve();
    });
  });
}

function runCliWithStdin(args, stdinData, opts) {
  return new Promise((resolve) => {
    var child = execFile(NODE_PATH, [CLI_PATH].concat(args), {
      env: { ...process.env, SNIP_SOCKET_PATH: socketPath, SNIP_NO_AUTO_LAUNCH: '1' },
      timeout: (opts && opts.timeout) || 10000
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code || 1) : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
    if (stdinData != null) {
      child.stdin.write(stdinData);
      child.stdin.end();
    }
  });
}

// ── Module isolation ──
// The CLI runs as a standalone script under plain Node.js (not Electron),
// launched from Resources/cli/snip.js in the packaged app. It CANNOT
// require() anything from src/main/ because that code lives inside app.asar
// and only Electron's patched require can resolve into it. If someone adds
// a require('../main/...') to snip.js, it will work in dev but crash in
// the packaged app. This test catches that.

describe('CLI module isolation', () => {
  it('does not require any modules outside of node builtins and child_process', async () => {
    var source = readFileSync(CLI_PATH, 'utf8');
    var requires = source.match(/require\(['"][^'"]+['"]\)/g) || [];
    var nodeBuiltins = [
      'net', 'path', 'os', 'fs', 'child_process', 'node:net', 'node:path',
      'node:os', 'node:fs', 'node:child_process'
    ];
    for (var req of requires) {
      var mod = req.match(/require\(['"]([^'"]+)['"]\)/)[1];
      expect(
        nodeBuiltins.includes(mod),
        'snip.js requires "' + mod + '" which is not a Node builtin — ' +
        'the CLI runs outside app.asar under plain Node, so it cannot ' +
        'require from src/main/. Inline the needed code instead.'
      ).toBe(true);
    }
  });
});

// ── Help and argument parsing ──

describe('CLI help and args', () => {
  it('--help exits 0 with usage text', async () => {
    var res = await runCli(['--help']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Usage:');
    expect(res.stdout).toContain('Commands:');
  });

  it('-h exits 0 with usage text', async () => {
    var res = await runCli(['-h']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Usage:');
  });

  it('no args shows help and exits 0', async () => {
    var res = await runCli([]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Usage:');
  });

  it('unknown command exits 1', async () => {
    var res = await runCli(['foobar']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Unknown command');
  });

  it('missing required arg for search exits 1', async () => {
    await startTestServer({});
    var res = await runCli(['search']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Missing argument');
  });

  it('missing required arg for get exits 1', async () => {
    await startTestServer({});
    var res = await runCli(['get']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Missing argument');
  });

  it('missing required arg for transcribe exits 1', async () => {
    await startTestServer({});
    var res = await runCli(['transcribe']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Missing argument');
  });
});

// ── Command output formatting ──

describe('CLI commands', () => {
  it('list returns JSON array', async () => {
    await startTestServer({
      list_screenshots: async () => [{ name: 'test', category: 'code' }]
    });
    var res = await runCli(['list']);
    expect(res.code).toBe(0);
    var data = JSON.parse(res.stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe('test');
  });

  it('search passes query and returns results', async () => {
    var receivedQuery = null;
    await startTestServer({
      search_screenshots: async (params) => {
        receivedQuery = params.query;
        return [{ name: 'match', score: 0.9 }];
      }
    });
    var res = await runCli(['search', 'hello world']);
    expect(res.code).toBe(0);
    expect(receivedQuery).toBe('hello world');
    var data = JSON.parse(res.stdout);
    expect(data[0].name).toBe('match');
  });

  it('categories returns JSON array', async () => {
    await startTestServer({
      get_categories: async () => ['code', 'design', 'web']
    });
    var res = await runCli(['categories']);
    expect(res.code).toBe(0);
    var data = JSON.parse(res.stdout);
    expect(data).toContain('code');
  });

  it('get returns metadata JSON (not dataURL)', async () => {
    await startTestServer({
      get_screenshot: async () => ({
        dataURL: 'data:image/png;base64,abc',
        metadata: { name: 'test', category: 'code', tags: ['js'] }
      })
    });
    var res = await runCli(['get', '/tmp/test.png']);
    expect(res.code).toBe(0);
    var data = JSON.parse(res.stdout);
    expect(data.name).toBe('test');
    expect(data.dataURL).toBeUndefined();
  });

  it('transcribe returns plain text, not JSON', async () => {
    await startTestServer({
      transcribe_screenshot: async () => ({ text: 'Hello World', languages: ['en'] })
    });
    var res = await runCli(['transcribe', '/tmp/test.png']);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('Hello World');
    // Verify it's NOT JSON
    expect(() => JSON.parse(res.stdout)).toThrow();
  });

  it('organize returns queued message', async () => {
    await startTestServer({
      organize_screenshot: async (params) => ({ queued: true, filepath: params.filepath })
    });
    var res = await runCli(['organize', '/tmp/test.png']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Queued');
  });

  it('open returns JSON with status, path, message', async () => {
    var outPath = join(tmpDir, 'annotated.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      open_in_snip: async () => ({ outputPath: outPath, dataURL: 'data:image/png;base64,abc' })
    });
    var res = await runCli(['open', '/tmp/test.png']);
    expect(res.code).toBe(0);
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('done');
    expect(data.path).toBe(outPath);
  });

  it('--pretty flag indents JSON output', async () => {
    await startTestServer({
      get_categories: async () => ['code', 'design']
    });
    var res = await runCli(['categories', '--pretty']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('  "code"');
  });
});

// ── Parameter passing ──

describe('CLI parameter passing', () => {
  it('filepath is resolved to absolute', async () => {
    var receivedPath = null;
    await startTestServer({
      get_screenshot: async (params) => {
        receivedPath = params.filepath;
        return { metadata: { name: 'test' } };
      }
    });
    var res = await runCli(['get', 'relative.png']);
    expect(res.code).toBe(0);
    // Should be absolute, not "relative.png"
    expect(receivedPath).toContain('/');
    expect(receivedPath).not.toBe('relative.png');
  });

  it('query is passed as-is', async () => {
    var receivedQuery = null;
    await startTestServer({
      search_screenshots: async (params) => {
        receivedQuery = params.query;
        return [];
      }
    });
    await runCli(['search', 'login form with spaces']);
    expect(receivedQuery).toBe('login form with spaces');
  });
});

// ── Socket communication ──

describe('CLI socket communication', () => {
  it('handler error → CLI exits 1 with error in stderr', async () => {
    await startTestServer({
      list_screenshots: async () => { throw new Error('database locked'); }
    });
    var res = await runCli(['list']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('database locked');
  });

  it('handler returns null → CLI outputs null', async () => {
    await startTestServer({
      get_categories: async () => null
    });
    var res = await runCli(['categories']);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('null');
  });

  it('async handler response is received', async () => {
    await startTestServer({
      list_screenshots: async () => {
        await new Promise(r => setTimeout(r, 100));
        return [{ name: 'delayed' }];
      }
    });
    var res = await runCli(['list']);
    expect(res.code).toBe(0);
    var data = JSON.parse(res.stdout);
    expect(data[0].name).toBe('delayed');
  });
});

// ── Error handling ──

describe('CLI error handling', () => {
  it('no server running → exits 1 with error', async () => {
    // Don't start server — socket doesn't exist. SNIP_NO_AUTO_LAUNCH prevents launch attempt.
    var res = await runCli(['list']);
    expect(res.code).not.toBe(0);
    expect(res.stderr.toLowerCase()).toMatch(/not running|could not be launched/);
  });
});

// ── Open command specifics ──

describe('CLI open command', () => {
  it('result with outputPath → returns edited status JSON', async () => {
    var outFile = join(tmpDir, 'out.png');
    writeFileSync(outFile, 'img');
    await startTestServer({
      open_in_snip: async () => ({ outputPath: outFile })
    });
    var res = await runCli(['open', '/tmp/img.png']);
    expect(res.code).toBe(0);
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('done');
    expect(data.path).toBe(outFile);
  });

  it('result with only dataURL → saves to temp and returns path', async () => {
    // Minimal valid PNG (1x1 pixel)
    var pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await startTestServer({
      open_in_snip: async () => ({ dataURL: 'data:image/png;base64,' + pngBase64 })
    });
    var res = await runCli(['open', '/tmp/img.png']);
    expect(res.code).toBe(0);
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('done');
    expect(data.path).toContain('.tmp');
    expect(existsSync(data.path)).toBe(true);
    // Clean up
    rmSync(data.path, { force: true });
  });

  it('user cancels → exits 1 with cancelled message', async () => {
    await startTestServer({
      open_in_snip: async () => { throw new Error('User cancelled editing'); }
    });
    var res = await runCli(['open', '/tmp/img.png']);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('cancelled');
  });
});

// ── Render command ──

describe('CLI render command', () => {
  it('help text includes render command', async () => {
    var res = await runCli(['--help']);
    expect(res.stdout).toContain('render');
    expect(res.stdout).toContain('mermaid');
  });

  it('sends code and format to render_diagram action', async () => {
    var receivedParams = null;
    var outPath = join(tmpDir, 'rendered.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      render_diagram: async (params) => {
        receivedParams = params;
        return { action: 'approved', edited: false, outputPath: outPath };
      }
    });
    var res = await runCliWithStdin(['render', '--format', 'mermaid'], 'graph TD; A-->B');
    expect(res.code).toBe(0);
    expect(receivedParams.code).toBe('graph TD; A-->B');
    expect(receivedParams.format).toBe('mermaid');
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('approved');
    expect(data.edited).toBe(false);
    expect(data.path).toBe(outPath);
  });

  it('defaults format to mermaid when --format omitted', async () => {
    var receivedFormat = null;
    var outPath = join(tmpDir, 'rendered.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      render_diagram: async (params) => {
        receivedFormat = params.format;
        return { outputPath: outPath };
      }
    });
    await runCliWithStdin(['render'], 'graph TD; A-->B');
    expect(receivedFormat).toBe('mermaid');
  });

  it('empty stdin → exits 1 with error', async () => {
    await startTestServer({
      render_diagram: async () => ({})
    });
    var res = await runCliWithStdin(['render'], '');
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('empty input');
  });

  it('handler error → exits 1 with error in stderr', async () => {
    await startTestServer({
      render_diagram: async () => { throw new Error('Mermaid syntax error: invalid'); }
    });
    var res = await runCliWithStdin(['render', '--format', 'mermaid'], 'not valid');
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Mermaid syntax error');
  });
});

// ── Review mode structured output ──

describe('CLI review mode output', () => {
  it('approved without edits → status + path, no message', async () => {
    var outPath = join(tmpDir, 'img.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      open_in_snip: async () => ({ action: 'approved', edited: false, outputPath: outPath })
    });
    var res = await runCli(['open', '/tmp/test.png']);
    expect(res.code).toBe(0);
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('approved');
    expect(data.edited).toBe(false);
    expect(data.path).toBe(outPath);
    expect(data.message).toBeUndefined();
    expect(data.text).toBeUndefined();
  });

  it('approved with edits → includes message about annotations', async () => {
    var outPath = join(tmpDir, 'img.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      open_in_snip: async () => ({ action: 'approved', edited: true, outputPath: outPath })
    });
    var res = await runCli(['open', '/tmp/test.png']);
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('approved');
    expect(data.edited).toBe(true);
    expect(data.message).toContain('annotations');
  });

  it('approved with text → includes text field', async () => {
    var outPath = join(tmpDir, 'img.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      open_in_snip: async () => ({ action: 'approved', edited: false, outputPath: outPath, text: 'looks great' })
    });
    var res = await runCli(['open', '/tmp/test.png']);
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('approved');
    expect(data.text).toBe('looks great');
    expect(data.message).toBeUndefined();
  });

  it('changes_requested with text only → text field, no message', async () => {
    var outPath = join(tmpDir, 'img.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      open_in_snip: async () => ({ action: 'changes_requested', edited: false, outputPath: outPath, text: 'fix the auth flow' })
    });
    var res = await runCli(['open', '/tmp/test.png']);
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('changes_requested');
    expect(data.edited).toBe(false);
    expect(data.text).toBe('fix the auth flow');
    expect(data.message).toBeUndefined();
  });

  it('changes_requested with edits → message about annotations', async () => {
    var outPath = join(tmpDir, 'img.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      open_in_snip: async () => ({ action: 'changes_requested', edited: true, outputPath: outPath })
    });
    var res = await runCli(['open', '/tmp/test.png']);
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('changes_requested');
    expect(data.edited).toBe(true);
    expect(data.message).toContain('annotations');
    expect(data.text).toBeUndefined();
  });

  it('changes_requested with edits + text → both message and text', async () => {
    var outPath = join(tmpDir, 'img.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      open_in_snip: async () => ({ action: 'changes_requested', edited: true, outputPath: outPath, text: 'move the button' })
    });
    var res = await runCli(['open', '/tmp/test.png']);
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('changes_requested');
    expect(data.edited).toBe(true);
    expect(data.text).toBe('move the button');
    expect(data.message).toContain('annotations');
  });

  it('--message flag is passed to handler', async () => {
    var receivedParams = null;
    var outPath = join(tmpDir, 'img.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      open_in_snip: async (params) => {
        receivedParams = params;
        return { action: 'approved', edited: false, outputPath: outPath };
      }
    });
    await runCli(['open', '/tmp/test.png', '--message', 'Does this look right?']);
    expect(receivedParams.message).toBe('Does this look right?');
  });

  it('render with --message passes message to handler', async () => {
    var receivedParams = null;
    var outPath = join(tmpDir, 'img.png');
    writeFileSync(outPath, 'fake');
    await startTestServer({
      render_diagram: async (params) => {
        receivedParams = params;
        return { action: 'approved', edited: false, outputPath: outPath };
      }
    });
    await runCliWithStdin(['render', '--format', 'mermaid', '--message', 'Check the flow'], 'graph TD; A-->B');
    expect(receivedParams.message).toBe('Check the flow');
  });
});

// ── Setup command ──

describe('CLI setup command', () => {
  let fakeHome;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'snip-setup-test-'));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function runSetup(args) {
    return runCli(['setup'].concat(args || []), { env: { HOME: fakeHome } });
  }

  it('detects Claude Code and adds rules to CLAUDE.md', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    var res = await runSetup();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Detected: Claude Code');
    expect(res.stdout).toContain('rules added to');
    var content = readFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(content).toContain('<!-- snip-start -->');
    expect(content).toContain('<!-- snip-end -->');
    expect(content).toContain('snip-rules-v6');
    expect(content).toContain('# Snip');
  });

  it('detects multiple providers', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
    var res = await runSetup();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Detected: Claude Code, Cursor');
    expect(res.stdout).toContain('Claude Code');
    expect(res.stdout).toContain('Cursor');
    expect(existsSync(join(fakeHome, '.claude', 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(fakeHome, '.cursor', 'rules', 'snip.mdc'))).toBe(true);
  });

  it('no providers detected prints message and exits 0', async () => {
    var res = await runSetup();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('No supported AI tools detected');
    expect(res.stdout).toContain('Claude Code (~/.claude)');
  });

  it('idempotent — already configured shows up to date', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    await runSetup();
    var res = await runSetup();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('already configured (up to date)');
    expect(res.stdout).not.toContain('Visual mode enabled');
  });

  it('updates outdated rules', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    var oldContent = '\n<!-- snip-start -->\n# Snip\n<!-- snip-rules-v5 -->\nold rules\n<!-- snip-end -->\n';
    writeFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), oldContent);
    var res = await runSetup();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('rules updated in');
    var content = readFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(content).toContain('snip-rules-v6');
    expect(content).not.toContain('snip-rules-v5');
  });

  it('preserves existing CLAUDE.md content before markers', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), '# My Project Rules\n\nSome custom rules here.\n');
    await runSetup();
    var content = readFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(content).toContain('# My Project Rules');
    expect(content).toContain('Some custom rules here.');
    expect(content).toContain('<!-- snip-start -->');
  });

  it('preserves existing CLAUDE.md content around markers', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    var original = '# Before\n\n<!-- snip-start -->\nold\n<!-- snip-end -->\n\n# After\n';
    writeFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), original);
    await runSetup();
    var content = readFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(content).toContain('# Before');
    expect(content).toContain('# After');
    expect(content).toContain('snip-rules-v6');
  });

  it('handles empty CLAUDE.md cleanly', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), '');
    await runSetup();
    var content = readFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(content).toContain('<!-- snip-start -->');
    expect(content).toContain('snip-rules-v6');
  });

  it('--remove removes rules from CLAUDE.md', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    await runSetup();
    var res = await runSetup(['--remove']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('rules removed from');
    expect(res.stdout).toContain('Snip rules removed');
    var content = readFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(content).not.toContain('<!-- snip-start -->');
    expect(content).not.toContain('# Snip');
  });

  it('--remove preserves surrounding content in CLAUDE.md', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), '# Before\n');
    await runSetup();
    await runSetup(['--remove']);
    var content = readFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(content).toContain('# Before');
    expect(content).not.toContain('<!-- snip-start -->');
  });

  it('--remove with no rules shows no rules to remove', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    var res = await runSetup(['--remove']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('no rules to remove');
  });

  it('--remove deletes file for non-Claude providers', async () => {
    mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
    await runSetup();
    expect(existsSync(join(fakeHome, '.cursor', 'rules', 'snip.mdc'))).toBe(true);
    await runSetup(['--remove']);
    expect(existsSync(join(fakeHome, '.cursor', 'rules', 'snip.mdc'))).toBe(false);
  });

  it('--remove --provider combined targets only specified provider', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
    await runSetup();
    var res = await runSetup(['--remove', '--provider', 'cursor']);
    expect(res.stdout).toContain('Cursor');
    expect(res.stdout).not.toContain('Claude Code');
    // Cursor rules removed, Claude Code untouched
    expect(existsSync(join(fakeHome, '.cursor', 'rules', 'snip.mdc'))).toBe(false);
    var claudeContent = readFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(claudeContent).toContain('<!-- snip-start -->');
  });

  it('--provider filters to specific provider', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
    var res = await runSetup(['--provider', 'cursor']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Cursor');
    expect(res.stdout).not.toContain('Claude Code');
    expect(existsSync(join(fakeHome, '.cursor', 'rules', 'snip.mdc'))).toBe(true);
    expect(existsSync(join(fakeHome, '.claude', 'CLAUDE.md'))).toBe(false);
  });

  it('--provider with undetected tool exits 1', async () => {
    // .cursor dir does not exist
    var res = await runSetup(['--provider', 'cursor']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Cursor not detected');
    expect(res.stderr).toContain('snip setup');
  });

  it('--provider with unknown id exits 1', async () => {
    var res = await runSetup(['--provider', 'vscode']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Unknown provider');
    expect(res.stderr).toContain('claude-code');
  });

  it('global --help includes setup command', async () => {
    var res = await runCli(['--help']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('setup');
  });

  it('setup --help shows setup-specific help', async () => {
    var res = await runSetup(['--help']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Configure AI coding tools');
    expect(res.stdout).toContain('--remove');
    expect(res.stdout).toContain('--provider');
  });

  it('extra positional args are ignored', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    var res = await runCli(['setup', 'foo', 'bar'], { env: { HOME: fakeHome } });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Claude Code');
  });

  it('prints Visual mode enabled message when rules change', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    var res = await runSetup();
    expect(res.stdout).toContain('Visual mode enabled');
  });

  it('cursor rules file uses .mdc extension', async () => {
    mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
    await runSetup();
    expect(existsSync(join(fakeHome, '.cursor', 'rules', 'snip.mdc'))).toBe(true);
    var content = readFileSync(join(fakeHome, '.cursor', 'rules', 'snip.mdc'), 'utf8');
    expect(content).toContain('# Snip');
  });

  it('--remove on Claude with file but no markers shows no rules to remove', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), '# My custom content\nNo snip markers here.\n');
    var res = await runSetup(['--remove']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('no rules to remove');
    // Original content preserved
    var content = readFileSync(join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    expect(content).toContain('# My custom content');
  });

  it('non-Claude provider idempotent — already configured shows up to date', async () => {
    mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
    await runSetup(['--provider', 'cursor']);
    var res = await runSetup(['--provider', 'cursor']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('already configured (up to date)');
  });

  it('non-Claude provider updates outdated rules', async () => {
    mkdirSync(join(fakeHome, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(fakeHome, '.cursor', 'rules', 'snip.mdc'), '# Snip\n<!-- snip-rules-v5 -->\nold content\n');
    var res = await runSetup(['--provider', 'cursor']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('rules updated in');
    var content = readFileSync(join(fakeHome, '.cursor', 'rules', 'snip.mdc'), 'utf8');
    expect(content).toContain('snip-rules-v6');
    expect(content).not.toContain('snip-rules-v5');
  });

  it('--remove on non-Claude provider with no file shows no rules to remove', async () => {
    mkdirSync(join(fakeHome, '.cursor'), { recursive: true });
    var res = await runSetup(['--remove', '--provider', 'cursor']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('no rules to remove');
  });

  it('rules template matches ipc-handlers version marker', async () => {
    // Verify CLI and ipc-handlers use the same version tag
    var cliSource = readFileSync(join(__dirname, '..', '..', 'src', 'cli', 'snip.js'), 'utf8');
    var ipcSource = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'ipc-handlers.js'), 'utf8');
    var cliVersion = cliSource.match(/SNIP_RULES_VERSION = '([^']+)'/);
    var ipcVersion = ipcSource.match(/SNIP_RULES_VERSION = '([^']+)'/);
    expect(cliVersion).not.toBeNull();
    expect(ipcVersion).not.toBeNull();
    expect(cliVersion[1]).toBe(ipcVersion[1]);
  });

  // ── Permissions ──

  it('adds permissions to settings.json when SNIP_SETUP_PERMISSIONS=yes', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    var res = await runCli(['setup'], { env: { HOME: fakeHome, SNIP_SETUP_PERMISSIONS: 'yes' } });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Permissions added');
    var settings = JSON.parse(readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    expect(settings.permissions.allow).toContain('Bash(snip *)');
    expect(settings.permissions.allow).toContain('Bash(echo * | snip *)');
  });

  it('skips permissions when SNIP_SETUP_PERMISSIONS=no', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    var res = await runCli(['setup'], { env: { HOME: fakeHome, SNIP_SETUP_PERMISSIONS: 'no' } });
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain('Permissions');
    expect(existsSync(join(fakeHome, '.claude', 'settings.json'))).toBe(false);
  });

  it('skips permissions prompt when stdin is not a TTY (default in tests)', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    await runSetup();
    expect(existsSync(join(fakeHome, '.claude', 'settings.json'))).toBe(false);
  });

  it('merges permissions into existing settings.json', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: ['WebSearch', 'WebFetch'], defaultMode: 'default' },
      effortLevel: 'high'
    }, null, 2) + '\n');
    await runCli(['setup'], { env: { HOME: fakeHome, SNIP_SETUP_PERMISSIONS: 'yes' } });
    var settings = JSON.parse(readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    expect(settings.permissions.allow).toContain('WebSearch');
    expect(settings.permissions.allow).toContain('WebFetch');
    expect(settings.permissions.allow).toContain('Bash(snip *)');
    expect(settings.permissions.allow).toContain('Bash(echo * | snip *)');
    expect(settings.permissions.defaultMode).toBe('default');
    expect(settings.effortLevel).toBe('high');
  });

  it('permissions are idempotent — no duplicates on second run', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    await runCli(['setup'], { env: { HOME: fakeHome, SNIP_SETUP_PERMISSIONS: 'yes' } });
    await runCli(['setup'], { env: { HOME: fakeHome, SNIP_SETUP_PERMISSIONS: 'yes' } });
    var settings = JSON.parse(readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    var snipCount = settings.permissions.allow.filter(function (p) { return p === 'Bash(snip *)'; }).length;
    expect(snipCount).toBe(1);
  });

  it('--remove removes permissions from settings.json', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    writeFileSync(join(fakeHome, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: ['WebSearch', 'Bash(snip *)', 'Bash(echo * | snip *)'] },
      effortLevel: 'high'
    }, null, 2) + '\n');
    await runSetup(['--remove']);
    var settings = JSON.parse(readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    expect(settings.permissions.allow).toContain('WebSearch');
    expect(settings.permissions.allow).not.toContain('Bash(snip *)');
    expect(settings.permissions.allow).not.toContain('Bash(echo * | snip *)');
    expect(settings.effortLevel).toBe('high');
  });

  it('--remove with no permissions present does not mention permissions', async () => {
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    var res = await runSetup(['--remove']);
    expect(res.stdout).not.toContain('Permissions removed');
  });
});
