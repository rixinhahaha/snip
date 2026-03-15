import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, statSync, writeFileSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import net from 'net';

const store = require('../../src/main/store');

// ── Helpers ──

let tmpDir;
let tmpConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'snip-mcp-test-'));
  tmpConfig = join(tmpDir, 'config.json');
  store.setExternalPaths(tmpDir, tmpConfig);
  store.reloadConfig();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Send a JSON message over a socket and read the response. */
function socketRequest(socketPath, msg) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath);
    let buffer = '';
    conn.on('connect', () => {
      conn.write(JSON.stringify(msg) + '\n');
    });
    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        conn.end();
        try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
      }
    });
    conn.on('error', reject);
  });
}

/** Send raw string over socket and read response (with close handling). */
function socketRaw(socketPath, raw) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath);
    let buffer = '';
    let resolved = false;
    conn.on('connect', () => { conn.write(raw); });
    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      const idx = buffer.indexOf('\n');
      if (idx !== -1 && !resolved) {
        resolved = true;
        const line = buffer.slice(0, idx).trim();
        conn.end();
        try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
      }
    });
    conn.on('close', () => { if (!resolved) { resolved = true; resolve(null); } });
    conn.on('error', (err) => { if (!resolved) { resolved = true; reject(err); } });
  });
}

/** Write data to socket and wait for it to close (no response expected). */
function socketWriteUntilClose(socketPath, data) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath);
    conn.on('connect', () => {
      conn.write(data, (err) => { if (err) resolve('write-error'); });
    });
    conn.on('close', () => resolve('closed'));
    conn.on('error', () => resolve('error'));
    setTimeout(() => resolve('timeout'), 3000);
  });
}

/** Send multiple messages on one connection and collect responses. */
function socketMulti(socketPath, messages) {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath);
    let buffer = '';
    const responses = [];
    conn.on('connect', () => {
      for (const msg of messages) {
        conn.write(JSON.stringify(msg) + '\n');
      }
    });
    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) {
          try { responses.push(JSON.parse(line)); } catch (e) { reject(e); }
        }
        if (responses.length === messages.length) {
          conn.end();
          resolve(responses);
        }
      }
    });
    conn.on('error', reject);
  });
}

/**
 * Create a minimal socket server that mirrors socket-server.js logic
 * but takes an explicit path instead of reading app.getPath('userData').
 * This avoids needing to mock electron's app module.
 */
function createTestSocketServer(socketPath, handlers) {
  const fs = require('fs');
  try { fs.unlinkSync(socketPath); } catch {}

  const server = net.createServer(function (conn) {
    let buffer = '';
    conn.on('data', function (chunk) {
      buffer += chunk.toString();
      if (buffer.length > 16 * 1024 * 1024) {
        conn.destroy();
        buffer = '';
        return;
      }
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        var line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          var msg = JSON.parse(line);
          handleMsg(conn, msg, handlers);
        } catch {
          sendRes(conn, null, null, 'Invalid JSON');
        }
      }
    });
    conn.on('error', function () {});
  });

  async function handleMsg(conn, msg, handlers) {
    var id = msg.id != null ? msg.id : null;
    var action = msg.action;
    var params = msg.params || {};
    if (!action) { sendRes(conn, id, null, 'Missing "action" field'); return; }
    var handler = handlers[action];
    if (!handler) { sendRes(conn, id, null, 'Unknown action: ' + action); return; }
    try {
      var result = await handler(params);
      sendRes(conn, id, result, null);
    } catch (err) {
      sendRes(conn, id, null, err.message || String(err));
    }
  }

  function sendRes(conn, id, result, error) {
    var response = { id: id };
    if (error) { response.error = error; } else { response.result = result; }
    try { conn.write(JSON.stringify(response) + '\n'); } catch {}
  }

  server.listen(socketPath, function () {
    try { chmodSync(socketPath, 0o600); } catch {}
  });

  return {
    stop: function () {
      server.close();
      try { fs.unlinkSync(socketPath); } catch {}
    },
    waitReady: function () {
      return new Promise((resolve) => {
        const check = () => {
          if (existsSync(socketPath)) {
            // Small delay to ensure listen callback (chmod) has completed
            setTimeout(resolve, 15);
            return;
          }
          setTimeout(check, 10);
        };
        check();
      });
    }
  };
}

