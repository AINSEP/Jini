import { describe, expect, it } from 'vitest';
import { createToolRegistry, requireString, type Principal, type ToolRegistry } from '@jini-ai/core';
import { createInMemoryEventLog, createRunLifecycle, createToolExecutor, type RunLifecycle } from '../../index.js';
import { delegatedToolExecuteRoute, type DelegatedToolsHttpDeps } from '../delegated-tools.js';

const PRINCIPAL: Principal = { id: 'obtain-from-principal' };
/** What the handler's own `requireString` says for an input without `themeId`. */
const MISSING_TEXT = "'themeId' (non-empty string) is required";

const schemaOf = (themeId: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: ['themeId'], properties: { themeId },
});

interface Harness { readonly deps: DelegatedToolsHttpDeps; readonly lifecycle: RunLifecycle }

/** A real registry and executor; `theme_open` reads `themeId` with `requireString`, as Tovu's handlers do. */
function buildHarness({ themeId, withLister = true }: { themeId: Record<string, unknown>; withLister?: boolean }): Harness {
  const registry: ToolRegistry = createToolRegistry({});
  if (withLister) registry.register({ descriptor: { id: 'theme_list', readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => [] });
  registry.register({
    descriptor: { id: 'theme_open', readOnly: true, inputSchema: schemaOf(themeId) },
    policy: { authorize: () => 'allow' },
    handler: async ({ input }) => requireString({ input: input as Record<string, unknown>, key: 'themeId' }),
  });
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const deps: DelegatedToolsHttpDeps = { lifecycle, toolExecutor: createToolExecutor({ registry }), resolvePrincipal: () => PRINCIPAL, toolRegistry: registry };
  return { deps, lifecycle };
}

async function call(harness: Harness, request: { input: unknown; requireReadOnly?: boolean }) {
  const { run } = await harness.lifecycle.start({ contextRef: 'ctx-1' });
  return delegatedToolExecuteRoute.handle({
    input: { runId: run.id, toolUseId: 'tu-1', toolId: 'theme_open', input: request.input, ...(request.requireReadOnly ? { requireReadOnly: true } : {}) },
    deps: harness.deps,
  });
}

const GATEWAYS = [{ name: 'unconstrained gateway', requireReadOnly: false }, { name: 'read-only gateway', requireReadOnly: true }] as const;

describe('delegated tool route: a validation answer today (characterization)', () => {
  it.each(GATEWAYS)('$name: an absent required themeId answers 400 BAD_REQUEST with the handler text and nothing else', async ({ requireReadOnly }) => {
    const harness = buildHarness({ themeId: { type: 'string', obtainFrom: 'theme_list' } });
    expect(await call(harness, { input: {}, requireReadOnly })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: MISSING_TEXT } });
  });
});
