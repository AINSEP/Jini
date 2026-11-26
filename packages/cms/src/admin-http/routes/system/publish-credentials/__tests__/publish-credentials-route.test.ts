import { expect, it } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { knownPublishCredentialListRefusal } from '../list.js';

it('maps typed credential list failures and leaves unknown failures to the host', () => {
  class StoreError extends Error {}
  const storeErrors = { validation: StoreError, duplicateLabel: StoreError, notFound: StoreError, secretStoreUnconfigured: StoreError };
  expect(knownPublishCredentialListRefusal({ err: new ToolInputError({ message: 'in use' }), storeErrors })).toEqual({ status: 409, body: { error: 'KEY_IN_USE', detail: 'in use' } });
  expect(knownPublishCredentialListRefusal({ err: new StoreError('invalid'), storeErrors })).toEqual({ status: 400, body: { error: 'VALIDATION', detail: 'invalid' } });
  expect(knownPublishCredentialListRefusal({ err: new Error('private'), storeErrors })).toBeUndefined();
});
