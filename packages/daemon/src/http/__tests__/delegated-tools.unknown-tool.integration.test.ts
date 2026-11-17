import { describe, expect, it } from 'vitest';
import { createToolRegistry, type Principal, type ToolRegistry } from '@jini-ai/core';
import {
  createInMemoryEventLog,
  createRunLifecycle,
  createToolExecutor,
  type RunLifecycle,
  type ToolExecutor,
} from '../../index.js';
import { delegatedToolExecuteRoute, type DelegatedToolsHttpDeps } from '../delegated-tools.js';

const PRINCIPAL: Principal = { id: 'unknown-tool-principal' };

interface Harness {
  readonly deps: DelegatedToolsHttpDeps;
  readonly registry: ToolRegistry;
  readonly lifecycle: RunLifecycle;
  readonly principalCalls: unknown[];
  readonly executorCalls: unknown[];
}

/** Real registry and executor, wrapped so every call that reaches the executor or the principal lookup is recorded. */
function buildHarness(options: { withRegistryDep?: boolean; registry?: ToolRegistry } = {}): Harness {
  const registry = options.registry ?? createToolRegistry({});
  registry.register({ descriptor: { id: 'content_read.menu', readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => 'menu' });
  registry.register({ descriptor: { id: 'writer' }, policy: { authorize: () => 'allow' }, handler: async () => 'wrote' });
  const inner = createToolExecutor({ registry });
  const executorCalls: unknown[] = [];
  const toolExecutor: ToolExecutor = { ...inner, execute: (request) => { executorCalls.push(request); return inner.execute(request); } };
  const principalCalls: unknown[] = [];
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const deps: DelegatedToolsHttpDeps = {
    lifecycle,
    toolExecutor,
    resolvePrincipal: (call) => { principalCalls.push(call); return PRINCIPAL; },
    ...(options.withRegistryDep === false ? {} : { toolRegistry: registry }),
  };
  return { deps, registry, lifecycle, principalCalls, executorCalls };
}

async function call(harness: Harness, request: { toolId: string; runId?: string; requireReadOnly?: boolean }) {
  const { run } = await harness.lifecycle.start({ contextRef: 'ctx-1' });
  return delegatedToolExecuteRoute.handle({
    input: { runId: request.runId ?? run.id, toolUseId: 'tu-1', toolId: request.toolId, ...(request.requireReadOnly ? { requireReadOnly: true } : {}) },
    deps: harness.deps,
  });
}

describe('delegated tool route: a made-up tool id (characterization of today)', () => {
  it('read-only gateway answers 403 TOOL_OPERATION_DENIED with the discovery sentence and never resolves a principal', async () => {
    const harness = buildHarness();
    const result = await call(harness, { toolId: 'content_read', requireReadOnly: true });
    expect(result).toEqual({ ok: false, error: {
      code: 'TOOL_OPERATION_DENIED',
      message: 'no tool "content_read" is registered; use search_tools — did you mean content_read.menu?',
    } });
    expect(harness.principalCalls).toEqual([]);
    expect(harness.executorCalls).toEqual([]);
  });

  it('unconstrained gateway answers 400 BAD_REQUEST from the executor throw; the principal is resolved first (path 2 today)', async () => {
    const harness = buildHarness();
    const result = await call(harness, { toolId: 'zzz' });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'ToolExecutor: unknown tool "zzz"' } });
    expect(harness.principalCalls).toHaveLength(1);
    expect(harness.executorCalls).toHaveLength(1);
  });

  it('a route mounted without a toolRegistry has no registry to decide with and keeps the executor 400 on the unconstrained gateway', async () => {
    const harness = buildHarness({ withRegistryDep: false });
    const result = await call(harness, { toolId: 'zzz' });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'ToolExecutor: unknown tool "zzz"' } });
  });

  it('check_messages is an MCP-local tool: the read-only gateway keeps its own sentence', async () => {
    const harness = buildHarness();
    const result = await call(harness, { toolId: 'check_messages', requireReadOnly: true });
    expect(result).toEqual({ ok: false, error: {
      code: 'TOOL_OPERATION_DENIED',
      message: 'check_messages is an MCP-local tool; call check_messages directly, never as toolId in a delegated gateway',
    } });
  });

  it.each([false, true])('an unknown runId answers 404 NOT_FOUND before any tool decision (requireReadOnly=%s)', async (requireReadOnly) => {
    const harness = buildHarness();
    const result = await call(harness, { toolId: 'content_reed', runId: 'no-such-run', requireReadOnly });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'run "no-such-run" was not found' } });
    expect(harness.principalCalls).toEqual([]);
  });

  it('a registered write tool on the read-only gateway keeps today\'s 403 text', async () => {
    const harness = buildHarness();
    const result = await call(harness, { toolId: 'writer', requireReadOnly: true });
    expect(result).toEqual({ ok: false, error: {
      code: 'TOOL_OPERATION_DENIED',
      message: 'tool "writer" is not registered as read-only — this gateway executes only tools whose registration declares readOnly; call it through execute_delegated_tool instead',
    } });
  });
});
