import { afterEach, expect, it, vi } from 'vitest';
import { createApprovalProposalStore } from '../approval.js';
import { AdminApiError, describeApiError } from '../admin-runtime/admin-api-error.js';
import { createConsoleLogger } from '../primitives/logger.js';
import { fakeScheduler, fixedIds } from './approval-fakes.js';

const sentinel = 'lilac otter private orchard';
const failure = () => Object.assign(new Error(sentinel), { stack: sentinel });
afterEach(() => vi.restoreAllMocks());

it.each([failure(), sentinel])('approval publishes fixed copy and rejects with the original value', async error => {
  const store = createApprovalProposalStore({ responseTool: 'reply', messages: { closed: 'closed', pending: 'pending', missing: 'missing' }, ids: fixedIds('proposal'), scheduler: fakeScheduler() });
  store.propose({ description: 'approved action', signal: new AbortController().signal, execute: async () => { throw error; } });
  await expect(store.respond({ approvalId: 'proposal', approved: true })).rejects.toBe(error);
  expect(store.getSnapshot()).toEqual({ pending: null, error: `The approved action stopped with an error (${error instanceof Error ? 'Error' : 'string'}).` });
  expect(JSON.stringify(store.getSnapshot())).not.toContain(sentinel);
});

it.each([[failure(), 'Error'], [sentinel, 'string']])('reports a throwing diagnostics sink once without repeating the original message', (error, label) => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const logger = createConsoleLogger({ prefix: 'core' }, { diagnostics: () => { throw error; } });
  expect(() => logger.error({ message: sentinel })).not.toThrow();
  expect(output).toHaveBeenCalledTimes(2);
  expect(output.mock.calls[0]?.[0]).toContain(sentinel);
  expect(output.mock.calls[1]).toEqual(['Diagnostics sink failed.', label]);
  expect(JSON.stringify(output.mock.calls[1])).not.toContain(sentinel);
});

it.each([failure(), sentinel])('keeps typed admin copy and uses the safe default when no warning port is supplied', error => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(describeApiError({ e: error, fallback: 'Media could not be loaded.' })).toBe('Media could not be loaded.');
  expect(warn).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(sentinel);
  expect(describeApiError({ e: new AdminApiError({ message: 'Approved API copy', status: 400 }), fallback: 'fallback' })).toBe('Approved API copy');
  expect(warn).toHaveBeenCalledTimes(1);
});
