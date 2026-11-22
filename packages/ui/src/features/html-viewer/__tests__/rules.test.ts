import { describe, expect, it } from 'vitest';
import {
  canGoNext,
  canGoPrev,
  clampSlideIndex,
  isKnownZoomLevel,
  parseDeckStateMessage,
  slideCounterLabel,
  zoomToScale,
} from '../rules.js';

describe('canGoPrev', () => {
  it('is false with no state yet', () => {
    expect(canGoPrev({ state: null })).toBe(false);
  });

  it('is false on the first slide', () => {
    expect(canGoPrev({ state: { active: 0, count: 3 } })).toBe(false);
  });

  it('is true past the first slide', () => {
    expect(canGoPrev({ state: { active: 1, count: 3 } })).toBe(true);
  });
});

describe('canGoNext', () => {
  it('is false with no state yet', () => {
    expect(canGoNext({ state: null })).toBe(false);
  });

  it('is false on the last slide', () => {
    expect(canGoNext({ state: { active: 2, count: 3 } })).toBe(false);
  });

  it('is true before the last slide', () => {
    expect(canGoNext({ state: { active: 1, count: 3 } })).toBe(true);
  });

  it('is false for a single-slide (count 1) deck', () => {
    expect(canGoNext({ state: { active: 0, count: 1 } })).toBe(false);
  });
});

describe('slideCounterLabel', () => {
  it('is null with no state yet', () => {
    expect(slideCounterLabel({ state: null })).toBeNull();
  });

  it('renders a 1-based "N / total" label', () => {
    expect(slideCounterLabel({ state: { active: 0, count: 5 } })).toBe('1 / 5');
    expect(slideCounterLabel({ state: { active: 4, count: 5 } })).toBe('5 / 5');
  });
});

describe('clampSlideIndex', () => {
  it('clamps a negative index to 0', () => {
    expect(clampSlideIndex({ index: -3, count: 5 })).toBe(0);
  });

  it('clamps an out-of-range index to the last slide', () => {
    expect(clampSlideIndex({ index: 99, count: 5 })).toBe(4);
  });

  it('passes an in-range index through unchanged', () => {
    expect(clampSlideIndex({ index: 2, count: 5 })).toBe(2);
  });

  it('returns 0 for a zero/negative count', () => {
    expect(clampSlideIndex({ index: 2, count: 0 })).toBe(0);
    expect(clampSlideIndex({ index: 2, count: -1 })).toBe(0);
  });
});

describe('parseDeckStateMessage', () => {
  it('accepts a well-formed message', () => {
    expect(parseDeckStateMessage({ data: { type: 'jini:deck-state', active: 1, count: 4 } })).toEqual({
      active: 1,
      count: 4,
    });
  });

  it('rejects null/non-object data', () => {
    expect(parseDeckStateMessage({ data: null })).toBeNull();
    expect(parseDeckStateMessage({ data: 'nope' })).toBeNull();
    expect(parseDeckStateMessage({ data: 42 })).toBeNull();
  });

  it('rejects missing or non-numeric active/count', () => {
    expect(parseDeckStateMessage({ data: {} })).toBeNull();
    expect(parseDeckStateMessage({ data: { active: '1', count: 4 } })).toBeNull();
    expect(parseDeckStateMessage({ data: { active: 1, count: '4' } })).toBeNull();
  });

  it('rejects non-finite numbers', () => {
    expect(parseDeckStateMessage({ data: { active: Infinity, count: 4 } })).toBeNull();
    expect(parseDeckStateMessage({ data: { active: 1, count: NaN } })).toBeNull();
  });

  it('rejects negative values and active beyond count', () => {
    expect(parseDeckStateMessage({ data: { active: -1, count: 4 } })).toBeNull();
    expect(parseDeckStateMessage({ data: { active: 1, count: -4 } })).toBeNull();
    expect(parseDeckStateMessage({ data: { active: 5, count: 4 } })).toBeNull();
  });

  it('accepts active === count (a deck reporting an empty/boundary state)', () => {
    expect(parseDeckStateMessage({ data: { active: 0, count: 0 } })).toEqual({ active: 0, count: 0 });
  });
});

describe('isKnownZoomLevel', () => {
  it('is true when zoom matches one of the levels', () => {
    expect(isKnownZoomLevel({ zoom: 100, levels: [50, 100, 150] })).toBe(true);
  });

  it('is false for a custom zoom value not in the preset list', () => {
    expect(isKnownZoomLevel({ zoom: 133, levels: [50, 100, 150] })).toBe(false);
  });
});

describe('zoomToScale', () => {
  it('converts a percentage to a scale factor', () => {
    expect(zoomToScale({ zoom: 100 })).toBe(1);
    expect(zoomToScale({ zoom: 50 })).toBe(0.5);
    expect(zoomToScale({ zoom: 150 })).toBe(1.5);
  });
});
