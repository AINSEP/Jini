import { access } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { getAgentDef, type RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { buildMcpBridgeDelivery } from '../mcp-bridge.js';
import { prepareHttpMcpForRun } from '../http-mcp.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { createInMemoryEventLog } from '../../event-log.js';

const def: RuntimeAgentDef & { mcpHttp?: boolean } = { id: 'opencode', name: 'Fixture', bin: 'fixture', versionArgs: [], fallbackModels: [],
  streamFormat: 'json-event-stream', buildArgs: () => [], externalMcpInjection: 'opencode-env-content', mcpHttp: true };
const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
afterEach(() => warn.mockClear());

async function fixture(prepareHttp: NonNullable<import('../contracts.js').McpJsonInjectionOptions['prepareHttp']>, runtime = def, httpPolicy?: 'required') {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'http' });
  const prepared = await prepareHttpMcpForRun({ runId: run.id, cwd: '/fixture', def: runtime, lifecycle,
    injection: { command: 'stdio-fallback', daemonUrl: 'http://daemon.invalid', prepareHttp, ...(httpPolicy ? { httpPolicy } : {}) } });
  return { prepared, lifecycle, runId: run.id };
}

it('prelaunch HTTP failure selects stdio once', async () => {
  const prepare = vi.fn(async () => { throw new Error('bind failed with secret'); });
  const f = await fixture(prepare);
  expect(f.prepared).toBeNull();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith('[agent-executor] MCP HTTP listener unavailable; using stdio');
  expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  await f.lifecycle.finish({ runId: f.runId, status: 'failed', code: 1, signal: null, resumable: false });
});

it('unsupported CLIs never open an HTTP endpoint', async () => {
  const prepare = vi.fn();
  const { mcpHttp: _removed, ...unsupported } = def;
  const f = await fixture(prepare, unsupported);
  expect(f.prepared).toBeNull();
  expect(prepare).not.toHaveBeenCalled();
  await f.lifecycle.finish({ runId: f.runId, status: 'succeeded', code: 0, signal: null, resumable: false });
});

it.each(['succeeded', 'failed', 'cancelled'] as const)('all exit paths close the run endpoint: %s', async status => {
  const close = vi.fn(async () => {});
  const f = await fixture(async () => ({ url: 'http://127.0.0.1:1234/mcp', token: 'listener', close }));
  expect(f.prepared?.endpoint.token).toBe('listener');
  await f.lifecycle.finish({ runId: f.runId, status, code: 0, signal: null, resumable: false });
  await f.prepared?.cleanup();
  await f.prepared?.cleanup();
  expect(close).toHaveBeenCalledTimes(1);
});

it('cancellation closes admission before the CLI exits', async () => {
  const close = vi.fn(async () => {});
  const f = await fixture(async () => ({ url: 'http://127.0.0.1:1234/mcp', token: 'listener', close }));
  await f.lifecycle.cancel({ runId: f.runId, reason: 'user' });
  expect(close).toHaveBeenCalledTimes(1);
  await f.prepared?.cleanup();
  await f.lifecycle.finish({ runId: f.runId, status: 'cancelled', code: null, signal: null, resumable: false });
});

it('terminal cleanup removes private Claude capability files even while CLI pipes remain open', async () => {
  const close = vi.fn(async () => {});
  const f = await fixture(async () => ({ url: 'http://127.0.0.1:1234/mcp', token: 'listener', close }),
    { ...def, id: 'claude', externalMcpInjection: 'claude-mcp-json', mcpHttp: true } as RuntimeAgentDef & { mcpHttp: boolean });
  const path = f.prepared!.mcpJsonPath!;
  await access(path);
  await f.lifecycle.finish({ runId: f.runId, status: 'failed', code: 1, signal: null, resumable: false });
  await vi.waitFor(() => expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' }));
  expect(close).toHaveBeenCalledTimes(1);
  await f.prepared!.cleanup();
});

it('agy keeps stdio and Aider creates no MCP host', async () => {
  for (const id of ['antigravity', 'aider']) {
    const runtime = getAgentDef({ id })!;
    const prepare = vi.fn();
    const f = await fixture(prepare, runtime);
    expect(f.prepared).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
    const delivery = buildMcpBridgeDelivery({ cwd: '/fixture', runId: f.runId, strategy: runtime.externalMcpInjection,
      options: { command: 'stdio', daemonUrl: 'http://daemon.invalid' }, credential: 'run-callback' });
    expect(delivery?.kind ?? null).toBe(id === 'antigravity' ? 'env-passthrough' : null);
    await f.lifecycle.finish({ runId: f.runId, status: 'succeeded', code: 0, signal: null, resumable: false });
  }
});


it.each(['missing preparation', 'unsupported runtime', 'listener failure'])('required HTTP refuses stdio fallback: %s', async scenario => {
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'required-http' });
  const prepare = vi.fn(async () => { throw new Error('private listener details'); });
  await expect(prepareHttpMcpForRun({ runId: run.id, cwd: '/fixture', def: scenario === 'unsupported runtime' ? { ...def, mcpHttp: false } : def,
    lifecycle, injection: { command: 'stdio', daemonUrl: 'http://daemon.invalid', httpPolicy: 'required',
      ...(scenario === 'missing preparation' ? {} : { prepareHttp: prepare }) } })).rejects.toThrow(/HTTP.*required/i);
  expect(warn.mock.calls.flat().join(' ')).not.toContain('private');
  expect(prepare).toHaveBeenCalledTimes(scenario === 'listener failure' ? 1 : 0);
  await lifecycle.finish({ runId: run.id, status: 'failed', code: 1, signal: null, resumable: false });
});


it('required HTTP launches with its endpoint and retains terminal cleanup', async () => {
  const close = vi.fn(async () => {});
  const f = await fixture(async () => ({ url: 'http://127.0.0.1:1234/mcp', token: 'capability', close }), def, 'required');
  expect(f.prepared?.endpoint.url).toBe('http://127.0.0.1:1234/mcp');
  await f.lifecycle.finish({ runId: f.runId, status: 'succeeded', code: 0, signal: null, resumable: false });
  await f.prepared?.cleanup();
  expect(close).toHaveBeenCalledOnce();
});
