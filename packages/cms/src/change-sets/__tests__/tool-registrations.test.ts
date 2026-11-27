import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext, ToolRegistration } from '@jini-ai/core';
import type { AuthorizeFn, ChangeSetRecord } from '@jini-ai/core/contracts/events';
import { createRevertRegistry, InMemoryChangeSetRepo, type RevertRegistry } from '../../core/commands/index.js';
import { getChangeSetsAgentToolCatalog } from '../agent-tools.js';
import {
  buildChangeSetsRegistrations,
  changeSetsDerivedRisk,
  contributeChangeSetsTools,
  toChangeSetView,
  type ChangeSetToolDeps,
} from '../tool-registrations.js';

const WORKSPACE_ID = 'ws-change-sets';
const PRINCIPAL_ID = 'principal-under-test';
const NOW = '2026-09-24T00:00:00.000Z';
const LATER = '2026-09-24T01:00:00.000Z';

function context(input: Record<string, unknown> | undefined): ToolExecutionContext {
  return { executionId: 'exec-1', principal: { id: PRINCIPAL_ID }, run: { id: 'run-1' }, input, signal: new AbortController().signal } as unknown as ToolExecutionContext;
}

function record(id: string, patch: Partial<ChangeSetRecord> = {}): ChangeSetRecord {
  return { id, workspaceId: WORKSPACE_ID, status: 'applied', summary: `change ${id}`, createdAt: NOW, ...patch } as ChangeSetRecord;
}

/** A widget domain with a controllable live version, standing in for any host reverter. */
function widgetRegistry(state: { version: number; reverted: string[] }): RevertRegistry {
  const registry = createRevertRegistry({});
  registry.register('widget', 'update', {
    currentVersion: async () => state.version,
    applyInverse: async ({ item }) => { state.reverted.push(item.entityId); state.version += 1; },
  });
  return registry;
}

function setup(options: { allowed?: readonly string[] } = {}) {
  const changeSets = new InMemoryChangeSetRepo();
  const calls: Array<Parameters<AuthorizeFn>[0]> = [];
  const widget = { version: 3, reverted: [] as string[] };
  const authorize: AuthorizeFn = async (input) => {
    calls.push(input);
    return !options.allowed || options.allowed.includes(input.permission) ? { allowed: true, reason: 'matched' } : { allowed: false, reason: 'insufficient_permission' };
  };
  const deps: ChangeSetToolDeps = {
    authorize, workspaceId: WORKSPACE_ID, changeSets, revertRegistry: widgetRegistry(widget),
    revertTransaction: async ({ work }) => {
      const before = await changeSets.listByWorkspace({ workspaceId: WORKSPACE_ID });
      const version = widget.version;
      const reverted = [...widget.reverted];
      try { return await work(); }
      catch (error) {
        for (const row of before) await changeSets.save(row);
        widget.version = version;
        widget.reverted.splice(0, widget.reverted.length, ...reverted);
        throw error;
      }
    },
    clock: { nowMs: () => Date.parse(LATER) }, idGen: { newId: () => 'generated-id' },
    outbox: { enqueue: async () => {} } as unknown as ChangeSetToolDeps['outbox'],
  };
  const tools = new Map<string, ToolRegistration>(buildChangeSetsRegistrations(deps).map((registration) => [registration.descriptor.id, registration]));
  const tool = (id: string) => { const found = tools.get(id); expect(found, `${id} must be registered`).toBeDefined(); return found!; };
  return { deps, changeSets, calls, widget, tool };
}

const appliedWithItem = async (changeSets: InMemoryChangeSetRepo, id: string, atVersion: number) => {
  await changeSets.insert({ record: { ...record(id), actorId: 'test-writer', actor: { id: 'test-writer', kind: 'user' } }, items: [{ id: `${id}-item`, changeSetId: id, entityType: 'widget', entityId: 'widget-1', operation: 'update', position: 0, entityVersionAtApply: atVersion, inversePayload: { title: 'Before' } }] });
};

