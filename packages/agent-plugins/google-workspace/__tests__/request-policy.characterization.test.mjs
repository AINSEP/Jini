/**
 * @file Characterization pins for `lib/request-policy.mjs` before the Sheets tools add their own
 * safe codes: every code that already exists keeps its fixed message, `retryable` flag, next action
 * and default outcome, because chat, form delivery and the assistant skill all rely on them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GoogleWorkspaceError } from '../lib/request-policy.mjs';

const EXISTING = {
  'invalid-request': [false, 'fix-request', 'Google rejected the request as invalid. Check the spreadsheet, tab, range and values, then try again.'],
  'not-connected': [false, 'connect', 'Google Workspace is not connected. Connect it from the Google Workspace plugin, then retry.'],
  'reconnect-required': [false, 'reconnect', 'Reconnect required: Google no longer accepts the saved sign-in. Reconnect Google Workspace, then retry.'],
  'account-changed': [false, 'review-account', 'The connected Google account changed since this was confirmed. Review the account and confirm again.'],
  'missing-permission': [false, 'grant-permission', 'The connected Google account has not granted a permission this needs. Reconnect and allow every requested permission.'],
  'file-not-granted': [false, 're-pick-file', 'This site cannot open this file with the connected Google account. Choose it again with the file picker, or create a new spreadsheet.'],
  'access-denied': [false, 're-pick-file', 'Google refused access to this file for the connected account. Check that the account can edit it, then choose it again.'],
  'admin-policy': [false, 'contact-admin', "A Google Workspace administrator's policy blocks this. Ask the administrator to allow this site, then retry."],
  'conflict': [true, 'retry-later', 'Google reported a conflicting change. Retry in a moment.'],
  'quota-delay': [true, 'retry-later', 'Google asked this site to slow down. Nothing was lost; retry after the delay.'],
  'service-unavailable': [true, 'retry-later', 'Google is temporarily unavailable. Nothing was lost; retry later.'],
  'network-error': [true, 'retry-later', 'This site could not reach Google. Check the connection and retry later.'],
  'uncertain-outcome': [false, 'review-outcome', 'Google did not confirm whether the change was applied. Check the spreadsheet before trying again.'],
  'unexpected-response': [false, 'report', 'Google returned a response this site does not understand. Report this to the plugin author.'],
  'product-disabled': [false, 'enable-product', 'This Google product is turned off. Turn it on in the Google Workspace panel, then retry; the Google sign-in is kept.'],
};

for (const [code, [retryable, nextAction, message]] of Object.entries(EXISTING)) {
  test(`safe error '${code}' keeps its message, retryable flag, next action and default outcome`, () => {
    assert.deepEqual(new GoogleWorkspaceError({ code }).toJSON(), { code, message, retryable, outcome: 'not-applied', nextAction });
  });
}
