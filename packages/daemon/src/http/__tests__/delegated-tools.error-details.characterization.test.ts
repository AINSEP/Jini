import { describe, expect, it } from 'vitest';
import { createToolRegistry, type Principal } from '@jini-ai/core';
import { createInMemoryEventLog, createRunLifecycle, createToolExecutor, type ToolExecutionResult, type ToolExecutor } from '../../index.js';
import { delegatedToolExecuteRoute, type DelegatedToolsHttpDeps } from '../delegated-tools.js';

const PRINCIPAL: Principal = { id: 'error-details-principal' };
const SHOT_PAGE_SCHEMA = {
  type: 'object',
  properties: { viewport: { type: 'string' }, fullPage: { type: 'boolean' }, dismissCookieBanners: { type: 'boolean' } },
};

/** What the fake executor answers: a settled result, or a throw. */
type Outcome = { readonly result: Omit<ToolExecutionResult, 'executionId'> } | { readonly throws: Error };

/** A fake `ToolExecutor` over a real registry holding `shot_page`; it answers `outcome` for every call. */
function buildDeps(outcome: Outcome): DelegatedToolsHttpDeps {
  const registry = createToolRegistry({});
  registry.register({ descriptor: { id: 'shot_page', inputSchema: SHOT_PAGE_SCHEMA }, policy: { authorize: () => 'allow' }, handler: async () => 'shot' });
  const inner = createToolExecutor({ registry });
  const toolExecutor: ToolExecutor = {
    ...inner,
    execute: async () => {
      if ('throws' in outcome) throw outcome.throws;
      return { executionId: 'exec-1', ...outcome.result };
    },
  };
  return {
    lifecycle: createRunLifecycle({ eventLog: createInMemoryEventLog({}) }),
    toolExecutor,
    resolvePrincipal: () => PRINCIPAL,
    toolRegistry: registry,
    onInternalError: () => undefined,
    isModelSafeToolFailure: ({ result }) => result.error === 'host-safe text',
  };
}

async function call(deps: DelegatedToolsHttpDeps) {
  const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
  return delegatedToolExecuteRoute.handle({ input: { runId: run.id, toolUseId: 'tu-1', toolId: 'shot_page', input: { viewport: 'wide' } }, deps });
}

describe('delegated tool route today: no error answer carries details', () => {
  const CASES: ReadonlyArray<{ name: string; outcome: Outcome; code: string }> = [
    { name: 'failed (validation)', outcome: { result: { status: 'failed', error: 'bad viewport', errorKind: 'validation' } }, code: 'BAD_REQUEST' },
    { name: 'failed (model-safe 422)', outcome: { result: { status: 'failed', error: 'host-safe text', errorKind: 'internal' } }, code: 'TOOL_EXECUTION_FAILED' },
    { name: 'timed-out', outcome: { result: { status: 'timed-out' } }, code: 'INTERNAL_ERROR' },
    { name: 'denied', outcome: { result: { status: 'denied' } }, code: 'TOOL_OPERATION_DENIED' },
    { name: 'a thrown executor error', outcome: { throws: new Error('boom') }, code: 'INTERNAL_ERROR' },
  ];

  it.each(CASES)('$name: the envelope has a code and a message and no details', async ({ outcome, code }) => {
    const result = await call(buildDeps(outcome));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error?.code).toBe(code);
    expect(typeof result.error?.message).toBe('string');
    expect(result.error).not.toHaveProperty('details');
  });
});
