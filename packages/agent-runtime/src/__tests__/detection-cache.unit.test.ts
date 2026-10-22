import { expect, it } from 'vitest';
import { detectAgents } from '../detection.js';
import { createAgentRuntimeState } from '../runtime-state.js';
import type { AgentDetectionModelOptions } from '../detection.js';

it('repeated complete detections call each CLI probe once and Rescan forces fresh evidence', async () => {
  const state = createAgentRuntimeState({});
  const calls = new Map<string, number>();
  const forces: boolean[] = [];
  const probeAgent: NonNullable<AgentDetectionModelOptions['probeAgent']> = async ({ def }, { force }) => {
    calls.set(def.id, (calls.get(def.id) ?? 0) + 1);
    if (def.id === 'claude') forces.push(force === true);
    return { ...def, available: true, models: [{ id: 'exact-model-v2', label: 'exact-model-v2' }], modelsSource: 'live' };
  };
  const options = { state, env: { PATH: '/missing', HOME: '/missing' }, probeAgent };
  const [first, second] = await Promise.all([detectAgents({}, options), detectAgents({}, options)]);
  expect(second).toEqual(first);
  await detectAgents({}, options);
  expect([...calls.values()].every(count => count === 1)).toBe(true);
  expect(first.find(agent => agent.id === 'claude')?.models).toEqual([{ id: 'exact-model-v2', label: 'exact-model-v2' }]);
  await detectAgents({}, { ...options, force: true });
  expect([...calls.values()].every(count => count === 2)).toBe(true);
  expect(forces).toEqual([false, true]);
});

it('Rescan waits behind the same CLI probe and cannot overlap it', async () => {
  const state = createAgentRuntimeState({});
  let finish!: () => void; let started!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0; let active = 0; let peak = 0;
  const probeAgent: NonNullable<AgentDetectionModelOptions['probeAgent']> = async ({ def }) => {
    if (def.id === 'claude') {
      calls++; peak = Math.max(peak, ++active); started();
      if (calls === 1) await pending;
      active--;
    }
    return { ...def, available: false, models: [], modelsSource: 'fallback' };
  };
  const options = { state, env: { PATH: '/missing', HOME: '/missing' }, probeAgent };
  const first = detectAgents({}, options);
  await startedPromise;
  const rescan = detectAgents({}, { ...options, force: true });
  finish();
  await Promise.all([first, rescan]);
  expect(calls).toBe(2); expect(peak).toBe(1);
});
