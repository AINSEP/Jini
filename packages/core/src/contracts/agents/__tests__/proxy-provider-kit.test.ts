import { describe, expect, it } from 'vitest';
import {
  extendParsed,
  firstOptionalFieldError,
  parseCommon,
  parseToolsProxyRequest,
  SYSTEM_CHECK,
  toolsOption,
  isArray,
  isNumber,
  isRecord,
  isString,
  nonEmptyString,
  pickDefined,
  requiredFieldError,
  type OptionalFieldCheck,
} from '../proxy-provider-kit.js';

describe('model-proxy-fields — primitive tests', () => {
  it('isRecord accepts plain objects only', () => {
    expect([{}, { a: 1 }].map(isRecord)).toEqual([true, true]);
    expect([null, [], 'x', 1, undefined].map(isRecord)).toEqual([false, false, false, false, false]);
  });

  it('nonEmptyString returns the original (untrimmed) string, or null for blank/non-strings', () => {
    expect(nonEmptyString(' k ')).toBe(' k ');
    expect([' ', '', 5, null].map(nonEmptyString)).toEqual([null, null, null, null]);
  });

  it('isString/isNumber/isArray are plain typeof/Array.isArray tests (NaN counts as a number)', () => {
    expect([isString('s'), isString(1)]).toEqual([true, false]);
    expect([isNumber(Number.NaN), isNumber('1')]).toEqual([true, false]);
    expect([isArray([]), isArray({})]).toEqual([true, false]);
  });
});

describe('model-proxy-fields — firstOptionalFieldError', () => {
  const checks: OptionalFieldCheck[] = [
    ['a', isString, 'a must be a string when provided'],
    ['b', isNumber, 'b must be a number when provided'],
  ];

  it('returns undefined when every present field is well-typed and absent ones are skipped', () => {
    expect(firstOptionalFieldError({ record: { a: 'x' }, checks })).toBeUndefined();
  });

  it('treats an explicitly-undefined field as absent', () => {
    expect(firstOptionalFieldError({ record: { a: undefined, b: undefined }, checks })).toBeUndefined();
  });

  it('treats null as present, so it fails the type test', () => {
    expect(firstOptionalFieldError({ record: { b: null }, checks })).toEqual({ code: 'BAD_REQUEST', message: 'b must be a number when provided' });
  });

  it('reports only the first failing field in check order', () => {
    expect(firstOptionalFieldError({ record: { b: 'no', a: 1 }, checks })).toEqual({ code: 'BAD_REQUEST', message: 'a must be a string when provided' });
  });
});

describe('model-proxy-fields — requiredFieldError', () => {
  it('carries a single validation issue naming the field', () => {
    expect(requiredFieldError({ path: 'apiKey', message: 'apiKey must be a non-empty string', issue: 'required non-empty string' })).toEqual({
      code: 'BAD_REQUEST',
      message: 'apiKey must be a non-empty string',
      details: { kind: 'validation', issues: [{ path: 'apiKey', message: 'required non-empty string' }] },
    });
  });
});

describe('model-proxy-fields — pickDefined', () => {
  it('omits keys whose value is undefined, including explicitly-undefined ones', () => {
    const picked = pickDefined({ source: { a: 1, b: undefined as number | undefined }, keys: ['a', 'b'] });
    expect(picked).toEqual({ a: 1 });
    expect(Object.keys(picked)).toEqual(['a']);
  });

  it('keeps falsy-but-defined values (0, empty string, null, false)', () => {
    expect(pickDefined({ source: { z: 0, e: '', n: null, f: false }, keys: ['z', 'e', 'n', 'f'] })).toEqual({ z: 0, e: '', n: null, f: false });
  });

  it('copies only the listed keys, in list order', () => {
    const picked = pickDefined({ source: { a: 1, b: 2, c: 3 }, keys: ['c', 'a'] });
    expect(Object.keys(picked)).toEqual(['c', 'a']);
  });
});

describe('provider request boundary', () => {
  const common = { apiKey: 'local-test-key', model: 'custom-model', messages: [{ speaker: 'user', text: 'hello' }] };

  it.each([null, [], 'not an object'])('rejects a non-object JSON body (%j)', body => {
    expect(parseCommon(body)).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it.each([
    { path: 'apiKey', value: '  ', type: 'string' },
    { path: 'model', value: null, type: 'string' },
    { path: 'messages', value: [], type: 'array' },
    { path: 'messages', value: {}, type: 'array' },
  ])('names the required field when $path has value $value', ({ path, value, type }) => {
    expect(parseToolsProxyRequest({ ...common, [path]: value })).toEqual({
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: `${path} must be a non-empty ${type}`,
        details: { kind: 'validation', issues: [{ path, message: `required non-empty ${type}` }] },
      },
    });
  });

  it.each([
    ['baseUrl', 123, 'a string'],
    ['temperature', '0.4', 'a number'],
    ['maxTokens', null, 'a number'],
    ['maxToolTurns', false, 'a number'],
    ['extraHeaders', [], 'an object'],
    ['tools', {}, 'an array'],
  ])('rejects a malformed optional %s without coercion', (field, value, type) => {
    expect(parseToolsProxyRequest({ ...common, [String(field)]: value })).toEqual({
      ok: false, error: { code: 'BAD_REQUEST', message: `${field} must be ${type} when provided` },
    });
  });

  it('preserves supported options and drops fields unknown to the provider parser', () => {
    const options = { baseUrl: 'https://example.test/v2', temperature: 0, maxTokens: 300, maxToolTurns: 4,
      extraHeaders: { 'x-client': 'demo' }, tools: [{ providerSpecific: true }] };
    expect(parseToolsProxyRequest({ ...common, ...options, ignored: 'do not forward' })).toStrictEqual({
      ok: true, value: { ...common, ...options },
    });
    expect(parseToolsProxyRequest({ ...common, tools: undefined })).toStrictEqual({ ok: true, value: common });
  });

  it('merges required provider fields, forwarding only recognized optional fields', () => {
    expect(extendParsed({ base: common, record: { system: 'special instructions', tools: [], debug: true }, checks: [SYSTEM_CHECK] },
      { required: { maxTokens: 900 } })).toStrictEqual({
      ok: true, value: { ...common, maxTokens: 900, system: 'special instructions' },
    });
  });

  it('distinguishes omitted tools from an explicit empty list', () => {
    expect(toolsOption(undefined)).toStrictEqual({});
    expect(toolsOption([])).toStrictEqual({ tools: [] });
  });
});
