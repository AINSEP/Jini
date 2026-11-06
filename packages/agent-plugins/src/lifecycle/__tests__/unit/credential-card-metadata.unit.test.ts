import { describe, expect, it } from 'vitest';
import { parsePluginCredentialCards, parseCredentialCardUsedFor } from '../../credential-card-metadata.js';

const card = { target: 'example', label: 'Example key', category: 'hosting', baseUrl: 'https://api.example.com', title: 'Connect Example', intro: 'Publish this site.', keyHint: 'Grant deployment access.' };
const raw = (credentialCards: unknown, namespace = 'jini') => JSON.stringify({ extensions: { [namespace]: { credentialCards } } });

describe('portable credential card metadata', () => {
  it('normalizes portable declarations and preserves reviewed destinations and bounded copy', () => {
    const result = parsePluginCredentialCards({ raw: raw([{ ...card, ownedApiLabel: card.label, usedFor: [' Publish '], fields: [{ name: 'username', label: 'Account', required: true }], additionalHosts: ['https://other.example.com'], probeUrl: 'https://api.example.com/check' }]) });
    expect(result).toEqual({ ok: true, descriptors: [{ providerId: 'example', label: card.label, ownedApiLabel: card.label, category: card.category, baseUrl: card.baseUrl, title: card.title, intro: card.intro, keyHint: card.keyHint, usedFor: ['Publish'], fields: [{ name: 'username', label: 'Account', required: true }], additionalHosts: ['https://other.example.com'], probeUrl: 'https://api.example.com/check' }] });
  });

  it('retains legacy declarations with a visible warning while portable keys take precedence', () => {
    const warnings: string[] = [];
    const legacy = parsePluginCredentialCards({ raw: raw([card], 'tovu') }, { onWarning: warning => warnings.push(warning) });
    expect(legacy.ok && legacy.descriptors[0]?.providerId).toBe('example');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/extensions\.tovu.*extensions\.jini/);
    const both = JSON.stringify({ extensions: { jini: { credentialCards: [] }, tovu: { credentialCards: [card] } } });
    expect(parsePluginCredentialCards({ raw: both }, { onWarning: () => undefined })).toEqual({ ok: true, descriptors: [] });
    expect(parsePluginCredentialCards({ raw: '{}' })).toEqual({ ok: true, descriptors: [] });
  });

  it('refuses the whole batch for duplicate targets and unsafe or malformed metadata', () => {
    const invalid = [
      [card, card], [{ ...card, baseUrl: 'http://plain.example' }], [{ ...card, helpUrl: 'javascript:alert(1)' }],
      [{ ...card, fields: [{ name: 'token', label: 'Token' }] }], [{ ...card, fields: [{ name: 'username', label: 'User', secret: true }] }],
      [{ ...card, fields: [{ name: 'username', label: 'User' }, { name: 'username', label: 'Again' }] }],
      [{ ...card, additionalHosts: ['https://user:password@example.com'] }], [{ ...card, additionalHosts: ['https://example.com/path'] }],
      [{ ...card, probeUrl: 'https://other.example.com/check' }], [{ ...card, ownedApiLabel: 'Other' }],
      [{ ...card, category: 'invalid' }], [{ ...card, saveKind: 'unknown' }], [{ ...card, saveTarget: '../other' }],
      [{ ...card, saveKind: 'oauth', fields: [{ name: 'username', label: 'User' }] }],
      [{ ...card, fields: [{ name: 'accountId', label: 'Account' }] }],
      Array(33).fill(card), {}, null,
    ];
    for (const declarations of invalid) expect(parsePluginCredentialCards({ raw: raw(declarations) }).ok, JSON.stringify(declarations)).toBe(false);
    for (const malformed of ['{', 'null', '[]']) expect(parsePluginCredentialCards({ raw: malformed }).ok).toBe(false);
  });

  it('supports domain-owned and dynamic-origin cards without accepting undeclared form authority', () => {
    const dynamic = parsePluginCredentialCards({ raw: raw([{ ...card, baseUrl: undefined, fields: [{ name: 'baseUrl', label: 'Server', required: true }] }]) });
    expect(dynamic.ok && dynamic.descriptors[0]?.baseUrl).toBe('');
    const provider = parsePluginCredentialCards({ raw: raw([{ ...card, baseUrl: undefined, saveKind: 'provider-settings', saveTarget: 'provider', permissions: 'Connect' }]) });
    expect(provider.ok && provider.descriptors[0]?.saveTarget).toBe('provider');
    expect(parsePluginCredentialCards({ raw: raw([{ ...card, saveKind: 'provider-settings', saveTarget: 'provider' }]) }).ok).toBe(false);
    for (const saveKind of ['publish-host', 'source-control', 'agent-plugin-token', 'oauth']) {
      const parsed = parsePluginCredentialCards({ raw: raw([{ ...card, saveKind }]) });
      expect(parsed.ok && parsed.descriptors[0]?.saveKind).toBe(saveKind);
    }
  });

  it('bounds purpose text and trims without silently truncating', () => {
    expect(parseCredentialCardUsedFor({ value: undefined })).toBeUndefined();
    expect(parseCredentialCardUsedFor({ value: [' purpose '] })).toEqual(['purpose']);
    for (const value of [null, 'purpose', [7], [''], ['x'.repeat(121)], Array(9).fill('purpose')]) {
      expect(() => parseCredentialCardUsedFor({ value })).toThrow(/usedFor/);
    }
  });
});
