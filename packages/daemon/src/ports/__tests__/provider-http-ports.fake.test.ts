/** Self-checks of the provider-HTTP fakes: a route test reads their call log and their scripted output,
 * so both must show what was really passed and replay what was scripted. */
import { expect, it } from 'vitest';
import { fakeBaseUrlGuard, fakeProviderToolTurnPort } from './provider-http-ports.fake.js';

it('replays the scripted events of a provider turn in order and records the call', async () => {
  const port = fakeProviderToolTurnPort({ events: [{ type: 'text_delta', delta: 'a' }, { type: 'end' }] });
  const seen: string[] = [];
  const result = await port.anthropic({ apiKey: 'k', model: 'm', maxTokens: 1, messages: [], onEvent: (event) => { seen.push(event.type); } }, { temperature: 0 });
  expect(seen).toEqual(['text_delta', 'end']);
  expect(result).toEqual({ stopReason: 'end_turn', toolTurns: 0 });
  expect(port.calls).toEqual([{ member: 'anthropic', required: expect.objectContaining({ apiKey: 'k' }), optional: { temperature: 0 } }]);
});

it('records every provider member under its own name', async () => {
  const port = fakeProviderToolTurnPort({});
  const onEvent = () => {};
  await port.openai({ apiKey: 'k', model: 'm', messages: [], onEvent });
  await port.azure({ apiKey: 'k', baseUrl: 'https://x', model: 'm', messages: [], onEvent });
  await port.google({ apiKey: 'k', model: 'm', contents: [], onEvent });
  await port.ollama({ apiKey: 'k', model: 'm', messages: [], onEvent });
  expect(port.calls.map((call) => call.member)).toEqual(['openai', 'azure', 'google', 'ollama']);
});

it('runs the executeTool a test passed through, unchanged', async () => {
  const port = fakeProviderToolTurnPort({ toolCall: { id: '1', name: 't', input: {} } });
  const executed: unknown[] = [];
  await port.openai({ apiKey: 'k', model: 'm', messages: [], onEvent: () => {} }, { executeTool: async (call) => { executed.push(call); return { content: 'ok' }; } });
  expect(executed).toEqual([{ id: '1', name: 't', input: {} }]);
});

it('answers the base-URL guard with the verdict a test seeded', () => {
  const guard = fakeBaseUrlGuard({ 'http://bad': { error: 'blocked', forbidden: true } });
  expect(guard.validate({ baseUrl: 'http://bad' })).toEqual({ error: 'blocked', forbidden: true });
  expect(guard.validate({ baseUrl: 'https://good' }).error).toBeUndefined();
  expect(guard.calls).toEqual([{ baseUrl: 'http://bad' }, { baseUrl: 'https://good' }]);
});
