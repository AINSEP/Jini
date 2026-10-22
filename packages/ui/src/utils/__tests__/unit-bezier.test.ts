import { describe, expect, it } from 'vitest';
import { unitBezier } from '../unit-bezier.js';

describe('unitBezier', () => {
  it('clamps inputs outside [0, 1] to the curve endpoints', () => {
    const ease = unitBezier(0.23, 1, 0.32, 1);
    expect(ease(-0.5)).toBe(0);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(3)).toBe(1);
  });

  it('solves a curve whose x and y polynomials coincide to the identity', () => {
    const linear = unitBezier(0.25, 0.25, 0.75, 0.75);
    for (const x of [0.1, 0.3, 0.5, 0.9]) expect(linear(x)).toBeCloseTo(x, 5);
  });

  it('solves the ease-out curve as front-loaded and monotone', () => {
    const ease = unitBezier(0.23, 1, 0.32, 1);
    const samples = [0.1, 0.25, 0.5, 0.75, 0.9].map(ease);
    expect(samples[2]).toBeGreaterThan(0.9);
    for (let i = 1; i < samples.length; i += 1) expect(samples[i]).toBeGreaterThan(samples[i - 1] as number);
  });

  it('keeps the current estimate instead of taking a divide-by-~0 Newton step where x(t) is flat', () => {
    // x1 = x2 = 0 gives x(t) = t^3, whose derivative 3t^2 is ~3e-10 at t = 1e-5. An unguarded step
    // would jump t to ~33 333, clamp to 1 and report the end of the curve (y = 1) for an input
    // barely past the start.
    const flatStart = unitBezier(0, 0, 0, 1);
    const y = flatStart(1e-5);
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeLessThan(1e-6);
    expect(y).toBeGreaterThan(0);
  });
});
