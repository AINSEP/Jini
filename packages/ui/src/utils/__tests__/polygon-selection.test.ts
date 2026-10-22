import { describe, expect, it } from 'vitest';
import {
  isClosedLoop,
  lassoSelectionHitsRect,
  lineIntersectsLine,
  pathIntersectsRect,
  pointInPolygon,
  rectContains,
} from '../polygon-selection.js';

describe('isClosedLoop', () => {
  it('is false for fewer than 4 points', () => {
    expect(isClosedLoop([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(false);
  });

  it('is true when the last point lands back near the first', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 2, y: 2 }];
    expect(isClosedLoop(points)).toBe(true);
  });

  it('is false when the last point is far from the first', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 100, y: 100 }];
    expect(isClosedLoop(points)).toBe(false);
  });

  it('respects a custom close threshold', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 40, y: 0 }];
    expect(isClosedLoop(points, 10)).toBe(false);
    expect(isClosedLoop(points, 50)).toBe(true);
  });
});

describe('rectContains', () => {
  it('is true when outer fully contains inner', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
  });

  it('is false when inner extends past outer on any side', () => {
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
    expect(rectContains({ x: 0, y: 0, width: 100, height: 100 }, { x: -5, y: 10, width: 20, height: 20 })).toBe(false);
  });

  it('is true for identical rects', () => {
    const rect = { x: 0, y: 0, width: 50, height: 50 };
    expect(rectContains(rect, rect)).toBe(true);
  });
});

describe('lineIntersectsLine', () => {
  it('detects a crossing between two segments', () => {
    expect(lineIntersectsLine({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
  });

  it('is false for non-crossing segments', () => {
    expect(lineIntersectsLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 5 }, { x: 1, y: 5 })).toBe(false);
  });

  it('is false for parallel (zero-denominator) segments', () => {
    expect(lineIntersectsLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false);
  });

  it('is false when segments would cross if extended but do not within their bounds', () => {
    expect(lineIntersectsLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 0 }, { x: 6, y: 1 })).toBe(false);
  });
});

describe('pointInPolygon', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it('is true for a point inside the polygon', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it('is false for a point outside the polygon', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(false);
  });

  it('handles a non-convex polygon correctly', () => {
    const cShape = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 },
      { x: 4, y: 6 }, { x: 10, y: 6 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 7, y: 5 }, cShape)).toBe(false); // in the notch
    expect(pointInPolygon({ x: 2, y: 5 }, cShape)).toBe(true); // in the body
  });
});

describe('pathIntersectsRect', () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };

  it('is false for an empty path', () => {
    expect(pathIntersectsRect([], rect)).toBe(false);
  });

  it('is true when a point lands directly inside the rect', () => {
    expect(pathIntersectsRect([{ x: 15, y: 15 }], rect)).toBe(true);
  });

  it('is true when a segment crosses the rect without any point landing inside it', () => {
    expect(pathIntersectsRect([{ x: 0, y: 15 }, { x: 40, y: 15 }], rect)).toBe(true);
  });

  it('is false when the path never comes near the rect', () => {
    expect(pathIntersectsRect([{ x: 0, y: 0 }, { x: 1, y: 1 }], rect)).toBe(false);
  });

  it('counts a point lying exactly on the rect border as inside', () => {
    expect(pathIntersectsRect([{ x: 30, y: 30 }], rect)).toBe(true);
  });

  it('is false for a single point outside the rect', () => {
    expect(pathIntersectsRect([{ x: 31, y: 15 }], rect)).toBe(false);
  });

  it('is true when a vertical segment crosses the top and bottom edges', () => {
    expect(pathIntersectsRect([{ x: 15, y: 0 }, { x: 15, y: 40 }], rect)).toBe(true);
  });

  it('is true when a segment only grazes the bottom-left corner', () => {
    expect(pathIntersectsRect([{ x: 5, y: 25 }, { x: 15, y: 35 }], rect)).toBe(true);
  });

  it('is true when a later segment of a longer path crosses the rect', () => {
    expect(pathIntersectsRect([{ x: 0, y: 0 }, { x: 0, y: 15 }, { x: 40, y: 15 }], rect)).toBe(true);
  });
});

describe('lassoSelectionHitsRect', () => {
  const rect = { x: 100, y: 100, width: 20, height: 20 };

  it('is true when the path crosses the rect regardless of closed-loop state', () => {
    const points = [{ x: 90, y: 110 }, { x: 130, y: 110 }];
    expect(lassoSelectionHitsRect({ points, rect, closedLoop: false })).toBe(true);
  });

  it('is false for an open loop that never touches the rect', () => {
    const points = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
    expect(lassoSelectionHitsRect({ points, rect, closedLoop: false })).toBe(false);
  });

  it('is true for a closed loop whose interior contains the rect center, even without crossing its border', () => {
    const points = [
      { x: 90, y: 90 }, { x: 140, y: 90 }, { x: 140, y: 140 }, { x: 90, y: 140 }, { x: 90, y: 90 },
    ];
    expect(lassoSelectionHitsRect({ points, rect, closedLoop: true })).toBe(true);
  });

  it('is true for a closed loop containing only a corner of the rect', () => {
    const points = [
      { x: 0, y: 0 }, { x: 105, y: 0 }, { x: 105, y: 105 }, { x: 0, y: 105 }, { x: 0, y: 0 },
    ];
    expect(lassoSelectionHitsRect({ points, rect, closedLoop: true })).toBe(true);
  });

  it('is true for a closed loop whose closing edge cuts a corner the stroke itself never touches', () => {
    const points = [{ x: 115, y: 90 }, { x: 90, y: 90 }, { x: 90, y: 115 }];
    expect(lassoSelectionHitsRect({ points, rect, closedLoop: true })).toBe(true);
  });

  it('is false for the same corner-cutting stroke when it is not a closed loop', () => {
    const points = [{ x: 115, y: 90 }, { x: 90, y: 90 }, { x: 90, y: 115 }];
    expect(lassoSelectionHitsRect({ points, rect, closedLoop: false })).toBe(false);
  });

  it('is false for a closed loop entirely elsewhere', () => {
    const points = [
      { x: 500, y: 500 }, { x: 520, y: 500 }, { x: 520, y: 520 }, { x: 500, y: 520 }, { x: 500, y: 500 },
    ];
    expect(lassoSelectionHitsRect({ points, rect, closedLoop: true })).toBe(false);
  });
});
