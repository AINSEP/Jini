import { describe, expect, it } from 'vitest';

import type { JsonValue } from '@jini-ai/protocol';

import {
  assertConnectorInputMatchesSchema,
  getConnectorSchemaSupportError,
  type ConnectorJsonSchema,
} from '../json-schema.js';

function expectValid(value: JsonValue, schema: ConnectorJsonSchema): void {
  expect(() => assertConnectorInputMatchesSchema(value, schema)).not.toThrow();
}

function expectInvalid(value: JsonValue, schema: ConnectorJsonSchema, message?: string): void {
  expect(() => assertConnectorInputMatchesSchema(value, schema)).toThrow(message);
}

describe('connector JSON Schema enforcement', () => {
  it('enforces scalar types, enums, const values, and numeric constraints', () => {
    expectValid(4, { type: ['number', 'string'], minimum: 1, maximum: 5, multipleOf: 2 });
    expectValid(4, { type: 'integer', exclusiveMinimum: 3, exclusiveMaximum: 5 });
    expectValid('safe', { type: 'string', enum: ['safe', 'safer'], const: 'safe' });
    expectValid(null, { type: 'null' });
    expectValid(true, { type: 'boolean' });

    expectInvalid(Number.NaN, { type: 'number' }, 'one of');
    expectInvalid(1.5, { type: 'integer' }, 'one of');
    expectInvalid(0, { type: 'number', minimum: 1 }, '>= 1');
    expectInvalid(6, { type: 'number', maximum: 5 }, '<= 5');
    expectInvalid(3, { type: 'number', exclusiveMinimum: 3 }, '> 3');
    expectInvalid(5, { type: 'number', exclusiveMaximum: 5 }, '< 5');
    expectInvalid(3, { type: 'number', multipleOf: 2 }, 'multiple of 2');
    expectInvalid('unsafe', { enum: ['safe'] }, 'enum');
    expectInvalid('unsafe', { const: 'safe' }, 'const');
    expectValid({ nested: [1, { ok: true }] }, {
      enum: [{ nested: [1, { ok: true }] }],
    });
    expectInvalid({ nested: [1, { ok: false }] }, {
      enum: [{ nested: [1, { ok: true }] }],
    }, 'enum');
    expectInvalid([1, 2], { const: [1, 2, 3] }, 'const');
    expectInvalid({ a: 1 }, { const: { b: 1 } }, 'const');
    expectInvalid({ a: 1 }, { const: 1 }, 'const');
    expectInvalid(1, { const: { a: 1 } }, 'const');
    expectInvalid([1], { const: { 0: 1 } }, 'const');
    expectInvalid({ 0: 1 }, { const: [1] }, 'const');
  });

  it('enforces strings, arrays, objects, and schema-valued additional properties', () => {
    expectValid('😀a', { type: 'string', minLength: 2, maxLength: 2 });
    expectInvalid('a', { type: 'string', minLength: 2 }, 'at least 2');
    expectInvalid('abc', { type: 'string', maxLength: 2 }, 'at most 2');

    const arraySchema: ConnectorJsonSchema = {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      uniqueItems: true,
      items: { type: 'integer' },
    };
    expectValid([1, 2], arraySchema);
    expectInvalid([1], arraySchema, 'at least 2');
    expectInvalid([1, 2, 3, 4], arraySchema, 'at most 3');
    expectInvalid([1, 1], arraySchema, 'unique');
    expectInvalid([1, 'two'], arraySchema, 'one of');

    const objectSchema: ConnectorJsonSchema = {
      type: 'object',
      minProperties: 1,
      maxProperties: 3,
      properties: { mode: { type: 'string' } },
      required: ['mode'],
      additionalProperties: { type: 'integer' },
    };
    expectValid({ mode: 'safe', retries: 2 }, objectSchema);
    expectInvalid({}, objectSchema, 'at least 1');
    expectInvalid({ retries: 2 }, objectSchema, 'mode is required');
    expectInvalid({ mode: 'safe', one: 1, two: 2, three: 3 }, objectSchema, 'at most 3');
    expectInvalid({ mode: 'safe', retries: 'two' }, objectSchema, 'one of');
    expectInvalid({ mode: 'safe', extra: true }, {
      type: 'object',
      properties: { mode: { type: 'string' } },
      additionalProperties: false,
    }, 'not allowed');
  });

  it('enforces combinators and boolean child schemas', () => {
    expectValid(4, {
      allOf: [{ type: 'number' }, { minimum: 1 }],
      anyOf: [{ const: 4 }, { const: 5 }],
      oneOf: [{ type: 'integer' }, { type: 'string' }],
      not: { const: 9 },
    });
    expectInvalid(0, { allOf: [{ type: 'number' }, { minimum: 1 }] }, '>= 1');
    expectInvalid(6, { anyOf: [{ const: 4 }, { const: 5 }] }, 'anyOf');
    expectInvalid(4, { oneOf: [{ type: 'number' }, { type: 'integer' }] }, 'exactly one');
    expectInvalid(9, { not: { const: 9 } }, 'must not');
    expectValid({ allowed: 'yes' }, {
      type: 'object',
      properties: { allowed: true },
      additionalProperties: false,
    });
    expectInvalid({ denied: 'yes' }, {
      type: 'object',
      properties: { denied: false },
      additionalProperties: false,
    }, 'rejected');
  });

  it.each<[string, ConnectorJsonSchema]>([
    ['not', {
      not: {
        type: 'array',
        items: { type: 'array', items: { type: 'integer' } },
      },
    }],
    ['anyOf', {
      anyOf: [
        { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
        { const: null },
      ],
    }],
    ['oneOf', {
      oneOf: [
        { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
        { const: null },
      ],
    }],
    ['allOf', {
      allOf: [
        { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
        {},
      ],
    }],
  ])('fails closed when %s evaluation exhausts the shared node budget', (_keyword, schema) => {
    const input = Array.from({ length: 7_000 }, () => [1, 2]);

    expectInvalid(
      input,
      schema,
      'schema evaluation exceeded the node limit',
    );
  });

  it('rejects missing, malformed, unsupported, and pathologically large schemas', () => {
    expect(() => assertConnectorInputMatchesSchema({}, undefined)).toThrow('missing');

    const malformedSchemas: Array<[JsonValue, string]> = [
      [{ type: 123 }, 'invalid type'],
      [{ type: 'made-up' }, 'unsupported type'],
      [{ enum: [] }, 'invalid enum'],
      [{ minimum: 'zero' }, 'invalid minimum'],
      [{ multipleOf: 0 }, 'invalid multipleOf'],
      [{ minLength: -1 }, 'invalid minLength'],
      [{ uniqueItems: 'yes' }, 'invalid uniqueItems'],
      [{ required: [1] }, 'invalid required'],
      [{ properties: [] }, 'invalid properties'],
      [{ additionalProperties: 1 }, 'invalid additionalProperties'],
      [{ allOf: [] }, 'invalid allOf'],
      [{ anyOf: Array.from({ length: 65 }, () => ({})) }, 'invalid anyOf'],
      [{ pattern: '^safe$' }, 'unsupported'],
      [{ properties: { nested: { $ref: '#/$defs/value' } } }, 'unsupported'],
    ];
    for (const [schema, message] of malformedSchemas) {
      expect(getConnectorSchemaSupportError(schema)).toContain(message);
    }

    let deep: JsonValue = {};
    for (let index = 0; index < 40; index += 1) deep = { not: deep };
    expect(getConnectorSchemaSupportError(deep)).toContain('depth');
    expect(getConnectorSchemaSupportError(null)).toContain('invalid');

    const manyProperties = Object.fromEntries(
      Array.from({ length: 20_001 }, (_, index) => [`value_${index}`, true]),
    );
    expect(getConnectorSchemaSupportError({
      type: 'object',
      properties: manyProperties,
    })).toContain('node limit');

    expectInvalid(
      Array.from({ length: 20_001 }, () => null),
      { type: 'array', items: true },
      'evaluation exceeded the node limit',
    );
    expectInvalid(Number.POSITIVE_INFINITY, {}, 'finite number');
  });
});
