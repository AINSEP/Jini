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
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error values', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });
});

describe('resolveAcpTimeoutMs', () => {
  it('C35: uses the fallback timeout when the environment value is blank', () => {
    const timeouts = ['', '   '].map((value) =>
      resolveAcpTimeoutMs({ [DEFAULT_ACP_TIMEOUT_ENV_VAR]: value }, 5000));
    expect(timeouts).toEqual([5000, 5000]);
  });

  it('reads the default env var name when no override is given', () => {
    expect(resolveAcpTimeoutMs({ [DEFAULT_ACP_TIMEOUT_ENV_VAR]: '5000' }, 1000)).toBe(5000);
  });

  it('falls back to fallbackMs when the env var is absent', () => {
    expect(resolveAcpTimeoutMs({}, 1234)).toBe(1234);
  });

  it('falls back to fallbackMs when the env var is non-numeric', () => {
    expect(resolveAcpTimeoutMs({ [DEFAULT_ACP_TIMEOUT_ENV_VAR]: 'not-a-number' }, 999)).toBe(999);
  });

  it('clamps a negative value to 0', () => {
    expect(resolveAcpTimeoutMs({ [DEFAULT_ACP_TIMEOUT_ENV_VAR]: '-50' }, 1000)).toBe(0);
  });

  it('clamps a value above MAX_TIMEOUT_MS down to the ceiling', () => {
    expect(resolveAcpTimeoutMs({ [DEFAULT_ACP_TIMEOUT_ENV_VAR]: String(MAX_TIMEOUT_MS * 2) }, 1000)).toBe(
      MAX_TIMEOUT_MS,
    );
  });

  it('floors a fractional value', () => {
    expect(resolveAcpTimeoutMs({ [DEFAULT_ACP_TIMEOUT_ENV_VAR]: '1500.9' }, 1000)).toBe(1500);
  });

  it('reads a caller-supplied env var name instead of the default', () => {
    expect(
      resolveAcpTimeoutMs({ CUSTOM_ACP_TIMEOUT_MS: '7000', [DEFAULT_ACP_TIMEOUT_ENV_VAR]: '1' }, 1000, 'CUSTOM_ACP_TIMEOUT_MS'),
    ).toBe(7000);
  });
});

describe('asObject', () => {
  it('returns the value cast when it is a plain object', () => {
    const obj = { a: 1 };
    expect(asObject(obj)).toBe(obj);
  });

  it('C37: rejects arrays instead of treating them as object records', () => {
    expect(asObject([1, 2])).toBeNull();
  });

  it('returns null for null, undefined, and primitives', () => {
    expect(asObject(null)).toBeNull();
    expect(asObject(undefined)).toBeNull();
    expect(asObject('str')).toBeNull();
    expect(asObject(42)).toBeNull();
    expect(asObject(true)).toBeNull();
  });
});

describe('acpValueKind', () => {
  it('identifies arrays', () => {
    expect(acpValueKind([1, 2])).toBe('array');
  });
  it('identifies null', () => {
    expect(acpValueKind(null)).toBe('null');
  });
  it('falls back to typeof for everything else', () => {
    expect(acpValueKind('x')).toBe('string');
    expect(acpValueKind(1)).toBe('number');
    expect(acpValueKind(undefined)).toBe('undefined');
    expect(acpValueKind({})).toBe('object');
    expect(acpValueKind(true)).toBe('boolean');
  });
});

describe('objectKeys', () => {
  it('returns sorted own keys for an object', () => {
    expect(objectKeys({ b: 1, a: 2 })).toEqual(['a', 'b']);
  });

  it('returns an empty array for non-objects', () => {
    expect(objectKeys(null)).toEqual([]);
    expect(objectKeys('x')).toEqual([]);
    expect(objectKeys(undefined)).toEqual([]);
  });
});

describe('extractAcpTextValue', () => {
  it('returns a non-empty string directly', () => {
    expect(extractAcpTextValue('hello')).toBe('hello');
  });

  it('returns null for an empty string', () => {
    expect(extractAcpTextValue('')).toBeNull();
  });

  it('joins string items from a flat array', () => {
    expect(extractAcpTextValue(['a', 'b', 'c'])).toBe('abc');
  });

  it('returns null for an array with no string content', () => {
    expect(extractAcpTextValue([1, 2, {}])).toBeNull();
  });

  it('recurses into nested arrays of objects with text-bearing keys', () => {
    expect(extractAcpTextValue([{ text: 'hi' }, { delta: 'there' }])).toBe('hithere');
  });

  it('checks each known key in priority order on an object', () => {
    // extractAcpTextValue's own key order is text, delta, content, ... (note:
    // this differs from extractAcpUpdateText's content-first order below).
    expect(extractAcpTextValue({ delta: 'd', content: 'c' })).toBe('d');
    expect(extractAcpTextValue({ delta: 'd' })).toBe('d');
    expect(extractAcpTextValue({ output: 'o' })).toBe('o');
    expect(extractAcpTextValue({ answer: 'a' })).toBe('a');
    expect(extractAcpTextValue({ value: 'v' })).toBe('v');
    expect(extractAcpTextValue({ body: 'b' })).toBe('b');
    expect(extractAcpTextValue({ parts: ['p1', 'p2'] })).toBe('p1p2');
    expect(extractAcpTextValue({ choices: ['x'] })).toBe('x');
  });

  it('returns null for a non-object, non-array, non-string value', () => {
    expect(extractAcpTextValue(42)).toBeNull();
    expect(extractAcpTextValue(null)).toBeNull();
    expect(extractAcpTextValue(true)).toBeNull();
  });

  it('returns null for an object with none of the known keys', () => {
    expect(extractAcpTextValue({ unrelated: 'x' })).toBeNull();
  });

  it('stops recursing past depth 4', () => {
    const deeplyNested = { text: { text: { text: { text: { text: 'too deep' } } } } };
    expect(extractAcpTextValue(deeplyNested)).toBeNull();
  });
});

describe('extractAcpUpdateText', () => {
  it('checks the update-level keys in priority order', () => {
    expect(extractAcpUpdateText({ content: 'c', text: 't' })).toBe('c');
    expect(extractAcpUpdateText({ text: 't' })).toBe('t');
  });

  it('returns null when no known key has text', () => {
    expect(extractAcpUpdateText({ unrelated: 'x' })).toBeNull();
  });
});
