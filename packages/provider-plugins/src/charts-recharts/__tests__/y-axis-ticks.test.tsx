import './dom-setup.js';
/**
 * Owner bugs 2026-11-01, moved from Tovu's `recharts-bundle-integer-ticks.unit.test.ts` (which mounted
 * the hand-patched shipped bundle, Tovu 6ca90820a and 194095b1a): a bar chart of whole counts (posts
 * per status, etc.) got y ticks 0, 0.8, 1.5, 2.3, and a max of 1 drew a 0–4 axis. These mount through
 * the provider's browser entry; the artifact integration test mounts the built bytes.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import type { ChartInstance } from '@jini-ai/ui/charts';
import { mount } from '../client/provider.js';

beforeEach(() => {
  // Recharts' ResponsiveContainer and tick sizing read getBoundingClientRect; jsdom reports 0x0,
  // which would draw an empty SVG. Text gets a proportional width so ticks are not thinned.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const text = this.id === 'recharts_measurement_span';
    const width = text ? (this.textContent ?? '').length * 7 : 600;
    const height = text ? 14 : 300;
    return { width, height, top: 0, left: 0, bottom: height, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => { vi.restoreAllMocks(); });

async function yTicks(kind: 'bar' | 'line', values: number[]): Promise<string[]> {
  const element = document.createElement('div');
  document.body.append(element);
  const data = values.map((count, i) => ({ status: `s${i}`, count }));
  let instance!: ChartInstance;
  act(() => {
    instance = mount({ element, spec: { kind, data, categoryKey: 'status', series: [{ key: 'count' }] }, theme: { mode: 'light' } });
  });
  await instance.ready;
  await vi.waitFor(() => expect(element.querySelector('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')).not.toBeNull());
  const ticks = Array.from(element.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')).map((el) => el.textContent ?? '');
  act(() => instance.destroy({}));
  element.remove();
  return ticks;
}

it.each(['bar', 'line'] as const)('a %s chart of whole counts gets whole-number y ticks', async (kind) => {
  const ticks = await yTicks(kind, [1, 3, 2]);
  expect(ticks.length).toBeGreaterThan(1);
  expect(ticks.every((tick) => /^\d+$/.test(tick)), ticks.join(', ')).toBe(true);
});

it.each(['bar', 'line'] as const)('a %s chart with fractional values keeps fractional y ticks', async (kind) => {
  const ticks = await yTicks(kind, [0.2, 0.5, 0.9]);
  expect(ticks.some((tick) => tick.includes('.')), ticks.join(', ')).toBe(true);
});

// Whole counts with a small maximum still got Recharts' default 5 ticks, so a posts chart with max 1
// had a 0–4 axis and quarter-height bars. Whole counts get at most max+1 ticks (never more than 5),
// so the axis ends at the data.
it.each(['bar', 'line'] as const)('a %s chart of small whole counts ends its y axis at the largest count', async (kind) => {
  expect(await yTicks(kind, [1, 0])).toEqual(['0', '1']);
  expect(await yTicks(kind, [2, 1, 0])).toEqual(['0', '1', '2']);
});

it.each(['bar', 'line'] as const)('a %s chart of all-zero counts still draws whole-number ticks', async (kind) => {
  const ticks = await yTicks(kind, [0, 0]);
  expect(ticks.length).toBeGreaterThan(0);
  expect(ticks.every((tick) => /^\d+$/.test(tick)), ticks.join(', ')).toBe(true);
});

it.each(['bar', 'line'] as const)('a %s chart of large whole counts keeps at most 5 ticks', async (kind) => {
  const ticks = await yTicks(kind, [12, 40, 7]);
  expect(ticks.length).toBeLessThanOrEqual(5);
  expect(ticks.every((tick) => /^\d+$/.test(tick)), ticks.join(', ')).toBe(true);
});
