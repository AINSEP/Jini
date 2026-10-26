import { expect, test } from 'vitest';
import { evaluateMemoryFloors } from '../memory-soak.js';

/** Fake post-GC readings exercise the numerical policy without any process instrumentation. */
function evaluate({ values, baseline = [100, 140] }: { values: number[][]; baseline?: number[] },
  options: Parameters<typeof evaluateMemoryFloors>[1] = {}) {
  return evaluateMemoryFloors({ baselineSamples: baseline,
    checkpoints: values.map((samples, completed) => ({ completed, samples })) }, options);
}

test('flat floors and collectible spikes pass; minima remain observable', () => {
  const result = evaluate({ values: [[100, 900], [800, 100], [100, 100]] });
  expect(result).toMatchObject({ pass: true, baselineFloor: 100, floors: [100, 100, 100], growth: 0, tailGrowth: 0 });
});

test.each([true, false])('exactly +15%% passes and above fails (checkSlope=%s)', checkSlope => {
  expect(evaluate({ values: [[115, 200]] }, { checkSlope }).pass).toBe(true);
  expect(evaluate({ values: [[115.01, 200]] }, { checkSlope }).pass).toBe(false);
});

test('a rising last three floors fails below the end limit; sustained rise also fails', () => {
  expect(evaluate({ values: [[100], [104], [108]] })).toMatchObject({ pass: false, failures: ['rising tail'], tailGrowth: 0.08 });
  expect(evaluate({ values: [[110], [120], [130]] }).failures).toEqual(['end floor', 'rising tail']);
});

test('tail must be strictly rising, and exactly half the limit passes', () => {
  expect(evaluate({ values: [[100], [104], [107.5]] }).pass).toBe(true);
  expect(evaluate({ values: [[100], [100], [110]] }).pass).toBe(true);
  expect(evaluate({ values: [[105], [100], [110]] }).pass).toBe(true);
  expect(evaluate({ values: [[100], [110], [110], [110]] }).pass).toBe(true);
});

test('flat tail cannot hide an excessive end floor', () => {
  expect(evaluate({ values: [[116], [116], [116]] }).failures).toEqual(['end floor']);
});

test('desktop checks intermediate floors; server checks its end and tail', () => {
  expect(evaluate({ values: [[120], [100], [100]] }, { checkSlope: false }).failures).toEqual(['checkpoint floor']);
  expect(evaluate({ values: [[120], [100], [100]] }).pass).toBe(true);
});

test('custom limit applies without mutating samples', () => {
  const values = [[110, 200]];
  expect(evaluate({ values }, { limit: 0.05 }).pass).toBe(false);
  expect(values).toEqual([[110, 200]]);
});

test.each([[], [NaN], [Infinity], [-Infinity], [100, NaN]].map(samples => ({ samples })))('invalid readings throw: $samples', ({ samples }) => {
  expect(() => evaluate({ values: [samples] })).toThrow(RangeError);
  expect(() => evaluate({ values: [[100]], baseline: samples })).toThrow(RangeError);
});

test.each([0, -1])('nonpositive baseline throws: %s', baseline => {
  expect(() => evaluate({ values: [[100]], baseline: [baseline] })).toThrow(RangeError);
});

test.each([0, 1, -0.1, NaN, Infinity])('invalid limit throws: %s', limit => {
  expect(() => evaluate({ values: [[100]] }, { limit })).toThrow(RangeError);
});

test('empty checkpoints throw', () => {
  expect(() => evaluate({ values: [] })).toThrow(RangeError);
});
