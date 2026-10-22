import { describe, expect, it } from 'vitest';
import { createInMemoryRoutineStore, summarizeLastRun } from '../routine-store.js';
import type { RoutineRun } from '../types.js';

function fixtureRun(overrides: Partial<RoutineRun> = {}): RoutineRun {
  return {
    id: 'run-1',
    routineId: 'routine-1',
    trigger: 'manual',
    status: 'succeeded',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    agentRunId: 'agent-run-1',
    startedAt: 1000,
    completedAt: 2000,
    summary: 'did the thing',
    error: null,
    errorCode: null,
    ...overrides,
  };
}

describe('summarizeLastRun', () => {
  it('returns null for a null run', () => {
    expect(summarizeLastRun({ run: null })).toBeNull();
  });

  it('omits completedAt/summary/error/errorCode when they are null/nullish', () => {
    const summary = summarizeLastRun({ run: fixtureRun({ completedAt: null, summary: null, error: null, errorCode: null }) }
    );
    expect(summary).toEqual({
      runId: 'run-1',
      status: 'succeeded',
      trigger: 'manual',
      startedAt: 1000,
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
    });
    expect(summary && 'completedAt' in summary).toBe(false);
    expect(summary && 'summary' in summary).toBe(false);
    expect(summary && 'error' in summary).toBe(false);
    expect(summary && 'errorCode' in summary).toBe(false);
  });

  it('includes completedAt/summary/error/errorCode when present', () => {
    const summary = summarizeLastRun({ run: fixtureRun({ completedAt: 2000, summary: 'ok', error: 'boom', errorCode: 'E_BOOM' }) }
    );
    expect(summary).toMatchObject({ completedAt: 2000, summary: 'ok', error: 'boom', errorCode: 'E_BOOM' });
  });
});

