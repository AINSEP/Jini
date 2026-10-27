import { expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { createAgentExecutor } from '../index.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { fixtureModelDiscovery } from './model-discovery-fixture.js';

// The transport and reported dollars are identical; only adapter metadata changes.
// A renamed adapter must retain its cost semantics without a vendor-id branch.
for (const id of ['third-party', 'claude']) for (const basis of ['session', 'run', undefined] as const) {
  it(`uses ${basis ?? 'default run'} cost basis for ${id}`, async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const def: RuntimeAgentDef = {
      ...fixtureModelDiscovery, id, name: 'Fixture', bin: 'fixture', versionArgs: [], fallbackModels: [],
      streamFormat: 'claude-stream-json', promptViaStdin: true,
      ...(basis === undefined ? {} : { usageCostBasis: basis }),
      buildArgs: (_required, { options = {} } = {}) => ['--model', options.model!],
    };
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null,
    });
    const spawn = (() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ChildProcess; }) as typeof nodeSpawn;
    const executor = createAgentExecutor({ lifecycle }, {
      getAgentDef: () => def,
      resolveAgentLaunch: () => ({ selectedPath: '/fixture', pathResolvedPath: '/fixture', configuredOverridePath: null, launchPath: '/fixture', launchKind: 'selected', childPathPrepend: [], diagnostic: null }),
      ensureAgentCapabilities: async () => {}, applyAgentLaunchEnv: ({ env }) => env, spawn,
    });
    const { run } = await lifecycle.start({ contextRef: 'cost-basis-fixture' });
    await executor.run({ runId: run.id, agentId: id, cwd: '/workspace', prompt: 'hello' });
    child.stdout.emit('data', JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fixture-session', tools: [] }) + '\n');
    child.stdout.emit('data', JSON.stringify({ type: 'result', total_cost_usd: 2.5, duration_ms: 100, stop_reason: 'end_turn' }) + '\n');
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal({ runId: run.id });
    const usage: unknown[] = [];
    await lifecycle.stream({ runId: run.id, onEvent: event => {
      if (event.kind === 'agent' && event.payload.type === 'usage') usage.push(event.payload);
    } });
    expect(usage).toEqual([basis === 'session'
      ? { type: 'usage', cumulativeCostUsd: 2.5, costSessionId: 'fixture-session', durationMs: 100, stopReason: 'end_turn' }
      : { type: 'usage', costUsd: 2.5, durationMs: 100, stopReason: 'end_turn' }]);
  });
}
