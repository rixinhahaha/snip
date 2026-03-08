import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parentPort } from 'worker_threads';

// Load the real store and configure it to work without Electron.
// setExternalPaths makes getScreenshotsDir() / getConfigPath() use our temp dir
// instead of calling require('electron').app.getPath().
const store = require('../../src/main/store');

// Load the real Ollama class — agent.js shares the same instance from CJS cache.
// Prototype spy on Ollama.prototype.chat intercepts all instances.
const { Ollama } = require('ollama');
const { processScreenshot } = require('../../src/main/organizer/agent');

// agent.js sends messages on parentPort when a new category is registered
// (showNotification + tags-changed). These confuse tinypool's IPC, so we
// swallow them while letting Vitest's own messages through.
const origPostMessage = parentPort.postMessage.bind(parentPort);
vi.spyOn(parentPort, 'postMessage').mockImplementation((msg, ...rest) => {
  if (msg && typeof msg === 'object' && (msg.type === 'notification' || msg.type === 'tags-changed')) {
    return;
  }
  return origPostMessage(msg, ...rest);
});

let tmpDir;
let FAKE_FILEPATH;
let spyChat, spyExistsSync, spyReadFileSync, spyRenameSync;

beforeEach(() => {
  // Fresh temp directory for each test so store operations don't need Electron
  tmpDir = mkdtempSync(join(tmpdir(), 'snip-agent-test-'));
  store.setExternalPaths(tmpDir, join(tmpDir, 'config.json'));
  store.reloadConfig();

  FAKE_FILEPATH = join(tmpDir, 'screenshot-123.png');

  spyChat = vi.spyOn(Ollama.prototype, 'chat');

  const origExistsSync = fs.existsSync.bind(fs);
  const origReadFileSync = fs.readFileSync.bind(fs);

  spyExistsSync = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    if (p === FAKE_FILEPATH) return true;
    return origExistsSync(p);
  });
  spyReadFileSync = vi.spyOn(fs, 'readFileSync').mockImplementation((p, ...args) => {
    if (p === FAKE_FILEPATH) return Buffer.from('fakepng');
    return origReadFileSync(p, ...args);
  });
  spyRenameSync = vi.spyOn(fs, 'renameSync').mockReturnValue(undefined);
});

