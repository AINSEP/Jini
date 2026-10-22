import { describe, expect, test } from 'vitest';
import { createToolRegistry, ToolInputError, type Principal, type RunRef } from '@jini-ai/core';

import { createVibecodingSession } from '../session.js';
import { VIBECODING_TOOL_IDS, createVibecodingToolRegistrations, createVibecodingToolRunner } from '../tools.js';
import type { EditTarget } from '../../core/target.js';
import type { PartId, Snapshot } from '../../core/types.js';

function makeTarget(initial: Record<PartId, string> = {}): EditTarget & { readonly parts: Map<PartId, string> } {
  const parts = new Map<PartId, string>(Object.entries(initial));
  return {
    parts,
    listParts: async () => [...parts.keys()].map((id) => ({ id })),
    readPart: async ({ id }) => {
      const found = parts.get(id);
      if (found === undefined) throw new Error(`no such part: ${id}`);
      return found;
    },
    replacePart: async ({ id, content }) => {
      parts.set(id, content);
    },
    snapshot: async (): Promise<Snapshot> => ({ id: 'snap', parts: Object.fromEntries(parts) }),
    restore: async ({ snapshot }) => {
      parts.clear();
      for (const [id, content] of Object.entries(snapshot.parts)) parts.set(id, content);
    },
    validate: async () => ({ ok: true }),
  };
}

const PRINCIPAL: Principal = { id: 'test-user' };
const RUN: RunRef = { id: 'run-1' };

