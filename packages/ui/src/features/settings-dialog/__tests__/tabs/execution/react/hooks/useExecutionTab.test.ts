import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeExecutionPort } from '../../../../../tabs/execution/dependencies.js';
import { useExecutionTab } from '../../../../../tabs/execution/react/hooks/useExecutionTab.js';
import type { ByokConfig } from '../../../../../tabs/execution/types.js';

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