// ── Store: getMcpConfig / setMcpConfig ──

describe('getMcpConfig', () => {
  it('returns defaults when config is empty', () => {
    const config = store.getMcpConfig();
    expect(config.enabled).toBe(false);
    expect(config.categories.library).toBe(true);
    expect(config.categories.upload).toBe(true);
    expect(config.categories.transcribe).toBe(true);
    expect(config.categories.organize).toBe(true);
  });

  it('returns enabled=true after setMcpConfig({ enabled: true })', () => {
    store.setMcpConfig({ enabled: true });
    expect(store.getMcpConfig().enabled).toBe(true);
  });

  it('persists per-category toggle', () => {
    store.setMcpConfig({ categories: { library: false } });
    const config = store.getMcpConfig();
    expect(config.categories.library).toBe(false);
    expect(config.categories.upload).toBe(true);
    expect(config.categories.transcribe).toBe(true);
  });

  it('partial update merges without wiping other categories', () => {
    store.setMcpConfig({ categories: { library: false } });
    store.setMcpConfig({ categories: { upload: false } });
    const config = store.getMcpConfig();
    expect(config.categories.library).toBe(false);
    expect(config.categories.upload).toBe(false);
    expect(config.categories.transcribe).toBe(true);
  });

  it('rejects unknown category keys', () => {
    store.setMcpConfig({ categories: { evil_key: true, nonexistent: true } });
    const config = store.getMcpConfig();
    expect(config.categories).not.toHaveProperty('evil_key');
    expect(config.categories).not.toHaveProperty('nonexistent');
  });

  it('coerces category values to boolean', () => {
    store.setMcpConfig({ categories: { library: 0, upload: 'yes' } });
    const config = store.getMcpConfig();
    expect(config.categories.library).toBe(false);
    expect(config.categories.upload).toBe(true);
  });

  it('coerces enabled to boolean', () => {
    store.setMcpConfig({ enabled: 1 });
    expect(store.getMcpConfig().enabled).toBe(true);
    store.setMcpConfig({ enabled: '' });
    expect(store.getMcpConfig().enabled).toBe(false);
  });

  it('survives reload from disk', () => {
    store.setMcpConfig({ enabled: true, categories: { library: false } });
    store.reloadConfig();
    const config = store.getMcpConfig();
    expect(config.enabled).toBe(true);
    expect(config.categories.library).toBe(false);
  });

  it('setMcpConfig without categories does not affect categories', () => {
    store.setMcpConfig({ categories: { library: false } });
    store.setMcpConfig({ enabled: true });
    expect(store.getMcpConfig().categories.library).toBe(false);
  });

  it('setMcpConfig without enabled does not affect enabled', () => {
    store.setMcpConfig({ enabled: true });
    store.setMcpConfig({ categories: { library: false } });
    expect(store.getMcpConfig().enabled).toBe(true);
  });
});

// ── Socket Server ──