describe('change_sets_list', () => {
  it('registers exactly the two catalog tools, under the change-sets domain, with the derived risk of each handler', () => {
    const { tool } = setup();
    expect(buildChangeSetsRegistrations(setup().deps).map((registration) => registration.descriptor.id).sort()).toEqual(['change_sets_list', 'change_sets_revert']);
    expect(getChangeSetsAgentToolCatalog().map((entry) => entry.name).sort()).toEqual(['change_sets_list', 'change_sets_revert']);
    expect(tool('change_sets_list')).toBeDefined();
    expect([...changeSetsDerivedRisk().entries()]).toEqual([['change_sets_list', 'none'], ['change_sets_revert', 'mutates-durable-state']]);
    expect(changeSetsDerivedRisk(), 'a fresh map per call so no state is shared between hosts').not.toBe(changeSetsDerivedRisk());
    expect(contributeChangeSetsTools()).toMatchObject({ domain: 'change-sets', build: buildChangeSetsRegistrations });
  });

  it('lists newest first, defaults to 20, and caps at 100 however large the requested limit', async () => {
    const { changeSets, tool } = setup();
    // Inserted oldest first: a list that trusted insertion order would come back reversed.
    for (let i = 0; i < 105; i++) await changeSets.insert({ record: { ...record(`cs-${i}`, { createdAt: new Date(Date.UTC(2026, 8, 24, 0, 0, i)).toISOString() }), actorId: 'test-writer', actor: { id: 'test-writer', kind: 'user' } }, items: [] });
    const list = async (input?: Record<string, unknown>) => (await tool('change_sets_list').handler(context(input))) as { changeSets: Array<{ id: string }> };
    const byDefault = await list({});
    expect(byDefault.changeSets).toHaveLength(20);
    expect(byDefault.changeSets[0]!.id).toBe('cs-104');
    expect(byDefault.changeSets[19]!.id).toBe('cs-85');
    expect((await list({ limit: 500 })).changeSets).toHaveLength(100);
    expect((await list({ limit: 3 })).changeSets.map((row) => row.id)).toEqual(['cs-104', 'cs-103', 'cs-102']);
    expect((await list({ limit: 0 })).changeSets, 'a limit below 1 is raised to 1').toHaveLength(1);
    expect((await list(undefined)).changeSets, 'omitted input is accepted').toHaveLength(20);
  });

  it('keeps the repo\'s order for tied timestamps, never mutates the repo\'s array, and projects only the model-facing view', async () => {
    const { deps, tool } = setup();
    const rows = [
      record('older', { createdAt: NOW }),
      record('first-tie', { status: 'reverted', createdAt: LATER, actorId: 'human', intentRef: 'intent-1', appliedAt: NOW, revertedAt: LATER, inversePayload: { secret: 'snapshot' } } as Partial<ChangeSetRecord>),
      record('second-tie', { createdAt: LATER }),
    ];
    deps.changeSets.listByWorkspace = async (input) => { expect(input).toEqual({ workspaceId: WORKSPACE_ID }); return rows; };
    expect(await tool('change_sets_list').handler(context(undefined))).toEqual({ changeSets: [
      { id: 'first-tie', workspaceId: WORKSPACE_ID, actorId: 'human', status: 'reverted', summary: 'change first-tie', intentRef: 'intent-1', createdAt: LATER, appliedAt: NOW, revertedAt: LATER },
      { id: 'second-tie', workspaceId: WORKSPACE_ID, actorId: null, status: 'applied', summary: 'change second-tie', intentRef: null, createdAt: LATER, appliedAt: null, revertedAt: null },
      { id: 'older', workspaceId: WORKSPACE_ID, actorId: null, status: 'applied', summary: 'change older', intentRef: null, createdAt: NOW, appliedAt: null, revertedAt: null },
    ] });
    expect(rows.map((row) => row.id)).toEqual(['older', 'first-tie', 'second-tie']);
  });

  it('checks changeset.read before touching the repo, and a denial reads nothing', async () => {
    const { deps, calls, tool } = setup({ allowed: [] });
    let listed = false;
    deps.changeSets.listByWorkspace = async () => { listed = true; return []; };
    await expect(tool('change_sets_list').handler(context({}))).rejects.toMatchObject({ permission: 'changeset.read', reason: 'insufficient_permission' });
    expect(listed).toBe(false);
    expect(calls).toEqual([{ principalId: PRINCIPAL_ID, permission: 'changeset.read', workspaceId: WORKSPACE_ID, entityType: 'change_set' }]);
  });
});

