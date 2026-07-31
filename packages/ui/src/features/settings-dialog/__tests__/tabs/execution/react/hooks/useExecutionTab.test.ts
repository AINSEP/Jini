import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeExecutionPort } from '@jini-ai/ui-core';
import { useExecutionTab } from '../../../../../tabs/execution/react/hooks/useExecutionTab.js';
import type { ByokConfig } from '@jini-ai/ui-core';

/**
 * @file Error-reporting contract coverage (`ADS-memory/governance/contracts/error-reporting.md`)
 * for `useExecutionTab`'s async edges. The canonical bug this guards against: a rejected
 * `listModels`/`detectLocalAgents` call must land in a distinct `'error'` state, never collapse
 * into the SAME resolved-empty-value shape a legitimate "found nothing" would produce.
 */

const byok: ByokConfig = {
  protocol: 'anthropic',
  providerId: 'anthropic',
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com',
  model: 'example-model',
};

describe('useExecutionTab — modelDiscovery', () => {
  it('starts idle and transitions to ok with the resolved models', async () => {
    const port = createFakeExecutionPort({ models: ['model-a', 'model-b'] });
    const { result } = renderHook(() => useExecutionTab({ port, autoDetect: false }));
    expect(result.current.modelDiscovery).toEqual({ status: 'idle' });

    result.current.loadModels(byok);
    await waitFor(() => expect(result.current.modelDiscovery.status).toBe('ok'));
    expect(result.current.modelDiscovery).toEqual({ status: 'ok', models: ['model-a', 'model-b'] });
  });

  it('a rejected listModels lands in a distinct error state, not an empty ok', async () => {
    const port = createFakeExecutionPort({ modelsError: 'invalid API key' });
    const { result } = renderHook(() => useExecutionTab({ port, autoDetect: false }));

    result.current.loadModels(byok);
    await waitFor(() => expect(result.current.modelDiscovery.status).toBe('error'));
    expect(result.current.modelDiscovery).toEqual({ status: 'error', message: 'invalid API key' });
    // The failure-distinguishability property itself: an 'error' status can never be mistaken
    // for 'ok' with an empty list — the two carry different fields entirely.
    expect(result.current.modelDiscovery).not.toMatchObject({ status: 'ok' });
  });

  it('is a no-op when the port declares no listModels support', async () => {
    const { listModels: _omit, ...noListModelsPort } = createFakeExecutionPort();
    const { result } = renderHook(() => useExecutionTab({ port: noListModelsPort, autoDetect: false }));

    result.current.loadModels(byok);
    // Give any accidental async work a tick, then confirm state never left idle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.modelDiscovery).toEqual({ status: 'idle' });
  });
});

describe('useExecutionTab — agent detection', () => {
  it('a rejected detectLocalAgents lands in a distinct error scan state, not an empty ok', async () => {
    const port = createFakeExecutionPort({ agentsError: 'daemon unreachable' });
    const { result } = renderHook(() => useExecutionTab({ port, autoDetect: true }));

    await waitFor(() => expect(result.current.scan.status).toBe('error'));
    expect(result.current.scan).toEqual({ status: 'error', message: 'daemon unreachable' });
    expect(result.current.agents).toEqual([]);
  });
});

/**
 * Ordering guards. Every async edge here can be re-launched before the previous
 * call settles (switch provider mid-discovery, click Test twice, rescan during
 * a scan), and responses are not guaranteed to come back in send order. A
 * slower FIRST response must never overwrite a newer one — otherwise the form
 * shows one provider's models under another, or a stale failure hides a fresh
 * success.
 */
describe('useExecutionTab — stale responses', () => {
  /** A port whose `listModels` resolves whatever the caller queues, in the
   *  order the TEST chooses rather than call order. */
  function outOfOrderPort() {
    const pending: Array<(models: readonly string[]) => void> = [];
    return {
      pending,
      port: {
        detectLocalAgents: () => Promise.resolve([]),
        testConnection: () => Promise.resolve({ ok: true }),
        listModels: () =>
          new Promise<readonly string[]>((resolve) => {
            pending.push(resolve);
          }),
      },
    };
  }

  it('ignores an earlier model-discovery response that lands last', async () => {
    const { pending, port } = outOfOrderPort();
    const { result } = renderHook(() => useExecutionTab({ port, autoDetect: false }));

    result.current.loadModels({ ...byok, providerId: 'provider-a' });
    result.current.loadModels({ ...byok, providerId: 'provider-b' });
    await waitFor(() => expect(pending).toHaveLength(2));

    // B (the newer request) answers first, then A's slow response arrives.
    pending[1]!(['b-model']);
    await waitFor(() => expect(result.current.modelDiscovery.status).toBe('ok'));
    pending[0]!(['a-model']);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.modelDiscovery).toEqual({ status: 'ok', models: ['b-model'] });
  });

  it('ignores a superseded agent test result', async () => {
    const settle: Array<(r: { ok: boolean; message?: string }) => void> = [];
    const port = {
      detectLocalAgents: () => Promise.resolve([]),
      testConnection: () => Promise.resolve({ ok: true }),
      testAgent: () =>
        new Promise<{ ok: boolean; message?: string }>((resolve) => {
          settle.push(resolve);
        }),
    };
    const { result } = renderHook(() => useExecutionTab({ port, autoDetect: false }));

    result.current.testAgent('agent-a');
    result.current.testAgent('agent-b');
    await waitFor(() => expect(settle).toHaveLength(2));

    settle[1]!({ ok: true, message: 'b ready' });
    await waitFor(() => expect(result.current.agentTest.status).toBe('ok'));
    settle[0]!({ ok: false, message: 'a failed' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.agentTest).toMatchObject({ status: 'ok', agentId: 'agent-b' });
  });
});
