import { describe, expect, it } from 'vitest';
import { createToolRegistry, type Principal } from '@jini-ai/core';
import { createInMemoryEventLog, createRunLifecycle, createToolExecutor, type ToolExecutionResult, type ToolExecutor } from '../../index.js';
import { delegatedToolExecuteRoute, type DelegatedToolsHttpDeps } from '../delegated-tools.js';
import type { ToolFamilyPort } from '../../core/tool-family.js';

const PRINCIPAL: Principal = { id: 'error-details-principal' };
const SHOT_PAGE_SCHEMA = {
  type: 'object',
  properties: {
    viewport: { type: 'object', properties: { width: { type: 'number' }, 'not an identifier': { type: 'string' } } },
    fullPage: { type: 'boolean' },
    dismissCookieBanners: { type: 'boolean' },
  },
};
const SHOT_PAGE_DETAILS = { toolId: 'shot_page', inputNames: ['dismissCookieBanners', 'fullPage', 'viewport', 'width'] };

/** What the fake executor answers: a settled result, or a throw. */
type Outcome = { readonly result: Omit<ToolExecutionResult, 'executionId'> } | { readonly throws: Error };

/** A fake `ToolExecutor` over a real registry holding `shot_page`; it answers `outcome` for every call. */
function buildDeps(outcome: Outcome, options: { resolvePrincipal?: DelegatedToolsHttpDeps['resolvePrincipal']; toolFamilies?: ToolFamilyPort } = {}): DelegatedToolsHttpDeps {
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
    resolvePrincipal: options.resolvePrincipal ?? (() => PRINCIPAL),
    toolRegistry: registry,
    onInternalError: () => undefined,
    isModelSafeToolFailure: ({ result }) => result.error === 'host-safe text',
    ...(options.toolFamilies === undefined ? {} : { toolFamilies: options.toolFamilies }),
  };
}

async function call(deps: DelegatedToolsHttpDeps, request: { toolId?: string; input?: unknown; requireReadOnly?: boolean; runId?: string } = {}) {
  const { run } = await deps.lifecycle.start({ contextRef: 'ctx-1' });
  return delegatedToolExecuteRoute.handle({
    input: { runId: request.runId ?? run.id, toolUseId: 'tu-1', toolId: request.toolId ?? 'shot_page', input: request.input ?? { viewport: 'wide' }, ...(request.requireReadOnly ? { requireReadOnly: true } : {}) },
    deps,
  });
}

function errorOf(result: Awaited<ReturnType<typeof call>>) {
  if (result.ok) throw new Error('expected an error answer');
  if (result.error === undefined) throw new Error('error answer without an envelope');
  return result.error;
}

