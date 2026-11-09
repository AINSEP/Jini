import { expect, test } from 'vitest';
import { deriveAgentPluginConnectionId, isEmptyJsonList } from '../federate-mcp.js';

test('connection ids take an object while preserving saved id derivation', () => {
  expect(deriveAgentPluginConnectionId({ serverKey: 'Hello World' }, {})).toBe('hello-world');
  expect(deriveAgentPluginConnectionId({ serverKey: 'ALPHA.one-2' })).toBe('alpha-one-2');
  expect(deriveAgentPluginConnectionId({ serverKey: '!!!' })).toBeNull();
});
test('saved tool lists take an object and preserve empty and malformed legacy projections', () => {
  expect(isEmptyJsonList({ raw: null }, {})).toBe(true);
  expect(isEmptyJsonList({ raw: '[]' })).toBe(true);
  expect(isEmptyJsonList({ raw: '["read"]' })).toBe(false);
  for (const raw of ['', '{"length":0}', 'invalid', 'null']) expect(isEmptyJsonList({ raw })).toBe(true);
});