describe('socket-server', () => {
  let socketPath;
  let server;

  beforeEach(() => {
    socketPath = join(tmpDir, 'test.sock');
  });

  afterEach(() => {
    if (server) { server.stop(); server = null; }
  });

  async function start(handlers) {
    server = createTestSocketServer(socketPath, handlers || {});
    await server.waitReady();
  }

  it('dispatches action to handler and returns result', async () => {
    await start({ ping: async () => ({ pong: true }) });
    const res = await socketRequest(socketPath, { id: '1', action: 'ping' });
    expect(res.id).toBe('1');
    expect(res.result).toEqual({ pong: true });
    expect(res.error).toBeUndefined();
  });

  it('returns error for missing action field', async () => {
    await start({});
    const res = await socketRequest(socketPath, { id: '2' });
    expect(res.id).toBe('2');
    expect(res.error).toContain('Missing "action"');
  });

  it('returns error for unknown action', async () => {
    await start({});
    const res = await socketRequest(socketPath, { id: '3', action: 'nope' });
    expect(res.error).toContain('Unknown action');
  });

  it('returns handler error message when handler throws', async () => {
    await start({ fail: async () => { throw new Error('boom'); } });
    const res = await socketRequest(socketPath, { id: '4', action: 'fail' });
    expect(res.error).toBe('boom');
  });

  it('returns error for malformed JSON', async () => {
    await start({});
    const res = await socketRaw(socketPath, 'not json\n');
    expect(res.error).toContain('Invalid JSON');
  });

  it('handles multiple messages on one connection', async () => {
    let counter = 0;
    await start({ count: async () => ({ n: ++counter }) });
    const responses = await socketMulti(socketPath, [
      { id: 'a', action: 'count' },
      { id: 'b', action: 'count' },
      { id: 'c', action: 'count' }
    ]);
    expect(responses).toHaveLength(3);
    expect(responses[0].result.n).toBe(1);
    expect(responses[1].result.n).toBe(2);
    expect(responses[2].result.n).toBe(3);
  });

  it('stop cleans up socket file', async () => {
    await start({});
    expect(existsSync(socketPath)).toBe(true);
    server.stop();
    server = null;
    expect(existsSync(socketPath)).toBe(false);
  });

  it('socket file has 0600 permissions', async () => {
    await start({});
    const stat = statSync(socketPath);
    const perms = stat.mode & 0o777;
    expect(perms).toBe(0o600);
  });

  it('passes params to handler', async () => {
    await start({ echo: async (params) => params });
    const res = await socketRequest(socketPath, { id: '5', action: 'echo', params: { foo: 'bar' } });
    expect(res.result).toEqual({ foo: 'bar' });
  });

  it('defaults params to empty object when not provided', async () => {
    await start({ echo: async (params) => params });
    const res = await socketRequest(socketPath, { id: '6', action: 'echo' });
    expect(res.result).toEqual({});
  });

  it('returns async handler results', async () => {
    await start({
      delayed: async () => {
        await new Promise(r => setTimeout(r, 10));
        return { done: true };
      }
    });
    const res = await socketRequest(socketPath, { id: '7', action: 'delayed' });
    expect(res.result).toEqual({ done: true });
  });
});

// ── Category gating (integration via socket) ──

describe('category gating', () => {
  let socketPath;
  let server;

  beforeEach(() => {
    socketPath = join(tmpDir, 'gate.sock');
  });

  afterEach(() => {
    if (server) { server.stop(); server = null; }
  });

  function startGatedServer() {
    server = createTestSocketServer(socketPath, {
      test_action: async () => {
        const config = store.getMcpConfig();
        if (!config.categories.library) {
          throw new Error('library is disabled in MCP settings');
        }
        return { ok: true };
      }
    });
    return server.waitReady();
  }

  it('handler executes when category is enabled', async () => {
    store.setMcpConfig({ enabled: true, categories: { library: true } });
    await startGatedServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'test_action' });
    expect(res.result).toEqual({ ok: true });
  });

  it('handler returns error when category is disabled', async () => {
    store.setMcpConfig({ enabled: true, categories: { library: false } });
    await startGatedServer();
    const res = await socketRequest(socketPath, { id: '2', action: 'test_action' });
    expect(res.error).toContain('disabled');
  });

  it('toggling category changes handler behavior', async () => {
    store.setMcpConfig({ enabled: true, categories: { library: true } });
    await startGatedServer();

    const res1 = await socketRequest(socketPath, { id: '1', action: 'test_action' });
    expect(res1.result).toEqual({ ok: true });

    store.setMcpConfig({ categories: { library: false } });

    const res2 = await socketRequest(socketPath, { id: '2', action: 'test_action' });
    expect(res2.error).toContain('disabled');
  });

  it('enabling category after disable allows execution', async () => {
    store.setMcpConfig({ enabled: true, categories: { library: false } });
    await startGatedServer();

    const res1 = await socketRequest(socketPath, { id: '1', action: 'test_action' });
    expect(res1.error).toContain('disabled');

    store.setMcpConfig({ categories: { library: true } });

    const res2 = await socketRequest(socketPath, { id: '2', action: 'test_action' });
    expect(res2.result).toEqual({ ok: true });
  });

  it('error message includes category name', async () => {
    store.setMcpConfig({ enabled: true, categories: { library: false } });
    await startGatedServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'test_action' });
    expect(res.error).toBe('library is disabled in MCP settings');
  });
});

