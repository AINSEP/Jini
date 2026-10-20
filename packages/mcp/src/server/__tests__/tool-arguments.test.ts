import { describe, expect, it } from 'vitest';
import type { OutputUnit } from '@cfworker/json-schema';
import { argumentShapeMessage, isRecord, normalizeToolArguments } from '../tool-arguments.js';
import type { McpToolDef } from '../tool-protocol.js';

function unit(fields: Partial<OutputUnit>): OutputUnit {
  return { keyword: 'type', keywordLocation: '#/type', instanceLocation: '#', error: 'bad', ...fields };
}

describe('argumentShapeMessage', () => {
  it('falls back to a generic instruction when the validator supplies no error units', () => {
    // handleToolCall never reaches this: @cfworker/json-schema reports valid:false only with >=1 error.
    expect(argumentShapeMessage({ errors: [] })).toBe('supply arguments matching the declared input schema');
  });

  it('falls back to a change instruction when a required error quotes no property name', () => {
    expect(argumentShapeMessage({ errors: [unit({ keyword: 'required', error: 'missing something' })] })).toBe('change `arguments`: missing something');
  });

  it('prefers a nested-location error over an earlier root-level one', () => {
    const errors = [unit({ error: 'root' }), unit({ instanceLocation: '#/a', error: 'nested' })];
    expect(argumentShapeMessage({ errors })).toBe('change `a`: nested');
  });

  it('uses the first error when every error is a root-level non-field error', () => {
    expect(argumentShapeMessage({ errors: [unit({ error: 'first' }), unit({ error: 'second' })] })).toBe('change `arguments`: first');
  });
});

describe('normalizeToolArguments', () => {
  const tool: McpToolDef = {
    name: 't',
    description: 't',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, input: { type: 'object' } }, additionalProperties: false },
    argumentNormalization: { aliases: { name: 'id' }, foldIntoInput: true },
    handler: () => null,
  };

  it('does not mutate the caller arguments while renaming and folding', () => {
    const rawArgs = { name: 'x', q: 1 };
    expect(normalizeToolArguments({ tool, rawArgs })).toEqual({ id: 'x', input: { q: 1 } });
    expect(rawArgs).toEqual({ name: 'x', q: 1 });
  });

  it('leaves a nested input alone for a strict schema that declares no properties', () => {
    const strictEmpty: McpToolDef = { ...tool, inputSchema: { type: 'object', additionalProperties: false }, argumentNormalization: {} };
    expect(normalizeToolArguments({ tool: strictEmpty, rawArgs: { input: { id: 'x' } } })).toEqual({ input: { id: 'x' } });
  });

  it('refuses null arguments with a replace instruction', () => {
    expect(() => normalizeToolArguments({ tool, rawArgs: null })).toThrow(/^replace `arguments` with a JSON object$/);
  });
});

describe('isRecord', () => {
  it.each([[{}, true], [[], false], [null, false], ['x', false]])('classifies %j as %s', (value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });
});
