/** Real executor/definition/session wiring with fake child processes; no subprocess or module mocks. */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { createAgentRuntimeState, getAgentDef, type RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createAgentExecutor } from '../index.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { fixtureModelDiscovery } from './model-discovery-fixture.js';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  signals: string[] = [];
  kill(signal: string) { this.killed = true; this.signals.push(signal); return true; }
}
afterEach(() => vi.useRealTimers());

/** Run through real launch composition and native protocol attachment with only OS effects replaced. */
async function startFixture(
  { agentId, hostEnv }: { agentId: 'codex' | 'pi'; hostEnv: NodeJS.ProcessEnv },
  policies: { codexDisablePlugins?: boolean; piGracefulShutdownMs?: number } = {},
) {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const child = new FakeChild();
  const calls: { args: readonly string[]; env: NodeJS.ProcessEnv | undefined }[] = [];
  const def: RuntimeAgentDef = { ...getAgentDef({ id: agentId })!, ...fixtureModelDiscovery };
  const executor = createAgentExecutor({ lifecycle }, {
    ...policies, hostEnv, runtimeState: createAgentRuntimeState({}),
    getAgentDef: () => def,
    resolveAgentLaunch: () => ({ selectedPath: '/fake/cli', pathResolvedPath: '/fake/cli',
      configuredOverridePath: null, launchPath: '/fake/cli', launchKind: 'selected', childPathPrepend: [], diagnostic: null }),
    applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {},
    spawn: ((_command: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ args, env: options.env });
      queueMicrotask(() => child.emit('spawn'));
      return child as unknown as ChildProcess;
    }) as typeof nodeSpawn,
  });
  const { run } = await lifecycle.start({ contextRef: 'host-policy' });
  await executor.run({ runId: run.id, agentId, prompt: 'question', cwd: '/missing-fixture-workspace' });
  return { child, calls };
}

it('passes explicit plugin policy through the executor instead of consulting ambient env in buildArgs', async () => {
  const hostEnv = { PATH: '/fake/bin', CODEX_DISABLE_PLUGINS: '1' };
  const baseline = await startFixture({ agentId: 'codex', hostEnv });
  const treatment = await startFixture({ agentId: 'codex', hostEnv }, { codexDisablePlugins: false });
  try {
    const args = baseline.calls[0]!.args;
    const i = args.indexOf('--disable');
    expect(args.slice(i, i + 2)).toEqual(['--disable', 'plugins']);
    expect(treatment.calls[0]!.args).toEqual([...args.slice(0, i), ...args.slice(i + 2)]);
    expect(baseline.calls[0]!.env).toEqual({ PATH: '/fake/bin' });
  } finally {
    baseline.child.emit('close', 0, null); treatment.child.emit('close', 0, null);
  }
});

it('carries host shutdown timing into the native pi session and keeps two executors independent', async () => {
  vi.useFakeTimers();
  const hostEnv = { PATH: '/fake/bin', PI_GRACEFUL_SHUTDOWN_MS: '100' };
  const baseline = await startFixture({ agentId: 'pi', hostEnv });
  const treatment = await startFixture({ agentId: 'pi', hostEnv }, { piGracefulShutdownMs: 700 });
  try {
    baseline.child.stdout.emit('data', '{"type":"agent_end"}\n');
    treatment.child.stdout.emit('data', '{"type":"agent_end"}\n');
    vi.advanceTimersByTime(99);
    expect(baseline.child.signals).toEqual([]); expect(treatment.child.signals).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(baseline.child.signals).toEqual(['SIGTERM']); expect(treatment.child.signals).toEqual([]);
    vi.advanceTimersByTime(600);
    expect(treatment.child.signals).toEqual(['SIGTERM']);
    expect(treatment.calls[0]!.env).toEqual({ PATH: '/fake/bin' });
  } finally {
    baseline.child.emit('close', 0, null); treatment.child.emit('close', 0, null);
  }
});
