import type { Request } from 'express';
import { expect, it, vi } from 'vitest';
import { readRequestAnalyticsProof, type ConsentHttpPorts } from '../express/index.js';
import { accepted, config, now } from './fixtures.js';

it.each([new Error('policy unavailable'), 'policy unavailable'])('denies analytics proof when config storage fails: %s', async error => {
  const read = vi.fn(async () => accepted);
  const ports: Pick<ConsentHttpPorts, 'config' | 'records' | 'clock' | 'readReceiptId' | 'reportError'> = {
    config: { get: async () => { throw error; } }, records: { read, save: async () => {}, retire: async () => {} },
    clock: { nowMs: () => Date.parse(now), nowIso: () => now }, readReceiptId: () => accepted.id, reportError: () => {},
  };
  const request = { get: () => undefined } as unknown as Request;
  expect(await readRequestAnalyticsProof({ ports, request })).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

it('produces a receipt proof after storage recovers', async () => {
  const ports = { config: { get: async () => config }, records: { read: async () => accepted, save: async () => {}, retire: async () => {} },
    clock: { nowMs: () => Date.parse(now), nowIso: () => now }, readReceiptId: () => accepted.id, reportError: () => {} };
  const request = { get: () => undefined } as unknown as Request;
  expect(await readRequestAnalyticsProof({ ports, request })).toEqual({ receiptId: accepted.id, policyVersion: '1' });
});
