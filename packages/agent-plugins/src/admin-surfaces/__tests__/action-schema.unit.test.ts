/**
 * @file Unit tests for the admin-surface action schema subset: every refusal at declaration time
 * (unknown keywords, open objects, bad bounds, depth) and every violation at payload time, whose
 * message names the path and never the offending value. Also the shared 64 KiB payload cap.
 */
import { describe, expect, test } from 'vitest';
import {
  checkAdminSurfaceActionSchema, exceedsAdminSurfacePayloadLimit, validateAdminSurfaceActionValue, type AdminSurfaceActionSchema,
} from '../action-schema.js';

const check = (schema: unknown) => checkAdminSurfaceActionSchema({ schema });
const validate = (schema: AdminSurfaceActionSchema, value: unknown) => validateAdminSurfaceActionValue({ schema, value });

describe('checkAdminSurfaceActionSchema', () => {
  test.each([
    ['an array', []],
    ['null', null],
    ['a class instance', new (class Schema { type = 'string'; })()],
  ])('refuses %s as a schema node', (_label, schema) => {
    expect(check(schema)).toBe('must be an object');
  });

  test('accepts a null-prototype node', () => {
    expect(check(Object.assign(Object.create(null), { type: 'boolean' }))).toBeNull();
  });

  test.each([[{}], [{ type: 'date' }], [{ type: 'toString' }], [{ type: 7 }]])('refuses %j without a supported type', (schema) => {
    expect(check(schema)).toBe('must declare a supported type');
  });

  test('accepts annotations on any type', () => {
    expect(check({ type: 'null', title: 'Nothing', description: 'Always null.' })).toBeNull();
  });

  test('refuses a keyword that belongs to another type', () => {
    expect(check({ type: 'string', minimum: 1 })).toBe("uses unsupported keyword 'minimum'");
  });

  test('accepts nesting exactly eight levels below the root', () => {
    let schema: Record<string, unknown> = { type: 'boolean' };
    for (let level = 0; level < 8; level += 1) schema = { type: 'array', items: schema };
    expect(check(schema)).toBeNull();
  });

  test('refuses nesting nine levels below the root, naming the path', () => {
    let schema: Record<string, unknown> = { type: 'boolean' };
    for (let level = 0; level < 9; level += 1) schema = { type: 'array', items: schema };
    expect(check(schema)).toBe(`${'items '.repeat(9)}nests deeper than 8 levels`);
  });

  describe('object', () => {
    test('accepts closed properties with required keys', () => {
      expect(check({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false })).toBeNull();
    });

    test('refuses properties that are not an object', () => {
      expect(check({ type: 'object', properties: [] })).toBe('properties must be an object');
    });

    test('refuses additionalProperties: true', () => {
      expect(check({ type: 'object', additionalProperties: true })).toBe('additionalProperties may only be false (objects are closed)');
    });

    test('refuses required that is not a list', () => {
      expect(check({ type: 'object', properties: { a: { type: 'string' } }, required: 'a' })).toBe('required must list declared properties');
    });

    test('refuses required naming an undeclared property', () => {
      expect(check({ type: 'object', properties: { a: { type: 'string' } }, required: ['b'] })).toBe('required must list declared properties');
    });

    test('refuses a non-string required entry', () => {
      expect(check({ type: 'object', properties: { a: { type: 'string' } }, required: [1] })).toBe('required must list declared properties');
    });

    test('names the property whose schema is invalid', () => {
      expect(check({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'set' } } })).toBe("property 'b' must declare a supported type");
    });
  });

  describe('array', () => {
    test.each([[-1], [1.5], ['10']])('refuses maxItems %j', (maxItems) => {
      expect(check({ type: 'array', items: { type: 'string' }, maxItems })).toBe('maxItems must be a non-negative integer');
    });

    test('refuses a missing items schema', () => {
      expect(check({ type: 'array' })).toBe('items must be an object');
    });

    test('accepts maxItems 0', () => {
      expect(check({ type: 'array', items: { type: 'string' }, maxItems: 0 })).toBeNull();
    });
  });

  describe('string', () => {
    test('refuses a negative minLength', () => {
      expect(check({ type: 'string', minLength: -1 })).toBe('minLength/maxLength must be non-negative integers');
    });

    test('refuses a fractional maxLength', () => {
      expect(check({ type: 'string', maxLength: 2.5 })).toBe('minLength/maxLength must be non-negative integers');
    });

    test.each([[[]], [['a', 2]], ['a']])('refuses enum %j', (values) => {
      expect(check({ type: 'string', enum: values })).toBe('enum must be a non-empty list of strings');
    });

    test('accepts a string enum', () => {
      expect(check({ type: 'string', enum: ['a', 'b'] })).toBeNull();
    });
  });

  describe('number and integer', () => {
    test.each(['number', 'integer'])('accepts finite bounds on %s', (type) => {
      expect(check({ type, minimum: -1, maximum: 1 })).toBeNull();
    });

    test('refuses an infinite maximum', () => {
      expect(check({ type: 'number', maximum: Infinity })).toBe('minimum/maximum must be finite numbers');
    });

    test('refuses a non-number minimum', () => {
      expect(check({ type: 'integer', minimum: '0' })).toBe('minimum/maximum must be finite numbers');
    });
  });
});

