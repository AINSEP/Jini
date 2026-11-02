/**
 * @file Characterization pin for `lib/request-policy.mjs` before the Picker lot (G13) adds selection
 * codes: every existing safe code keeps its retryability, next action and fixed message prefix, so
 * an additive change to the table cannot quietly alter what tools and deliveries already report.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GoogleWorkspaceError } from '../lib/request-policy.mjs';

const EXISTING = [
  ['invalid-request', false, 'fix-request', 'Google rejected the request as invalid.'],
  ['not-connected', false, 'connect', 'Google Workspace is not connected.'],
  ['reconnect-required', false, 'reconnect', 'Reconnect required:'],
  ['account-changed', false, 'review-account', 'The connected Google account changed'],
  ['missing-permission', false, 'grant-permission', 'The connected Google account has not granted'],
  ['file-not-granted', false, 're-pick-file', 'This site cannot open this file'],
  ['access-denied', false, 're-pick-file', 'Google refused access to this file'],
  ['admin-policy', false, 'contact-admin', "A Google Workspace administrator's policy"],
  ['conflict', true, 'retry-later', 'Google reported a conflicting change.'],
  ['quota-delay', true, 'retry-later', 'Google asked this site to slow down.'],
  ['service-unavailable', true, 'retry-later', 'Google is temporarily unavailable.'],
  ['network-error', true, 'retry-later', 'This site could not reach Google.'],
  ['uncertain-outcome', false, 'review-outcome', 'Google did not confirm whether the change was applied.'],
  ['unexpected-response', false, 'report', 'Google returned a response this site does not understand.'],
  ['product-disabled', false, 'enable-product', 'This Google product is turned off'],
];

for (const [code, retryable, nextAction, prefix] of EXISTING) {
  test(`pin: '${code}' keeps retryable=${retryable}, nextAction '${nextAction}' and its message`, () => {
    const error = new GoogleWorkspaceError({ code });
    assert.equal(error.retryable, retryable);
    assert.equal(error.nextAction, nextAction);
    assert.ok(error.message.startsWith(prefix), error.message);
    assert.equal(error.outcome, 'not-applied');
  });
}
