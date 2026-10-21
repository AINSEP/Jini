import { describe, expect, test } from 'vitest';
import { compileOperationSchema } from '../operation-schema.js';

const closed = (properties: Record<string, unknown>, required: readonly string[] = []) => ({ type: 'object', additionalProperties: false, properties, required });

describe('strict projection under prefer policy', () => {
  test.each(['anthropic', 'openai', 'azure'] as const)('%s distinguishes omission from a real null-as-clear without mutating arguments', protocol => {
    const schema = closed({
      required: { type: 'string' },
      optional: { type: 'string', default: 'default' },
      clear: { type: ['string', 'null'] },
      requiredNullable: { type: ['number', 'null'] },
    }, ['required', 'clear', 'requiredNullable']);
    const original = structuredClone(schema);
    const result = compileOperationSchema({ schema, protocol }, { strict: true });
    expect(result.strict).toBe(true);
    expect(result.fallbackReason).toBeUndefined();
    expect(result.schema).toEqual(closed({
      required: { type: 'string' },
      optional: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      clear: { type: ['string', 'null'] },
      requiredNullable: { type: ['number', 'null'] },
    }, ['required', 'optional', 'clear', 'requiredNullable']));
    const input = { required: 'id', optional: null, clear: null, requiredNullable: null, unknown: 'host must validate' };
    expect(result.decodeInput(input)).toEqual({ required: 'id', clear: null, requiredNullable: null, unknown: 'host must validate' });
    expect(result.decodeInput({ required: 'id', optional: '' })).toEqual({ required: 'id', optional: '' });
    expect(result.decodeInput({ required: 'id' })).toEqual({ required: 'id' });
    expect(input.optional).toBeNull();
    expect(schema).toEqual(original);
  });

  test('nested objects and array items remove synthetic nulls at their own paths', () => {
    const schema = closed({
      child: closed({ optional: { type: 'integer' }, clear: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, ['clear']),
      items: { type: 'array', items: closed({ value: { type: 'boolean' }, note: { type: ['string', 'null'] } }, ['note']) },
    });
    const result = compileOperationSchema({ schema, protocol: 'openai' }, { strict: true });
    expect(result.strict).toBe(true);
    expect(result.decodeInput({ child: { optional: null, clear: null }, items: [{ value: null, note: null }, { value: false, note: 'kept' }] })).toEqual({
      child: { clear: null }, items: [{ note: null }, { value: false, note: 'kept' }],
    });
    expect(result.decodeInput({ child: null, items: null })).toEqual({});
    const childSchema = (result.schema.properties as Record<string, { anyOf: Record<string, unknown>[] }>).child!.anyOf[0]!;
    expect(childSchema.additionalProperties).toBe(false);
    expect(childSchema.required).toEqual(['optional', 'clear']);
  });

  test('finite local references expand and decode correctly, including escaped pointer segments', () => {
    const schema = { ...closed({ first: { $ref: '#/$defs/a~1b~0c' }, second: { $ref: '#/$defs/a~1b~0c' } }), $defs: { 'a/b~c': closed({ optional: { type: 'string' } }) } };
    const result = compileOperationSchema({ schema, protocol: 'openai' }, { strict: true });
    expect(result.strict).toBe(true);
    expect(JSON.stringify(result.schema)).not.toContain('$ref');
    expect(result.decodeInput({ first: { optional: null }, second: { optional: 'kept' } })).toEqual({ first: {}, second: { optional: 'kept' } });
  });

  test('an empty or absent argument schema remains a closed parameterless tool', () => {
    const result = compileOperationSchema({ schema: undefined, protocol: 'anthropic' }, { strict: true });
    expect(result.strict).toBe(true);
    expect(result.schema).toEqual(closed({}));
    expect(result.decodeInput({})).toEqual({});
  });

  test('required nulls and const/enum constraints survive projection', () => {
    const result = compileOperationSchema({ schema: closed({ status: { type: 'integer', enum: [301, 302] }, mode: { type: 'string', const: 'exact' }, nil: { type: 'null' } }, ['status', 'mode', 'nil']), protocol: 'openai' }, { strict: true });
    expect(result.schema).toEqual(closed({ status: { type: 'integer', enum: [301, 302] }, mode: { type: 'string', enum: ['exact'] }, nil: { type: 'null' } }, ['status', 'mode', 'nil']));
    expect(result.decodeInput({ status: 301, mode: 'exact', nil: null })).toEqual({ status: 301, mode: 'exact', nil: null });
  });
});

describe('fallback preserves authoritative contracts', () => {
  const recursive = { ...closed({ child: { $ref: '#/$defs/node' } }), $defs: { node: closed({ next: { $ref: '#/$defs/node' } }) } };
  test.each([
    { name: 'recursive refs', schema: recursive, reason: 'recursive-schema' },
    { name: 'explicit open maps', schema: closed({ map: { type: 'object', additionalProperties: { type: 'string' } } }), reason: 'open-map' },
    { name: 'implicitly open objects', schema: { type: 'object', properties: { value: { type: 'string' } } }, reason: 'open-map' },
    { name: 'explicitly open objects', schema: { ...closed({}), additionalProperties: true }, reason: 'open-map' },
    { name: 'unresolved refs', schema: closed({ x: { $ref: '#/$defs/missing' } }), reason: 'unresolved-reference' },
    { name: 'external refs', schema: closed({ x: { $ref: 'https://schemas.invalid/input.json' } }), reason: 'unresolved-reference' },
    { name: 'ref siblings', schema: closed({ x: { $ref: '#/$defs/value', minLength: 2 } }), reason: 'unsupported-schema' },
    { name: 'unsupported bounds', schema: closed({ count: { type: 'number', minimum: 1 } }), reason: 'unsupported-schema' },
    { name: 'bounded nullable union', schema: closed({ x: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } }), reason: 'unsupported-schema' },
    { name: 'constrained null union branch', schema: closed({ x: { anyOf: [{ type: 'string' }, { type: 'null', not: {} }] } }, ['x']), reason: 'unsupported-schema' },
    { name: 'ambiguous unions', schema: closed({ x: { anyOf: [{ type: 'integer' }, { type: 'string' }] } }), reason: 'unsupported-schema' },
    { name: 'tuples', schema: closed({ x: { type: 'array', items: [{ type: 'string' }] } }), reason: 'unsupported-schema' },
    { name: 'unknown required properties', schema: closed({}, ['missing']), reason: 'unsupported-schema' },
    { name: 'invalid types', schema: closed({ x: { type: [] } }), reason: 'unsupported-schema' },
    { name: 'root scalar', schema: { type: 'string' }, reason: 'unsupported-schema' },
  ])('$name reports a value-free reason and preserves input for host validation', ({ schema, reason }) => {
    const result = compileOperationSchema({ schema, protocol: 'openai' }, { strict: true });
    expect(result.strict).toBe(false);
    expect(result.fallbackReason).toBe(reason);
    expect(result.schema).toBe(schema);
    const input = { secret: 'raw arguments must never enter diagnostics', optional: null };
    expect(result.decodeInput(input)).toBe(input);
    expect(result.fallbackReason).not.toContain('raw arguments');
  });

  test('unknown/unsupported endpoint uses host validation and keeps real nulls', () => {
    const schema = closed({ optional: { type: 'string' } });
    const result = compileOperationSchema({ schema, protocol: 'openai' });
    expect(result.strict).toBe(false);
    expect(result.fallbackReason).toBe('endpoint-unsupported');
    expect(result.schema).toBe(schema);
    expect(result.decodeInput({ optional: null })).toEqual({ optional: null });
  });

  test.each(['anthropic', 'openai', 'azure', 'google'] as const)('%s: optional null-as-clear falls back rather than losing omission semantics', protocol => {
    const schema = closed({ clear: { type: ['string', 'null'] } });
    const result = compileOperationSchema({ schema, protocol }, { strict: true });
    expect(result.strict).toBe(false);
    expect(result.fallbackReason).toBe('optional-nullable');
    expect(result.decodeInput({})).toEqual({});
    expect(result.decodeInput({ clear: null })).toEqual({ clear: null });
    expect(result.decodeInput({ clear: 'changed' })).toEqual({ clear: 'changed' });
  });

  test('reference expansion is bounded by node count as well as depth', () => {
    const schema = { ...closed(Object.fromEntries(Array.from({ length: 2050 }, (_, i) => [`v${i}`, { $ref: '#/$defs/value' }]))), $defs: { value: { type: 'string' } } };
    const result = compileOperationSchema({ schema, protocol: 'openai' }, { strict: true });
    expect(result.strict).toBe(false);
    expect(result.fallbackReason).toBe('schema-limit');
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 40; i++) deep = closed({ next: deep });
    expect(compileOperationSchema({ schema: deep, protocol: 'openai' }, { strict: true }).fallbackReason).toBe('schema-limit');
  });

  test('decoder treats literal prototype-shaped keys as data and leaves malformed argument types for the host to reject', () => {
    const properties = Object.fromEntries([['__proto__', { type: 'string' }], ['constructor', { type: 'string' }]]);
    const result = compileOperationSchema({ schema: closed(properties), protocol: 'openai' }, { strict: true });
    expect(result.strict).toBe(true);
    const input: unknown = JSON.parse('{"__proto__":null,"constructor":"value","other":{"polluted":true}}');
    expect(result.decodeInput(input)).toEqual({ constructor: 'value', other: { polluted: true } });
    expect(Object.hasOwn(input as object, '__proto__')).toBe(true);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(result.decodeInput(null)).toBeNull();
    expect(result.decodeInput('invalid')).toBe('invalid');
    expect(result.decodeInput(['invalid'])).toEqual(['invalid']);
  });
});

