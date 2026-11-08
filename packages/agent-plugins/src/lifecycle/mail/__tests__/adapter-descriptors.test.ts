import { parseMailProviderSetupProperty } from "@jini-ai/platform/mail";
import { describe, expect, it } from 'vitest';
import { asMailAdapterModule, parseMailAdaptersFile } from '../index.js';

const v1 = { id: 'relay', label: 'Relay', module: 'mail/relay.mjs', credentialLabel: 'Relay key' };
const v2 = { id: 'relay', label: 'Relay', module: 'mail/relay.mjs', credentialKeys: ['token'], feedback: false };
const file = (schemaVersion: number, adapters: unknown) => JSON.stringify({ schemaVersion, adapters });

describe('parseMailAdaptersFile', () => {
  it('parses v1 entries and refuses a bad id, module or label', () => {
    expect(parseMailAdaptersFile({ parseSetup: parseMailProviderSetupProperty, raw: file(1, [v1]) })).toEqual({ ok: true, descriptors: [v1] });
    expect(parseMailAdaptersFile({ parseSetup: parseMailProviderSetupProperty, raw: file(1, [{ ...v1, module: '/x.mjs' }]) })).toEqual({ ok: false, reason: 'adapters[0].module must be a relative path ending in .mjs' });
    expect(parseMailAdaptersFile({ parseSetup: parseMailProviderSetupProperty, raw: file(1, [{ ...v1, credentialLabel: '' }]) })).toEqual({ ok: false, reason: 'adapters[0].credentialLabel must be a non-empty string' });
    expect(parseMailAdaptersFile({ parseSetup: parseMailProviderSetupProperty, raw: file(3, []) })).toEqual({ ok: false, reason: 'schemaVersion must be 1 or 2' });
  });

  it('gives a v2 entry without a label the neutral default, or the host label when one is supplied', () => {
    const neutral = parseMailAdaptersFile({ parseSetup: parseMailProviderSetupProperty, raw: file(2, [v2]) });
    expect(neutral.ok && neutral.descriptors[0]?.credentialLabel).toBe('Mail — Relay API');
    const hosted = parseMailAdaptersFile({ parseSetup: parseMailProviderSetupProperty, raw: file(2, [v2]) }, { defaultCredentialLabel: ({ label }) => `Host — ${label}` });
    expect(hosted.ok && hosted.descriptors[0]?.credentialLabel).toBe('Host — Relay');
    const explicit = parseMailAdaptersFile({ parseSetup: parseMailProviderSetupProperty, raw: file(2, [{ ...v2, credentialLabel: 'Own key' }]) }, { defaultCredentialLabel: () => 'unused' });
    expect(explicit.ok && explicit.descriptors[0]?.credentialLabel).toBe('Own key');
  });

  it('keeps a bad optional key card as a note and refuses a bad feedback flag', () => {
    const parsed = parseMailAdaptersFile({ parseSetup: parseMailProviderSetupProperty, raw: file(2, [{ ...v2, credentialCard: { title: 'Key', baseUrl: 'http://x' } }]) });
    expect(parsed.ok && parsed.descriptors[0]?.credentialCardRefusal).toBe('adapters[0].credentialCard.baseUrl must be an https URL');
    expect(parseMailAdaptersFile({ parseSetup: parseMailProviderSetupProperty, raw: file(2, [{ ...v2, feedback: 'yes' }]) })).toEqual({ ok: false, reason: 'adapters[0].feedback must be true or false' });
  });
});

describe('asMailAdapterModule', () => {
  it('needs create()', () => {
    const module = { create: () => ({}) };
    expect(asMailAdapterModule({ exported: module })).toBe(module);
    expect(asMailAdapterModule({ exported: { send: () => ({}) } })).toBe('its module has no create() function');
  });
});
