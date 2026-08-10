import { describe, expect, it } from 'vitest';
import {
  MARK_TOOL_OPTION_RULES,
  buildSubmitOptionRules,
  clamp,
  clamp01,
  computeDockPlacement,
  deriveMarkKind,
  dockPlacementEquals,
  mergeBounds,
  mergeRects,
  normalizedRectFromPoints,
  rectsOverlap,
} from '../rules.js';
import type { DockPlacement, Rect } from '../types.js';

describe('clamp / clamp01', () => {
  it('clamps within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns min when max < min', () => {
    expect(clamp(5, 10, 0)).toBe(10);
  });

  it('clamp01 bounds to [0,1]', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });
});

describe('rectsOverlap', () => {
  const base: Rect = { x: 0, y: 0, width: 10, height: 10 };
  it('detects overlap', () => {
    expect(rectsOverlap(base, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });
  it('detects no overlap', () => {
    expect(rectsOverlap(base, { x: 20, y: 20, width: 10, height: 10 })).toBe(false);
  });
  it('touching edges do not overlap', () => {
    expect(rectsOverlap(base, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe('normalizedRectFromPoints', () => {
  it('normalizes regardless of drag direction', () => {
    const rect = normalizedRectFromPoints({ x: 0.6, y: 0.6 }, { x: 0.2, y: 0.2 });
    expect(rect.x).toBeCloseTo(0.2);
    expect(rect.y).toBeCloseTo(0.2);
    expect(rect.width).toBeCloseTo(0.4);
    expect(rect.height).toBeCloseTo(0.4);
  });
  it('produces a zero-size rect for a click without drag', () => {
    expect(normalizedRectFromPoints({ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 })).toEqual({ x: 0.3, y: 0.3, width: 0, height: 0 });
  });
});

describe('dockPlacementEquals', () => {
  const a: DockPlacement = { layout: 'docked', side: null, style: { left: '1px' } };
  it('true for identical placements', () => {
    expect(dockPlacementEquals(a, { layout: 'docked', side: null, style: { left: '1px' } })).toBe(true);
  });
  it('false when layout differs', () => {
    expect(dockPlacementEquals(a, { layout: 'floating', side: 'right', style: { left: '1px' } })).toBe(false);
  });
  it('false when a style field differs', () => {
    expect(dockPlacementEquals(a, { layout: 'docked', side: null, style: { left: '2px' } })).toBe(false);
  });
});

describe('computeDockPlacement', () => {
  const dockedStyle = { bottom: '16px' };
  const hostRect: Rect = { x: 0, y: 0, width: 800, height: 600 };
  const wrapRect: Rect = { x: 0, y: 0, width: 800, height: 600 };
  const dockRect: Rect = { x: 0, y: 0, width: 200, height: 60 };

  it('falls back to docked with no anchor', () => {
    expect(computeDockPlacement({ dockedStyle, hostRect, wrapRect, dockRect, anchor: null })).toEqual({
      layout: 'docked',
      side: null,
      style: dockedStyle,
    });
  });

  it('falls back to docked when the host is too small', () => {
    const tinyHost: Rect = { x: 0, y: 0, width: 100, height: 80 };
    const anchor: Rect = { x: 40, y: 30, width: 10, height: 10 };
    expect(computeDockPlacement({ dockedStyle, hostRect: tinyHost, wrapRect: tinyHost, dockRect, anchor }).layout).toBe('docked');
  });

  it('floats to the right of an anchor near the left edge', () => {
    const anchor: Rect = { x: 50, y: 250, width: 20, height: 20 };
    const placement = computeDockPlacement({ dockedStyle, hostRect, wrapRect, dockRect, anchor });
    expect(placement.layout).toBe('floating');
    expect(placement.side).toBe('right');
  });

  it('floats to the left of an anchor near the right edge', () => {
    const anchor: Rect = { x: 750, y: 250, width: 20, height: 20 };
    const placement = computeDockPlacement({ dockedStyle, hostRect, wrapRect, dockRect, anchor });
    expect(placement.layout).toBe('floating');
    expect(placement.side).toBe('left');
  });

  it('never overlaps the anchor', () => {
    const anchor: Rect = { x: 300, y: 270, width: 20, height: 20 };
    const placement = computeDockPlacement({ dockedStyle, hostRect, wrapRect, dockRect, anchor });
    if (placement.layout === 'floating') {
      const left = parseFloat(String(placement.style.left));
      const top = parseFloat(String(placement.style.top));
      const placedRect: Rect = { x: left, y: top, width: dockRect.width, height: dockRect.height };
      expect(rectsOverlap(placedRect, anchor)).toBe(false);
    }
  });

  it('falls back to docked when the anchor fills nearly the entire host, so none of the 4 candidate sides has room to fit', () => {
    // Big enough host/dock to clear the early "host too small" bail-out, but
    // an anchor that fills almost the whole host so every one of right/left/
    // bottom/top's own `fits` check fails and the loop runs out of
    // candidates (not the same code path as the "too small" guard above).
    const anchor: Rect = { x: 20, y: 20, width: 760, height: 560 };
    const placement = computeDockPlacement({ dockedStyle, hostRect, wrapRect, dockRect, anchor });
    expect(placement).toEqual({ layout: 'docked', side: null, style: dockedStyle });
  });
});

describe('mergeBounds', () => {
  it('returns undefined for no rects', () => {
    expect(mergeBounds([null, undefined])).toBeUndefined();
  });
  it('returns the single rect unchanged', () => {
    const r: Rect = { x: 1, y: 2, width: 3, height: 4 };
    expect(mergeBounds([r, null])).toEqual(r);
  });
  it('merges multiple rects into an enclosing bound', () => {
    const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
    const b: Rect = { x: 20, y: 20, width: 10, height: 10 };
    expect(mergeBounds([a, b])).toEqual({ x: 0, y: 0, width: 30, height: 30 });
  });
});

describe('mergeRects', () => {
  it('returns null for an empty list', () => {
    expect(mergeRects([])).toBeNull();
  });
  it('merges several rects', () => {
    const a: Rect = { x: 0, y: 0, width: 5, height: 5 };
    const b: Rect = { x: 10, y: 10, width: 5, height: 5 };
    expect(mergeRects([a, b])).toEqual({ x: 0, y: 0, width: 15, height: 15 });
  });
});

describe('deriveMarkKind', () => {
  it('click+stroke when both target and a visual mark are present', () => {
    expect(deriveMarkKind({ hasTarget: true, hasVisualMark: true })).toBe('click+stroke');
  });
  it('click when only a target is present', () => {
    expect(deriveMarkKind({ hasTarget: true, hasVisualMark: false })).toBe('click');
  });
  it('stroke when only a visual mark is present', () => {
    expect(deriveMarkKind({ hasTarget: false, hasVisualMark: true })).toBe('stroke');
  });
  it('undefined when neither is present', () => {
    expect(deriveMarkKind({ hasTarget: false, hasVisualMark: false })).toBeUndefined();
  });
});

describe('buildSubmitOptionRules', () => {
  it('gates only send when sendDisabled is true', () => {
    const rules = buildSubmitOptionRules({ canSubmit: true, sendDisabled: true });
    const send = rules.find((r) => r.action === 'send')!;
    const draft = rules.find((r) => r.action === 'draft')!;
    const queue = rules.find((r) => r.action === 'queue')!;
    expect(send.enabled).toBe(false);
    expect(draft.enabled).toBe(true);
    expect(queue.enabled).toBe(true);
  });

  it('disables everything when there is nothing to submit', () => {
    const rules = buildSubmitOptionRules({ canSubmit: false, sendDisabled: false });
    expect(rules.every((r) => !r.enabled)).toBe(true);
  });

  it('enables send when nothing blocks it', () => {
    const rules = buildSubmitOptionRules({ canSubmit: true, sendDisabled: false });
    expect(rules.find((r) => r.action === 'send')!.enabled).toBe(true);
  });
});

describe('MARK_TOOL_OPTION_RULES', () => {
  it('lists box, pen, and text in that order', () => {
    expect(MARK_TOOL_OPTION_RULES.map((r) => r.tool)).toEqual(['box', 'pen', 'text']);
  });
});
