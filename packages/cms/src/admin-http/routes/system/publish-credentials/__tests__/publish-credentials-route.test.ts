import { expect, it } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { knownPublishCredentialListRefusal, listPublishCredentialsReply } from '../list.js';

it('maps typed credential list failures and leaves unknown failures to the host', () => {
  class StoreError extends Error {}
  const storeErrors = { validation: StoreError, duplicateLabel: StoreError, notFound: StoreError, secretStoreUnconfigured: StoreError };
  expect(knownPublishCredentialListRefusal({ err: new ToolInputError({ message: 'in use' }), storeErrors })).toEqual({ status: 409, body: { error: 'KEY_IN_USE', detail: 'in use' } });
  expect(knownPublishCredentialListRefusal({ err: new StoreError('invalid'), storeErrors })).toEqual({ status: 400, body: { error: 'VALIDATION', detail: 'invalid' } });
  expect(knownPublishCredentialListRefusal({ err: new Error('private'), storeErrors })).toBeUndefined();
});

it('writes the credential list before triggering label healing', async () => {
  const order: string[] = [];
  const credentials = [{ id: 'credential', credentialType: 'vendor' as const, worksFor: [], publishHosts: [], defaultFor: [], providerId: 'host', vendorId: 'vendor', label: 'label', configured: true as const, isDefault: false, tokenTail: 'tail', accountLabel: null, createdAt: 'now', updatedAt: 'now' }];
  await listPublishCredentialsReply({ deps: {
    list: async () => { order.push('list'); return credentials; },
    executionMode: () => 'local',
    json: reply => { expect(reply).toEqual({ credentials, executionMode: 'local' }); order.push('json'); },
    triggerAccountLabelHeal: async rows => { expect(rows).toBe(credentials); order.push('heal'); },
  } });
  expect(order).toEqual(['list', 'json', 'heal']);
});
