import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { createCommandInvocation } from '@jini-ai/platform/command';
import { getAgentDef, type RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { expect, it, vi } from 'vitest';
import { createAgentExecutor } from '../index.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { fixtureLaunchModel, fixtureModelDiscovery } from './model-discovery-fixture.js';

/** Runs the real executor and vendor argv/config writers with only process launch replaced.
 * Packaged CLI consumption remains a cloud gate; this fixture makes no version claim. */
async function launch(vendor: 'claude' | 'codex' | 'opencode', failHttp = false, failure?: 'sync-spawn' | 'async-spawn' | 'invocation') {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null, signalCode: null, pid: 56789 });
  const definition: RuntimeAgentDef & { mcpHttp: boolean } = { ...getAgentDef({ id: vendor })!, ...fixtureModelDiscovery, mcpHttp: true };
  const endpointClose = vi.fn(async () => {});
  const prepareHttp = vi.fn(async () => {
    if (failHttp) throw new Error('listener did not bind');
    return { url: 'http://127.0.0.1:12345/mcp', token: 'endpoint-only', close: endpointClose };
  });
  const mint = vi.fn(() => 'callback-only');
  const probe = vi.fn(async () => ({ ok: true as const, exitCode: 0, signal: null, stderrTail: '', elapsedMs: 1 }));
  let argv: readonly string[] = [];
  let environment: NodeJS.ProcessEnv = {};
  let config = '';
  const spawn = vi.fn((_command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
    argv = args; environment = options.env;
    if (failure === 'sync-spawn') throw new Error('spawn failed');
    queueMicrotask(() => failure === 'async-spawn' ? child.emit('error', new Error('spawn failed')) : child.emit('spawn'));
    return child as unknown as ChildProcess;
  });
  const executor = createAgentExecutor({ lifecycle }, { getAgentDef: () => definition, hostEnv: {},
    resolveAgentLaunch: () => ({ selectedPath: '/fixture', pathResolvedPath: '/fixture', configuredOverridePath: null,
      launchPath: '/fixture', launchKind: 'selected', childPathPrepend: [], diagnostic: null }),
    applyAgentLaunchEnv: ({ env }) => env, ensureAgentCapabilities: async () => {}, resolveModelForLaunch: fixtureLaunchModel,
    spawn: spawn as unknown as typeof nodeSpawn, probeMcpBridge: probe,
    createCommandInvocation: input => { if (failure === 'invocation') throw new Error('invocation failed'); return createCommandInvocation(input); },
    listProcessSnapshots: async () => [], collectProcessTreePids: () => [],
    stopProcesses: async () => ({ alreadyStopped: false, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] }),
    mcpJsonInjection: { command: 'node', args: ['serve.js'], daemonUrl: 'http://daemon.invalid', credential: mint, prepareHttp,
      readFile: async () => '', writeFile: async ({ content }) => { config = content; },
      mkdtemp: async () => '/fixture-codex-home', removeDir: async () => {}, linkSessionStore: async () => {},
      removeFile: async () => {},
    },
  });
  const { run } = await lifecycle.start({ contextRef: 'http-launch' });
  const runError: unknown = await executor.run({ runId: run.id, agentId: vendor, cwd: '/fixture', prompt: 'Hello' }, { permissionMode: 'bypass' }).then(() => undefined, error => error);
  if (!failure) expect(runError).toBeUndefined();
  return { runError, child, lifecycle, runId: run.id, prepareHttp, mint, spawn, probe, endpointClose, argv, environment, config,
    finish: async () => { child.emit('close', 1, null); await lifecycle.waitForTerminal({ runId: run.id }); } };
}

it.each(['claude', 'codex', 'opencode'] as const)('HTTP %s launch contains no serve child configuration', async vendor => {
  const f = await launch(vendor);
  let claudePath: string | undefined;
  try {
    const pathIndex = f.argv.indexOf('--mcp-config');
    if (vendor === 'claude') {
      claudePath = f.argv[pathIndex + 1];
      expect(f.argv).toContain('--strict-mcp-config');
      expect(await readFile(claudePath!, 'utf8')).toContain('Bearer endpoint-only');
    }
    if (vendor === 'codex') {
      expect(f.environment.CODEX_HOME).toBe('/fixture-codex-home');
      expect(f.config).toContain('url = "http://127.0.0.1:12345/mcp"');
      expect(f.config).toContain('tool_timeout_sec = 400');
    }
    if (vendor === 'opencode') {
      expect(JSON.parse(f.environment.OPENCODE_CONFIG_CONTENT!).mcp.jini).toEqual({ type: 'remote', url: 'http://127.0.0.1:12345/mcp', headers: { Authorization: 'Bearer endpoint-only' } });
    }
    expect(JSON.stringify([f.argv, f.environment, f.config])).not.toContain('serve.js');
    expect(JSON.stringify(f.argv)).not.toContain('endpoint-only');
    expect(f.mint).not.toHaveBeenCalled();
    expect(f.prepareHttp).toHaveBeenCalledTimes(1);
    expect(f.spawn).toHaveBeenCalledTimes(1);
  } finally { await f.finish(); }
  expect(f.endpointClose).toHaveBeenCalledTimes(1);
  if (claudePath) await expect(access(claudePath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('prelaunch HTTP failure selects stdio once through the real executor', async () => {
  const f = await launch('opencode', true);
  try {
    expect(JSON.parse(f.environment.OPENCODE_CONFIG_CONTENT!).mcp.jini.type).toBe('local');
    expect(f.environment.OPENCODE_CONFIG_CONTENT).toContain('serve.js');
    expect(f.mint).toHaveBeenCalledTimes(1);
    expect(f.prepareHttp).toHaveBeenCalledTimes(1);
    expect(f.spawn).toHaveBeenCalledTimes(1);
  } finally { await f.finish(); }
});

it('postlaunch failure never respawns or replays and HTTP diagnostics never spawn stdio', async () => {
  const f = await launch('claude');
  try {
    f.child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'jini', status: 'failed' }] }) + '\n'));
    await vi.waitFor(() => expect(f.lifecycle.get({ runId: f.runId })).resolves.toMatchObject({ state: 'running' }));
  } finally { await f.finish(); }
  expect(f.probe).not.toHaveBeenCalled();
  expect(f.spawn).toHaveBeenCalledTimes(1);
  expect(f.prepareHttp).toHaveBeenCalledTimes(1);
  const events: unknown[] = [];
  const stream = await f.lifecycle.stream({ runId: f.runId, onEvent: event => events.push(event) });
  if (stream.kind === 'ok') stream.unsubscribe();
  expect(JSON.stringify(events)).toContain('MCP_BRIDGE_UNAVAILABLE');
});

it.each(['sync-spawn', 'async-spawn', 'invocation'] as const)('launch failure releases HTTP credentials and endpoint: %s', async failure => {
  const f = await launch('claude', false, failure);
  expect(f.runError).toMatchObject({ code: 'AGENT_SPAWN_FAILED' });
  expect(f.endpointClose).toHaveBeenCalledTimes(1);
  expect(f.prepareHttp).toHaveBeenCalledTimes(1);
  expect(f.probe).not.toHaveBeenCalled();
  expect((await f.lifecycle.get({ runId: f.runId }))?.state).toBe('failed');
});
