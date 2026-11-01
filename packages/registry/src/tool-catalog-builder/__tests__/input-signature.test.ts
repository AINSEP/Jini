import { batchDescriptorFor } from '@jini-ai/core';
import { expect, test } from 'vitest';
import { inputSignature, MAX_SIGNATURE_BYTES } from '../input-signature.js';

const themeId = { type: 'string', minLength: 1 };

test('required names and types come first, then optional ones marked ?', () => {
  expect(inputSignature({ inputSchema: { type: 'object', required: ['path'], properties: {
    includeTrash: { type: 'boolean' }, path: { type: 'string' }, root: { type: 'string', enum: ['site', 'custom'] },
  } } })).toBe('path: string, includeTrash?: boolean, root?: "site"|"custom"');
});

test('a batch-wrapped tool still names the required fields the wrapper moved into its items description', () => {
  const descriptor = { id: 'theme_read_file', inputSchema: { type: 'object', required: ['themeId', 'path'],
    properties: { themeId, path: { type: 'string' }, offset: { type: 'integer' } } } };
  const batched = batchDescriptorFor({ descriptor, tool: { toolId: descriptor.id } });
  expect(batched.inputSchema).not.toHaveProperty('required');
  expect(inputSignature({ inputSchema: batched.inputSchema })).toBe('themeId: string, path: string, offset?: integer, items?: array<object>');
});

test('the first anyOf alternative is the primary form, with one level of nested item shape', () => {
  const option = { type: 'object', required: ['label'], properties: { label: { type: 'string' }, value: { type: 'string' } } };
  expect(inputSignature({ inputSchema: { type: 'object', anyOf: [{ required: ['question', 'options'] }, { required: ['title'] }],
    properties: { question: { type: 'string' }, options: { type: 'array', items: option }, title: { type: 'string' } } } }))
    .toBe('question: string, options: array<{label: string, value?: string}>, title?: string (other forms: describe_tool)');
});

test('long enums collapse; argument-free and schema-less tools say so', () => {
  const values = Array.from({ length: 20 }, (_, index) => `value-${index}`);
  expect(inputSignature({ inputSchema: { type: 'object', required: ['kind'], properties: { kind: { enum: values } } } })).toBe('kind: enum');
  expect(inputSignature({ inputSchema: { type: 'object', properties: {} } })).toBe('no arguments');
  expect(inputSignature({ inputSchema: undefined })).toBeUndefined();
  expect(inputSignature({ inputSchema: { type: 'object' } })).toBeUndefined();
});

test('over the byte cap, optional fields drop first, then the whole line defers to describe_tool', () => {
  const field = (index: number) => [`field_${String(index).padStart(3, '0')}_${'x'.repeat(20)}`, { type: 'string' }] as const;
  const properties = Object.fromEntries(Array.from({ length: 12 }, (_, index) => field(index)));
  const names = Object.keys(properties);
  const optionalHeavy = inputSignature({ inputSchema: { type: 'object', required: names.slice(0, 2), properties } })!;
  expect(optionalHeavy).toBe(`${names.slice(0, 2).map(name => `${name}: string`).join(', ')}; optional fields: describe_tool`);
  expect(inputSignature({ inputSchema: { type: 'object', properties } })).toBe('no required arguments; optional fields: describe_tool');
  expect(inputSignature({ inputSchema: { type: 'object', required: names, properties } })).toBe('call describe_tool for the arguments');
  const exact = 'a'.repeat(MAX_SIGNATURE_BYTES - ': string'.length);
  expect(inputSignature({ inputSchema: { type: 'object', required: [exact], properties: { [exact]: { type: 'string' } } } })).toBe(`${exact}: string`);
  const over = `${exact}a`;
  expect(inputSignature({ inputSchema: { type: 'object', required: [over], properties: { [over]: { type: 'string' } } } })).toBe('call describe_tool for the arguments');
});
