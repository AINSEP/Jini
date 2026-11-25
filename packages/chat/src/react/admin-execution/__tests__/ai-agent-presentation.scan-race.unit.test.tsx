import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { ExecutionCardAgent, ExecutionPort } from '@jini-ai/core/contracts/execution';
import { selectedAgentWarning } from '../ai-agent-presentation.js';
import { useAiAgentPresentation } from '../hooks/use-ai-agent-presentation.hooks.js';

afterEach(cleanup);

test('a slower detection cannot replace the newer rescan authentication state', async () => {
  const missing: ExecutionCardAgent = { id: 'local', label: 'Local CLI', installed: true, authStatus: 'missing' };
  let complete: (agents: readonly ExecutionCardAgent[]) => void = () => {};
  const slow = new Promise<readonly ExecutionCardAgent[]>(resolve => { complete = resolve; });
  const port: ExecutionPort = {
    detectLocalAgents: () => slow,
    rescanLocalAgents: async function () {
      expect(this).toBe(port);
      return [{ ...missing, authStatus: 'ok' }];
    },
    testConnection: async () => ({ ok: true }),
  };
  const { result } = renderHook(() => useAiAgentPresentation({
    port, config: { mode: 'local-cli', byok: { protocol: 'openai', providerId: null, baseUrl: '', apiKey: '', model: '' }, localCli: { agentId: null } },
    locale: 'en', desktop: true, defaultLocalAgentId: 'local',
    translate: ({ key }) => key, scopeKeys: { desktopKey: 'desktop', serverKey: 'server' },
  }));
  const initial = result.current.port.detectLocalAgents();
  const rescan = result.current.port.rescanLocalAgents;
  if (!rescan) throw new Error('missing rescan');
  await act(async () => { await rescan(); });
  expect(result.current.warning).toBeNull();
  await act(async () => { complete([missing]); await initial; });
  expect(result.current.warning).toBeNull();
  expect(result.current.scopeCopy).toBe('desktop');
});

test('unknown authentication is not a refusal', () => {
  const input = {
    mode: 'local-cli', agentId: 'local', locale: 'en', translate: ({ key }: { key: string }) => key,
    agents: [{ id: 'local', label: 'Local CLI', installed: true, authStatus: 'unknown' as const }],
  };
  expect(selectedAgentWarning(input)).toBeNull();
  expect(selectedAgentWarning({ ...input, agents: [{ ...input.agents[0], id: 'local', label: 'Local CLI', installed: true, authStatus: 'missing' }] }))
    .toBe('Local CLI: Authentication required. Sign in before sending.');
});
