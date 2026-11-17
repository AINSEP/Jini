/** Self-checks of the port fake: a launcher test relies on its call log, so the log must show what was really passed. */
import { expect, it } from 'vitest';
import { fakeAgentDef, fakeAgentRuntimePort } from './agent-runtime-port.fake.js';

it('records each call with its required and optional arguments, in order', async () => {
  const port = fakeAgentRuntimePort();
  const def = port.defs.get({ id: 'fixture' })!;
  port.launch.resolve({ def }, { configuredEnv: { A: '1' } });
  await port.launch.preparePromptFile({ def, prompt: 'p', label: 'l' });
  expect(port.calls.map(call => call.member)).toEqual(['defs.get', 'launch.resolve', 'launch.preparePromptFile']);
  expect(port.calls[1]).toEqual({ member: 'launch.resolve', required: { def }, optional: { configuredEnv: { A: '1' } } });
});

it('answers undefined for an unprobed capability map and the map a test seeded on defs', () => {
  const port = fakeAgentRuntimePort({}, { capabilities: new Map([['fixture', { appendSystemPrompt: false }]]) });
  expect(port.defs.capabilities({ defId: 'other' })).toBeUndefined();
  expect(port.defs.capabilities({ defId: 'fixture' })).toEqual({ appendSystemPrompt: false });
});

it('lets a test replace one group and keeps the others recording', () => {
  const port = fakeAgentRuntimePort({}, { failures: { startupMessage: () => 'custom' } });
  expect(port.failures.startupMessage({ stage: 'spawn', error: new Error('x') })).toBe('custom');
  expect(fakeAgentDef({ id: 'a' }).buildArgs({ prompt: 'hello', imagePaths: [] })).toEqual(['hello']);
  expect(port.launch.hostEnvNames()).toEqual([]);
  expect(port.calls.map(call => call.member)).toEqual(['launch.hostEnvNames']);
});

it('fails with plain words when a test reaches a session it did not supply', () => {
  const port = fakeAgentRuntimePort();
  expect(() => port.sessions.attachPiRpc({ child: {} as never, prompt: 'p', send: () => {} })).toThrow(
    'fakeAgentRuntimePort: sessions.attachPiRpc was called but the test supplied no session. Pass { sessions: { ... } } to fakeAgentRuntimePort.');
});
