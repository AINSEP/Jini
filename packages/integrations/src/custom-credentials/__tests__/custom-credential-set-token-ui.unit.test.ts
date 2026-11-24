import { describe, expect, it } from 'vitest';
import type { SurfaceCardApp } from '@jini-ai/core/contracts/cards';
import { setTokenForm, setTokenOutcome } from '../custom-credential-set-token-ui.js';

const app = { name: 'host-set-token-app' } as unknown as SurfaceCardApp;
const outcomeApp = { name: 'host-set-token-outcome-app' } as unknown as SurfaceCardApp;

describe('setTokenForm', () => {
  it('collects exactly one masked-by-marker token field, optional so a blank submission reaches the host\'s refusal', () => {
    const form = setTokenForm({ label: 'Stripe', app, secretField: { secret: true } });
    expect(form.fields).toEqual([{
      kind: 'string', name: 'token', label: 'Token', hint: 'Pasted or typed here only — never shown to the assistant.',
      required: false, allowBlank: true, secret: true,
    }]);
  });

  it('takes the secret marker only from the host: with none supplied the field carries no secret flag', () => {
    const [field] = setTokenForm({ label: 'Stripe', app, secretField: undefined }).fields;
    expect(field).toMatchObject({ name: 'token', required: false, allowBlank: true });
    expect('secret' in field!).toBe(false);
  });

  it('names the credential in the title and states the replace-and-never-seen promise in the description', () => {
    const form = setTokenForm({ label: "Bob's key", app, secretField: { secret: true } });
    expect(form.title).toBe("Replace the saved key for 'Bob's key'?");
    expect(form.description).toContain('This REPLACES the saved key.');
    expect(form.description).toContain('the assistant never sees it');
    expect(form.description).toContain('never written to the chat transcript');
    expect(form.description).toContain('Any saved username for this credential is kept as-is.');
    expect(form).toMatchObject({ submitLabel: 'Replace saved key', cancelLabel: 'Cancel', preferredFrameSize: ['100%', '360px'] });
  });

  it('uses the host\'s card identity for the form, untouched', () => {
    expect(setTokenForm({ label: 'x', app, secretField: undefined }).app).toBe(app);
  });
});

describe('setTokenOutcome', () => {
  it('reports success as "Token saved" with the credential label and the caller\'s message', () => {
    expect(setTokenOutcome({ label: 'Stripe', state: 'success', message: 'Saved the new key.', app: outcomeApp })).toEqual({
      title: 'Token saved', details: [{ label: 'Credential', value: 'Stripe' }], state: 'success', message: 'Saved the new key.',
      app: outcomeApp, preferredFrameSize: ['100%', '240px'],
    });
  });

  it('reports failure as "Token not saved" with the failure state', () => {
    expect(setTokenOutcome({ label: 'Stripe', state: 'failure', message: 'A blank token was submitted. Nothing was saved.', app: outcomeApp })).toEqual({
      title: 'Token not saved', details: [{ label: 'Credential', value: 'Stripe' }], state: 'failure',
      message: 'A blank token was submitted. Nothing was saved.', app: outcomeApp, preferredFrameSize: ['100%', '240px'],
    });
  });

  it('renders exactly the message it is given: the caller owns keeping a token out of it', () => {
    expect(setTokenOutcome({ label: 'L', state: 'success', message: 'm-1', app: outcomeApp }).message).toBe('m-1');
    expect(setTokenOutcome({ label: 'L', state: 'success', message: 'm-2', app: outcomeApp }).message).toBe('m-2');
  });
});
