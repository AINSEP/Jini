/**
 * @file Unit tests for connection keys: the workspace+plugin+connection → key mapping stays
 * injective, the staged key sits beside the main key, and the generation reader fences both.
 */
import { describe, expect, it } from 'vitest';
import { createApiConnectionGenerationReader, deriveApiConnectionKey } from '../index.js';
import { stagedTokenKey } from '../keys.js';
import type { ApiConnectionRecord } from '../types.js';
import { memoryRecordStore } from './fixtures/harness.js';

function record(key: string, generation: number): ApiConnectionRecord {
  return { key, workspaceId: 'ws-1', pluginId: 'acme-office', connectionId: 'account', status: 'connected', revision: 0,
    generation, account: null, grantedScopes: [], staged: null, revocationFailure: null, updatedAt: '2026-10-20T10:00:00.000Z' };
}

describe('deriveApiConnectionKey', () => {
  it('is a versioned, prefixed key of the three parts', () => {
    expect(deriveApiConnectionKey({ workspaceId: 'ws-1', pluginId: 'acme-office', connectionId: 'account' }))
      .toBe('api-connection:v1:ws-1:acme-office:account');
  });

  it('keeps parts containing the separator apart (percent-encoding keeps the mapping injective)', () => {
    const shifted = deriveApiConnectionKey({ workspaceId: 'ws:a', pluginId: 'b', connectionId: 'c' });
    expect(shifted).not.toBe(deriveApiConnectionKey({ workspaceId: 'ws', pluginId: 'a:b', connectionId: 'c' }));
  });

  it('cannot be made to look like a staged key', () => {
    expect(deriveApiConnectionKey({ workspaceId: 'ws-1', pluginId: 'acme-office', connectionId: 'account#staged' }).endsWith('#staged'))
      .toBe(false);
  });
});

describe('createApiConnectionGenerationReader', () => {
  it('reads 0 for a connection without a record', async () => {
    const readGeneration = createApiConnectionGenerationReader({ records: memoryRecordStore() });
    expect(await readGeneration({ key: 'api-connection:v1:ws-1:acme-office:account' })).toBe(0);
  });

  it('reads the record generation for the main key', async () => {
    const records = memoryRecordStore();
    const key = 'api-connection:v1:ws-1:acme-office:account';
    await records.compareAndSet({ key, expectedRevision: 0, record: record(key, 4) });
    expect(await createApiConnectionGenerationReader({ records })({ key })).toBe(4);
  });

  it('reads the owning record generation for the staged key', async () => {
    const records = memoryRecordStore();
    const key = 'api-connection:v1:ws-1:acme-office:account';
    await records.compareAndSet({ key, expectedRevision: 0, record: record(key, 6) });
    expect(await createApiConnectionGenerationReader({ records })({ key: stagedTokenKey({ key }) })).toBe(6);
  });
});
