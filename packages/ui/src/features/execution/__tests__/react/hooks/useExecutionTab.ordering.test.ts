import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionPort } from '../../../ports.js';
import type { ByokConfig, DetectedAgent } from '../../../types.js';
import { useExecutionTab } from '../../../react/hooks/useExecutionTab.js';

afterEach(cleanup);

/**
 * @file Ordering and fallback contract for `useExecutionTab`'s async edges: every edge (detection,
 * rescan, connection test, agent test, model discovery) must let ONLY its newest call write state,
 * on both the resolve and the reject side, and each must word a bare non-`Error` rejection or a
 * message-less failure honestly.
 */

interface Deferred<T> { resolve: (value: T) => void; reject: (error: unknown) => void }

/** A port fake whose every call parks a deferred the test settles in whatever order it chooses. */
function createDeferredPort() {
  const detect: Deferred<readonly DetectedAgent[]>[] = [];
  const rescan: Deferred<readonly DetectedAgent[]>[] = [];
  const connection: Deferred<{ ok: boolean; message?: string }>[] = [];
  const agent: Deferred<{ ok: boolean; message?: string }>[] = [];
  const models: Deferred<readonly string[]>[] = [];
  const park = <T,>(queue: Deferred<T>[]) => new Promise<T>((resolve, reject) => { queue.push({ resolve, reject }); });
  const port: ExecutionPort = {
    detectLocalAgents: () => park(detect),
    rescanLocalAgents: () => park(rescan),
    testConnection: () => park(connection),
    testAgent: () => park(agent),
    listModels: () => park(models),
  };
  return { port, detect, rescan, connection, agent, models };
}

const byok: ByokConfig = { protocol: 'openai', providerId: null, apiKey: 'typed', baseUrl: 'https://example.test', model: 'model-a' };
const agentA: DetectedAgent = { id: 'agent-a', label: 'Agent A', installed: true };
const agentB: DetectedAgent = { id: 'agent-b', label: 'Agent B', installed: false };

describe('useExecutionTab rescan', () => {
  it('runs the port rescan and replaces agents, dropping the superseded mount-time detection result', async () => {
    const fake = createDeferredPort();
    const { result } = renderHook(() => useExecutionTab({ port: fake.port }));
    expect(result.current.canRescan).toBe(true);
    expect(fake.detect).toHaveLength(1);

    act(() => { result.current.rescan(); });
    expect(fake.rescan).toHaveLength(1);
    expect(result.current.scan).toEqual({ status: 'scanning' });

    await act(async () => { fake.rescan[0]!.resolve([agentA, agentB]); });
    expect(result.current.scan).toEqual({ status: 'ok', count: 1 });

    await act(async () => { fake.detect[0]!.resolve([agentB]); });
    expect(result.current.agents.map((agent) => agent.id)).toEqual(['agent-a', 'agent-b']);
  });

  it('ignores a superseded detection rejection', async () => {
    const fake = createDeferredPort();
    const { result } = renderHook(() => useExecutionTab({ port: fake.port }));
    act(() => { result.current.rescan(); });
    await act(async () => { fake.rescan[0]!.resolve([agentA]); });
    await act(async () => { fake.detect[0]!.reject(new Error('stale failure')); });
    expect(result.current.scan).toEqual({ status: 'ok', count: 1 });
  });

  it('is a no-op when the port declares no rescan support', () => {
    const fake = createDeferredPort();
    const { rescanLocalAgents: _omit, ...port } = fake.port;
    const { result } = renderHook(() => useExecutionTab({ port, autoDetect: false }));
    expect(result.current.canRescan).toBe(false);
    act(() => { result.current.rescan(); });
    expect(result.current.scan).toEqual({ status: 'idle' });
  });

  it('describes a non-Error detection rejection by its string form', async () => {
    const fake = createDeferredPort();
    const { result } = renderHook(() => useExecutionTab({ port: fake.port }));
    await act(async () => { fake.detect[0]!.reject('daemon offline'); });
    expect(result.current.scan).toEqual({ status: 'error', message: 'daemon offline' });
  });
});

