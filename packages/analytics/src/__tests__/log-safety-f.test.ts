import { afterEach, expect, it, vi } from 'vitest';
import { createConsoleLogger } from '@jini-ai/core/primitives';
import { withProductAnalyticsGuards } from '../product/index.js';

afterEach(() => vi.restoreAllMocks());

it('reports missing consent revision once per wrapper and drops repeated promised approvals', async () => {
  const output = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const inner = { capture: vi.fn(), identify: vi.fn() };
  const warn = vi.fn(createConsoleLogger({ prefix: 'analytics' }).warn);
  const guarded = withProductAnalyticsGuards({ inner, consent: async () => true }, { report: { warn } });
  await guarded.capture({ name: 'first', userId: 'u1' });
  await guarded.capture({ name: 'second', userId: 'u1' });
  expect(inner.capture).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(output).toHaveBeenCalledTimes(1);
  expect(output.mock.calls[0]?.[0]).toContain('async consent without consentRevision');
});

it('keeps safe default diagnostics and catches a throwing host reporter', async () => {
  const output = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const inner = { capture: vi.fn(), identify: vi.fn() };
  await withProductAnalyticsGuards({ inner, consent: async () => true }).capture({ name: 'first', userId: 'u1' });
  expect(output).toHaveBeenCalledTimes(1);
  const error = Object.assign(new Error('teal fox private cedar'), { stack: 'teal fox private cedar' });
  await withProductAnalyticsGuards({ inner, consent: async () => true }, { report: { warn: () => { throw error; } } }).capture({ name: 'second', userId: 'u1' });
  expect(inner.capture).not.toHaveBeenCalled();
  expect(JSON.stringify(output.mock.calls)).not.toContain('teal fox private cedar');
});