// ── Path validation (mirrors requireScreenshotPath logic) ──

describe('requireScreenshotPath', () => {
  let socketPath;
  let server;

  beforeEach(() => {
    socketPath = join(tmpDir, 'path.sock');
  });

  afterEach(() => {
    if (server) { server.stop(); server = null; }
  });

  /** Mirrors the production requireScreenshotPath from main.js */
  function validatePath(filepath) {
    const screenshotsDir = store.getScreenshotsDir();
    if (!filepath) throw new Error('Missing filepath parameter');
    var resolved = resolve(filepath);
    var base = resolve(screenshotsDir);
    if (!resolved.startsWith(base + '/') && resolved !== base) {
      throw new Error('Path outside screenshots directory');
    }
    if (!existsSync(resolved)) {
      throw new Error('File not found');
    }
    return resolved;
  }

  function startPathServer() {
    server = createTestSocketServer(socketPath, {
      read_file: async (params) => {
        var validated = validatePath(params.filepath);
        return { path: validated };
      }
    });
    return server.waitReady();
  }

  it('allows path inside screenshots directory', async () => {
    var filePath = join(tmpDir, 'test.png');
    writeFileSync(filePath, 'fake image');
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: { filepath: filePath } });
    expect(res.result.path).toBe(filePath);
  });

  it('rejects missing filepath parameter', async () => {
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: {} });
    expect(res.error).toBe('Missing filepath parameter');
  });

  it('rejects null filepath', async () => {
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: { filepath: null } });
    expect(res.error).toBe('Missing filepath parameter');
  });

  it('rejects empty string filepath', async () => {
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: { filepath: '' } });
    expect(res.error).toBe('Missing filepath parameter');
  });

  it('rejects path traversal with ../', async () => {
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: { filepath: join(tmpDir, '..', 'etc', 'passwd') } });
    expect(res.error).toBe('Path outside screenshots directory');
  });

  it('rejects path traversal to sibling directory', async () => {
    var siblingDir = mkdtempSync(join(tmpdir(), 'snip-sibling-'));
    var siblingFile = join(siblingDir, 'secret.txt');
    writeFileSync(siblingFile, 'secret');
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: { filepath: siblingFile } });
    expect(res.error).toBe('Path outside screenshots directory');
    rmSync(siblingDir, { recursive: true, force: true });
  });

  it('rejects absolute path outside screenshots dir', async () => {
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: { filepath: '/tmp/evil.txt' } });
    expect(res.error).toBe('Path outside screenshots directory');
  });

  it('rejects file that does not exist (inside screenshots dir)', async () => {
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: { filepath: join(tmpDir, 'nonexistent.png') } });
    expect(res.error).toBe('File not found');
  });

  it('allows files in subdirectories of screenshots dir', async () => {
    var subdir = join(tmpDir, 'code');
    mkdirSync(subdir);
    var filePath = join(subdir, 'test.png');
    writeFileSync(filePath, 'fake image');
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: { filepath: filePath } });
    expect(res.result.path).toBe(filePath);
  });

  it('rejects path that is a prefix match but not a real subdirectory', async () => {
    // e.g., if screenshotsDir is /tmp/snip-mcp-test-abc, reject /tmp/snip-mcp-test-abcDEF/file
    var prefixDir = tmpDir + 'EXTRA';
    mkdirSync(prefixDir);
    var filePath = join(prefixDir, 'trick.png');
    writeFileSync(filePath, 'trick');
    await startPathServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'read_file', params: { filepath: filePath } });
    expect(res.error).toBe('Path outside screenshots directory');
    rmSync(prefixDir, { recursive: true, force: true });
  });
});