describe('change_sets_revert', () => {
  it('reverts an applied change set through the shared registry and returns the model-facing view', async () => {
    const { changeSets, widget, tool, calls } = setup();
    await appliedWithItem(changeSets, 'cs-1', 3);
    const result = (await tool('change_sets_revert').handler(context({ changeSetId: 'cs-1' }))) as { reverted: boolean; changeSet: Record<string, unknown> };
    expect(result.reverted).toBe(true);
    expect(result.changeSet).toMatchObject({ id: 'cs-1', status: 'reverted', workspaceId: WORKSPACE_ID });
    expect(Object.keys(result.changeSet).sort()).toEqual(['actorId', 'appliedAt', 'createdAt', 'id', 'intentRef', 'revertedAt', 'status', 'summary', 'workspaceId']);
    expect(widget.reverted).toEqual(['widget-1']);
    expect((await changeSets.findById({ workspaceId: WORKSPACE_ID, id: 'cs-1' }))?.changeSet.status).toBe('reverted');
    expect(calls).toEqual([{ principalId: PRINCIPAL_ID, permission: 'changeset.revert', workspaceId: WORKSPACE_ID, entityType: 'change_set', entityId: 'cs-1' }]);
  });

  it('turns a version conflict into a non-throwing REVERT_CONFLICT result that defers to a human, and writes nothing', async () => {
    const { changeSets, widget, tool } = setup();
    await appliedWithItem(changeSets, 'cs-1', 2); // the widget is now at version 3: someone edited it since
    const result = await tool('change_sets_revert').handler(context({ changeSetId: 'cs-1' }));
    expect(result).toEqual({
      reverted: false, code: 'REVERT_CONFLICT', currentVersion: 3,
      note: 'someone edited it since; ask the human to revert from the Recovery page if they still want it',
    });
    expect(widget.reverted).toEqual([]);
    expect((await changeSets.findById({ workspaceId: WORKSPACE_ID, id: 'cs-1' }))?.changeSet.status).toBe('applied');
  });

  it('maps a missing id, an already-reverted record and a non-invertible record to ToolInputError', async () => {
    const { changeSets, tool } = setup();
    const revert = (changeSetId: string) => tool('change_sets_revert').handler(context({ changeSetId }));
    await expect(revert('missing')).rejects.toMatchObject({ name: 'ToolInputError', message: expect.stringMatching(/was not found/) });
    await changeSets.insert({ record: { ...record('done', { status: 'reverted' }), actorId: 'test-writer', actor: { id: 'test-writer', kind: 'user' } }, items: [] });
    await expect(revert('done')).rejects.toMatchObject({ name: 'ToolInputError', message: expect.stringMatching(/only 'applied'/) });
    await changeSets.insert({ record: { ...record('odd'), actorId: 'test-writer', actor: { id: 'test-writer', kind: 'user' } }, items: [{ id: 'odd-item', changeSetId: 'odd', entityType: 'unregistered', entityId: 'e-1', operation: 'update', position: 0, inversePayload: {} }] });
    await expect(revert('odd')).rejects.toMatchObject({ name: 'ToolInputError', message: expect.stringMatching(/no inverse applier/) });
  });

  it('rethrows an unexpected storage failure unchanged instead of disguising it as a model input problem', async () => {
    const { changeSets, tool } = setup();
    const failure = new Error('unexpected storage failure');
    changeSets.findById = async () => { throw failure; };
    await expect(tool('change_sets_revert').handler(context({ changeSetId: 'any' }))).rejects.toBe(failure);
  });

  it('never accepts force: an agent revert of a stale record conflicts even though the input carries force: true', async () => {
    const { changeSets, widget, tool } = setup();
    await appliedWithItem(changeSets, 'cs-1', 2);
    const result = (await tool('change_sets_revert').handler(context({ changeSetId: 'cs-1', force: true }))) as { reverted: boolean; code?: string };
    expect(result).toMatchObject({ reverted: false, code: 'REVERT_CONFLICT' });
    expect(widget.reverted).toEqual([]);
    const schema = getChangeSetsAgentToolCatalog().find((entry) => entry.name === 'change_sets_revert')!.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(['changeSetId']);
  });

  it('requires a changeSetId string and checks changeset.revert before touching the change set', async () => {
    const denied = setup({ allowed: ['changeset.read'] });
    await appliedWithItem(denied.changeSets, 'cs-1', 3);
    await expect(denied.tool('change_sets_revert').handler(context({}))).rejects.toMatchObject({ name: 'ToolInputError' });
    await expect(denied.tool('change_sets_revert').handler(context({ changeSetId: 'cs-1' }))).rejects.toMatchObject({ permission: 'changeset.revert', reason: 'insufficient_permission' });
    expect(denied.widget.reverted).toEqual([]);
    expect((await denied.changeSets.findById({ workspaceId: WORKSPACE_ID, id: 'cs-1' }))?.changeSet.status).toBe('applied');
    expect(denied.calls.map((call) => call.permission)).toEqual(['changeset.revert']);
  });
});

describe('toChangeSetView', () => {
  it('defaults every absent optional field to null and never leaks the inverse payload', () => {
    expect(toChangeSetView({ changeSet: { ...record('a'), inversePayload: { snapshot: 1 } } as ChangeSetRecord })).toEqual({
      id: 'a', workspaceId: WORKSPACE_ID, actorId: null, status: 'applied', summary: 'change a', intentRef: null, createdAt: NOW, appliedAt: null, revertedAt: null,
    });
  });
});