describe('validateAdminSurfaceActionValue', () => {
  const SECRET = 'value-that-must-not-echo';

  describe('object', () => {
    const schema: AdminSurfaceActionSchema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } }, required: ['a'] };

    test('accepts a conforming object', () => {
      expect(validate(schema, { a: 'x', b: 2 })).toBeNull();
    });

    test('accepts an object schema without properties for an empty object', () => {
      expect(validate({ type: 'object' }, {})).toBeNull();
    });

    test('refuses a non-object', () => {
      expect(validate(schema, [SECRET])).toBe('$ must be an object');
    });

    test('refuses an undeclared key, quoting at most 64 characters of the key', () => {
      expect(validate(schema, { a: 'x', [`k${'y'.repeat(100)}`]: SECRET })).toBe(`$ has an undeclared property ${JSON.stringify(`k${'y'.repeat(63)}`)}`);
    });

    test('refuses a missing required key', () => {
      expect(validate(schema, { b: 1 })).toBe('$.a is required');
    });

    test('names the nested path of a bad value without the value', () => {
      expect(validate(schema, { a: 'x', b: SECRET })).toBe('$.b must be an integer');
    });
  });

  describe('array', () => {
    test('refuses a non-array', () => {
      expect(validate({ type: 'array', items: { type: 'string' } }, 'x')).toBe('$ must be an array');
    });

    test('applies the declared maxItems', () => {
      expect(validate({ type: 'array', items: { type: 'string' }, maxItems: 1 }, ['a', 'b'])).toBe('$ has too many items');
    });

    test('applies a default cap of 1000 items when none is declared', () => {
      const schema: AdminSurfaceActionSchema = { type: 'array', items: { type: 'null' } };
      expect([validate(schema, Array(1000).fill(null)), validate(schema, Array(1001).fill(null))]).toEqual([null, '$ has too many items']);
    });

    test('names the index of a bad item', () => {
      expect(validate({ type: 'array', items: { type: 'string' } }, ['a', 'b', 3])).toBe('$[2] must be a string');
    });
  });

  describe('string', () => {
    test('refuses a non-string', () => {
      expect(validate({ type: 'string' }, 1)).toBe('$ must be a string');
    });

    test('refuses a string shorter than minLength', () => {
      expect(validate({ type: 'string', minLength: 2 }, 'a')).toBe('$ has the wrong length');
    });

    test('refuses a string longer than maxLength', () => {
      expect(validate({ type: 'string', maxLength: 2 }, 'abc')).toBe('$ has the wrong length');
    });

    test('accepts lengths at both bounds', () => {
      expect([validate({ type: 'string', minLength: 2, maxLength: 3 }, 'ab'), validate({ type: 'string', minLength: 2, maxLength: 3 }, 'abc')]).toEqual([null, null]);
    });

    test('refuses a value outside the enum', () => {
      expect(validate({ type: 'string', enum: ['a'] }, SECRET)).toBe('$ is not one of the allowed values');
    });

    test('accepts a value in the enum', () => {
      expect(validate({ type: 'string', enum: ['a'] }, 'a')).toBeNull();
    });
  });

  describe('number and integer', () => {
    test('refuses a fraction for an integer', () => {
      expect(validate({ type: 'integer' }, 1.5)).toBe('$ must be an integer');
    });

    test('accepts a fraction for a number', () => {
      expect(validate({ type: 'number' }, 1.5)).toBeNull();
    });

    test('refuses NaN for a number', () => {
      expect(validate({ type: 'number' }, Number.NaN)).toBe('$ must be a number');
    });

    test('refuses a numeric string', () => {
      expect(validate({ type: 'number' }, '1')).toBe('$ must be a number');
    });

    test('refuses a value below minimum', () => {
      expect(validate({ type: 'integer', minimum: 1 }, 0)).toBe('$ is out of range');
    });

    test('refuses a value above maximum', () => {
      expect(validate({ type: 'number', maximum: 1 }, 1.01)).toBe('$ is out of range');
    });

    test('accepts values at both bounds', () => {
      expect([validate({ type: 'integer', minimum: 1, maximum: 2 }, 1), validate({ type: 'integer', minimum: 1, maximum: 2 }, 2)]).toEqual([null, null]);
    });
  });

  test('boolean refuses a non-boolean and accepts false', () => {
    expect([validate({ type: 'boolean' }, 'true'), validate({ type: 'boolean' }, false)]).toEqual(['$ must be a boolean', null]);
  });

  test('null refuses undefined and accepts null', () => {
    expect([validate({ type: 'null' }, undefined), validate({ type: 'null' }, null)]).toEqual(['$ must be null', null]);
  });

  test('a caller-supplied path prefixes the message', () => {
    expect(validateAdminSurfaceActionValue({ schema: { type: 'null' }, value: 1 }, { path: '$.result' })).toBe('$.result must be null');
  });
});

describe('exceedsAdminSurfacePayloadLimit', () => {
  test('a payload of exactly 64 KiB of JSON text is within the limit', () => {
    expect(exceedsAdminSurfacePayloadLimit({ payload: 'x'.repeat(64 * 1024 - 2) })).toBe(false);
  });

  test('one character more exceeds it', () => {
    expect(exceedsAdminSurfacePayloadLimit({ payload: 'x'.repeat(64 * 1024 - 1) })).toBe(true);
  });

  test('a payload with no JSON form exceeds it', () => {
    expect(exceedsAdminSurfacePayloadLimit({ payload: undefined })).toBe(true);
  });

  test('an unserializable payload exceeds it', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(exceedsAdminSurfacePayloadLimit({ payload: circular })).toBe(true);
  });
});