// ── open_in_snip validation ──

describe('open_in_snip validation', () => {
  let socketPath;
  let server;

  beforeEach(() => {
    socketPath = join(tmpDir, 'upload.sock');
  });

  afterEach(() => {
    if (server) { server.stop(); server = null; }
  });

  function startUploadServer() {
    let pendingResolve = null;

    server = createTestSocketServer(socketPath, {
      open_in_snip: async (params) => {
        // Category check
        const config = store.getMcpConfig();
        if (!config.categories.upload) throw new Error('upload is disabled in MCP settings');

        // Missing param
        if (!params.imageDataURL) throw new Error('Missing imageDataURL parameter');

        // Size check (mirrors main.js)
        var commaIdx = params.imageDataURL.indexOf(',');
        var base64Len = commaIdx >= 0 ? params.imageDataURL.length - commaIdx - 1 : params.imageDataURL.length;
        if (base64Len > 20 * 1024 * 1024) throw new Error('Image too large (max ~15 MB)');

        // Busy check
        if (pendingResolve) throw new Error('Editor is busy with another upload');

        return { accepted: true };
      }
    });
    return server.waitReady();
  }

  it('rejects when upload category is disabled', async () => {
    store.setMcpConfig({ enabled: true, categories: { upload: false } });
    await startUploadServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'open_in_snip', params: { imageDataURL: 'data:image/png;base64,abc' } });
    expect(res.error).toContain('upload is disabled');
  });

  it('rejects missing imageDataURL', async () => {
    store.setMcpConfig({ enabled: true });
    await startUploadServer();
    const res = await socketRequest(socketPath, { id: '1', action: 'open_in_snip', params: {} });
    expect(res.error).toBe('Missing imageDataURL parameter');
  });

  it('rejects oversized base64 payload via size check', async () => {
    store.setMcpConfig({ enabled: true });
    await startUploadServer();
    // Use a payload under 16MB socket limit but over 20MB base64 check
    // is impossible since 20MB > 16MB. Instead test a payload that passes
    // socket but is checked by the handler — use a smaller threshold test.
    // The real protection is the socket's 16MB buffer limit which is tested
    // in the buffer overflow section. Here we test the handler logic with
    // a payload that fits in the socket but exceeds the handler's check.
    // We lower the check in our test handler to 1KB to verify the logic.
    server.stop();
    server = null;

    server = createTestSocketServer(socketPath, {
      open_in_snip: async (params) => {
        if (!params.imageDataURL) throw new Error('Missing imageDataURL parameter');
        var commaIdx = params.imageDataURL.indexOf(',');
        var base64Len = commaIdx >= 0 ? params.imageDataURL.length - commaIdx - 1 : params.imageDataURL.length;
        // Use 1KB threshold for testing
        if (base64Len > 1024) throw new Error('Image too large (max ~15 MB)');
        return { accepted: true };
      }
    });
    await server.waitReady();

    var bigPayload = 'data:image/png;base64,' + 'A'.repeat(2048);
    const res = await socketRequest(socketPath, { id: '1', action: 'open_in_snip', params: { imageDataURL: bigPayload } });
    expect(res.error).toContain('Image too large');
  });

  it('size check counts base64 after comma correctly', async () => {
    store.setMcpConfig({ enabled: true });
    await startUploadServer();
    // Small valid payload passes
    const res = await socketRequest(socketPath, { id: '1', action: 'open_in_snip', params: { imageDataURL: 'data:image/png;base64,iVBOR' } });
    expect(res.result).toEqual({ accepted: true });
  });

  it('size check handles data URL without comma', async () => {
    store.setMcpConfig({ enabled: true });
    // Start with low threshold to test the no-comma branch
    if (server) { server.stop(); server = null; }

    server = createTestSocketServer(socketPath, {
      open_in_snip: async (params) => {
        if (!params.imageDataURL) throw new Error('Missing imageDataURL parameter');
        var commaIdx = params.imageDataURL.indexOf(',');
        var base64Len = commaIdx >= 0 ? params.imageDataURL.length - commaIdx - 1 : params.imageDataURL.length;
        if (base64Len > 100) throw new Error('Image too large (max ~15 MB)');
        return { accepted: true };
      }
    });
    await server.waitReady();

    var noComma = 'A'.repeat(200);
    const res = await socketRequest(socketPath, { id: '1', action: 'open_in_snip', params: { imageDataURL: noComma } });
    expect(res.error).toContain('Image too large');
  });
});

