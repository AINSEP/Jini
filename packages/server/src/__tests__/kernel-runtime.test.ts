/** The shipped kernel composition owns runtime state and uses it for real executor argument binding. */
import type { spawn as nodeSpawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { getAgentDef } from '@jini-ai/agent-runtime';
import { createJiniKernelBase } from '../kernel-base.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeAgentRuntime } from '@jini-ai/agent-runtime';
import { createLocalNodeDaemon } from '../create-local-node-daemon.js';

it('gives each kernel a separate state, shares it with its executor, and clears it on close', async () => {
  const def = getAgentDef({ id: 'codex' })!;
  const makeBase = () => {
    const captured: string[][] = [];
    return { captured, boot: createJiniKernelBase({ storage: { kind: 'memory' }, agentExecutor: {
      hostEnv: { PATH: '/fake/bin' }, codexDisablePlugins: true,
      getAgentDef: () => ({ ...def, buildArgs: (_required, { options } = {}) =>
        options?.capabilities?.hostFlag ? ['--host-flag'] : [] }),
      resolveAgentLaunch: () => ({ selectedPath: '/fake/cli', pathResolvedPath: '/fake/cli', configuredOverridePath: null,
        launchPath: '/fake/cli', launchKind: 'selected', childPathPrepend: [], diagnostic: null }),
      resolveModelForLaunch: async () => ({ model: 'fixture-model',
        resolution: { status: 'resolved', id: 'fixture-model', source: 'rpc', resolvedAt: '2026-10-13T00:00:00.000Z', launchFingerprint: 'fixture' },
        catalog: { models: [{ id: 'fixture-model', label: 'fixture-model', identityKind: 'concrete' }], source: 'rpc', freshness: 'fresh', fetchedAt: '2026-10-13T00:00:00.000Z', expiresAt: '2026-10-13T01:00:00.000Z', coverage: 'account', launchFingerprint: 'fixture', diagnostics: [] },
      }),
      applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {},
      spawn: ((_command: string, argv: readonly string[]) => { captured.push([...argv]); throw new Error('fixture spawn stop'); }) as unknown as typeof nodeSpawn,
    } }) };
  };
  const aFixture = makeBase(); const bFixture = makeBase();
  const a = await aFixture.boot; const b = await bFixture.boot;
  try {
    expect(a.agentRuntime.state).not.toBe(b.agentRuntime.state);
    a.agentRuntime.state.capabilities.set('codex', { hostFlag: true });
    b.agentRuntime.state.capabilities.set('codex', { hostFlag: false });
    const aRun = await a.lifecycle.start({ contextRef: 'kernel-a' });
    const bRun = await b.lifecycle.start({ contextRef: 'kernel-b' });
    await expect(a.agentExecutor.run({ runId: aRun.run.id, agentId: 'codex', prompt: 'question', cwd: '/work' })).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    await expect(b.agentExecutor.run({ runId: bRun.run.id, agentId: 'codex', prompt: 'question', cwd: '/work' })).rejects.toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
    expect(aFixture.captured).toEqual([['--host-flag']]);
    expect(bFixture.captured).toEqual([[]]);
    await a.close();
    expect(a.agentRuntime.state.capabilities.size).toBe(0);
    expect(b.agentRuntime.state.capabilities.get('codex')).toEqual({ hostFlag: false });
  } finally { await Promise.all([a.close(), b.close()]); }
});


it('forwards explicit executor options through the local preset and disposes its supplied state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jini-runtime-preset-'));
  const env = { PATH: '/fake/bin', JINI_DISABLE_API_AUTH: '1' };
  const runtime = createNativeAgentRuntime({ env });
  runtime.state.capabilities.set('owned', { feature: true });
  let lookups = 0;
  const daemon = await createLocalNodeDaemon({ dataDir: dir, packs: [], discoveryFile: false, env,
    open: (file, settings = {}) => new Database(file, settings),
    agentExecutor: { runtimeState: runtime.state, getAgentDef: () => { lookups++; return null; } },
    resolveRunInput: () => ({ agentId: 'host-only-fixture', prompt: 'question', cwd: '/work' }),
  });
  try {
    const response = await fetch(`${daemon.url}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextRef: 'preset-owned-runtime', agentId: 'host-only-fixture' }),
    });
    // The default run handler waits for the real executor's pre-spawn failure; no process launches.
    await response.text();
    expect(lookups).toBe(1);
    await daemon.stop();
    expect(runtime.state.capabilities.size).toBe(0);
  } finally {
    await daemon.stop();
    await runtime.dispose({});
    rmSync(dir, { recursive: true, force: true });
  }
});