describe('createVibecodingToolRunner', () => {
  test('exposes all five tool ids as descriptors, discoverable without a hardcoded list', () => {
    const runner = createVibecodingToolRunner({ session: createVibecodingSession({ target: makeTarget() }) });

    expect(runner.descriptors.map((d) => d.id).sort()).toEqual(Object.values(VIBECODING_TOOL_IDS).sort());
  });

  test('list_parts runs a fresh refresh and returns the current parts', async () => {
    const runner = createVibecodingToolRunner({ session: createVibecodingSession({ target: makeTarget({ a: 'A' }) }) });

    const result = await runner.run({ toolId: VIBECODING_TOOL_IDS.LIST_PARTS, input: {} });

    expect(result).toEqual([{ id: 'a' }]);
  });

  test('read_part validates input and returns the content', async () => {
    const runner = createVibecodingToolRunner({ session: createVibecodingSession({ target: makeTarget({ a: 'A' }) }) });

    const result = await runner.run({ toolId: VIBECODING_TOOL_IDS.READ_PART, input: { id: 'a' } });

    expect(result).toEqual({ id: 'a', content: 'A' });
  });

  test('read_part rejects a malformed input with ToolInputError', async () => {
    const runner = createVibecodingToolRunner({ session: createVibecodingSession({ target: makeTarget({ a: 'A' }) }) });

    await expect(runner.run({ toolId: VIBECODING_TOOL_IDS.READ_PART, input: {} })).rejects.toBeInstanceOf(ToolInputError);
    await expect(runner.run({ toolId: VIBECODING_TOOL_IDS.READ_PART, input: { id: 42 } })).rejects.toBeInstanceOf(ToolInputError);
    await expect(runner.run({ toolId: VIBECODING_TOOL_IDS.READ_PART, input: null })).rejects.toBeInstanceOf(ToolInputError);
  });

  test('propose_edits applies a valid batch and returns outcomes plus corrections', async () => {
    const target = makeTarget({ a: 'old' });
    const runner = createVibecodingToolRunner({ session: createVibecodingSession({ target }) });

    const result = await runner.run({ toolId: VIBECODING_TOOL_IDS.PROPOSE_EDITS, input: {
      edits: [{ id: 'a', content: 'new' }],
      label: 'chat turn 1',
    } });

    expect(result).toEqual({ outcomes: [{ status: 'applied', id: 'a' }], corrections: [] });
    expect(target.parts.get('a')).toBe('new');
  });

  test('propose_edits rejects an empty edits array', async () => {
    const runner = createVibecodingToolRunner({ session: createVibecodingSession({ target: makeTarget() }) });

    await expect(runner.run({ toolId: VIBECODING_TOOL_IDS.PROPOSE_EDITS, input: { edits: [] } })).rejects.toBeInstanceOf(ToolInputError);
  });

  test('propose_edits rejects a batch over the per-call limit', async () => {
    const runner = createVibecodingToolRunner({ session: createVibecodingSession({ target: makeTarget() }) });
    const edits = Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, content: 'x' }));

    // Not `.rejects.toThrow(/regex/)`: that overload of vitest's own matcher is broken by
    // `@testing-library/jest-dom`'s global `expect.extend` under this package's jsdom projects
    // (verified empirically — see `vitest.setup.ts`'s doc). `.rejects.toBeInstanceOf` is unaffected,
    // and a manual catch covers the message itself.
    await expect(runner.run({ toolId: VIBECODING_TOOL_IDS.PROPOSE_EDITS, input: { edits } })).rejects.toBeInstanceOf(ToolInputError);
    const error = (await runner.run({ toolId: VIBECODING_TOOL_IDS.PROPOSE_EDITS, input: { edits } }).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('50-entry limit');
  });

  test('propose_edits rejects an edit entry missing content', async () => {
    const runner = createVibecodingToolRunner({ session: createVibecodingSession({ target: makeTarget() }) });

    await expect(
      runner.run({ toolId: VIBECODING_TOOL_IDS.PROPOSE_EDITS, input: { edits: [{ id: 'a' }] } }),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  test('undo and redo round-trip through the runner', async () => {
    const target = makeTarget({ a: 'old' });
    const session = createVibecodingSession({ target });
    const runner = createVibecodingToolRunner({ session });
    await runner.run({ toolId: VIBECODING_TOOL_IDS.PROPOSE_EDITS, input: { edits: [{ id: 'a', content: 'new' }] } });

    const undone = (await runner.run({ toolId: VIBECODING_TOOL_IDS.UNDO, input: {} })) as { entry: unknown };
    expect(undone.entry).not.toBeNull();
    expect(target.parts.get('a')).toBe('old');

    const redone = (await runner.run({ toolId: VIBECODING_TOOL_IDS.REDO, input: {} })) as { entry: unknown };
    expect(redone.entry).not.toBeNull();
    expect(target.parts.get('a')).toBe('new');
  });

  test('an unknown tool id rejects with RangeError', async () => {
    const runner = createVibecodingToolRunner({ session: createVibecodingSession({ target: makeTarget() }) });

    await expect(runner.run({ toolId: 'vibecoding.not_a_real_tool', input: {} })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('createVibecodingToolRegistrations — real ToolRegistry integration', () => {
  test('registers all five tools, listable through the registry (not a hardcoded catalog)', () => {
    const registry = createToolRegistry({});
    const registrations = createVibecodingToolRegistrations({ session: createVibecodingSession({ target: makeTarget() }) });

    for (const registration of registrations) registry.register(registration);

    expect(registry.list({}).map((d) => d.id).sort()).toEqual(Object.values(VIBECODING_TOOL_IDS).sort());
  });

  test('registered descriptors classify read/write correctly for a read-only gate', () => {
    const registry = createToolRegistry({});
    for (const registration of createVibecodingToolRegistrations({ session: createVibecodingSession({ target: makeTarget() }) })) {
      registry.register(registration);
    }

    const byId = new Map(registry.list({}).map((d) => [d.id, d]));
    expect(byId.get(VIBECODING_TOOL_IDS.LIST_PARTS)?.readOnly).toBe(true);
    expect(byId.get(VIBECODING_TOOL_IDS.READ_PART)?.readOnly).toBe(true);
    expect(byId.get(VIBECODING_TOOL_IDS.PROPOSE_EDITS)?.readOnly).toBe(false);
    expect(byId.get(VIBECODING_TOOL_IDS.UNDO)?.readOnly).toBe(false);
    expect(byId.get(VIBECODING_TOOL_IDS.REDO)?.readOnly).toBe(false);
  });

  test('a registration\'s handler runs correctly given a full ToolExecutionContext', async () => {
    // `@jini-ai/core`'s `ToolRegistry` deliberately keeps a registered handler unreachable once
    // registered (see `tool-registry.ts`'s own module doc) — only `authorizeToolInvocation`,
    // exported from `@jini-ai/core/composition` for `@jini-ai/daemon`'s `ToolExecutor` alone, can get
    // it back out (a *value* import this package must not make itself — see that module's own doc
    // on `scripts/check-engine-boundaries.ts`'s daemon-only rule). So this test calls the
    // `ToolRegistration.handler` this factory returns DIRECTLY, before it is ever handed to
    // `registry.register(...)` — the same object `ToolExecutor` would eventually invoke, exercised
    // with a realistic `ToolExecutionContext` shape rather than through the registry's opaque path.
    const target = makeTarget({ a: 'old' });
    const registrations = createVibecodingToolRegistrations({ session: createVibecodingSession({ target }) });
    const proposeEdits = registrations.find((r) => r.descriptor.id === VIBECODING_TOOL_IDS.PROPOSE_EDITS);
    if (!proposeEdits) throw new Error('unreachable');

    const decision = await proposeEdits.policy.authorize({
      principal: PRINCIPAL,
      run: RUN,
      tool: proposeEdits.descriptor,
      input: { edits: [{ id: 'a', content: 'new' }] },
    });
    expect(decision).toBe('allow');

    const result = await proposeEdits.handler({
      executionId: 'exec-1',
      principal: PRINCIPAL,
      run: RUN,
      input: { edits: [{ id: 'a', content: 'new' }] },
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ outcomes: [{ status: 'applied', id: 'a' }], corrections: [] });
    expect(target.parts.get('a')).toBe('new');
  });

  test('a supplied ToolPolicy overrides the default allow-always policy', async () => {
    const registrations = createVibecodingToolRegistrations({ session: createVibecodingSession({ target: makeTarget() }) }, {
      policy: { authorize: () => 'deny' },
    });
    const listParts = registrations.find((r) => r.descriptor.id === VIBECODING_TOOL_IDS.LIST_PARTS);
    if (!listParts) throw new Error('unreachable');

    const decision = await listParts.policy.authorize({ principal: PRINCIPAL, run: RUN, tool: listParts.descriptor, input: {} });

    expect(decision).toBe('deny');
  });
});