// ── Buffer overflow protection ──

describe('buffer overflow', () => {
  let socketPath;
  let server;

  beforeEach(() => {
    socketPath = join(tmpDir, 'overflow.sock');
  });

  afterEach(() => {
    if (server) { server.stop(); server = null; }
  });

  it('destroys connection when buffer exceeds 16 MB without a newline', async () => {
    server = createTestSocketServer(socketPath, {});
    await server.waitReady();

    // Send 17 MB of data without a newline
    var bigData = Buffer.alloc(17 * 1024 * 1024, 'x');
    var result = await socketWriteUntilClose(socketPath, bigData);
    expect(result).not.toBe('timeout');
  });

  it('handles normal-sized messages after server starts', async () => {
    server = createTestSocketServer(socketPath, {
      ping: async () => ({ ok: true })
    });
    await server.waitReady();

    // Normal message should still work
    const res = await socketRequest(socketPath, { id: '1', action: 'ping' });
    expect(res.result).toEqual({ ok: true });
  });
});

// ── Socket edge cases ──

describe('socket edge cases', () => {
  let socketPath;
  let server;

  beforeEach(() => {
    socketPath = join(tmpDir, 'edge.sock');
  });

  afterEach(() => {
    if (server) { server.stop(); server = null; }
  });

  it('skips empty lines between messages', async () => {
    server = createTestSocketServer(socketPath, {
      ping: async () => ({ ok: true })
    });
    await server.waitReady();

    // Send empty lines before a valid message
    const res = await socketRaw(socketPath, '\n\n\n{"id":"1","action":"ping"}\n');
    expect(res.result).toEqual({ ok: true });
  });

  it('id: 0 is preserved in response', async () => {
    server = createTestSocketServer(socketPath, {
      ping: async () => ({ ok: true })
    });
    await server.waitReady();

    const res = await socketRequest(socketPath, { id: 0, action: 'ping' });
    expect(res.id).toBe(0);
  });

  it('handles handler that returns null', async () => {
    server = createTestSocketServer(socketPath, {
      nothing: async () => null
    });
    await server.waitReady();

    const res = await socketRequest(socketPath, { id: '1', action: 'nothing' });
    expect(res.result).toBe(null);
    expect(res.error).toBeUndefined();
  });

  it('handles handler that returns undefined', async () => {
    server = createTestSocketServer(socketPath, {
      undef: async () => undefined
    });
    await server.waitReady();

    const res = await socketRequest(socketPath, { id: '1', action: 'undef' });
    expect(res.error).toBeUndefined();
  });
});
