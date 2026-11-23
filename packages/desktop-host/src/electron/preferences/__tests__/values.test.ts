import { describe, expect, it } from 'vitest';
import { choiceOf, clampWholeNumber, positiveWholeNumber, wholeNumberSteps } from '../values.js';

const bounds = { min: 1, max: 5 };

describe('preference values', () => {
  it('accepts only safe whole numbers above zero', () => {
    for (const value of [1, 5, 99]) expect(positiveWholeNumber({ value })).toBe(value);
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '3', null, undefined, Number.NaN]) expect(positiveWholeNumber({ value })).toBeUndefined();
  });

  it('clamps into the inclusive host bounds', () => {
    expect(clampWholeNumber({ value: 0, bounds })).toBe(1);
    expect(clampWholeNumber({ value: 1, bounds })).toBe(1);
    expect(clampWholeNumber({ value: 3, bounds })).toBe(3);
    expect(clampWholeNumber({ value: 5, bounds })).toBe(5);
    expect(clampWholeNumber({ value: 6, bounds })).toBe(5);
  });

  it('lists every step from min to max', () => {
    expect(wholeNumberSteps({ bounds })).toEqual([1, 2, 3, 4, 5]);
    expect(wholeNumberSteps({ bounds: { min: 2, max: 2 } })).toEqual([2]);
  });

  it('finds only a shipped choice', () => {
    const choices = [0, 5, 10, 30] as const;
    expect(choiceOf({ value: 0, choices })).toBe(0);
    expect(choiceOf({ value: 30, choices })).toBe(30);
    expect(choiceOf({ value: 7, choices })).toBeUndefined();
    expect(choiceOf({ value: '5', choices })).toBeUndefined();
  });
});
