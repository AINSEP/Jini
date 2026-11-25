import assert from 'node:assert/strict';
import { test } from 'vitest';
import { describeDeleteRequestApproval } from '../delete-request-confirmation-ui.js';

test('names credential, resolved host, DELETE and the full reviewed path with no token', () => {
  const result = describeDeleteRequestApproval({ label: 'Production', host: 'api.example.test', path: '/items/item-1?force=true', toolId: 'request', irreversibleDescription: 'Provider deletion cannot be undone.' });
  assert.equal(result.title, "Send a DELETE through 'Production'?");
  assert.equal(result.description, 'Provider deletion cannot be undone.');
  assert.equal(result.toolId, 'request');
  assert.equal(result.errorCode, 'CUSTOM_CREDENTIALS');
  assert.deepEqual(result.details, [{ label: 'Credential', value: 'Production' }, { label: 'Host', value: 'api.example.test' }, { label: 'Method', value: 'DELETE' }, { label: 'Path', value: '/items/item-1?force=true' }]);
  assert.equal(result.warning, 'This is irreversible if the provider actually deletes something. Double-check the path above before confirming.');
  assert.equal(result.danger, true);
  assert.equal(result.confirmLabel, 'Send DELETE');
  assert.equal(JSON.stringify(result).includes('accessToken'), false);
});
