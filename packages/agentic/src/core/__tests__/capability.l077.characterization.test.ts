import { describe, expect, it } from 'vitest';
import { findCapabilityInputError, type CapabilityDef } from '../capability.js';

const capability: CapabilityDef = {
  id: 'test.input', description: 'Characterize shallow validation', risk: 'read', surface: 'session',
  inputSchema: { type: 'object', properties: {
    name: { type: 'string', enum: ['Ada', 'Grace'] }, count: { type: 'number' }, tags: { type: 'array' },
  }, required: ['name'], additionalProperties: false },
};

describe('L077 input validation order and shallow semantics', () => {
  it.each([
    [{ unexpected: true }, '"name" is required'],
    [{ name: undefined }, '"name" is required'],
    [{ name: 'Ada', z: 0, a: 0 }, 'unknown arguments: a, z'],
    [{ name: 'Ada', extra: 0 }, 'unknown argument: extra'],
    [{ name: 1, extra: 0 }, 'unknown argument: extra'],
    [{ name: 1 }, '"name" must be a string, received number'],
    [{ name: [] }, '"name" must be a string, received array'],
    [{ name: null }, '"name" must be a string, received object'],
    [{ name: 'Other' }, '"name" must be one of: Ada, Grace'],
    [{ name: 'Ada', count: '1' }, '"count" must be a number, received string'],
    [{ name: 'Grace', count: 2, tags: [] }, null],
    [{ name: 'Ada', count: undefined }, null],
  ] satisfies [Record<string, unknown>, string | null][])('validates %j as %s', (input, expected) => {
    expect(findCapabilityInputError({ capability, input })).toBe(expected);
  });

  it.each(['constructor', '__proto__', 'toString', 'valueOf'])('rejects undeclared own %s keys', (key) => {
    const input: Record<string, unknown> = { name: 'Ada', [key]: 'payload' };
    expect(findCapabilityInputError({ capability, input })).toBe(`unknown argument: ${key}`);
  });

  it('permits undeclared keys when the schema is open and has no required list', () => {
    const open: CapabilityDef = { ...capability, inputSchema: { type: 'object', properties: {} } };
    expect(findCapabilityInputError({ capability: open, input: { arbitrary: 1 } })).toBeNull();
  });

  it('accepts null for an object schema because validation is shallow (reported, not fixed)', () => {
    const object: CapabilityDef = { ...capability, inputSchema: { type: 'object', properties: { data: { type: 'object' } } } };
    expect(findCapabilityInputError({ capability: object, input: { data: null } })).toBeNull();
  });
});
