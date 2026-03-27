import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join, sep } from 'path';
import { tmpdir } from 'os';

const store = require('../../src/main/store');

let tmpDir;
let tmpConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'snip-test-'));
  tmpConfig = join(tmpDir, 'config.json');
  store.setExternalPaths(tmpDir, tmpConfig);
  store.reloadConfig();
});

afterEach(() => {
  store.flushConfig(); // cancel any pending debounced write
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Categories ────────────────────────────────────────────────────────────────

describe('getAllCategories', () => {
  it('returns the 9 default categories when config is empty', () => {
    const cats = store.getAllCategories();
    expect(cats).toContain('code');
    expect(cats).toContain('other');
    expect(cats.length).toBeGreaterThanOrEqual(9);
  });

  it('includes custom categories after defaults', () => {
    store.addCustomCategory('gaming');
    const cats = store.getAllCategories();
    expect(cats).toContain('gaming');
  });

  it('does not duplicate defaults', () => {
    const cats = store.getAllCategories();
    const unique = new Set(cats);
    expect(unique.size).toBe(cats.length);
  });
});

describe('addCustomCategory', () => {
  it('adds a new category', () => {
    store.addCustomCategory('gaming');
    expect(store.getAllCategories()).toContain('gaming');
  });

  it('normalizes to lowercase', () => {
    store.addCustomCategory('Gaming');
    expect(store.getAllCategories()).toContain('gaming');
    expect(store.getAllCategories()).not.toContain('Gaming');
  });

  it('trims whitespace', () => {
    store.addCustomCategory('  gaming  ');
    expect(store.getAllCategories()).toContain('gaming');
  });

  it('does not add duplicate custom categories', () => {
    store.addCustomCategory('gaming');
    store.addCustomCategory('gaming');
    const cats = store.getAllCategories();
    expect(cats.filter(c => c === 'gaming')).toHaveLength(1);
  });

  it('does not add a category that already exists as a default', () => {
    const before = store.getAllCategories().length;
    store.addCustomCategory('code'); // 'code' is a default
    expect(store.getAllCategories().length).toBe(before);
  });
});

describe('removeCustomCategory', () => {
  it('removes an existing custom category', () => {
    store.addCustomCategory('gaming');
    store.removeCustomCategory('gaming');
    expect(store.getAllCategories()).not.toContain('gaming');
  });

  it('no-op for non-existent category', () => {
    const before = store.getAllCategories().length;
    store.removeCustomCategory('nonexistent');
    expect(store.getAllCategories().length).toBe(before);
  });

  it('also removes the tag description when category is removed', () => {
    store.addCustomCategoryWithDescription('gaming', 'Games and entertainment');
    store.removeCustomCategory('gaming');
    const tags = store.getAllTagsWithDescriptions();
    expect(tags.find(t => t.name === 'gaming')).toBeUndefined();
  });
});

// ── Tag descriptions ──────────────────────────────────────────────────────────

describe('getAllTagsWithDescriptions', () => {
  it('returns objects with name, description, and isDefault', () => {
    const tags = store.getAllTagsWithDescriptions();
    const codeTag = tags.find(t => t.name === 'code');
    expect(codeTag).toBeDefined();
    expect(codeTag.isDefault).toBe(true);
    expect(typeof codeTag.description).toBe('string');
    expect(codeTag.description.length).toBeGreaterThan(0);
  });

  it('marks custom categories as not default', () => {
    store.addCustomCategory('gaming');
    const tags = store.getAllTagsWithDescriptions();
    const gaming = tags.find(t => t.name === 'gaming');
    expect(gaming.isDefault).toBe(false);
  });

  it('returns custom description when set', () => {
    store.setTagDescription('code', 'Custom code description');
    const tags = store.getAllTagsWithDescriptions();
    const codeTag = tags.find(t => t.name === 'code');
    expect(codeTag.description).toBe('Custom code description');
  });
});

describe('addCustomCategoryWithDescription', () => {
  it('adds category and stores description together', () => {
    store.addCustomCategoryWithDescription('gaming', 'Games and entertainment');
    expect(store.getAllCategories()).toContain('gaming');
    const tags = store.getAllTagsWithDescriptions();
    expect(tags.find(t => t.name === 'gaming')?.description).toBe('Games and entertainment');
  });

  it('no-op for existing default category', () => {
    const before = store.getAllCategories().length;
    store.addCustomCategoryWithDescription('code', 'some description');
    expect(store.getAllCategories().length).toBe(before);
  });
});

// ── Ollama config ─────────────────────────────────────────────────────────────

describe('getOllamaModel / setOllamaModel', () => {
  it('returns minicpm-v by default', () => {
    expect(store.getOllamaModel()).toBe('minicpm-v');
  });

  it('persists a set value', () => {
    store.setOllamaModel('llava');
    expect(store.getOllamaModel()).toBe('llava');
  });
});

describe('getOllamaUrl / setOllamaUrl', () => {
  it('returns default URL', () => {
    expect(store.getOllamaUrl()).toBe('http://127.0.0.1:11434');
  });

  it('persists a custom URL', () => {
    store.setOllamaUrl('http://localhost:9999');
    expect(store.getOllamaUrl()).toBe('http://localhost:9999');
  });
});

// ── Theme / AI enabled ────────────────────────────────────────────────────────

describe('getTheme / setTheme', () => {
  it('returns dark by default', () => {
    expect(store.getTheme()).toBe('dark');
  });

  it('persists light theme', () => {
    store.setTheme('light');
    expect(store.getTheme()).toBe('light');
  });

  it('migrates glass theme to dark', () => {
    store.setTheme('glass');
    expect(store.getTheme()).toBe('dark');
  });
});

describe('getAiEnabled / setAiEnabled', () => {
  it('returns undefined on first launch', () => {
    expect(store.getAiEnabled()).toBeUndefined();
  });

  it('persists true', () => {
    store.setAiEnabled(true);
    expect(store.getAiEnabled()).toBe(true);
  });

  it('persists false', () => {
    store.setAiEnabled(false);
    expect(store.getAiEnabled()).toBe(false);
  });
});

// ── Shortcuts ─────────────────────────────────────────────────────────────────

describe('getShortcuts / setShortcut / resetShortcuts', () => {
  it('returns defaults when no custom shortcuts', () => {
    const shortcuts = store.getShortcuts();
    expect(shortcuts.capture).toBe('CommandOrControl+Shift+2');
    expect(shortcuts['quick-snip']).toBe('CommandOrControl+Shift+1');
  });

  it('setShortcut overrides a specific key', () => {
    store.setShortcut('capture', 'CommandOrControl+Shift+3');
    expect(store.getShortcuts().capture).toBe('CommandOrControl+Shift+3');
  });

  it('resetShortcuts restores defaults', () => {
    store.setShortcut('capture', 'CommandOrControl+Shift+3');
    store.resetShortcuts();
    expect(store.getShortcuts().capture).toBe('CommandOrControl+Shift+2');
  });

  it('getDefaultShortcuts always returns defaults regardless of overrides', () => {
    store.setShortcut('capture', 'CommandOrControl+Shift+9');
    expect(store.getDefaultShortcuts().capture).toBe('CommandOrControl+Shift+2');
  });
});

// ── Index management ──────────────────────────────────────────────────────────

describe('readIndex', () => {
  it('returns empty array when index file does not exist', () => {
    expect(store.readIndex()).toEqual([]);
  });

  it('returns parsed array when index file exists', () => {
    const entry = { filename: 'shot.png', path: join(tmpDir, 'code', 'shot.png'), category: 'code' };
    writeFileSync(join(tmpDir, '.index.json'), JSON.stringify([entry]));
    expect(store.readIndex()).toEqual([entry]);
  });

  it('returns empty array for corrupt JSON', () => {
    writeFileSync(join(tmpDir, '.index.json'), 'not valid json {{{');
    expect(store.readIndex()).toEqual([]);
  });
});

describe('addToIndex', () => {
  it('appends a new entry', () => {
    const entry = { filename: 'a.png', path: join(tmpDir, 'a.png'), category: 'code' };
    store.addToIndex(entry);
    expect(store.readIndex()).toHaveLength(1);
    expect(store.readIndex()[0].filename).toBe('a.png');
  });

  it('upserts: updates existing entry by path', () => {
    const path = join(tmpDir, 'a.png');
    store.addToIndex({ filename: 'a.png', path, category: 'code' });
    store.addToIndex({ filename: 'a.png', path, category: 'design', name: 'updated' });
    const index = store.readIndex();
    expect(index).toHaveLength(1);
    expect(index[0].category).toBe('design');
    expect(index[0].name).toBe('updated');
  });

  it('appends distinct entries', () => {
    store.addToIndex({ filename: 'a.png', path: join(tmpDir, 'a.png'), category: 'code' });
    store.addToIndex({ filename: 'b.png', path: join(tmpDir, 'b.png'), category: 'web' });
    expect(store.readIndex()).toHaveLength(2);
  });
});

describe('removeFromIndex', () => {
  it('removes an existing entry by path', () => {
    const p = join(tmpDir, 'a.png');
    store.addToIndex({ filename: 'a.png', path: p });
    store.removeFromIndex(p);
    expect(store.readIndex()).toHaveLength(0);
  });

  it('is a no-op when path not found', () => {
    store.addToIndex({ filename: 'a.png', path: join(tmpDir, 'a.png') });
    store.removeFromIndex(join(tmpDir, 'nonexistent.png'));
    expect(store.readIndex()).toHaveLength(1);
  });
});

describe('removeFromIndexByDir', () => {
  it('removes all entries under a directory', () => {
    const subDir = join(tmpDir, 'code');
    store.addToIndex({ filename: 'a.png', path: join(subDir, 'a.png') });
    store.addToIndex({ filename: 'b.png', path: join(subDir, 'b.png') });
    store.addToIndex({ filename: 'c.png', path: join(tmpDir, 'web', 'c.png') });
    store.removeFromIndexByDir(subDir);
    const remaining = store.readIndex();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].filename).toBe('c.png');
  });

  it('handles dir path with or without trailing separator', () => {
    const subDir = join(tmpDir, 'code');
    store.addToIndex({ filename: 'a.png', path: join(subDir, 'a.png') });
    store.removeFromIndexByDir(subDir + sep);
    expect(store.readIndex()).toHaveLength(0);
  });
});

describe('rebuildIndex', () => {
  it('prunes entries whose files do not exist', () => {
    store.addToIndex({ filename: 'ghost.png', path: join(tmpDir, 'ghost.png') });
    store.rebuildIndex();
    expect(store.readIndex()).toHaveLength(0);
  });

  it('keeps entries whose files exist', () => {
    const p = join(tmpDir, 'real.png');
    writeFileSync(p, 'fake');
    store.addToIndex({ filename: 'real.png', path: p });
    store.rebuildIndex();
    expect(store.readIndex()).toHaveLength(1);
  });

  it('prunes entries with missing path field', () => {
    store.addToIndex({ filename: 'no-path.png' }); // no path property
    store.rebuildIndex();
    expect(store.readIndex()).toHaveLength(0);
  });
});
