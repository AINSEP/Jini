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