afterEach(() => {
  spyChat?.mockRestore();
  spyExistsSync?.mockRestore();
  spyReadFileSync?.mockRestore();
  spyRenameSync?.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('processScreenshot', () => {
  it('happy path: parses response, renames file, and adds to index', async () => {
    spyChat.mockResolvedValue({
      message: {
        content: JSON.stringify({
          category: 'code',
          name: 'my-snippet',
          description: 'A Python snippet',
          tags: ['python', 'code'],
          newCategory: false,
        }),
      },
    });

    const result = await processScreenshot(FAKE_FILEPATH);

    expect(result.category).toBe('code');
    expect(result.name).toBe('my-snippet');
    expect(result.tags).toEqual(['python', 'code']);
    expect(spyRenameSync).toHaveBeenCalled();
    // Verify index was updated
    const index = store.readIndex();
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ category: 'code', name: 'my-snippet' });
  });

  it('extracts JSON from a code block wrapper', async () => {
    spyChat.mockResolvedValue({
      message: {
        content: '```json\n{"category":"web","name":"github-page","description":"A repo","tags":[],"newCategory":false}\n```',
      },
    });

    const result = await processScreenshot(FAKE_FILEPATH);
    expect(result.category).toBe('web');
    expect(result.name).toBe('github-page');
  });

  it('falls back gracefully when JSON is unparseable', async () => {
    spyChat.mockResolvedValue({
      message: { content: 'Sorry, I cannot analyze this image.' },
    });

    const result = await processScreenshot(FAKE_FILEPATH);
    expect(result.category).toBe('other');
    expect(result.name).toBe('screenshot-123');
  });

  // ── Name sanitization ──────────────────────────────────────────────────────

  it('sanitizes name: removes special chars, collapses hyphens, lowercases', async () => {
    spyChat.mockResolvedValue({
      message: {
        content: JSON.stringify({
          category: 'code',
          name: 'My Cool!! Snippet---Here',
          description: '',
          tags: [],
          newCategory: false,
        }),
      },
    });

    const result = await processScreenshot(FAKE_FILEPATH);
    expect(result.finalPath).toMatch(/my-cool-snippet-here/);
  });

  it('sanitizes name: strips leading and trailing hyphens', async () => {
    spyChat.mockResolvedValue({
      message: {
        content: JSON.stringify({
          category: 'code',
          name: '---hello---',
          description: '',
          tags: [],
          newCategory: false,
        }),
      },
    });

    const result = await processScreenshot(FAKE_FILEPATH);
    expect(result.finalPath).toMatch(/[/\\]hello\.png$/);
  });

  // ── Collision handling ─────────────────────────────────────────────────────

  it('appends counter on file name collision', async () => {
    // Override existsSync: source=true, then simulate two collisions
    spyExistsSync.mockReset();
    spyExistsSync
      .mockReturnValueOnce(true)   // source file exists
      .mockReturnValueOnce(true)   // dest path collision
      .mockReturnValueOnce(true)   // dest-1 collision
      .mockReturnValueOnce(false); // dest-2 is free

    spyChat.mockResolvedValue({
      message: {
        content: JSON.stringify({
          category: 'code', name: 'my-file', description: '', tags: [], newCategory: false,
        }),
      },
    });

    const result = await processScreenshot(FAKE_FILEPATH);
    expect(result.finalPath).toMatch(/my-file-2\.png$/);
  });

  // ── Category auto-registration ─────────────────────────────────────────────

  it('auto-registers an unknown category', async () => {
    spyChat.mockResolvedValue({
      message: {
        content: JSON.stringify({
          category: 'gaming',
          categoryDescription: 'Games and entertainment',
          name: 'fortnite-clip',
          description: '',
          tags: [],
          newCategory: true,
        }),
      },
    });

    await processScreenshot(FAKE_FILEPATH);

    // Verify the new category was registered in the store
    expect(store.getAllCategories()).toContain('gaming');
    const tags = store.getAllTagsWithDescriptions();
    expect(tags.find(t => t.name === 'gaming')?.description).toBe('Games and entertainment');
  });

  it('does NOT register a category that is already known', async () => {
    const categoriesBefore = store.getAllCategories().length;

    spyChat.mockResolvedValue({
      message: {
        content: JSON.stringify({
          category: 'code',
          name: 'snippet',
          description: '',
          tags: [],
          newCategory: false,
        }),
      },
    });

    await processScreenshot(FAKE_FILEPATH);
    expect(store.getAllCategories().length).toBe(categoriesBefore);
  });

  it('normalizes category to lowercase', async () => {
    spyChat.mockResolvedValue({
      message: {
        content: JSON.stringify({
          category: 'Gaming',
          categoryDescription: 'Games',
          name: 'game',
          description: '',
          tags: [],
          newCategory: true,
        }),
      },
    });

    const result = await processScreenshot(FAKE_FILEPATH);
    expect(result.category).toBe('gaming');
  });

  // ── Early return when file is missing ─────────────────────────────────────

  it('returns undefined when source file does not exist', async () => {
    spyExistsSync.mockReturnValue(false);
    const result = await processScreenshot(FAKE_FILEPATH);
    expect(result).toBeUndefined();
    expect(spyChat).not.toHaveBeenCalled();
  });

  // ── Ollama error propagation ───────────────────────────────────────────────

  it('throws when Ollama API call fails', async () => {
    spyChat.mockRejectedValue(new Error('Connection refused'));
    await expect(processScreenshot(FAKE_FILEPATH)).rejects.toThrow('Connection refused');
  });

  // ── textToEmbed construction ───────────────────────────────────────────────

  it('returns textToEmbed combining name, description, and tags', async () => {
    spyChat.mockResolvedValue({
      message: {
        content: JSON.stringify({
          category: 'code',
          name: 'my-snippet',
          description: 'A useful snippet',
          tags: ['python', 'util'],
          newCategory: false,
        }),
      },
    });

    const result = await processScreenshot(FAKE_FILEPATH);
    expect(result.textToEmbed).toContain('my-snippet');
    expect(result.textToEmbed).toContain('A useful snippet');
    expect(result.textToEmbed).toContain('python');
    expect(result.textToEmbed).toContain('util');
  });
});
