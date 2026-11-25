import { createRouteTestErrors } from './fakes/route-host.js';
import { describe, expect, it } from 'vitest';
import { createToolRegistry, requireString, ToolInputError, type Principal, type ToolRegistry } from '@jini-ai/core';
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
function buildHarness({ themeId, withLister = true, failWith }: { themeId: Record<string, unknown>; withLister?: boolean; failWith?: string }): Harness {
  const registry: ToolRegistry = createToolRegistry({});
  if (withLister) registry.register({ descriptor: { id: 'theme_list', readOnly: true }, policy: { authorize: () => 'allow' }, handler: async () => [] });
  registry.register({
    descriptor: { id: 'theme_open', readOnly: true, inputSchema: schemaOf(themeId) },
    policy: { authorize: () => 'allow' },
    handler: async ({ input }) => {
      if (failWith !== undefined) throw new ToolInputError({ message: failWith });
      return requireString({ input: input as Record<string, unknown>, key: 'themeId' });
    },
  });
  const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
  const deps: DelegatedToolsHttpDeps = { reportInternalError: createRouteTestErrors().reportInternalError, lifecycle, toolExecutor: createToolExecutor({ registry }), resolvePrincipal: () => PRINCIPAL, toolRegistry: registry };
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
  it.each(GATEWAYS)('$name: an absent required themeId without obtainFrom answers 400 BAD_REQUEST with the handler text and nothing else', async ({ requireReadOnly }) => {
    const harness = buildHarness({ themeId: { type: 'string' } });
    expect(await call(harness, { input: {}, requireReadOnly })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: MISSING_TEXT } });
  });
});

describe('delegated tool route: a missing argument that declares obtainFrom', () => {
  const GUIDED = { type: 'string', obtainFrom: 'theme_list' };

  it.each(GATEWAYS)('$name: the handler text is followed by exactly one sentence naming the lister', async ({ requireReadOnly }) => {
    const harness = buildHarness({ themeId: GUIDED });
    expect(await call(harness, { input: {}, requireReadOnly })).toEqual({
      ok: false, error: { code: 'BAD_REQUEST', message: `${MISSING_TEXT} List valid values for \`themeId\` with theme_list.` },
    });
  });

  it.each(GATEWAYS)('$name: a property that is present keeps the handler text byte for byte', async ({ requireReadOnly }) => {
    const present = await call(buildHarness({ themeId: GUIDED }), { input: { themeId: '' }, requireReadOnly });
    expect(present).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', message: "'themeId' (non-empty string) is required" } });
  });

  it.each(GATEWAYS)('$name: an obtainFrom naming a tool the route does not hold adds no clause', async ({ requireReadOnly }) => {
    const harness = buildHarness({ themeId: GUIDED, withLister: false });
    expect(await call(harness, { input: {}, requireReadOnly })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: MISSING_TEXT } });
  });

  it.each(GATEWAYS)('$name: a failure about another field adds no clause even while themeId is absent', async ({ requireReadOnly }) => {
    const harness = buildHarness({ themeId: GUIDED, failWith: 'name must be shorter than 10 characters' });
    expect(await call(harness, { input: {}, requireReadOnly })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'name must be shorter than 10 characters' } });
  });
});
