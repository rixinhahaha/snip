import { describe, it, expect, beforeAll } from 'vitest';
import { loadIIFE } from '../setup/load-iife.js';

let ToolUtils;

beforeAll(() => {
  ToolUtils = loadIIFE('src/renderer/tools/tool-utils.js', 'ToolUtils');
});

// ── hexToRgba ─────────────────────────────────────────────────────────────────

describe('hexToRgba', () => {
  it('converts red hex to rgba', () => {
    expect(ToolUtils.hexToRgba('#FF0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });

  it('converts purple brand color', () => {
    expect(ToolUtils.hexToRgba('#8B5CF6', 1)).toBe('rgba(139,92,246,1)');
  });

  it('handles lowercase hex', () => {
    expect(ToolUtils.hexToRgba('#ff0000', 1)).toBe('rgba(255,0,0,1)');
  });

  it('handles alpha = 0', () => {
    expect(ToolUtils.hexToRgba('#000000', 0)).toBe('rgba(0,0,0,0)');
  });

  it('handles black', () => {
    expect(ToolUtils.hexToRgba('#000000', 1)).toBe('rgba(0,0,0,1)');
  });

  it('handles white', () => {
    expect(ToolUtils.hexToRgba('#FFFFFF', 0.8)).toBe('rgba(255,255,255,0.8)');
  });
});

// ── lineEndpointForTag ────────────────────────────────────────────────────────

describe('lineEndpointForTag', () => {
  // Box centered at (100, 100), 60x40
  const bounds = { left: 70, top: 80, width: 60, height: 40 };
  // center: cx=100, cy=100; halfW=30, halfH=20

  it('tip directly to the right → exits right edge', () => {
    const pt = ToolUtils.lineEndpointForTag(200, 100, bounds);
    expect(pt.x).toBeCloseTo(130); // cx + halfW
    expect(pt.y).toBeCloseTo(100);
  });

  it('tip directly to the left → exits left edge', () => {
    const pt = ToolUtils.lineEndpointForTag(0, 100, bounds);
    expect(pt.x).toBeCloseTo(70); // cx - halfW
    expect(pt.y).toBeCloseTo(100);
  });

  it('tip directly above → exits top edge', () => {
    const pt = ToolUtils.lineEndpointForTag(100, 0, bounds);
    expect(pt.x).toBeCloseTo(100);
    expect(pt.y).toBeCloseTo(80); // cy - halfH
  });

  it('tip directly below → exits bottom edge', () => {
    const pt = ToolUtils.lineEndpointForTag(100, 200, bounds);
    expect(pt.x).toBeCloseTo(100);
    expect(pt.y).toBeCloseTo(120); // cy + halfH
  });

  it('tip at center (dx=dy=0) → returns left edge midpoint', () => {
    const pt = ToolUtils.lineEndpointForTag(100, 100, bounds);
    expect(pt.x).toBe(bounds.left);
    expect(pt.y).toBe(100);
  });

  it('point is always on the edge (not inside)', () => {
    // At 45° — constrained by whichever half-size is smaller (halfH=20 < halfW=30)
    const pt = ToolUtils.lineEndpointForTag(200, 200, bounds);
    // t = min(30/100, 20/100) = 0.2; pt.x = 100+0.2*100=120, pt.y = 100+0.2*100=120
    expect(pt.x).toBeCloseTo(120);
    expect(pt.y).toBeCloseTo(120);
  });

  it('returns a point object with x and y', () => {
    const pt = ToolUtils.lineEndpointForTag(200, 150, bounds);
    expect(pt).toHaveProperty('x');
    expect(pt).toHaveProperty('y');
  });
});

// ── nextTagId ─────────────────────────────────────────────────────────────────

describe('nextTagId', () => {
  it('returns string IDs with snip-tag- prefix', () => {
    const id = ToolUtils.nextTagId();
    expect(id).toMatch(/^snip-tag-\d+$/);
  });

  it('returns unique IDs on successive calls', () => {
    const ids = new Set(Array.from({ length: 10 }, () => ToolUtils.nextTagId()));
    expect(ids.size).toBe(10);
  });

  it('increments counter monotonically', () => {
    const a = ToolUtils.nextTagId();
    const b = ToolUtils.nextTagId();
    const numA = parseInt(a.split('-')[2]);
    const numB = parseInt(b.split('-')[2]);
    expect(numB).toBe(numA + 1);
  });
});