describe('Gemini numeric enum representations', () => {
  test('numeric enums decode through nested arrays, references and literal property names', () => {
    const schema = { ...closed({
      'status.code': { type: 'integer', enum: [301, 302] },
      entries: { type: 'array', items: closed({ status: { $ref: '#/$defs/status' } }) },
    }), $defs: { status: { type: 'number', enum: [1.5, 2] } } };
    const result = compileOperationSchema({ schema, protocol: 'google' }, { strict: true });
    expect(result.strict).toBe(true);
    expect(JSON.stringify(result.schema)).toContain('"enum":["301","302"]');
    const input = { 'status.code': '301', entries: [{ status: '1.5' }, { status: null }, { status: '999' }] };
    expect(result.decodeInput(input)).toEqual({ 'status.code': 301, entries: [{ status: 1.5 }, {}, { status: '999' }] });
    expect(input.entries[0]!.status).toBe('1.5');
  });

  test('nullable numeric enums preserve null-as-clear and only convert declared numeric values', () => {
    const result = compileOperationSchema({ schema: closed({ status: { type: ['integer', 'null'], enum: [301, 302, null] } }, ['status']), protocol: 'google' }, { strict: true });
    expect(result.strict).toBe(true);
    expect((result.schema.properties as Record<string, unknown>).status).toEqual({ type: 'string', nullable: true, enum: ['301', '302'] });
    expect(result.decodeInput({ status: null })).toEqual({ status: null });
    expect(result.decodeInput({ status: '301' })).toEqual({ status: 301 });
    expect(result.decodeInput({ status: '3.01e2' })).toEqual({ status: '3.01e2' });
  });

  test('fallback reuses the existing Google numeric enum conversion', () => {
    const result = compileOperationSchema({ schema: { type: 'object', properties: { code: { type: 'integer', enum: [301, 302] } } }, protocol: 'google' }, { strict: true });
    expect(result.strict).toBe(false);
    expect(result.fallbackReason).toBe('open-map');
    expect(result.schema).toEqual({ type: 'object', properties: { code: { type: 'string', enum: ['301', '302'] } } });
    expect(result.decodeInput({ code: '302' })).toEqual({ code: 302 });
  });
});