describe('delegated tool route: an error answer for a tool the registry holds names that tool and its input names', () => {
  const CASES: ReadonlyArray<{ name: string; outcome: Outcome; code: string; message: string; executionId?: string }> = [
    { name: 'failed (validation)', outcome: { result: { status: 'failed', error: 'bad viewport', errorKind: 'validation' } }, code: 'BAD_REQUEST', message: 'bad viewport', executionId: 'exec-1' },
    { name: 'failed (model-safe 422)', outcome: { result: { status: 'failed', error: 'host-safe text', errorKind: 'internal' } }, code: 'TOOL_EXECUTION_FAILED', message: 'host-safe text', executionId: 'exec-1' },
    { name: 'failed (redacted 500)', outcome: { result: { status: 'failed', error: 'secret detail', errorKind: 'internal' } }, code: 'INTERNAL_ERROR', message: 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.', executionId: 'exec-1' },
    { name: 'timed-out', outcome: { result: { status: 'timed-out' } }, code: 'INTERNAL_ERROR', message: 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.', executionId: 'exec-1' },
    { name: 'denied', outcome: { result: { status: 'denied' } }, code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied by policy', executionId: 'exec-1' },
    { name: 'a thrown executor error', outcome: { throws: new Error('boom') }, code: 'INTERNAL_ERROR', message: 'The tool could not run because of a server fault. Do not retry the same call; tell the user to copy the request ID and report this problem.' },
  ];

  it.each(CASES)('$name: details carry the tool id, the sorted names and the execution id; code and message are as before', async ({ outcome, code, message, executionId }) => {
    const error = errorOf(await call(buildDeps(outcome)));
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.details).toEqual({ ...SHOT_PAGE_DETAILS, ...(executionId === undefined ? {} : { executionId }) });
  });

  it('a redacted 500 keeps its requestId', async () => {
    const error = errorOf(await call(buildDeps({ result: { status: 'timed-out' } })));
    expect(typeof error.requestId).toBe('string');
  });

  it('a throwing resolvePrincipal answers with the same details', async () => {
    const deps = buildDeps({ result: { status: 'timed-out' } }, { resolvePrincipal: () => { throw new Error('no principal'); } });
    expect(errorOf(await call(deps)).details).toEqual(SHOT_PAGE_DETAILS);
  });

  it('the read-only gateway refusing a writable tool answers with the same details', async () => {
    const error = errorOf(await call(buildDeps({ result: { status: 'timed-out' } }), { requireReadOnly: true }));
    expect(error.code).toBe('TOOL_OPERATION_DENIED');
    expect(error.details).toEqual(SHOT_PAGE_DETAILS);
  });

  it('the names come from the descriptor, never from the input the caller sent', async () => {
    const error = errorOf(await call(buildDeps({ result: { status: 'denied' } }), { input: { zzSecretKeyName: 'x', viewport: 'wide' } }));
    expect(error.details).toEqual({ ...SHOT_PAGE_DETAILS, executionId: 'exec-1' });
    expect(JSON.stringify(error.details)).not.toContain('zzSecretKeyName');
  });

  it('a descriptor with more than 64 names lists the first 64 in sorted order', async () => {
    const properties = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`p${String(index).padStart(2, '0')}`, { type: 'string' }]));
    const deps = buildDeps({ result: { status: 'timed-out' } });
    const registry = createToolRegistry({});
    registry.register({ descriptor: { id: 'wide', inputSchema: { type: 'object', properties } }, policy: { authorize: () => 'allow' }, handler: async () => 'x' });
    const names = (errorOf(await call({ ...deps, toolRegistry: registry }, { toolId: 'wide' })).details as { inputNames: string[] }).inputNames;
    expect(names).toEqual(Object.keys(properties).slice(0, 64));
  });

  it('a tool with no input schema answers with its id and an empty name list', async () => {
    const registry = createToolRegistry({});
    registry.register({ descriptor: { id: 'bare' }, policy: { authorize: () => 'allow' }, handler: async () => 'x' });
    const deps = { ...buildDeps({ result: { status: 'denied' } }), toolRegistry: registry };
    expect(errorOf(await call(deps, { toolId: 'bare' })).details).toEqual({ toolId: 'bare', inputNames: [], executionId: 'exec-1' });
  });
});

describe('delegated tool route: an answer about something that did not resolve names nothing', () => {
  it('an unknown tool carries no names', async () => {
    const error = errorOf(await call(buildDeps({ result: { status: 'timed-out' } }), { toolId: 'zzz' }));
    expect(error.code).toBe('UNKNOWN_TOOL');
    expect(error).not.toHaveProperty('details');
  });

  it('a group id keeps its family details and gains no names', async () => {
    const toolFamilies: ToolFamilyPort = { describeFamily: ({ familyId }) => (familyId === 'fam' ? { members: ['shot_page'] } : undefined) };
    const error = errorOf(await call(buildDeps({ result: { status: 'timed-out' } }, { toolFamilies }), { toolId: 'fam' }));
    expect(error.code).toBe('UNKNOWN_TOOL');
    expect(Object.keys(error.details as object)).toEqual(['family']);
  });

  it('an unknown run carries no names', async () => {
    const error = errorOf(await call(buildDeps({ result: { status: 'timed-out' } }), { runId: 'no-such-run' }));
    expect(error.code).toBe('NOT_FOUND');
    expect(error).not.toHaveProperty('details');
  });

  it('a completed call has no details', async () => {
    const result = await call(buildDeps({ result: { status: 'completed', output: 'ok' } }));
    expect(result.ok).toBe(true);
  });
});
