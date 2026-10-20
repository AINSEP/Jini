/**
 * @file Unit tests for `parseApiConnectionDescriptor`: a plugin's untrusted connection
 * declaration becomes a frozen, bounded descriptor, and every malformed part is refused with
 * `descriptor-invalid` naming that part. Malformed inputs are plain `unknown` values on purpose.
 */
import { describe, expect, it } from 'vitest';
import { ApiConnectionError, parseApiConnectionDescriptor } from '../index.js';

const VALID = {
  pluginId: 'acme-office', connectionId: 'account', label: 'Acme account',
  authorizationEndpoint: 'https://auth.acme.test/authorize', tokenEndpoint: 'https://auth.acme.test/token',
};

function refusal(value: unknown): string {
  try {
    parseApiConnectionDescriptor({ value });
  } catch (error) {
    if (error instanceof ApiConnectionError && error.code === 'descriptor-invalid') return error.message;
    throw error;
  }
  throw new Error('expected descriptor-invalid');
}

describe('accepted declarations', () => {
  it('fills empty parameters and field lists when the plugin declares none', () => {
    expect(parseApiConnectionDescriptor({ value: VALID })).toEqual({
      ...VALID, authorizationParams: { public: {}, confidential: {} }, startParams: [], callbackFields: [],
    });
  });

  it('freezes the descriptor and every nested part', () => {
    const descriptor = parseApiConnectionDescriptor({ value: { ...VALID, authorizationParams: { public: { prompt: 'consent' } },
      startParams: [{ name: 'mode', maxLength: 4 }] } });
    expect([descriptor, descriptor.authorizationParams, descriptor.authorizationParams.public, descriptor.startParams,
      descriptor.startParams[0]].every(part => Object.isFrozen(part))).toBe(true);
  });

  it('keeps only the declared field properties', () => {
    const descriptor = parseApiConnectionDescriptor({ value: { ...VALID, callbackFields: [{ name: 'picked', maxLength: 64, note: 'x' }] } });
    expect(descriptor.callbackFields).toEqual([{ name: 'picked', maxLength: 64 }]);
  });
});

describe('refused declarations', () => {
  it('refuses a value that is not an object', () => {
    expect(refusal([VALID])).toContain('expected an object');
  });

  it('refuses authorizationParams that is not an object', () => {
    expect(refusal({ ...VALID, authorizationParams: 'consent' })).toContain('(authorizationParams)');
  });

  it('refuses a plugin id that is not a short id', () => {
    expect(refusal({ ...VALID, pluginId: '../acme' })).toContain('pluginId must be a short id');
  });

  it('refuses a connection id longer than 64 characters', () => {
    expect(refusal({ ...VALID, connectionId: 'a'.repeat(65) })).toContain('connectionId must be a short id');
  });

  it('refuses a blank label', () => {
    expect(refusal({ ...VALID, label: '   ' })).toContain('(label)');
  });

  it('refuses a label longer than 120 characters', () => {
    expect(refusal({ ...VALID, label: 'a'.repeat(121) })).toContain('(label)');
  });

  it('refuses an endpoint that does not parse as a URL', () => {
    expect(refusal({ ...VALID, tokenEndpoint: 'not a url' })).toContain('tokenEndpoint must be a URL');
  });

  it('refuses an endpoint longer than 2048 characters', () => {
    expect(refusal({ ...VALID, authorizationEndpoint: `https://auth.acme.test/${'a'.repeat(2048)}` }))
      .toContain('authorizationEndpoint must be a URL');
  });

  it('refuses more than 16 fixed parameters for one client kind', () => {
    const params = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`p${index}`, 'v']));
    expect(refusal({ ...VALID, authorizationParams: { public: params } })).toContain('(authorizationParams.public)');
  });

  it('refuses a fixed parameter value that is not a string', () => {
    expect(refusal({ ...VALID, authorizationParams: { confidential: { access_type: 1 } } })).toContain('authorizationParams.confidential value');
  });

  it('refuses a fixed parameter value longer than 512 characters', () => {
    expect(refusal({ ...VALID, authorizationParams: { public: { hint: 'a'.repeat(513) } } })).toContain('authorizationParams.public value');
  });

  it('refuses a fixed parameter name with characters outside the allowed set', () => {
    expect(refusal({ ...VALID, authorizationParams: { public: { 'bad name': 'v' } } })).toContain('uses an invalid or reserved name');
  });

  it('refuses a field list that is not an array', () => {
    expect(refusal({ ...VALID, startParams: { name: 'mode', maxLength: 4 } })).toContain('(startParams)');
  });

  it('refuses more than 8 start parameters', () => {
    const fields = Array.from({ length: 9 }, (_, index) => ({ name: `mode${index}`, maxLength: 4 }));
    expect(refusal({ ...VALID, startParams: fields })).toContain('(startParams)');
  });

  it('refuses a field entry that is not an object', () => {
    expect(refusal({ ...VALID, callbackFields: ['picked'] })).toContain('(callbackFields)');
  });

  it('refuses a field maxLength below 1', () => {
    expect(refusal({ ...VALID, startParams: [{ name: 'mode', maxLength: 0 }] })).toContain('startParams maxLength');
  });

  it('refuses a field maxLength that is not an integer', () => {
    expect(refusal({ ...VALID, startParams: [{ name: 'mode', maxLength: 2.5 }] })).toContain('startParams maxLength');
  });

  it('refuses a start parameter maxLength over 8192', () => {
    expect(refusal({ ...VALID, startParams: [{ name: 'mode', maxLength: 8193 }] })).toContain('startParams maxLength');
  });

  it('refuses a field list that repeats a name', () => {
    expect(refusal({ ...VALID, callbackFields: [{ name: 'picked', maxLength: 4 }, { name: 'picked', maxLength: 8 }] }))
      .toContain('callbackFields repeats a name');
  });

  it('tells the plugin author what to do next', () => {
    expect(refusal({ ...VALID, label: '' })).toContain('Fix the plugin manifest and reload it.');
  });
});
