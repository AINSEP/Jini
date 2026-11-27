import { expect, it } from 'vitest';
import { availableCapabilities, findCapability, findCapabilityInputError, type CapabilityDef } from '../capabilities.js';

const server: CapabilityDef = {
  id: 'deliver-summary', description: 'Deliver a summary', risk: 'write', surface: 'server',
  inputSchema: { type: 'object', additionalProperties: false, required: ['target'], properties: {
    target: { type: 'string', enum: ['inbox', 'archive'] }, options: { type: 'object' },
    limit: { type: 'integer' }, confidence: { type: 'number' }, labels: { type: 'array' },
  } },
};
const session: CapabilityDef = {
  id: 'highlight-summary', description: 'Highlight a summary', risk: 'read', surface: 'session',
  inputSchema: { type: 'object', properties: {} },
};

it('exposes headless capabilities without a session and looks up an exact id', () => {
  const capabilities = [session, server];
  expect(availableCapabilities({ capabilities, hasSession: false })).toEqual([server]);
  expect(availableCapabilities({ capabilities, hasSession: true })).toEqual([session, server]);
  expect(findCapability({ capabilities, id: 'deliver-summary' })).toBe(server);
  expect(findCapability({ capabilities, id: 'deliver' })).toBeUndefined();
});

it.each([
  { input: { target: undefined }, error: '"target" is required' },
  { input: { target: 'inbox', mistyped: 3 }, error: 'unknown argument: mistyped' },
  { input: { target: 'inbox', z: false, a: true }, error: 'unknown arguments: a, z' },
  { input: { target: 'inbox', options: null }, error: '"options" must be a object, received null' },
  { input: { target: 'inbox', options: [] }, error: '"options" must be a object, received array' },
  { input: { target: 'inbox', limit: 2.5 }, error: '"limit" must be a integer, received number' },
  { input: { target: 'inbox', confidence: Infinity }, error: '"confidence" must be a number, received Infinity' },
  { input: { target: 'inbox', confidence: '0.8' }, error: '"confidence" must be a number, received string' },
  { input: { target: 'trash' }, error: '"target" must be one of: inbox, archive' },
])('returns the precise validation refusal: $error', ({ input, error }) => {
  expect(findCapabilityInputError({ capability: server, input })).toBe(error);
});

it('accepts typed arguments and permits undeclared arguments only in the open schema', () => {
  const input = { target: 'archive', options: { compact: true }, limit: 3, confidence: 0.8, labels: ['important'] };
  expect(findCapabilityInputError({ capability: server, input })).toBeNull();
  expect(findCapabilityInputError({ capability: session, input: { futureOption: true } })).toBeNull();
});