describe('useExecutionTab connection test', () => {
  it('falls back to a generic message for a failure without one', async () => {
    const fake = createDeferredPort();
    const { result } = renderHook(() => useExecutionTab({ port: fake.port, autoDetect: false }));
    act(() => { result.current.testConnection(byok); });
    expect(result.current.connectionTest).toEqual({ status: 'testing' });
    await act(async () => { fake.connection[0]!.resolve({ ok: false }); });
    expect(result.current.connectionTest).toEqual({ status: 'error', message: 'Connection failed' });
  });

  it('only lets the newest test write state, on both the resolve and reject side', async () => {
    const fake = createDeferredPort();
    const { result } = renderHook(() => useExecutionTab({ port: fake.port, autoDetect: false }));
    act(() => { result.current.testConnection(byok); });
    act(() => { result.current.testConnection(byok); });
    act(() => { result.current.testConnection(byok); });
    await act(async () => { fake.connection[2]!.resolve({ ok: true, message: 'newest ok' }); });
    await act(async () => { fake.connection[0]!.resolve({ ok: false, message: 'stale failure' }); });
    await act(async () => { fake.connection[1]!.reject(new Error('stale rejection')); });
    expect(result.current.connectionTest).toEqual({ status: 'ok', message: 'newest ok' });
  });
});

describe('useExecutionTab agent test', () => {
  it('is a no-op when the port declares no agent test support', () => {
    const fake = createDeferredPort();
    const { testAgent: _omit, ...port } = fake.port;
    const { result } = renderHook(() => useExecutionTab({ port, autoDetect: false }));
    expect(result.current.canTestAgent).toBe(false);
    act(() => { result.current.testAgent('agent-a'); });
    expect(result.current.agentTest).toEqual({ status: 'idle' });
  });

  it('falls back to a generic message for a failure without one, scoped to the agent tested', async () => {
    const fake = createDeferredPort();
    const { result } = renderHook(() => useExecutionTab({ port: fake.port, autoDetect: false }));
    act(() => { result.current.testAgent('agent-a', 'model-x'); });
    expect(result.current.agentTest).toEqual({ status: 'testing', agentId: 'agent-a' });
    await act(async () => { fake.agent[0]!.resolve({ ok: false }); });
    expect(result.current.agentTest).toEqual({ status: 'error', agentId: 'agent-a', message: 'Agent check failed' });
  });

  it('reports a rejection by its message and ignores a superseded rejection', async () => {
    const fake = createDeferredPort();
    const { result } = renderHook(() => useExecutionTab({ port: fake.port, autoDetect: false }));
    act(() => { result.current.testAgent('agent-a'); });
    act(() => { result.current.testAgent('agent-b'); });
    await act(async () => { fake.agent[1]!.reject(new Error('binary missing')); });
    expect(result.current.agentTest).toEqual({ status: 'error', agentId: 'agent-b', message: 'binary missing' });
    await act(async () => { fake.agent[0]!.reject(new Error('stale')); });
    expect(result.current.agentTest).toEqual({ status: 'error', agentId: 'agent-b', message: 'binary missing' });
  });
});

describe('useExecutionTab model discovery', () => {
  it('ignores a superseded discovery rejection', async () => {
    const fake = createDeferredPort();
    const { result } = renderHook(() => useExecutionTab({ port: fake.port, autoDetect: false }));
    act(() => { result.current.loadModels(byok); });
    act(() => { result.current.loadModels({ ...byok, model: 'model-b' }); });
    await act(async () => { fake.models[1]!.resolve(['model-b']); });
    await act(async () => { fake.models[0]!.reject(new Error('stale')); });
    expect(result.current.modelDiscovery).toEqual({ status: 'ok', models: ['model-b'] });
  });
});
