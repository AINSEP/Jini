import { describe, expect, it } from 'vitest';
import { defaultMailProviderSetup, parseMailProviderSetupProperty } from '../index.js';

describe('mail provider setup', () => {
  it('derives plain fields from credential keys, always asking for baseUrl', () => {
    expect(defaultMailProviderSetup({ credentialKeys: ['token', 'region'] }).fields.map(field => [field.key, field.type])).toEqual([['token', 'secret'], ['region', 'text'], ['baseUrl', 'url']]);
  });

  it('keeps declared fields first and fills the rest with defaults', () => {
    const setup = { helpUrl: 'https://help.example', fields: [{ key: 'baseUrl', label: 'Endpoint', type: 'url', defaultValue: 'https://api.example' }] };
    expect(parseMailProviderSetupProperty({ value: setup, at: 'adapters[0]', credentialKeys: ['token'] })).toEqual({ setup: {
      helpUrl: 'https://help.example',
      fields: [{ key: 'baseUrl', label: 'Endpoint', type: 'url', required: true, defaultValue: 'https://api.example' }, { key: 'token', label: 'API key', type: 'secret', required: true }],
    } });
    expect(parseMailProviderSetupProperty({ value: undefined, at: 'a', credentialKeys: ['token'] })).toEqual({});
  });

  it('refuses a plain-text token, a secret default and an undeclared key', () => {
    expect(parseMailProviderSetupProperty({ value: { fields: [{ key: 'token', label: 'Key', type: 'text' }] }, at: 'a', credentialKeys: ['token'] })).toBe('a.setup.fields[0]: the token field must be type secret');
    expect(parseMailProviderSetupProperty({ value: { fields: [{ key: 'token', label: 'Key', type: 'secret', defaultValue: 'x' }] }, at: 'a', credentialKeys: ['token'] })).toBe('a.setup.fields[0].defaultValue is not allowed on a secret field');
    expect(parseMailProviderSetupProperty({ value: { fields: [{ key: 'other', label: 'Other' }] }, at: 'a', credentialKeys: ['token'] })).toBe("a.setup.fields[0].key must be one of the provider's credential keys or baseUrl");
  });
});
