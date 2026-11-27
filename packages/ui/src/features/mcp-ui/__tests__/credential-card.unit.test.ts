import { expect, it } from 'vitest';
import { applyPluginCredentialCard, buildPluginCredentialForm } from '../credential-card.js';

const card = { providerId: 'metrics', label: 'Metrics key', category: 'general', baseUrl: 'https://metrics.test', title: 'Connect metrics' };
const app = { appName: 'another-host', appVersion: '2' };

it('uses the host app identity and complete plugin metadata without introducing absent hints', () => {
  const form = buildPluginCredentialForm({ card, app });
  expect(form.app).toEqual(app);
  expect(form.preferredFrameSize).toEqual(['100%', '360px']);
  expect(form.title).toBe('Connect metrics');
  expect(form.details).toContainEqual({ label: 'Saved as', value: 'Metrics key' });
  const decorated = applyPluginCredentialCard({ card, app, form: {
    title: 'Host form', app, submitLabel: 'Save', fields: [{ kind: 'string', name: 'token', label: 'Token', secret: true }],
  } });
  expect(decorated.fields[0]).not.toHaveProperty('hint');
  expect(decorated.app).toEqual(app);
});

it('preserves the domain form and stored-secret rules while applying declared plugin hints', () => {
  const base = { title: 'Host form', app, submitLabel: 'Update', fields: [{ kind: 'string' as const, name: 'token', label: 'Token', secret: true as const, allowBlank: true, hint: 'Keep saved value' }] };
  expect(applyPluginCredentialCard({ card: undefined, form: base, app })).toBe(base);
  const decorated = applyPluginCredentialCard({ card: { ...card, keyHint: 'Use a scoped key' }, form: base, app });
  expect(decorated.fields[0]).toEqual({ ...base.fields[0], hint: 'Use a scoped key' });
  expect(decorated.submitLabel).toBe('Update');
});

it('puts the intro ahead of the sealing note, lists help and use, and appends declared fields before the masked key', () => {
  const form = buildPluginCredentialForm({ app, card: {
    ...card, intro: 'Connect your metrics account.', helpUrl: 'https://metrics.test/keys', helpLabel: 'Open key page',
    usedFor: ['dashboards', 'alerts'], keyHint: 'Use a read key', fields: [{ name: 'region', label: 'Region' }],
  } });
  expect(form.description).toBe('Connect your metrics account. The key is sealed on the server the moment you submit — the assistant never sees it.');
  expect(form.details).toEqual([
    { label: 'Open key page', value: 'https://metrics.test/keys' },
    { label: 'Used for', value: 'dashboards; alerts' },
    { label: 'Saved as', value: 'Metrics key' },
  ]);
  expect(form.submitLabel).toBe('Save key');
  expect(form.fields).toEqual([
    { kind: 'string', name: 'region', label: 'Region' },
    { kind: 'string', name: 'token', label: 'API key', hint: 'Use a read key', required: true, secret: true },
  ]);
});

it('falls back to the default help label, key hint and bare sealing note, and omits an empty used-for list', () => {
  const form = buildPluginCredentialForm({ app, card: { ...card, helpUrl: 'https://metrics.test/keys', usedFor: [] } });
  expect(form.description).toBe('The key is sealed on the server the moment you submit — the assistant never sees it.');
  expect(form.details).toEqual([{ label: 'Get a key', value: 'https://metrics.test/keys' }, { label: 'Saved as', value: 'Metrics key' }]);
  expect(form.fields).toEqual([{ kind: 'string', name: 'token', label: 'API key', hint: 'Paste the key here. It is never shown to the assistant.', required: true, secret: true }]);
});

it('a non-api save kind names its own connection, so no fixed "Saved as" row; an explicit api kind keeps it', () => {
  expect(buildPluginCredentialForm({ app, card: { ...card, saveKind: 'publish-host' } }).details).toEqual([]);
  expect(buildPluginCredentialForm({ app, card: { ...card, saveKind: 'api' } }).details).toEqual([{ label: 'Saved as', value: 'Metrics key' }]);
});

it('on a domain form: prefixes the intro to its own description, appends plugin detail rows, and only re-hints the secret token field', () => {
  const form = {
    title: 'Host form', description: 'Saved per site.', app, submitLabel: 'Save', details: [{ label: 'Site', value: 'Docs' }],
    fields: [
      { kind: 'string' as const, name: 'token', label: 'Token', secret: true as const },
      { kind: 'string' as const, name: 'token', label: 'Visible token' },
      { kind: 'string' as const, name: 'user', label: 'User', secret: true as const },
    ],
  };
  const decorated = applyPluginCredentialCard({ app, form, card: { ...card, intro: 'Connect metrics.', keyHint: 'Scoped key' } });
  expect(decorated.title).toBe('Connect metrics');
  expect(decorated.description).toBe('Connect metrics. Saved per site.');
  expect(decorated.details).toEqual([{ label: 'Site', value: 'Docs' }, { label: 'Saved as', value: 'Metrics key' }]);
  expect(decorated.fields).toEqual([{ ...form.fields[0], hint: 'Scoped key' }, form.fields[1], form.fields[2]]);

  // No intro: the domain description stands alone; no domain description: the plugin's own sealing note.
  expect(applyPluginCredentialCard({ app, form, card }).description).toBe('Saved per site.');
  const bare = applyPluginCredentialCard({ app, form: { title: 'Host form', app, submitLabel: 'Save', fields: [] }, card });
  expect(bare.description).toBe('The key is sealed on the server the moment you submit — the assistant never sees it.');
  expect(bare.details).toEqual([{ label: 'Saved as', value: 'Metrics key' }]);
});
