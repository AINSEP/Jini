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

describe('delegated tool route: a made-up tool id answers 404 UNKNOWN_TOOL on both gateways', () => {
  const GATEWAYS = [
    { name: 'read-only gateway', requireReadOnly: true },
    { name: 'unconstrained gateway', requireReadOnly: false },
  ] as const;

  it.each(GATEWAYS)('$name: names the closest registered ids', async ({ requireReadOnly }) => {
    const harness = buildHarness();
    const result = await call(harness, { toolId: 'content_read', requireReadOnly });
    expect(result).toEqual({ ok: false, error: {
      code: 'UNKNOWN_TOOL',
      message: 'There is no tool named "content_read". Closest names: content_read.menu. Find tools with search_tools.',
    } });
  });

  it.each(GATEWAYS)('$name: leaves the closest-names part out when nothing is close', async ({ requireReadOnly }) => {
    const harness = buildHarness();
    const result = await call(harness, { toolId: 'zzz', requireReadOnly });
    expect(result).toEqual({ ok: false, error: { code: 'UNKNOWN_TOOL', message: 'There is no tool named "zzz". Find tools with search_tools.' } });
  });

  it.each(GATEWAYS)('$name: resolves no principal and reaches no executor', async ({ requireReadOnly }) => {
    const harness = buildHarness();
    await call(harness, { toolId: 'zzz', requireReadOnly });
    expect(harness.principalCalls).toEqual([]);
    expect(harness.executorCalls).toEqual([]);
  });

  it.each(GATEWAYS)('$name: a tool held only by another registry gets the byte-identical answer a made-up id gets', async ({ requireReadOnly }) => {
    const elsewhere = createToolRegistry({});
    elsewhere.register({ descriptor: { id: 'hidden_tool', readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => 'secret' });
    const harness = buildHarness();
    const hidden = await call(harness, { toolId: 'hidden_tool', requireReadOnly });
    const madeUp = await call(buildHarness(), { toolId: 'hidden_tool', requireReadOnly });
    expect(elsewhere.has({ toolId: 'hidden_tool' })).toBe(true);
    expect(hidden).toEqual(madeUp);
    expect(hidden).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
  });

  it('a route mounted without a toolRegistry has no registry to decide with and keeps the executor 400 on the unconstrained gateway', async () => {
    const harness = buildHarness({ withRegistryDep: false });
    const result = await call(harness, { toolId: 'zzz' });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'ToolExecutor: unknown tool "zzz"' } });
  });

  it('a route mounted without a toolRegistry still refuses the read-only gateway as unverifiable', async () => {
    const harness = buildHarness({ withRegistryDep: false });
    const result = await call(harness, { toolId: 'zzz', requireReadOnly: true });
    expect(result).toMatchObject({ ok: false, error: { code: 'TOOL_OPERATION_DENIED' } });
    expect(harness.principalCalls).toEqual([]);
  });

  it('check_messages is an MCP-local tool: both gateways keep its own sentence, now as UNKNOWN_TOOL', async () => {
    for (const requireReadOnly of [true, false]) {
      const result = await call(buildHarness(), { toolId: 'check_messages', requireReadOnly });
      expect(result).toEqual({ ok: false, error: {
        code: 'UNKNOWN_TOOL',
        message: 'check_messages is an MCP-local tool; call check_messages directly, never as toolId in a delegated gateway',
      } });
    }
  });
});

describe('delegated tool route: gate order around the tool decision', () => {
  it.each([false, true])('an unknown runId answers 404 NOT_FOUND before any tool answer (requireReadOnly=%s)', async (requireReadOnly) => {
    const harness = buildHarness();
    const result = await call(harness, { toolId: 'zzz', runId: 'no-such-run', requireReadOnly });
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
    expect(harness.principalCalls).toEqual([]);
  });

  it('a registered write tool on the unconstrained gateway still reaches the principal lookup and the executor', async () => {
    const harness = buildHarness();
    const result = await call(harness, { toolId: 'writer' });
    expect(result).toMatchObject({ ok: true });
    expect(harness.principalCalls).toHaveLength(1);
    expect(harness.executorCalls).toHaveLength(1);
  });
});
