/**
 * @file EXTRACT-S4 Main F4: setup validation belongs to the host runtime. With the copied parser
 * deleted (owner-approved), a schemaVersion 2 descriptor parsed without a host validator is refused
 * with one exact reason; raw v1 files still parse, and an injected validator's verdict is used as is.
 */
import { expect, it } from 'vitest';
import type { MailProviderSetup } from '@jini-ai/core/contracts/mail';
import { parseMailAdaptersFile } from '../index.js';
import type { ParseMailSetup } from '../adapter-descriptors.js';

const v1 = { id: 'relay', label: 'Relay', module: 'mail/relay.mjs', credentialLabel: 'Relay key' };
const v2 = { id: 'relay', label: 'Relay', module: 'mail/relay.mjs', credentialKeys: ['token'], feedback: false };
const file = (schemaVersion: number, adapters: unknown) => JSON.stringify({ schemaVersion, adapters });

it('a v2 descriptor without a host setup validator is refused with the exact reason', () => {
  expect(parseMailAdaptersFile({ raw: file(2, [v2]) })).toEqual({ ok: false, reason: 'this host supplies no mail setup validator' });
  expect(parseMailAdaptersFile({ raw: file(2, [{ ...v2, setup: { fields: [] } }]) })).toEqual({ ok: false, reason: 'this host supplies no mail setup validator' });
});

it('a raw v1 file still parses without any validator', () => {
  expect(parseMailAdaptersFile({ raw: file(1, [v1]) })).toEqual({ ok: true, descriptors: [v1] });
});

it('an injected v2 validator decides setup: its defaults are kept and its refusal is returned unchanged', () => {
  const calls: unknown[] = [];
  const setup: MailProviderSetup = { fields: [{ key: 'token', label: 'API key', type: 'secret', required: true }] };
  const accept: ParseMailSetup = input => { calls.push(input); return { setup }; };
  expect(parseMailAdaptersFile({ raw: file(2, [{ ...v2, setup: { declared: true } }]), parseSetup: accept })).toEqual({ ok: true, descriptors: [{ ...v2, schemaVersion: 2, credentialLabel: 'Mail — Relay API', setup }] });
  expect(calls).toEqual([{ value: { declared: true }, at: 'adapters[0]', credentialKeys: ['token'] }]);
  const refuse: ParseMailSetup = () => 'adapters[0].setup.fields[0]: host refusal';
  expect(parseMailAdaptersFile({ raw: file(2, [v2]), parseSetup: refuse })).toEqual({ ok: false, reason: 'adapters[0].setup.fields[0]: host refusal' });
});
