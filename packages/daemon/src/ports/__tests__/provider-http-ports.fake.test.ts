/** Self-checks of the provider-HTTP and xAI OAuth fakes: a route test reads their call log and their scripted output,
 * so both must show what was really passed and replay what was scripted. */
import { expect, it } from 'vitest';
import { fakeBaseUrlGuard, fakeProviderToolTurnPort, fakeXaiOAuthPort } from './provider-http-ports.fake.js';

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

it('keeps the xAI token store in memory, per file name, and counts pending authorizations', async () => {
  const port = fakeXaiOAuthPort();
  expect(await port.tokens.get({ dataDir: '/d', fileName: 'a' })).toBeNull();
  await port.tokens.set({ dataDir: '/d', fileName: 'a', token: { accessToken: 't', tokenType: 'Bearer', savedAt: 1 } });
  expect((await port.tokens.get({ dataDir: '/d', fileName: 'a' }))?.accessToken).toBe('t');
  expect(await port.tokens.get({ dataDir: '/d', fileName: 'b' })).toBeNull();
  await port.tokens.clear({ dataDir: '/d', fileName: 'a' });
  expect(await port.tokens.get({ dataDir: '/d', fileName: 'a' })).toBeNull();
});

it('runs begin then complete as one dance and consumes the state exactly once', async () => {
  const port = fakeXaiOAuthPort();
  const pending = port.createPendingCache();
  const { state, authorizeUrl } = port.begin({ config: port.config, pending, redirectUri: 'http://127.0.0.1:1/callback' });
  expect(authorizeUrl).toContain(state);
  expect(pending.size()).toBe(1);
  const token = await port.complete({ config: port.config, pending, state, code: 'c' });
  expect(token.access_token).toBe('fake-access-token');
  expect(pending.size()).toBe(0);
  await expect(port.complete({ config: port.config, pending, state, code: 'c' })).rejects.toThrow('state not found or expired');
});

it('lets a test fire the loopback callback and stop the listener', async () => {
  const port = fakeXaiOAuthPort();
  const outcomes: unknown[] = [];
  const listener = await port.startCallbackListener({ host: '127.0.0.1', port: 1, path: '/callback', expectedState: 's', onCallback: (outcome) => { outcomes.push(outcome); } });
  await port.fireCallback({ kind: 'ok', code: 'c', state: 's' });
  expect(outcomes).toEqual([{ kind: 'ok', code: 'c', state: 's' }]);
  await listener.stop();
  expect(port.listenerStops).toBe(1);
});