describe('change_sets_revert per-item policy', () => {
  /** Adds a policy-bearing kind beside the ordinary widget, recording what the current revert actor is. */
  function withStrictKind(deps: ChangeSetToolDeps, options: { allowForce?: boolean; version?: number } = {}) {
    const writes: Array<{ entityId: string; actorId: string | undefined }> = [];
    deps.revertRegistry.register('raw-widget', 'update', {
      policy: { permission: 'widgets.write_raw', authorizationEntityType: 'widget', ...(options.allowForce === undefined ? {} : { allowForce: options.allowForce }) },
      currentVersion: async () => options.version ?? 1,
      applyInverse: async ({ item }, extra) => { writes.push({ entityId: item.entityId, actorId: extra?.actorId }); },
    });
    return writes;
  }
  const strictSet = async (changeSets: InMemoryChangeSetRepo, id: string) => {
    await changeSets.insert({ record: { ...record(id, { actorId: 'original-writer' }), actorId: 'original-writer', actor: { id: 'original-writer', kind: 'user' } }, items: [{ id: `${id}-raw`, changeSetId: id, entityType: 'raw-widget', entityId: 'raw-1', operation: 'update', position: 0, entityVersionAtApply: 1, inversePayload: { body: 'inverse' } }] });
  };

  it('tool and admin revert forward the current principal and authorize the scoped item', async () => {
    const { deps, changeSets, calls, tool } = setup();
    const writes = withStrictKind(deps);
    await strictSet(changeSets, 'cs-1');
    expect(await tool('change_sets_revert').handler(context({ changeSetId: 'cs-1' }))).toMatchObject({ reverted: true });
    expect(calls).toEqual([
      { principalId: PRINCIPAL_ID, permission: 'changeset.revert', workspaceId: WORKSPACE_ID, entityType: 'change_set', entityId: 'cs-1' },
      { principalId: PRINCIPAL_ID, permission: 'widgets.write_raw', workspaceId: WORKSPACE_ID, entityType: 'widget', entityId: 'raw-1' },
    ]);
    expect(writes).toEqual([{ entityId: 'raw-1', actorId: PRINCIPAL_ID }]);
  });

  it('the tool returns REVERT_NOT_ALLOWED for a policy denial and does not suggest Recovery for a non-forceable conflict', async () => {
    const denied = setup({ allowed: ['changeset.revert'] });
    const deniedWrites = withStrictKind(denied.deps);
    await strictSet(denied.changeSets, 'cs-1');
    const result = await denied.tool('change_sets_revert').handler(context({ changeSetId: 'cs-1' }));
    expect(result).toEqual({ reverted: false, code: 'REVERT_NOT_ALLOWED', note: expect.any(String) });
    expect(JSON.stringify(result)).not.toMatch(/widgets\.write_raw|insufficient_permission|principal-under-test/);
    expect(deniedWrites).toEqual([]);
    expect((await denied.changeSets.findById({ workspaceId: WORKSPACE_ID, id: 'cs-1' }))?.changeSet.status).toBe('applied');

    const stale = setup();
    withStrictKind(stale.deps, { allowForce: false, version: 4 });
    await strictSet(stale.changeSets, 'cs-2');
    const conflict = (await stale.tool('change_sets_revert').handler(context({ changeSetId: 'cs-2' }))) as { code: string; note: string };
    expect(conflict).toMatchObject({ reverted: false, code: 'REVERT_CONFLICT', currentVersion: 4 });
    expect(conflict.note).not.toMatch(/Recovery/);
    expect(conflict.note).toMatch(/keep the newer version and edit it again/i);

    // A forceable policy kind still gets the existing Recovery suggestion.
    const forceable = setup();
    withStrictKind(forceable.deps, { version: 4 });
    await strictSet(forceable.changeSets, 'cs-3');
    expect(await forceable.tool('change_sets_revert').handler(context({ changeSetId: 'cs-3' }))).toMatchObject({
      code: 'REVERT_CONFLICT', note: 'someone edited it since; ask the human to revert from the Recovery page if they still want it',
    });
  });
});

it('still returns the conflict when the scoped change set disappears before the policy re-read', async () => {
  const { changeSets, widget, tool } = setup();
  await appliedWithItem(changeSets, 'cs-expired', 2);
  const original = changeSets.findById.bind(changeSets);
  const lookups: unknown[] = [];
  changeSets.findById = async (key) => {
    lookups.push(key);
    return lookups.length === 1 ? original(key) : null;
  };
  expect(await tool('change_sets_revert').handler(context({ changeSetId: 'cs-expired' }))).toEqual({
    reverted: false, code: 'REVERT_CONFLICT', currentVersion: 3,
    note: 'someone edited it since; ask the human to revert from the Recovery page if they still want it',
  });
  expect(lookups).toEqual(Array.from({ length: 2 }, () => ({ workspaceId: WORKSPACE_ID, id: 'cs-expired' })));
  expect(widget.reverted).toEqual([]);
});
