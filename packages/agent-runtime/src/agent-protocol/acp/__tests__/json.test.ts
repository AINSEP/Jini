import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACP_TIMEOUT_ENV_VAR,
  errorMessage,
  resolveAcpTimeoutMs,
  asObject,
  acpValueKind,
  objectKeys,
  extractAcpTextValue,
  extractAcpUpdateText,
} from '../json.js';
import { MAX_TIMEOUT_MS } from '../constants.js';

describe('errorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(errorMessage({ err: new Error('boom') })).toBe('boom');
  });

  it('stringifies non-Error values', () => {
    expect(errorMessage({ err: 'plain string' })).toBe('plain string');
    expect(errorMessage({ err: 42 })).toBe('42');
    expect(errorMessage({ err: null })).toBe('null');
  });
});

describe('resolveAcpTimeoutMs', () => {
  it('C35: uses the fallback timeout when the environment value is blank', () => {
    const timeouts = ['', '   '].map((value) =>
      resolveAcpTimeoutMs({ env: { [DEFAULT_ACP_TIMEOUT_ENV_VAR]: value }, fallbackMs: 5000 }));
    expect(timeouts).toEqual([5000, 5000]);
  });

  it('reads the default env var name when no override is given', () => {
    expect(resolveAcpTimeoutMs({ env: { [DEFAULT_ACP_TIMEOUT_ENV_VAR]: '5000' }, fallbackMs: 1000 })).toBe(5000);
  });

  it('falls back to fallbackMs when the env var is absent', () => {
    expect(resolveAcpTimeoutMs({ env: {}, fallbackMs: 1234 })).toBe(1234);
  });

  it('falls back to fallbackMs when the env var is non-numeric', () => {
    expect(resolveAcpTimeoutMs({ env: { [DEFAULT_ACP_TIMEOUT_ENV_VAR]: 'not-a-number' }, fallbackMs: 999 })).toBe(999);
  });

  it('clamps a negative value to 0', () => {
    expect(resolveAcpTimeoutMs({ env: { [DEFAULT_ACP_TIMEOUT_ENV_VAR]: '-50' }, fallbackMs: 1000 })).toBe(0);
  });

  it('clamps a value above MAX_TIMEOUT_MS down to the ceiling', () => {
    expect(resolveAcpTimeoutMs({ env: { [DEFAULT_ACP_TIMEOUT_ENV_VAR]: String(MAX_TIMEOUT_MS * 2) }, fallbackMs: 1000 })).toBe(
      MAX_TIMEOUT_MS,
    );
  });

  it('floors a fractional value', () => {
    expect(resolveAcpTimeoutMs({ env: { [DEFAULT_ACP_TIMEOUT_ENV_VAR]: '1500.9' }, fallbackMs: 1000 })).toBe(1500);
  });

  it('reads a caller-supplied env var name instead of the default', () => {
    expect(
      resolveAcpTimeoutMs({ env: { CUSTOM_ACP_TIMEOUT_MS: '7000', [DEFAULT_ACP_TIMEOUT_ENV_VAR]: '1' }, fallbackMs: 1000 }, { envVarName: 'CUSTOM_ACP_TIMEOUT_MS' }),
    ).toBe(7000);
  });
});

describe('asObject', () => {
  it('returns the value cast when it is a plain object', () => {
    const obj = { a: 1 };
    expect(asObject({ value: obj })).toBe(obj);
  });

  it('C37: rejects arrays instead of treating them as object records', () => {
    expect(asObject({ value: [1, 2] })).toBeNull();
  });

  it('returns null for null, undefined, and primitives', () => {
    expect(asObject({ value: null })).toBeNull();
    expect(asObject({ value: undefined })).toBeNull();
    expect(asObject({ value: 'str' })).toBeNull();
    expect(asObject({ value: 42 })).toBeNull();
    expect(asObject({ value: true })).toBeNull();
  });
});

