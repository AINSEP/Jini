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

describe('execution HTTP adapter contracts', () => {
  it('shares an in-flight detection across mounts but isolates different host transports', async () => {
    let calls = 0;
    let finish!: (value: { data: [] }) => void;
    const pending = new Promise<{ data: [] }>((resolve) => { finish = resolve; });
    const adapter = createExecutionHttpAdapter({ transport: transport({
      detectExecutionAgents: () => { calls++; return pending; },
    }) }, {});
    const first = adapter.createPort({}, {}).detectLocalAgents();
    const second = adapter.createPort({}, {}).detectLocalAgents();
    expect(calls).toBe(1);
    const other = createExecutionHttpAdapter({ transport: transport({
      detectExecutionAgents: async () => { calls++; return { data: [] }; },
    }) }, {});
    await other.createPort({}, {}).detectLocalAgents();
    expect(calls).toBe(2);
    finish({ data: [] });
    expect(await first).toEqual([]);
    expect(await second).toEqual([]);
    await adapter.createPort({}, {}).rescanLocalAgents!();
    expect(calls).toBe(3);
  });

  it('does not let an older failed scan clear a newer successful rescan', async () => {
    let fail!: (reason: Error) => void;
    const pending = new Promise<{ data: [] }>((_resolve, reject) => { fail = reject; });
    let calls = 0;
    const adapter = createExecutionHttpAdapter({ transport: transport({
      detectExecutionAgents: () => ++calls === 1 ? pending : Promise.resolve({ data: [] }),
    }) }, {});
    const port = adapter.createPort({}, {});
    const first = port.detectLocalAgents();
    const rejection = expect(first).rejects.toThrow('scan unavailable');
    await port.rescanLocalAgents!();
    fail(new Error('scan unavailable'));
    await rejection;
    await port.detectLocalAgents();
    expect(calls).toBe(2);
  });

  it('keeps stored-site/admin probes opt-in and distinct in the outbound body', async () => {
    const bodies: unknown[] = [];
    const adapter = createExecutionHttpAdapter({ transport: transport({
      testExecutionConnection: async (input) => { bodies.push(input); return { ok: false, message: 'credentials rejected' }; },
    }) }, {});
    for (const options of [{}, { useStoredCredential: true }, { useAdminStoredCredential: true }]) {
      await expect(adapter.createPort({}, options).testConnection(config)).resolves.toEqual({ ok: false, message: 'credentials rejected' });
    }
    const base = { protocol: 'openai', baseUrl: 'https://example.test', apiKey: '', model: 'model' };
    expect(bodies).toEqual([base, { ...base, useStoredCredential: true }, { ...base, useAdminStoredCredential: true }]);
  });

  it('rejects malformed detection and failed model discovery with their exact errors', async () => {
    const adapter = createExecutionHttpAdapter({ transport: transport({
      detectExecutionAgents: async () => ({ data: null } as unknown as { data: [] }),
      listExecutionModels: async () => ({ ok: false, models: [], message: 'provider unavailable' }),
    }) }, {});
    const port = adapter.createPort({}, {});
    await expect(port.detectLocalAgents()).rejects.toThrow('detectExecutionAgents response missing data');
    await expect(port.listModels!(config)).rejects.toThrow('provider unavailable');
  });
});