describe('every unsupported construct falls back with a value-free reason', () => {
  const nullable = (member: unknown, extra: Record<string, unknown> = {}) => ({ anyOf: [member, { type: 'null' }], ...extra });
  test.each([
    { name: 'a reference to a non-schema value', schema: { ...closed({ x: { $ref: '#/$defs/n' } }), $defs: { n: 5 } }, reason: 'unresolved-reference' },
    { name: 'a single-member union', schema: closed({ x: { anyOf: [{ type: 'string' }] } }, ['x']), reason: 'unsupported-schema' },
    { name: 'a union of two nulls', schema: closed({ x: { anyOf: [{ type: 'null' }, { type: 'null' }] } }, ['x']), reason: 'unsupported-schema' },
    { name: 'a nullable union with a non-schema member', schema: closed({ x: { anyOf: [{ type: 'null' }, 'string'] } }, ['x']), reason: 'unsupported-schema' },
    { name: 'a nullable union carrying sibling constraints', schema: closed({ x: nullable({ type: 'string' }, { examples: ['a'] }) }, ['x']), reason: 'unsupported-schema' },
    { name: 'a nullable union whose member has no single type', schema: closed({ x: nullable({ enum: ['a'] }) }, ['x']), reason: 'unsupported-schema' },
    { name: 'an unknown type name', schema: closed({ x: { type: 'date' } }, ['x']), reason: 'unsupported-schema' },
    { name: 'a repeated type name', schema: closed({ x: { type: ['string', 'string'] } }, ['x']), reason: 'unsupported-schema' },
    { name: 'a non-null type pair', schema: closed({ x: { type: ['string', 'integer'] } }, ['x']), reason: 'unsupported-schema' },
    { name: 'const alongside enum', schema: closed({ x: { type: 'string', enum: ['a'], const: 'a' } }, ['x']), reason: 'unsupported-schema' },
    { name: 'an empty enum', schema: closed({ x: { type: 'string', enum: [] } }, ['x']), reason: 'unsupported-schema' },
    { name: 'a non-literal enum member', schema: closed({ x: { type: 'string', enum: [{}] } }, ['x']), reason: 'unsupported-schema' },
    { name: 'properties given as an array', schema: { type: 'object', additionalProperties: false, properties: [] }, reason: 'unsupported-schema' },
    { name: 'required given as a string', schema: { type: 'object', additionalProperties: false, properties: {}, required: 'x' }, reason: 'unsupported-schema' },
  ])('$name', ({ schema, reason }) => {
    const result = compileOperationSchema({ schema, protocol: 'openai' }, { strict: true });
    expect(result).toMatchObject({ strict: false, fallbackReason: reason });
    expect(result.schema).toBe(schema);
  });

  test('a closed object with no properties keyword projects as a strict parameterless object', () => {
    const result = compileOperationSchema({ schema: { type: 'object', additionalProperties: false }, protocol: 'openai' }, { strict: true });
    expect(result).toMatchObject({ strict: true, schema: { type: 'object', additionalProperties: false, properties: {}, required: [] } });
  });

  test('a non-object argument schema falls back to the closed empty schema', () => {
    const result = compileOperationSchema({ schema: 'string', protocol: 'anthropic' }, { strict: true });
    expect(result).toMatchObject({ strict: false, fallbackReason: 'unsupported-schema', schema: { type: 'object', additionalProperties: false, properties: {}, required: [] } });
  });

  test('an unexpected error while reading the schema propagates instead of being reported as a fallback', () => {
    const schema = { type: 'object', additionalProperties: false, get properties(): never { throw new TypeError('schema getter failed'); } };
    expect(() => compileOperationSchema({ schema, protocol: 'openai' }, { strict: true })).toThrow(new TypeError('schema getter failed'));
  });
});

describe('Gemini enum decoding edge cases', () => {
  test('a string enum needs no numeric decoding and round-trips unchanged', () => {
    const result = compileOperationSchema({ schema: closed({ mode: { type: 'string', enum: ['fast', 'slow'] } }, ['mode']), protocol: 'google' }, { strict: true });
    expect(result.strict).toBe(true);
    expect(result.decodeInput({ mode: 'fast' })).toEqual({ mode: 'fast' });
  });

  test('a numeric enum that lists null without a nullable type is refused', () => {
    const result = compileOperationSchema({ schema: closed({ code: { type: 'integer', enum: [1, null] } }, ['code']), protocol: 'google' }, { strict: true });
    expect(result).toMatchObject({ strict: false, fallbackReason: 'unsupported-schema' });
  });
});
