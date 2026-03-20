import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── cosineSimilarity ──────────────────────────────────────────────────────────

const { cosineSimilarity } = require('../../src/main/organizer/embeddings');

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 0, 0, 1];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('handles arbitrary vectors with known similarity', () => {
    // [1,1] vs [1,0]: cos = 1/sqrt(2) ≈ 0.707
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(0.707, 2);
  });

  it('returns 0 for null inputs', () => {
    expect(cosineSimilarity(null, [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], null)).toBe(0);
    expect(cosineSimilarity(null, null)).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it('returns NaN for empty arrays (0/0)', () => {
    expect(cosineSimilarity([], [])).toBeNaN();
  });

  it('works with Float32Array (model output type)', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });
});

// ── searchScreenshots ─────────────────────────────────────────────────────────

// Mock sendRequest to simulate the embeddings worker returning an embedding
const mockSendRequest = vi.hoisted(() => vi.fn().mockResolvedValue([0.5, 0.5, 0.5, 0.5]));

vi.mock('../../src/main/worker-process', () => ({
  createWorkerProcess: vi.fn().mockReturnValue({
    sendRequest: mockSendRequest,
    sendMessage: vi.fn(),
    killWorker: vi.fn(),
  }),
}));

vi.mock('../../src/main/addon-manager', () => ({
  ADDON_DEFS: { segment: {}, upscale: {}, 'smart-search': {} },
  isAddonInstalled: vi.fn().mockReturnValue(true),
  isRuntimeInstalled: vi.fn().mockReturnValue(true),
  getRuntimeNodeModules: vi.fn().mockReturnValue('/tmp/test-runtime/node_modules'),
  getModelsDir: vi.fn().mockReturnValue('/tmp/test-models'),
  getAddonsDir: vi.fn().mockReturnValue('/tmp/test-addons'),
}));

const store = require('../../src/main/store');
const { searchScreenshots } = require('../../src/main/organizer/embeddings');

// Spy on the real store.readIndex rather than replacing the module — this ensures
// the lazy `require('../store').readIndex()` inside searchScreenshots picks up the spy
let spyReadIndex;

beforeEach(() => {
  mockSendRequest.mockReset();
  mockSendRequest.mockResolvedValue([0.5, 0.5, 0.5, 0.5]);
  spyReadIndex = vi.spyOn(store, 'readIndex');
});

afterEach(() => {
  spyReadIndex?.mockRestore();
});

describe('searchScreenshots', () => {
  it('returns empty array for empty index', async () => {
    spyReadIndex.mockReturnValue([]);
    expect(await searchScreenshots('code')).toEqual([]);
  });

  it('does text matching for entries without embeddings', async () => {
    spyReadIndex.mockReturnValue([
      { filename: 'shot.png', name: 'my code snippet', description: 'python code', tags: ['python'], category: 'code' },
      { filename: 'other.png', name: 'cat photo', description: 'fluffy cat', tags: ['cats'], category: 'personal' },
    ]);

    const results = await searchScreenshots('code');
    expect(results.length).toBeGreaterThan(0);
    // 'code' entry should score higher than 'cat' entry
    expect(results[0].name).toBe('my code snippet');
  });

  it('text match is case-insensitive', async () => {
    spyReadIndex.mockReturnValue([
      { filename: 'a.png', name: 'Python Tutorial', description: '', tags: [], category: 'code' },
    ]);
    const results = await searchScreenshots('python');
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('scores zero for entries with no keyword match', async () => {
    spyReadIndex.mockReturnValue([
      { filename: 'x.png', name: 'shopping list', description: 'groceries', tags: ['food'], category: 'personal' },
    ]);
    const results = await searchScreenshots('code');
    expect(results[0].score).toBe(0);
  });

  it('returns at most 20 results', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      filename: `shot${i}.png`, name: `code thing ${i}`, description: '', tags: [], category: 'code',
    }));
    spyReadIndex.mockReturnValue(entries);
    const results = await searchScreenshots('code');
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('sorts results by score descending', async () => {
    spyReadIndex.mockReturnValue([
      { filename: 'a.png', name: 'x', description: 'x', tags: ['x'], category: 'x' },
      { filename: 'b.png', name: 'code editor snippet', description: 'code snippet', tags: ['code'], category: 'code' },
    ]);
    const results = await searchScreenshots('code');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('falls back to text search for all entries when embedding pipeline fails', async () => {
    mockSendRequest.mockRejectedValue(new Error('Model not found'));
    spyReadIndex.mockReturnValue([
      { filename: 'a.png', path: '/a.png', name: 'code thing', description: '', tags: [], category: 'code', embedding: [0.1, 0.2] },
      { filename: 'b.png', path: '/b.png', name: 'shopping', description: '', tags: [], category: 'personal', embedding: [0.3, 0.4] },
    ]);

    const results = await searchScreenshots('code');
    // Falls back to text match — code entry should be found
    expect(results.some(r => r.name === 'code thing')).toBe(true);
  });
});