describe('acpValueKind', () => {
  it('identifies arrays', () => {
    expect(acpValueKind({ value: [1, 2] })).toBe('array');
  });
  it('identifies null', () => {
    expect(acpValueKind({ value: null })).toBe('null');
  });
  it('falls back to typeof for everything else', () => {
    expect(acpValueKind({ value: 'x' })).toBe('string');
    expect(acpValueKind({ value: 1 })).toBe('number');
    expect(acpValueKind({ value: undefined })).toBe('undefined');
    expect(acpValueKind({ value: {} })).toBe('object');
    expect(acpValueKind({ value: true })).toBe('boolean');
  });
});

describe('objectKeys', () => {
  it('returns sorted own keys for an object', () => {
    expect(objectKeys({ value: { b: 1, a: 2 } })).toEqual(['a', 'b']);
  });

  it('returns an empty array for non-objects', () => {
    expect(objectKeys({ value: null })).toEqual([]);
    expect(objectKeys({ value: 'x' })).toEqual([]);
    expect(objectKeys({ value: undefined })).toEqual([]);
  });
});

describe('extractAcpTextValue', () => {
  it('returns a non-empty string directly', () => {
    expect(extractAcpTextValue({ value: 'hello' })).toBe('hello');
  });

  it('returns null for an empty string', () => {
    expect(extractAcpTextValue({ value: '' })).toBeNull();
  });

  it('joins string items from a flat array', () => {
    expect(extractAcpTextValue({ value: ['a', 'b', 'c'] })).toBe('abc');
  });

  it('returns null for an array with no string content', () => {
    expect(extractAcpTextValue({ value: [1, 2, {}] })).toBeNull();
  });

  it('recurses into nested arrays of objects with text-bearing keys', () => {
    expect(extractAcpTextValue({ value: [{ text: 'hi' }, { delta: 'there' }] })).toBe('hithere');
  });

  it('checks each known key in priority order on an object', () => {
    // extractAcpTextValue's own key order is text, delta, content, ... (note:
    // this differs from extractAcpUpdateText's content-first order below).
    expect(extractAcpTextValue({ value: { delta: 'd', content: 'c' } })).toBe('d');
    expect(extractAcpTextValue({ value: { delta: 'd' } })).toBe('d');
    expect(extractAcpTextValue({ value: { output: 'o' } })).toBe('o');
    expect(extractAcpTextValue({ value: { answer: 'a' } })).toBe('a');
    expect(extractAcpTextValue({ value: { value: 'v' } })).toBe('v');
    expect(extractAcpTextValue({ value: { body: 'b' } })).toBe('b');
    expect(extractAcpTextValue({ value: { parts: ['p1', 'p2'] } })).toBe('p1p2');
    expect(extractAcpTextValue({ value: { choices: ['x'] } })).toBe('x');
  });

  it('returns null for a non-object, non-array, non-string value', () => {
    expect(extractAcpTextValue({ value: 42 })).toBeNull();
    expect(extractAcpTextValue({ value: null })).toBeNull();
    expect(extractAcpTextValue({ value: true })).toBeNull();
  });

  it('returns null for an object with none of the known keys', () => {
    expect(extractAcpTextValue({ value: { unrelated: 'x' } })).toBeNull();
  });

  it('stops recursing past depth 4', () => {
    const deeplyNested = { text: { text: { text: { text: { text: 'too deep' } } } } };
    expect(extractAcpTextValue({ value: deeplyNested })).toBeNull();
  });
});

describe('extractAcpUpdateText', () => {
  it('checks the update-level keys in priority order', () => {
    expect(extractAcpUpdateText({ update: { content: 'c', text: 't' } })).toBe('c');
    expect(extractAcpUpdateText({ update: { text: 't' } })).toBe('t');
  });

  it('returns null when no known key has text', () => {
    expect(extractAcpUpdateText({ update: { unrelated: 'x' } })).toBeNull();
  });
});