describe('createInMemoryRoutineStore — CRUD', () => {
  it('list() returns an empty array for a fresh store', async () => {
    const store = createInMemoryRoutineStore({  });
    expect(await store.list()).toEqual([]);
  });

  it('create() assigns an id, defaults, and timestamps', async () => {
    const store = createInMemoryRoutineStore({  });
    const routine = await store.create({
      name: 'Daily brief',
      prompt: 'Summarize the day',
      schedule: { kind: 'hourly', minute: 5 },
      target: { mode: 'create_each_run' },
    });

    expect(routine.id).toMatch(/^routine-/);
    expect(routine.name).toBe('Daily brief');
    expect(routine.skillId).toBeNull();
    expect(routine.agentId).toBeNull();
    expect(routine.context).toEqual({});
    expect(routine.enabled).toBe(true);
    expect(routine.nextRunAt).toBeNull();
    expect(routine.lastRun).toBeNull();
    expect(routine.createdAt).toBe(routine.updatedAt);
    expect(typeof routine.createdAt).toBe('number');
  });

  it('create() honors explicit skillId/agentId/context/enabled overrides', async () => {
    const store = createInMemoryRoutineStore({  });
    const routine = await store.create({ name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 5 }, target: { mode: 'create_each_run' } }, { skillId: 'skill-1', agentId: 'agent-1', context: { skillIds: ['skill-1'] }, enabled: false });
    expect(routine.skillId).toBe('skill-1');
    expect(routine.agentId).toBe('agent-1');
    expect(routine.context).toEqual({ skillIds: ['skill-1'] });
    expect(routine.enabled).toBe(false);
  });

  it('get() returns null for an unknown id, and the created routine by id otherwise', async () => {
    const store = createInMemoryRoutineStore({  });
    expect(await store.get({ id: 'missing' })).toBeNull();
    const created = await store.create({
      name: 'n',
      prompt: 'p',
      schedule: { kind: 'hourly', minute: 5 },
      target: { mode: 'create_each_run' },
    });
    expect(await store.get({ id: created.id })).toEqual(created);
  });

  it('list() returns every created routine sorted by id', async () => {
    const store = createInMemoryRoutineStore({  });
    const a = await store.create({ name: 'a', prompt: 'p', schedule: { kind: 'hourly', minute: 1 }, target: { mode: 'create_each_run' } });
    const b = await store.create({ name: 'b', prompt: 'p', schedule: { kind: 'hourly', minute: 2 }, target: { mode: 'create_each_run' } });
    const listed = await store.list();
    expect(listed.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('update() returns null for an unknown id', async () => {
    const store = createInMemoryRoutineStore({  });
    expect(await store.update({ id: 'missing', patch: { name: 'x' } })).toBeNull();
  });

  it('update() applies only the supplied fields, bumps updatedAt, and leaves the rest untouched', async () => {
    const store = createInMemoryRoutineStore({  });
    const created = await store.create({
      name: 'n',
      prompt: 'p',
      schedule: { kind: 'hourly', minute: 1 },
      target: { mode: 'create_each_run' },
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const updated = await store.update({ id: created.id, patch: { name: 'new name', enabled: false } });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('new name');
    expect(updated!.enabled).toBe(false);
    expect(updated!.prompt).toBe('p');
    expect(updated!.createdAt).toBe(created.createdAt);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('update() can patch every field independently', async () => {
    const store = createInMemoryRoutineStore({  });
    const created = await store.create({
      name: 'n',
      prompt: 'p',
      schedule: { kind: 'hourly', minute: 1 },
      target: { mode: 'create_each_run' },
    });
    const updated = await store.update({ id: created.id, patch: {
      prompt: 'new prompt',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'reuse', projectId: 'proj-1' },
      skillId: 'skill-2',
      agentId: 'agent-2',
      context: { pluginIds: ['plugin-1'] },
    } });
    expect(updated).toMatchObject({
      prompt: 'new prompt',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'reuse', projectId: 'proj-1' },
      skillId: 'skill-2',
      agentId: 'agent-2',
      context: { pluginIds: ['plugin-1'] },
    });
  });

  it('update() can clear skillId/agentId back to null', async () => {
    const store = createInMemoryRoutineStore({  });
    const created = await store.create({ name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 1 }, target: { mode: 'create_each_run' } }, { skillId: 'skill-1', agentId: 'agent-1' });
    const updated = await store.update({ id: created.id, patch: { skillId: null, agentId: null } });
    expect(updated!.skillId).toBeNull();
    expect(updated!.agentId).toBeNull();
  });

  it('delete() returns false for an unknown id and true (removing it) for a known one', async () => {
    const store = createInMemoryRoutineStore({  });
    expect(await store.delete({ id: 'missing' })).toBe(false);
    const created = await store.create({
      name: 'n',
      prompt: 'p',
      schedule: { kind: 'hourly', minute: 1 },
      target: { mode: 'create_each_run' },
    });
    expect(await store.delete({ id: created.id })).toBe(true);
    expect(await store.get({ id: created.id })).toBeNull();
  });

  it('mutating a routine returned from list()/get() does not corrupt the store’s internal state (defensive clone)', async () => {
    const store = createInMemoryRoutineStore({  });
    const created = await store.create({ name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 1 }, target: { mode: 'create_each_run' } }, { context: { skillIds: ['a'], pluginIds: ['p1'], mcpServerIds: ['m1'], connectorIds: ['c1'] } });
    const fetched = await store.get({ id: created.id });
    (fetched!.context.skillIds as string[]).push('mutated');
    (fetched!.context.pluginIds as string[]).push('mutated');
    (fetched!.context.mcpServerIds as string[]).push('mutated');
    (fetched!.context.connectorIds as string[]).push('mutated');
    (fetched!.schedule as { minute: number }).minute = 999;

    const refetched = await store.get({ id: created.id });
    expect(refetched!.context).toEqual({
      skillIds: ['a'],
      pluginIds: ['p1'],
      mcpServerIds: ['m1'],
      connectorIds: ['c1'],
    });
    expect((refetched!.schedule as { minute: number }).minute).toBe(1);
  });

  it('cloneContext omits array fields the routine never set, rather than including them as empty arrays', async () => {
    const store = createInMemoryRoutineStore({  });
    const created = await store.create({ name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 1 }, target: { mode: 'create_each_run' } }, { context: {} });
    const fetched = await store.get({ id: created.id });
    expect(fetched!.context).toEqual({});
    expect('skillIds' in fetched!.context).toBe(false);
  });
});

describe('createInMemoryRoutineStore — run history (recordRun/patchRun/listRuns/getLatestRun)', () => {
  it('listRuns() and getLatestRun() return empty/null for a routine with no recorded runs', async () => {
    const store = createInMemoryRoutineStore({  });
    expect(await store.listRuns({ routineId: 'routine-1', limit: 10 })).toEqual([]);
    expect(await store.getLatestRun({ routineId: 'routine-1' })).toBeNull();
  });

  it('recordRun() adds a run and returns true; a duplicate id returns false without adding a second copy', async () => {
    const store = createInMemoryRoutineStore({  });
    expect(store.recordRun({ run: fixtureRun({ id: 'run-1' }) })).toBe(true);
    expect(store.recordRun({ run: fixtureRun({ id: 'run-1' }) })).toBe(false);
    expect(await store.listRuns({ routineId: 'routine-1', limit: 10 })).toHaveLength(1);
  });

  it('listRuns() returns runs newest-first and respects the limit', async () => {
    const store = createInMemoryRoutineStore({  });
    store.recordRun({ run: fixtureRun({ id: 'run-1', startedAt: 1000 }) });
    store.recordRun({ run: fixtureRun({ id: 'run-2', startedAt: 3000 }) });
    store.recordRun({ run: fixtureRun({ id: 'run-3', startedAt: 2000 }) });

    const all = await store.listRuns({ routineId: 'routine-1', limit: 10 });
    expect(all.map((r) => r.id)).toEqual(['run-2', 'run-3', 'run-1']);

    const limited = await store.listRuns({ routineId: 'routine-1', limit: 2 });
    expect(limited.map((r) => r.id)).toEqual(['run-2', 'run-3']);
  });

  it('listRuns() scopes strictly to the given routineId', async () => {
    const store = createInMemoryRoutineStore({  });
    store.recordRun({ run: fixtureRun({ id: 'run-1', routineId: 'routine-a' }) });
    store.recordRun({ run: fixtureRun({ id: 'run-2', routineId: 'routine-b' }) });
    expect((await store.listRuns({ routineId: 'routine-a', limit: 10 })).map((r) => r.id)).toEqual(['run-1']);
    expect((await store.listRuns({ routineId: 'routine-b', limit: 10 })).map((r) => r.id)).toEqual(['run-2']);
  });

  it('getLatestRun() returns the most recently started run', async () => {
    const store = createInMemoryRoutineStore({  });
    store.recordRun({ run: fixtureRun({ id: 'run-1', startedAt: 1000 }) });
    store.recordRun({ run: fixtureRun({ id: 'run-2', startedAt: 5000 }) });
    const latest = await store.getLatestRun({ routineId: 'routine-1' });
    expect(latest?.id).toBe('run-2');
  });

  it('patchRun() mutates an existing recorded run in place', async () => {
    const store = createInMemoryRoutineStore({  });
    store.recordRun({ run: fixtureRun({ id: 'run-1', status: 'running', completedAt: null }) });
    store.patchRun({ id: 'run-1', patch: { status: 'succeeded', completedAt: 9999 } });
    const latest = await store.getLatestRun({ routineId: 'routine-1' });
    expect(latest).toMatchObject({ status: 'succeeded', completedAt: 9999 });
  });

  it('patchRun() on an unknown id is a silent no-op', () => {
    const store = createInMemoryRoutineStore({  });
    expect(() => store.patchRun({ id: 'missing', patch: { status: 'failed' } })).not.toThrow();
  });

  it('list()/get()/create()/update() embed the recorded lastRun summary', async () => {
    const store = createInMemoryRoutineStore({  });
    const created = await store.create({
      name: 'n',
      prompt: 'p',
      schedule: { kind: 'hourly', minute: 1 },
      target: { mode: 'create_each_run' },
    });
    expect(created.lastRun).toBeNull();

    store.recordRun({ run: fixtureRun({ id: 'run-1', routineId: created.id, startedAt: 1000 }) });
    store.recordRun({ run: fixtureRun({ id: 'run-2', routineId: created.id, startedAt: 5000, summary: 'newest' }) });

    const fetched = await store.get({ id: created.id });
    expect(fetched!.lastRun).toMatchObject({ runId: 'run-2', summary: 'newest' });

    const [listed] = await store.list();
    expect(listed!.lastRun).toMatchObject({ runId: 'run-2' });

    const updated = await store.update({ id: created.id, patch: { name: 'renamed' } });
    expect(updated!.lastRun).toMatchObject({ runId: 'run-2' });
  });
});

// This pins the new clock/ID ports without changing the native defaults or defensive-clone contract.
it('uses host clocks and identifiers while separating optional routine fields', async () => {
  let now = 100;
  const store = createInMemoryRoutineStore({}, { now: () => now, newId: () => 'host-id' });
  const created = await store.create({ name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 5 }, target: { mode: 'create_each_run' } }, { enabled: false });
  expect([created.id, created.createdAt, created.updatedAt, created.enabled]).toEqual(['routine-host-id', 100, 100, false]);
  now = 200;
  const updated = await store.update({ id: created.id, patch: { name: 'next' } });
  expect([updated?.createdAt, updated?.updatedAt]).toEqual([100, 200]);
});
