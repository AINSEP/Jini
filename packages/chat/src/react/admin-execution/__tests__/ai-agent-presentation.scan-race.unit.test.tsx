import { act, cleanup, renderHook } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, test } from 'vitest';
import type { ExecutionCardAgent, ExecutionPort } from '@jini-ai/core/contracts/execution';
import { createAgentPresentationPort, localCliScopeCopy, normalizeAgentDescription, selectedAgentWarning } from '../ai-agent-presentation.js';
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

test('a server-hosted surface uses the server scope copy', () => {
  expect(localCliScopeCopy({ desktop: false, desktopKey: 'desktop', serverKey: 'server' })).toBe('server');
});

test('trims a provided description, keeps an empty one empty, and leaves an absent one absent', () => {
  const base: ExecutionCardAgent = { id: 'a', label: 'A', installed: true, authStatus: 'ok' };
  expect(normalizeAgentDescription({ agent: { ...base, description: '  Fast local agent  ' } }).description).toBe('Fast local agent');
  expect(normalizeAgentDescription({ agent: { ...base, description: '   ' } }).description).toBe('');
  expect(normalizeAgentDescription({ agent: base })).toBe(base);
});

test('a port without a rescan gains no rescan, and detection still reports normalized agents', async () => {
  const reported: (readonly ExecutionCardAgent[])[] = [];
  const port: ExecutionPort = {
    detectLocalAgents: async () => [{ id: 'a', label: 'A', installed: true, authStatus: 'ok', description: ' d ' }],
    testConnection: async () => ({ ok: true }),
  };
  const wrapped = createAgentPresentationPort({ port, onAgents: ({ agents }) => { reported.push(agents); } });
  expect('rescanLocalAgents' in wrapped).toBe(false);
  expect(await wrapped.detectLocalAgents()).toEqual([{ id: 'a', label: 'A', installed: true, authStatus: 'ok', description: 'd' }]);
  expect(reported).toEqual([[{ id: 'a', label: 'A', installed: true, authStatus: 'ok', description: 'd' }]]);
});

test('with no saved config there is no warning, even for a default agent that is signed out', async () => {
  const missing: ExecutionCardAgent = { id: 'local', label: 'Local CLI', installed: true, authStatus: 'missing' };
  const port: ExecutionPort = { detectLocalAgents: async () => [missing], testConnection: async () => ({ ok: true }) };
  const { result } = renderHook(() => useAiAgentPresentation({
    port, config: null, locale: 'en', desktop: false, defaultLocalAgentId: 'local',
    translate: ({ key }) => key, scopeKeys: { desktopKey: 'desktop', serverKey: 'server' },
  }));
  await act(async () => { await result.current.port.detectLocalAgents(); });
  expect(result.current.warning).toBeNull();
  expect(result.current.scopeCopy).toBe('server');
});

test('a rescan that reports the same agents again commits nothing new, while a changed report does', async () => {
  // Every scan returns a fresh array; only its content decides whether Settings re-commits.
  let report: ExecutionCardAgent[] = [{ id: 'local', label: 'Local CLI', installed: true, authStatus: 'ok' }];
  const port: ExecutionPort = { detectLocalAgents: async () => report.map(agent => ({ ...agent })), testConnection: async () => ({ ok: true }) };
  let commits = 0;
  const { result } = renderHook(() => {
    const presentation = useAiAgentPresentation({
      port, config: { mode: 'local-cli', byok: { protocol: 'openai', providerId: null, baseUrl: '', apiKey: '', model: '' }, localCli: { agentId: 'local' } },
      locale: 'en', desktop: true, defaultLocalAgentId: 'local',
      translate: ({ key }) => key, scopeKeys: { desktopKey: 'desktop', serverKey: 'server' },
    });
    useEffect(() => { commits += 1; });
    return presentation;
  });
  expect(commits).toBe(1);
  await act(async () => { await result.current.port.detectLocalAgents(); });
  expect(commits).toBe(2);
  await act(async () => { await result.current.port.detectLocalAgents(); });
  expect(commits).toBe(2);
  expect(result.current.warning).toBeNull();
  report = [{ id: 'local', label: 'Local CLI', installed: true, authStatus: 'missing' }];
  await act(async () => { await result.current.port.detectLocalAgents(); });
  expect(commits).toBe(3);
  expect(result.current.warning).toBe('Local CLI: Authentication required. Sign in before sending.');
});
