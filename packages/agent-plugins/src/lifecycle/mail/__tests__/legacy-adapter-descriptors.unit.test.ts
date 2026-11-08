import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseMailProviderSetupProperty } from '@jini-ai/platform/mail';
import { parseMailAdaptersFile } from '../adapter-descriptors.js';

const v1 = { id: 'relay', label: 'Relay', module: 'relay.mjs', credentialLabel: 'Relay key' };
const v2 = { id: 'relay', label: 'Relay', module: 'relay.mjs', credentialKeys: ['token', 'region'], feedback: false };
const raw = (version: number, entry: unknown) => JSON.stringify({ schemaVersion: version, adapters: [entry] });

it('F3 legacy raw-only v1 and v2 without setup retain valid descriptor semantics', () => {
  expect(parseMailAdaptersFile({ raw: raw(1, v1) })).toEqual({ ok: true, descriptors: [v1] });
  expect(parseMailAdaptersFile({ raw: raw(2, v2) })).toEqual({ ok: true, descriptors: [{ ...v2, schemaVersion: 2, credentialLabel: 'Mail — Relay API' }] });
});

it('F3 legacy raw-only parser validates declared setup and retains default fields', () => {
  const setup = { helpUrl: 'https://relay.test/help', fields: [{ key: 'baseUrl', label: 'Endpoint', type: 'url', defaultValue: 'https://api.relay.test' }] };
  const result = parseMailAdaptersFile({ raw: raw(2, { ...v2, setup, ignored: 'unknown' }) });
  expect(result).toEqual({ ok: true, descriptors: [{ ...v2, schemaVersion: 2, credentialLabel: 'Mail — Relay API',
    setup: { helpUrl: setup.helpUrl, fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', required: true, defaultValue: 'https://api.relay.test' },
      { key: 'token', label: 'API key', type: 'secret', required: true }, { key: 'region', label: 'region', type: 'text', required: true },
    ] },
  }] });
  expect(parseMailAdaptersFile({ raw: raw(2, { ...v2, setup: { fields: [{ key: 'token', label: 'Key', type: 'text' }] } }) })).toEqual({ ok: false, reason: 'adapters[0].setup.fields[0]: the token field must be type secret' });
});

it.each([
  undefined, null, [], 'bad', {}, { helpUrl: 'http://insecure.test' }, { fields: 'bad' }, { fields: [null] },
  { fields: [{ key: 'other', label: 'Other' }] }, { fields: [{ key: 'token', label: 'Key', type: 'text' }] },
  { fields: [{ key: 'token', label: 'Key', type: 'secret', defaultValue: 'secret' }] },
  { fields: [{ key: 'region', label: 'Region', type: 'email', required: false, help: '  Help  ', placeholder: '  Region  ', helpUrl: 'https://relay.test' }] },
  { fields: [{ key: 'region', label: 'Region' }, { key: 'region', label: 'Repeated' }] },
  { fields: [{ key: 'region', label: ' ', type: 'text' }] }, { fields: [{ key: 'region', label: 'Region', type: 'number' }] },
  { fields: [{ key: 'region', label: 'Region', help: '' }] }, { fields: [{ key: 'region', label: 'Region', helpUrl: 'bad' }] },
])('F3 legacy setup result equals the real injected platform parser for %j', setup => {
  const input = raw(2, { ...v2, setup });
  expect(parseMailAdaptersFile({ raw: input })).toEqual(parseMailAdaptersFile({ raw: input, parseSetup: parseMailProviderSetupProperty }));
});

it('F3 legacy actual Resend descriptor keeps its card and exact declared label', () => {
  const input = readFileSync(new URL('../../../../resend/tovu-mail-adapters.json', import.meta.url), 'utf8');
  const result = parseMailAdaptersFile({ raw: input });
  expect(result).toEqual(parseMailAdaptersFile({ raw: input, parseSetup: parseMailProviderSetupProperty }));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.descriptors[0]?.credentialLabel).toBe('Tovu Mail — Resend API');
  expect(result.descriptors[0]?.credentialCard?.title).toBe('Connect Resend');
});

it('F3 wired parser receives the original arguments and its output is preserved', () => {
  const calls: unknown[] = []; const setup = { fields: [] };
  const result = parseMailAdaptersFile({ raw: raw(2, { ...v2, setup }), parseSetup: input => { calls.push(input); return 'Host validation refusal'; } });
  expect(calls).toEqual([{ value: setup, at: 'adapters[0]', credentialKeys: v2.credentialKeys }]);
  expect(result).toEqual({ ok: false, reason: 'Host validation refusal' });
});
