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

it.each([
  { value: null, reason: 'plugin.setup must be an object' },
  { value: { fields: 'token' }, reason: 'plugin.setup.fields must be an array' },
  { value: { helpUrl: 'not a URL' }, reason: 'plugin.setup.helpUrl must be an https URL' },
  { value: { helpUrl: 123 }, reason: 'plugin.setup.helpUrl must be an https URL' },
  { value: { helpUrl: 'http://docs.example.test' }, reason: 'plugin.setup.helpUrl must be an https URL' },
  { value: { fields: [{ key: 'baseUrl', label: 'Endpoint', helpUrl: 'https://' }] }, reason: 'plugin.setup.fields[0].helpUrl must be an https URL' },
  { value: { fields: [{ key: 'baseUrl', label: 'Endpoint' }, { key: 'baseUrl', label: 'Other' }] }, reason: "plugin.setup.fields[1].key 'baseUrl' is declared twice" },
  { value: { fields: [{ key: 'baseUrl', label: 'Endpoint', help: ' ' }] }, reason: 'plugin.setup.fields[0].help must be a non-empty string' },
])('reports a field-specific diagnostic for invalid setup %j', ({ value, reason }) => {
  expect(parseMailProviderSetupProperty({ value, at: 'plugin', credentialKeys: ['token'] })).toBe(reason);
});

it('keeps an optional credential field and its trimmed operator guidance', () => {
  expect(parseMailProviderSetupProperty({ value: { fields: [{ key: 'region', label: ' Region ', required: false,
    help: ' Select the sending region ', helpUrl: 'https://docs.example.test/mail', placeholder: ' eu-west-1 ' }] },
    at: 'plugin', credentialKeys: ['region'] })).toEqual({ setup: { fields: [
    { key: 'region', label: 'Region', type: 'text', required: false, help: 'Select the sending region',
      helpUrl: 'https://docs.example.test/mail', placeholder: 'eu-west-1' },
    { key: 'baseUrl', label: 'API base URL', type: 'url', required: true },
  ] } });
});

it.each([
  { field: null, suffix: ' must be an object' },
  { field: { key: 2, label: 'Endpoint' }, suffix: ".key must be one of the provider's credential keys or baseUrl" },
  { field: { key: 'baseUrl', label: ' ' }, suffix: '.label must be a non-empty string' },
  { field: { key: 'baseUrl', label: 'Endpoint', type: 'number' }, suffix: '.type must be one of secret, text, url, email' },
])('refuses a malformed field head %j', ({ field, suffix }) => {
  expect(parseMailProviderSetupProperty({ value: { fields: [field] }, at: 'plugin', credentialKeys: ['token'] }))
    .toBe('plugin.setup.fields[0]' + suffix);
});
