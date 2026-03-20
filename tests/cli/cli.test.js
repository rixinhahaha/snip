import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, chmodSync } from 'fs';
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
    execFile(NODE_PATH, [CLI_PATH].concat(args), {
      env: { ...process.env, SNIP_SOCKET_PATH: socketPath, SNIP_NO_AUTO_LAUNCH: '1' },
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
    expect(data.message).toContain('finished reviewing');
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
        return { outputPath: outPath };
      }
    });
    var res = await runCliWithStdin(['render', '--format', 'mermaid'], 'graph TD; A-->B');
    expect(res.code).toBe(0);
    expect(receivedParams.code).toBe('graph TD; A-->B');
    expect(receivedParams.format).toBe('mermaid');
    var data = JSON.parse(res.stdout);
    expect(data.status).toBe('done');
    expect(data.path).toBe(outPath);
    expect(data.message).toContain('annotating the diagram');
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
