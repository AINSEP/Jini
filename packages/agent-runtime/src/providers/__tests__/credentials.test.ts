import { describe, expect, test } from 'vitest';
import { createRequestSuppliedExecutionCredentialPort, createStoredExecutionCredentialPort, type StoredProviderCredential } from '../credentials.js';

const ids = { workspaceId: 'w', principalId: 'p' };
const complete = { protocol: 'anthropic', apiKey: 'k', model: 'm' };
const stored = (row: Partial<StoredProviderCredential> = {}): StoredProviderCredential =>
  ({ protocol: 'openai', apiKey: 'sk', model: 'gpt', baseUrl: null, maxTokens: null, ...row });

describe('provider credentials', () => {
  test('request-supplied: complete config resolves; optional fields carried only when usable', async () => {
    const port = createRequestSuppliedExecutionCredentialPort();
    await expect(port.resolve({ requestBody: complete, ...ids })).resolves.toEqual(complete);
    await expect(port.resolve({ requestBody: { ...complete, baseUrl: 'https://x.test', maxTokens: 9 }, ...ids }))
      .resolves.toEqual({ ...complete, baseUrl: 'https://x.test', maxTokens: 9 });
    await expect(port.resolve({ requestBody: { ...complete, baseUrl: '  ', maxTokens: 0 }, ...ids })).resolves.toEqual(complete);
    for (const broken of [{ ...complete, protocol: 'other' }, { ...complete, apiKey: ' ' }, { ...complete, model: undefined }]) {
      await expect(port.resolve({ requestBody: broken, ...ids })).resolves.toBeNull();
    }
  });

  test('stored: the request wins without a read; otherwise the identity-scoped row is used', async () => {
    const reads: unknown[] = [];
    const port = createStoredExecutionCredentialPort({ readStored: async (identity) => { reads.push(identity); return stored({ baseUrl: 'https://b.test', maxTokens: 5 }); } });
    await expect(port.resolve({ requestBody: complete, ...ids })).resolves.toEqual(complete);
    expect(reads).toEqual([]);
    await expect(port.resolve({ requestBody: { apiKey: '' }, ...ids }))
      .resolves.toEqual({ protocol: 'openai', apiKey: 'sk', model: 'gpt', baseUrl: 'https://b.test', maxTokens: 5 });
    expect(reads).toEqual([ids]);
  });

  test('stored: no row, unknown protocol or blank model resolves null', async () => {
    for (const row of [null, stored({ protocol: 'other' }), stored({ model: null }), stored({ model: ' ' })]) {
      const port = createStoredExecutionCredentialPort({ readStored: async () => row });
      await expect(port.resolve({ requestBody: {}, ...ids })).resolves.toBeNull();
    }
  });
});
