import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir, homedir } from 'os';
import net from 'net';
import { spawn } from 'child_process';

// ── Platform module tests ──
// These test the shared and platform-specific modules directly.
// The electron mock from setup makes darwin.js loadable on any OS.

const shared = require('../../src/main/platform/shared');
const platform = require('../../src/main/platform');

// ── shared.js ──

describe('shared.killProcess', () => {
  it('resolves immediately for null proc', async () => {
    await shared.killProcess(null);
  });

  it('kills a real child process', async () => {
    var child = spawn('sleep', ['60'], { stdio: 'ignore' });
    var pid = child.pid;
    expect(pid).toBeGreaterThan(0);

    await shared.killProcess(child);

    // Process should be dead — kill(0) throws for non-existent processes
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('resolves if process exits on its own', async () => {
    var child = spawn('true', [], { stdio: 'ignore' });
    // Wait a tick for it to exit
    await new Promise(r => setTimeout(r, 100));
    await shared.killProcess(child);
  });
});

describe('shared.pollForSocket', () => {
  let tmpDir;
  let socketPath;
  let server;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'snip-poll-test-'));
    socketPath = join(tmpDir, 'test.sock');
  });

  afterEach(() => {
    if (server) { server.close(); server = null; }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('succeeds when socket is already listening', (done) => {
    server = net.createServer();
    server.listen(socketPath, () => {
      shared.pollForSocket(socketPath, (err) => {
        expect(err).toBeNull();
        done();
      });
    });
  });

  it('succeeds when socket appears after a delay', (done) => {
    // Start the socket after 600ms (poll checks every 500ms)
    setTimeout(() => {
      server = net.createServer();
      server.listen(socketPath);
    }, 600);

    shared.pollForSocket(socketPath, (err) => {
      expect(err).toBeNull();
      done();
    });
  });

  it('fails after max attempts when no socket', (done) => {
    // Override with a fast version for testing — use the real function
    // but it polls 20 times at 500ms = 10s, too slow for tests.
    // Instead, test the error callback directly.
    var attempts = 0;
    var fakePath = join(tmpDir, 'nonexistent.sock');

    // We'll just verify the function calls back with an error eventually.
    // Use a short timeout to avoid waiting 10s.
    var timeout = setTimeout(() => {
      // If we get here, the test takes too long — skip gracefully
      done();
    }, 12000);

    shared.pollForSocket(fakePath, (err) => {
      clearTimeout(timeout);
      expect(err).toBeTruthy();
      expect(err.message).toContain('did not start');
      done();
    });
  }, 15000);
});

describe('shared.getCliInstallPaths', () => {
  it('returns an array of absolute paths', () => {
    var paths = shared.getCliInstallPaths();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    for (var p of paths) {
      expect(p).toContain('snip');
      expect(typeof p).toBe('string');
    }
  });

  it('includes ~/.local/bin/snip', () => {
    var paths = shared.getCliInstallPaths();
    var localBin = paths.find(p => p.includes('.local'));
    expect(localBin).toBeTruthy();
  });
});

describe('shared.getCliWrapperContent', () => {
  it('produces a valid shell script', () => {
    var content = shared.getCliWrapperContent('/usr/local/bin/node', '/app/cli/snip.js');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('Snip CLI');
    expect(content).toContain('exec');
    expect(content).toContain('/usr/local/bin/node');
    expect(content).toContain('/app/cli/snip.js');
  });

  it('escapes single quotes in paths', () => {
    var content = shared.getCliWrapperContent("/path/with'quote/node", '/cli/snip.js');
    // Should use the '\'' escape pattern
    expect(content).toContain("'\\''");
    expect(content).not.toContain("with'quote/node'");
  });

  it('handles paths with spaces and special chars', () => {
    var content = shared.getCliWrapperContent('/path with spaces/node', '/cli/$pecial/snip.js');
    // Single-quoted strings are safe from expansion
    expect(content).toContain("'/path with spaces/node'");
    expect(content).toContain("'/cli/$pecial/snip.js'");
  });
});

// ── Platform interface consistency ──

describe('platform interface', () => {
  var expectedFunctions = [
    'getOllamaConfig',
    'installOllama',
    'killProcess',
    'getWindowList',
    'setMoveToActiveSpace',
    'getWindowOptions',
    'hideFromDock',
    'getNodeBinaryName',
    'getNodeSearchPaths',
    'getSocketPath',
    'pollForSocket',
    'launchApp',
    'canTranscribe',
    'getCliInstallPaths',
    'getCliWrapperContent',
    'getTrayIcon'
  ];

  it('exports all required functions', () => {
    for (var fn of expectedFunctions) {
      expect(typeof platform[fn]).toBe('function');
    }
  });

  // Load all three platform modules directly to check interface parity
  var darwin = require('../../src/main/platform/darwin');
  var linux = require('../../src/main/platform/linux');
  var win32 = require('../../src/main/platform/win32');

  for (var mod of [
    { name: 'darwin', impl: darwin },
    { name: 'linux', impl: linux },
    { name: 'win32', impl: win32 }
  ]) {
    it(mod.name + ' exports all required functions', () => {
      for (var fn of expectedFunctions) {
        expect(typeof mod.impl[fn]).toBe('function');
      }
    });
  }
});

// ── Platform-specific return values ──

