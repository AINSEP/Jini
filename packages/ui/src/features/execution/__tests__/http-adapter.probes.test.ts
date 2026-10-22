import { describe, expect, it } from 'vitest';
import { createExecutionHttpAdapter, type ExecutionProbeTransport } from '../http-adapter.js';
import type { ByokConfig } from '../types.js';

const config: ByokConfig = { protocol: 'openai', providerId: null, baseUrl: 'https://example.test', apiKey: '', model: 'model' };

function transport(overrides: Partial<ExecutionProbeTransport> = {}): ExecutionProbeTransport {
  return {
    detectExecutionAgents: async () => ({ data: [] }),
    testExecutionConnection: async () => ({ ok: true }),
    testExecutionAgent: async () => ({ ok: true }),
    listExecutionModels: async () => ({ ok: true, models: [] }),
    ...overrides,
  };
}

describe('execution HTTP adapter probes', () => {
  it('forwards an agent test with the model only when one is chosen, returning the route value as-is', async () => {
    const bodies: unknown[] = [];
    const adapter = createExecutionHttpAdapter({ transport: transport({
      testExecutionAgent: async (input) => { bodies.push(input); return { ok: false, message: 'not signed in' }; },
    }) });
    const port = adapter.createPort();
    await expect(port.testAgent!('agent-a', 'model-x')).resolves.toEqual({ ok: false, message: 'not signed in' });
    await expect(port.testAgent!('agent-a')).resolves.toEqual({ ok: false, message: 'not signed in' });
    await expect(port.testAgent!('agent-a', '')).resolves.toEqual({ ok: false, message: 'not signed in' });
    expect(bodies).toEqual([{ agentId: 'agent-a', model: 'model-x' }, { agentId: 'agent-a' }, { agentId: 'agent-a' }]);
  });

  it('sends model discovery with opt-in credential flags and returns the listed models', async () => {
    const bodies: unknown[] = [];
    const adapter = createExecutionHttpAdapter({ transport: transport({
      listExecutionModels: async (input) => { bodies.push(input); return { ok: true, models: ['m1', 'm2'] }; },
    }) });
    for (const options of [{}, { useStoredCredential: true }, { useAdminStoredCredential: true }]) {
      await expect(adapter.createPort({}, options).listModels!(config)).resolves.toEqual(['m1', 'm2']);
    }
    const base = { protocol: 'openai', baseUrl: 'https://example.test', apiKey: '' };
    expect(bodies).toEqual([base, { ...base, useStoredCredential: true }, { ...base, useAdminStoredCredential: true }]);
  });

  it('rejects a failed discovery that carries no usable message with a generic one', async () => {
    for (const message of [undefined, '   ']) {
      const adapter = createExecutionHttpAdapter({ transport: transport({
        listExecutionModels: async () => ({ ok: false, models: [], ...(message === undefined ? {} : { message }) }),
      }) });
      await expect(adapter.createPort().listModels!(config)).rejects.toThrow('Model discovery failed');
    }
  });

  it('starts from a cold cache after resetDetectionCache, so the next mount probes again', async () => {
    let calls = 0;
    const adapter = createExecutionHttpAdapter({ transport: transport({
      detectExecutionAgents: async () => { calls += 1; return { data: [{ id: `agent-${calls}`, label: 'Agent', installed: true }] }; },
    }) });
    expect((await adapter.createPort().detectLocalAgents())[0]?.id).toBe('agent-1');
    expect((await adapter.createPort().detectLocalAgents())[0]?.id).toBe('agent-1');
    adapter.resetDetectionCache();
    expect((await adapter.createPort().detectLocalAgents())[0]?.id).toBe('agent-2');
    expect(calls).toBe(2);
  });
});
