/**
 * @file Characterization pins for existing Google Workspace plugin files that the Sheets admin tools
 * (lot G12) extend: the safe error table in `lib/request-policy.mjs` (new codes are added, none of
 * these may change) and the `account_info` entry of `tovu-agent-tools.json` (new tools are appended
 * after it, it stays as it is). Green on the files before the Sheets admin tools landed.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { GoogleWorkspaceError, classifyFailure } from '../lib/request-policy.mjs';

/** Every code that existed before G12 with its retryable flag and next action. */
const EXISTING_CODES = {
  'invalid-request': [false, 'fix-request'],
  'not-connected': [false, 'connect'],
  'reconnect-required': [false, 'reconnect'],
  'account-changed': [false, 'review-account'],
  'missing-permission': [false, 'grant-permission'],
  'file-not-granted': [false, 're-pick-file'],
  'access-denied': [false, 're-pick-file'],
  'admin-policy': [false, 'contact-admin'],
  'conflict': [true, 'retry-later'],
  'quota-delay': [true, 'retry-later'],
  'service-unavailable': [true, 'retry-later'],
  'network-error': [true, 'retry-later'],
  'uncertain-outcome': [false, 'review-outcome'],
  'unexpected-response': [false, 'report'],
  'product-disabled': [false, 'enable-product'],
};

test('request-policy: every existing safe code keeps its retryable flag, next action and default not-applied outcome', () => {
  for (const [code, [retryable, nextAction]] of Object.entries(EXISTING_CODES)) {
    const json = new GoogleWorkspaceError({ code }).toJSON();
    assert.deepEqual({ code: json.code, retryable: json.retryable, nextAction: json.nextAction, outcome: json.outcome }, { code, retryable, nextAction, outcome: 'not-applied' }, code);
  }
});

test('request-policy: an unknown write outcome stays uncertain-outcome and a 5xx read stays a retryable service-unavailable', () => {
  assert.equal(classifyFailure({ kind: 'write', status: 503 }).code, 'uncertain-outcome');
  assert.equal(classifyFailure({ kind: 'idempotent-write', status: 503 }).outcome, 'unknown');
  assert.equal(classifyFailure({ kind: 'read', status: 503 }).code, 'service-unavailable');
});

test('tovu-agent-tools.json: account_info stays the first tool, unchanged', async () => {
  const file = JSON.parse(await readFile(new URL('../tovu-agent-tools.json', import.meta.url), 'utf8'));
  assert.equal(file.schemaVersion, 1);
  assert.deepEqual(file.tools[0], {
    name: 'account_info',
    description: 'Show which Google account a Google Workspace connection is signed in as. Pass the connectionRef from the connection status. Returns the account label only, never a token.',
    effect: 'read',
    module: 'tools/account-info.mjs',
    inputSchema: {
      type: 'object', required: ['connectionRef'], additionalProperties: false,
      properties: { connectionRef: { type: 'string', minLength: 1, maxLength: 512 } },
    },
  });
});