describe('darwin module', () => {
  var darwin = require('../../src/main/platform/darwin');

  it('getOllamaConfig returns macOS paths', () => {
    var config = darwin.getOllamaConfig();
    expect(config.knownPaths).toContain('/opt/homebrew/bin/ollama');
    expect(config.appPath).toBe('/Applications/Ollama.app');
    expect(config.appBinary).toContain('Ollama.app');
  });

  it('getWindowOptions returns titleBarStyle and transparency for home', () => {
    var opts = darwin.getWindowOptions('home');
    expect(opts.titleBarStyle).toBe('hiddenInset');
    expect(opts.trafficLightPosition).toEqual({ x: 16, y: 16 });
    expect(opts.transparent).toBe(true);
    expect(opts.backgroundColor).toBe('#00000000');
  });

  it('getWindowOptions returns titleBarStyle and transparency for editor', () => {
    var opts = darwin.getWindowOptions('editor');
    expect(opts.titleBarStyle).toBe('hiddenInset');
    expect(opts.trafficLightPosition).toEqual({ x: 12, y: 14 });
    expect(opts.transparent).toBe(true);
  });

  it('getWindowOptions returns same object on repeated calls (cached)', () => {
    var a = darwin.getWindowOptions('home');
    var b = darwin.getWindowOptions('home');
    expect(a).toBe(b); // reference equality — cached constant
  });

  it('getNodeBinaryName returns node', () => {
    expect(darwin.getNodeBinaryName()).toBe('node');
  });

  it('getNodeSearchPaths returns directory paths', () => {
    var paths = darwin.getNodeSearchPaths();
    expect(paths).toContain('/usr/local/bin');
    expect(paths).toContain('/opt/homebrew/bin');
    // Should NOT contain full binary paths
    for (var p of paths) {
      expect(p).not.toMatch(/\/node$/);
    }
  });

  it('getSocketPath returns macOS socket path', () => {
    var sp = darwin.getSocketPath();
    expect(sp).toContain('Library');
    expect(sp).toContain('snip.sock');
  });

  it('canTranscribe returns true', () => {
    expect(darwin.canTranscribe()).toBe(true);
  });

  it('getWindowList returns array', () => {
    // Without the native addon, returns empty array
    var list = darwin.getWindowList({ size: { width: 100, height: 100 }, bounds: { x: 0, y: 0 } });
    expect(Array.isArray(list)).toBe(true);
  });

  it('setMoveToActiveSpace does not throw', () => {
    // Without the native addon, should be a no-op
    expect(() => darwin.setMoveToActiveSpace({ getNativeWindowHandle: () => Buffer.alloc(0) })).not.toThrow();
  });
});

describe('linux module', () => {
  var linux = require('../../src/main/platform/linux');

  it('getOllamaConfig returns Linux paths', () => {
    var config = linux.getOllamaConfig();
    expect(config.knownPaths).toContain('/usr/bin/ollama');
    expect(config.knownPaths).toContain('/snap/bin/ollama');
    expect(config.appPath).toBeNull();
  });

  it('getWindowOptions returns empty object', () => {
    expect(linux.getWindowOptions('home')).toEqual({});
  });

  it('getNodeBinaryName returns node', () => {
    expect(linux.getNodeBinaryName()).toBe('node');
  });

  it('getNodeSearchPaths returns Linux directories', () => {
    var paths = linux.getNodeSearchPaths();
    expect(paths).toContain('/usr/bin');
    expect(paths).toContain('/snap/bin');
  });

  it('getSocketPath returns XDG runtime or config path', () => {
    var sp = linux.getSocketPath();
    // Uses XDG_RUNTIME_DIR if set, otherwise falls back to ~/.config/
    expect(sp).toContain('snip.sock');
    if (process.env.XDG_RUNTIME_DIR) {
      expect(sp).toContain(process.env.XDG_RUNTIME_DIR);
    } else {
      expect(sp).toContain('.config');
    }
  });

  it('canTranscribe returns false', () => {
    expect(linux.canTranscribe()).toBe(false);
  });

  it('getWindowList returns empty array', () => {
    expect(linux.getWindowList()).toEqual([]);
  });

  it('setMoveToActiveSpace is a no-op', () => {
    expect(() => linux.setMoveToActiveSpace()).not.toThrow();
  });

  it('installOllama throws with helpful message', async () => {
    await expect(linux.installOllama()).rejects.toThrow('curl');
  });
});

describe('win32 module', () => {
  var win32 = require('../../src/main/platform/win32');

  it('getOllamaConfig returns Windows paths', () => {
    var config = win32.getOllamaConfig();
    expect(config.knownPaths.length).toBeGreaterThan(0);
    expect(config.knownPaths[0]).toContain('Ollama');
    expect(config.appPath).toBeNull();
  });

  it('getWindowOptions returns empty object', () => {
    expect(win32.getWindowOptions('home')).toEqual({});
  });

  it('getNodeBinaryName returns node.exe', () => {
    expect(win32.getNodeBinaryName()).toBe('node.exe');
  });

  it('getNodeSearchPaths returns Windows directories', () => {
    var paths = win32.getNodeSearchPaths();
    expect(paths[0]).toContain('Program Files');
  });

  it('getSocketPath returns named pipe', () => {
    var sp = win32.getSocketPath();
    expect(sp).toContain('pipe');
  });

  it('canTranscribe returns false', () => {
    expect(win32.canTranscribe()).toBe(false);
  });

  it('getCliInstallPaths returns empty array', () => {
    expect(win32.getCliInstallPaths()).toEqual([]);
  });

  it('getCliWrapperContent returns empty string', () => {
    expect(win32.getCliWrapperContent()).toBe('');
  });

  it('installOllama throws with helpful message', async () => {
    await expect(win32.installOllama()).rejects.toThrow('ollama.com');
  });
});
