import { expect, it } from 'vitest';
import { decodeToolInputObject, unwrapToolInputEnvelope } from '../tool-input-envelope.js';
import { ToolInputError } from '../tool-input-errors.js';

it('decodes a delegated JSON object without coercing typed values or echoing invalid input', () => {
  expect(decodeToolInputObject({ input: '{"name":"brief","active":false}' })).toEqual({ name: 'brief', active: false });
  for (const [input, message] of [
    ['{bad:', 'The delegated input is not valid JSON. Send one JSON object containing the tool fields.'],
    ['null', 'The delegated input must be a JSON object. Send the tool fields inside an object.'],
    ['[1]', 'The delegated input must be a JSON object. Send the tool fields inside an object.'],
    ['"text"', 'The delegated input must be a JSON object. Send the tool fields inside an object.'],
  ] as const) {
    const decode = () => decodeToolInputObject({ input });
    expect(decode).toThrow(ToolInputError);
    expect(decode).toThrow(message);
  }
});

it('unboxes only an object envelope whose schema cannot own input', () => {
  const envelope = { input: '{"name":"brief"}' };
  for (const schema of [{ type: 'object' }, { type: 'object', properties: { name: { type: 'string' } } }]) {
    expect(unwrapToolInputEnvelope({ input: envelope, schema })).toEqual({ name: 'brief' });
  }
  for (const schema of [undefined, [], { type: 'array' }, { type: 'object', properties: [] }, { type: 'object', properties: { input: {} } }]) {
    expect(unwrapToolInputEnvelope({ input: envelope, schema })).toBe(envelope);
  }
  const schema = { type: 'object', properties: { name: { type: 'string' } } };
  const ownContent = { name: 'outer', ...envelope };
  const notAnEnvelope = { name: 'standalone' };
  const invalidContent = { input: [1] };
  for (const input of [ownContent, notAnEnvelope, invalidContent, null]) {
    expect(unwrapToolInputEnvelope({ input, schema })).toBe(input);
  }
});
