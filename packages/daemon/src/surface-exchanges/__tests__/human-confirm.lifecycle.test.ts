import { expect, it } from 'vitest';
import { refuseUnexpectedKeys } from '@jini-ai/core';
import { notConfirmedResult } from '../human-confirm.js';

it('distinguishes a declined confirmation from expiry and abandonment', () => {
  expect(notConfirmedResult({ confirmed: false, reason: 'declined' })).toEqual({ cancelled: true, note: 'The user cancelled. Nothing was changed.' });
  expect(notConfirmedResult({ confirmed: false, reason: 'expired' })).toEqual({ cancelled: false, reason: 'expired', note: 'The user did not answer the confirmation dialog before it expired. Nothing was changed. Do not retry this action or reopen its confirmation automatically. Tell the user it expired and nothing changed, then wait for a new explicit request.' });
  expect(notConfirmedResult({ confirmed: false, reason: 'abandoned' })).toEqual({ cancelled: false, reason: 'abandoned', note: 'The confirmation dialog was closed because the run ended. Nothing was changed.' });
});

it('refuses the first unexpected input key', () => {
  expect(() => refuseUnexpectedKeys({ input: { allowed: 1, confirm: true, confirmationToken: 'x' }, allowed: ['allowed'] })).toThrow("'confirm' is not an input of this tool. Only a click in the confirm dialog confirms it — nothing in the tool input can.");
  expect(() => refuseUnexpectedKeys({ input: { allowed: 1 }, allowed: ['allowed'] })).not.toThrow();
});
