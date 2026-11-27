import { describe, expect, it, vi } from 'vitest';
import { ClientFacingError } from '@jini-ai/core/contracts/server';
import { RoutineActiveError } from '../../routines/routine-errors.js';
import { denyAllOrigins } from '@jini-ai/core/contracts/server/testing';
import { fakeDaemonRouteHost } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { describeRoutes } from '../route-table.js';
import {
  createInMemoryRoutineStore,
  validateSchedule,
  type Routine,
  type RoutineRun,
  type RoutineStore,
} from '../../index.js';
import {
  routineRoutes,
  createRoutineCreateRoute,
  createRoutineListRoute,
  createRoutineGetRoute,
  createRoutineRunsRoute,
  createRoutineRunNowRoute,
  createRoutineUpdateRoute,
  createRoutineDeleteRoute,
  routineCreateRoute,
  routineDeleteRoute,
  routineGetRoute,
  routineListRoute,
  routineRunNowRoute,
  routineRunsListRoute,
  routineUpdateRoute,
  type RoutineHttpDeps,
  type RoutineScheduler,
} from '../routines.js';

// `validateSchedule`/`validateTarget` (real @jini-ai/daemon logic, unmocked in every other test in this
// file via the wrapping vi.fn below) always throw genuine `Error` instances in practice — confirmed by
// reading their source. `parseSchedule`'s `errorMessage` fallback for a non-Error throw is therefore
// dead through any real input; this mock lets exactly one test prove that defensive branch works
// without weakening real validation for every other test (the wrapper delegates to the actual
// implementation by default).
vi.mock('../../index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../index.js')>();
  return { ...actual, validateSchedule: vi.fn(actual.validateSchedule) };
});


function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Daily brief',
    prompt: 'Summarize the day',
    schedule: { kind: 'hourly', minute: 5 },
    target: { mode: 'create_each_run' },
    ...overrides,
  };
}

function makeScheduler(overrides: Partial<RoutineScheduler> = {}): RoutineScheduler {
  return {
    nextRunAt: vi.fn(() => null),
    rescheduleOne: vi.fn(),
    unschedule: vi.fn(),
    runNow: vi.fn(async () => ({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
      completion: Promise.resolve({ status: 'succeeded' as const }),
    })),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<RoutineHttpDeps> = {}): RoutineHttpDeps {
  return { store: createInMemoryRoutineStore({}), scheduler: makeScheduler(), ...overrides };
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

describe('routineCreateRoute.parse', () => {
  it('rejects a non-object body', () => {
    const result = routineCreateRoute.parse({ body: 'nope', query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('rejects a missing/blank name', () => {
    const result = routineCreateRoute.parse({ body: validCreateBody({ name: '  ' }), query: {}, params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('name is required');
  });

  it('rejects a missing/blank prompt', () => {
    const result = routineCreateRoute.parse({ body: validCreateBody({ prompt: '' }), query: {}, params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('prompt is required');
  });

  it('rejects an invalid schedule, surfacing validateSchedule\'s own message', () => {
    const result = routineCreateRoute.parse({
      body: validCreateBody({ schedule: { kind: 'hourly', minute: 99 } }),
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/hourly\.minute/);
  });

  it('rejects an invalid target, surfacing validateTarget\'s own message', () => {
    const result = routineCreateRoute.parse({
      body: validCreateBody({ target: { mode: 'reuse', projectId: '' } }),
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/projectId/);
  });

  it('rejects a non-string/empty skillId', () => {
    const result = routineCreateRoute.parse({ body: validCreateBody({ skillId: '' }), query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string/empty agentId', () => {
    const result = routineCreateRoute.parse({ body: validCreateBody({ agentId: '' }), query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('accepts an explicit null skillId/agentId', () => {
    const result = routineCreateRoute.parse({
      body: validCreateBody({ skillId: null, agentId: null }),
      query: {},
      params: {},
    });
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ skillId: null, agentId: null }),
    });
  });

  it('omits skillId/agentId entirely when absent, rather than as undefined', () => {
    const result = routineCreateRoute.parse({ body: validCreateBody(), query: {}, params: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('skillId' in result.value).toBe(false);
      expect('agentId' in result.value).toBe(false);
    }
  });

  it('accepts skillId/agentId strings without trimming (matches OD, which trims name/prompt but not these two)', () => {
    const result = routineCreateRoute.parse({
      body: validCreateBody({ skillId: ' skill-1 ', agentId: 'agent-1' }),
      query: {},
      params: {},
    });
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ skillId: ' skill-1 ', agentId: 'agent-1' }),
    });
  });

  it('rejects a non-object context', () => {
    const result = routineCreateRoute.parse({ body: validCreateBody({ context: 'nope' }), query: {}, params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('context must be an object');
  });

  it('rejects a context array field that is not an array', () => {
    const result = routineCreateRoute.parse({
      body: validCreateBody({ context: { skillIds: 'nope' } }),
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('context.skillIds must be an array');
  });

  it('rejects a context array field with a non-string entry', () => {
    const result = routineCreateRoute.parse({
      body: validCreateBody({ context: { skillIds: [42] } }),
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('context.skillIds must contain strings');
  });

  it('trims and de-duplicates context array entries, dropping blanks', () => {
    const result = routineCreateRoute.parse({
      body: validCreateBody({ context: { skillIds: [' a ', 'a', '', '  ', 'b'] } }),
      query: {},
      params: {},
    });
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ context: { skillIds: ['a', 'b'] } }) });
  });

  it('drops a context field entirely when its cleaned array is empty, rather than keeping []', () => {
    const result = routineCreateRoute.parse({
      body: validCreateBody({ context: { skillIds: ['', '  '] } }),
      query: {},
      params: {},
    });
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ context: {} }) });
  });

  it('defaults context to {} when absent or null', () => {
    expect(routineCreateRoute.parse({ body: validCreateBody(), query: {}, params: {} })).toEqual({
      ok: true,
      value: expect.objectContaining({ context: {} }),
    });
    expect(routineCreateRoute.parse({ body: validCreateBody({ context: null }), query: {}, params: {} })).toEqual({
      ok: true,
      value: expect.objectContaining({ context: {} }),
    });
  });

  it('accepts every context field (skillIds/pluginIds/mcpServerIds/connectorIds)', () => {
    const result = routineCreateRoute.parse({
      body: validCreateBody({
        context: { skillIds: ['s1'], pluginIds: ['p1'], mcpServerIds: ['m1'], connectorIds: ['c1'] },
      }),
      query: {},
      params: {},
    });
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        context: { skillIds: ['s1'], pluginIds: ['p1'], mcpServerIds: ['m1'], connectorIds: ['c1'] },
      }),
    });
  });

  it('rejects a non-boolean enabled', () => {
    const result = routineCreateRoute.parse({ body: validCreateBody({ enabled: 'yes' }), query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('omits enabled entirely when absent, and includes it when provided', () => {
    const absent = routineCreateRoute.parse({ body: validCreateBody(), query: {}, params: {} });
    expect(absent.ok && 'enabled' in absent.value).toBe(false);
    const present = routineCreateRoute.parse({ body: validCreateBody({ enabled: false }), query: {}, params: {} });
    expect(present).toEqual({ ok: true, value: expect.objectContaining({ enabled: false }) });
  });

  it('falls back to String(error) for a non-Error throw from validateSchedule (defensive; real validateSchedule always throws genuine Errors)', () => {
    vi.mocked(validateSchedule).mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'raw schedule failure';
    });
    const result = routineCreateRoute.parse({ body: validCreateBody(), query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'raw schedule failure' } });
  });

  it('accepts a fully valid minimal body', () => {
    const result = routineCreateRoute.parse({ body: validCreateBody(), query: {}, params: {} });
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Daily brief',
        prompt: 'Summarize the day',
        schedule: { kind: 'hourly', minute: 5 },
        target: { mode: 'create_each_run' },
        context: {},
      },
    });
  });
});

describe('routineGetRoute.parse (parseRoutineId)', () => {
  it('accepts a non-empty id path parameter', () => {
    expect(routineGetRoute.parse({ body: {}, query: {}, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: 'routine-1',
    });
  });

  it('rejects a missing id', () => {
    const result = routineGetRoute.parse({ body: {}, query: {}, params: {} });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'id must be a non-empty path parameter' },
    });
  });

  it('rejects an empty-string id', () => {
    expect(routineGetRoute.parse({ body: {}, query: {}, params: { id: '' } }).ok).toBe(false);
  });
});

describe('routineUpdateRoute.parse', () => {
  it('rejects a missing id before validating the body', () => {
    const result = routineUpdateRoute.parse({ body: {}, query: {}, params: {} });
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'id must be a non-empty path parameter' },
    });
  });

  it('rejects a non-object body', () => {
    const result = routineUpdateRoute.parse({ body: 'nope', query: {}, params: { id: 'routine-1' } });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('accepts an empty patch object (no fields to update)', () => {
    const result = routineUpdateRoute.parse({ body: {}, query: {}, params: { id: 'routine-1' } });
    expect(result).toEqual({ ok: true, value: { id: 'routine-1', patch: {} } });
  });

  it('validates and includes only the fields present in the body', () => {
    const result = routineUpdateRoute.parse({
      body: { name: 'new name', enabled: false },
      query: {},
      params: { id: 'routine-1' },
    });
    expect(result).toEqual({ ok: true, value: { id: 'routine-1', patch: { name: 'new name', enabled: false } } });
  });

  it('rejects an invalid name when present', () => {
    const result = routineUpdateRoute.parse({ body: { name: '' }, query: {}, params: { id: 'routine-1' } });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid prompt when present', () => {
    const result = routineUpdateRoute.parse({ body: { prompt: '' }, query: {}, params: { id: 'routine-1' } });
    expect(result.ok).toBe(false);
  });

  it('includes a valid prompt patch', () => {
    const result = routineUpdateRoute.parse({ body: { prompt: 'new prompt' }, query: {}, params: { id: 'routine-1' } });
    expect(result).toEqual({ ok: true, value: { id: 'routine-1', patch: { prompt: 'new prompt' } } });
  });

  it('rejects an invalid schedule when present', () => {
    const result = routineUpdateRoute.parse({
      body: { schedule: { kind: 'hourly', minute: 99 } },
      query: {},
      params: { id: 'routine-1' },
    });
    expect(result.ok).toBe(false);
  });

  it('includes a valid schedule patch', () => {
    const result = routineUpdateRoute.parse({
      body: { schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } },
      query: {},
      params: { id: 'routine-1' },
    });
    expect(result).toEqual({
      ok: true,
      value: { id: 'routine-1', patch: { schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } } },
    });
  });

  it('rejects an invalid target when present', () => {
    const result = routineUpdateRoute.parse({
      body: { target: { mode: 'reuse', projectId: '' } },
      query: {},
      params: { id: 'routine-1' },
    });
    expect(result.ok).toBe(false);
  });

  it('includes a valid target patch', () => {
    const result = routineUpdateRoute.parse({
      body: { target: { mode: 'reuse', projectId: 'proj-1' } },
      query: {},
      params: { id: 'routine-1' },
    });
    expect(result).toEqual({
      ok: true,
      value: { id: 'routine-1', patch: { target: { mode: 'reuse', projectId: 'proj-1' } } },
    });
  });

  it('accepts and clears skillId/agentId to null', () => {
    const result = routineUpdateRoute.parse({
      body: { skillId: null, agentId: null },
      query: {},
      params: { id: 'routine-1' },
    });
    expect(result).toEqual({ ok: true, value: { id: 'routine-1', patch: { skillId: null, agentId: null } } });
  });

  it('rejects an invalid skillId/agentId when present', () => {
    expect(routineUpdateRoute.parse({ body: { skillId: 42 }, query: {}, params: { id: 'routine-1' } }).ok).toBe(false);
    expect(routineUpdateRoute.parse({ body: { agentId: '' }, query: {}, params: { id: 'routine-1' } }).ok).toBe(false);
  });

  it('rejects an invalid context when present', () => {
    const result = routineUpdateRoute.parse({ body: { context: 'nope' }, query: {}, params: { id: 'routine-1' } });
    expect(result.ok).toBe(false);
  });

  it('includes a valid context patch', () => {
    const result = routineUpdateRoute.parse({
      body: { context: { skillIds: ['a'] } },
      query: {},
      params: { id: 'routine-1' },
    });
    expect(result).toEqual({ ok: true, value: { id: 'routine-1', patch: { context: { skillIds: ['a'] } } } });
  });

  it('rejects a non-boolean enabled when present', () => {
    const result = routineUpdateRoute.parse({ body: { enabled: 'no' }, query: {}, params: { id: 'routine-1' } });
    expect(result.ok).toBe(false);
  });
});

describe('routineRunsListRoute.parse', () => {
  it('rejects a missing id', () => {
    expect(routineRunsListRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
  });

  it('defaults limit to 20 when absent', () => {
    expect(routineRunsListRoute.parse({ body: {}, query: {}, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: { id: 'routine-1', limit: 20, cursor: null },
    });
  });

  it('honors a valid limit within range', () => {
    expect(routineRunsListRoute.parse({ body: {}, query: { limit: '50' }, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: { id: 'routine-1', limit: 50, cursor: null },
    });
  });

  it('clamps a limit above 100 down to 100', () => {
    expect(routineRunsListRoute.parse({ body: {}, query: { limit: '500' }, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: { id: 'routine-1', limit: 100, cursor: null },
    });
  });

  it('falls back to the default (20) for zero or NaN', () => {
    // Zero and NaN retain the historical fallback; negatives now use the same documented default.
    expect(routineRunsListRoute.parse({ body: {}, query: { limit: '0' }, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: { id: 'routine-1', limit: 20, cursor: null },
    });
    expect(routineRunsListRoute.parse({ body: {}, query: { limit: 'garbage' }, params: { id: 'routine-1' } })).toEqual(
      { ok: true, value: { id: 'routine-1', limit: 20, cursor: null } },
    );
  });

  it.each([{ limit: '-5' }, { limit: '-0.5' }, { limit: ['-5', '99'] }])('falls back to 20 for a negative limit ($limit)', ({ limit }) => {
    expect(routineRunsListRoute.parse({ body: {}, query: { limit }, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: { id: 'routine-1', limit: 20, cursor: null },
    });
  });

  it('takes the first element when limit is a repeated query param (array)', () => {
    expect(
      routineRunsListRoute.parse({ body: {}, query: { limit: ['5', '99'] }, params: { id: 'routine-1' } }),
    ).toEqual({ ok: true, value: { id: 'routine-1', limit: 5, cursor: null } });
  });
});

// ---------------------------------------------------------------------------
// handle
// ---------------------------------------------------------------------------

describe('routineListRoute.handle', () => {
  it('returns an empty list for a fresh store', async () => {
    const deps = makeDeps();
    const result = await routineListRoute.handle({ input: undefined, deps });
    expect(result).toEqual({ ok: true, value: { routines: [] } });
  });

  it('overlays the scheduler\'s live nextRunAt onto every listed routine', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const fireAt = new Date('2030-01-01T00:00:00Z');
    const scheduler = makeScheduler({ nextRunAt: vi.fn(() => fireAt) });
    const deps = makeDeps({ store, scheduler });

    const result = await routineListRoute.handle({ input: undefined, deps });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.routines).toHaveLength(1);
      expect(result.value.routines[0]!.nextRunAt).toBe(fireAt.getTime());
      expect(scheduler.nextRunAt).toHaveBeenCalledWith({ routineId: routine.id });
    }
  });

  it('reports nextRunAt: null when the scheduler has nothing scheduled for a routine', async () => {
    const store = createInMemoryRoutineStore({});
    await store.create(validCreateBody() as any);
    const deps = makeDeps({ store });
    const result = await routineListRoute.handle({ input: undefined, deps });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.routines[0]!.nextRunAt).toBeNull();
  });
});

describe('routineCreateRoute.handle', () => {
  it('creates a routine, reschedules it, and returns it with nextRunAt overlaid', async () => {
    const scheduler = makeScheduler({ nextRunAt: vi.fn(() => new Date('2030-01-01T00:00:00Z')) });
    const deps = makeDeps({ scheduler });
    const result = await routineCreateRoute.handle({ input: { name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 1 }, target: { mode: 'create_each_run' }, context: {} }, deps }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.routine.name).toBe('n');
      expect(result.value.routine.nextRunAt).toBe(new Date('2030-01-01T00:00:00Z').getTime());
    }
    expect(scheduler.rescheduleOne).toHaveBeenCalledWith({ routineId: (await deps.store.list())[0]!.id });
  });

  it('rejects a reuse target whose project does not exist, when projectExists is supplied', async () => {
    const deps = makeDeps({ projectExists: vi.fn(() => false) });
    const result = await routineCreateRoute.handle({
      input: {
        name: 'n',
        prompt: 'p',
        schedule: { kind: 'hourly', minute: 1 },
        target: { mode: 'reuse', projectId: 'missing-project' },
        context: {},
      }, deps
    }
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'target project missing-project not found' },
    });
    expect(await deps.store.list()).toEqual([]);
  });

  it('accepts a reuse target whose project exists, when projectExists is supplied', async () => {
    const projectExists = vi.fn(() => true);
    const deps = makeDeps({ projectExists });
    const result = await routineCreateRoute.handle({
      input: {
        name: 'n',
        prompt: 'p',
        schedule: { kind: 'hourly', minute: 1 },
        target: { mode: 'reuse', projectId: 'proj-1' },
        context: {},
      }, deps
    }
    );
    expect(result.ok).toBe(true);
    expect(projectExists).toHaveBeenCalledWith({ projectId: 'proj-1' });
  });

  it('accepts any reuse target when projectExists is not supplied (permissive default)', async () => {
    const deps = makeDeps();
    const result = await routineCreateRoute.handle({
      input: {
        name: 'n',
        prompt: 'p',
        schedule: { kind: 'hourly', minute: 1 },
        target: { mode: 'reuse', projectId: 'whatever' },
        context: {},
      }, deps
    }
    );
    expect(result.ok).toBe(true);
  });

  it('does not consult projectExists for a create_each_run target', async () => {
    const projectExists = vi.fn(() => false);
    const deps = makeDeps({ projectExists });
    const result = await routineCreateRoute.handle({ input: { name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 1 }, target: { mode: 'create_each_run' }, context: {} }, deps }
    );
    expect(result.ok).toBe(true);
    expect(projectExists).not.toHaveBeenCalled();
  });

  it('supports an async projectExists predicate', async () => {
    const deps = makeDeps({ projectExists: async () => true });
    const result = await routineCreateRoute.handle({
      input: {
        name: 'n',
        prompt: 'p',
        schedule: { kind: 'hourly', minute: 1 },
        target: { mode: 'reuse', projectId: 'proj-1' },
        context: {},
      }, deps
    }
    );
    expect(result.ok).toBe(true);
  });
});

describe('routineGetRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id', async () => {
    const deps = makeDeps();
    const result = await routineGetRoute.handle({ input: 'missing', deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
  });

  it('returns the routine with nextRunAt overlaid when found', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const fireAt = new Date('2030-06-01T00:00:00Z');
    const deps = makeDeps({ store, scheduler: makeScheduler({ nextRunAt: vi.fn(() => fireAt) }) });
    const result = await routineGetRoute.handle({ input: routine.id, deps });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.routine.nextRunAt).toBe(fireAt.getTime());
  });
});

describe('routineUpdateRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id', async () => {
    const deps = makeDeps();
    const result = await routineUpdateRoute.handle({ input: { id: 'missing', patch: { name: 'x' } }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
  });

  it('applies the patch, reschedules, and returns the updated routine', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const scheduler = makeScheduler();
    const deps = makeDeps({ store, scheduler });
    const result = await routineUpdateRoute.handle({ input: { id: routine.id, patch: { name: 'renamed' } }, deps });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.routine.name).toBe('renamed');
    expect(scheduler.rescheduleOne).toHaveBeenCalledWith({ routineId: routine.id });
  });

  it('validates a reuse target project via projectExists before applying the patch', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const projectExists = vi.fn(() => false);
    const deps = makeDeps({ store, projectExists });
    const result = await routineUpdateRoute.handle({ input: { id: routine.id, patch: { target: { mode: 'reuse', projectId: 'missing' } } }, deps }
    );
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'target project missing not found' } });
    // The store was never mutated since the check failed before store.update() was called.
    expect((await store.get({ id: routine.id }))!.target).toEqual({ mode: 'create_each_run' });
  });

  it('does not consult projectExists when the patch has no target field', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const projectExists = vi.fn(() => false);
    const deps = makeDeps({ store, projectExists });
    const result = await routineUpdateRoute.handle({ input: { id: routine.id, patch: { name: 'x' } }, deps });
    expect(result.ok).toBe(true);
    expect(projectExists).not.toHaveBeenCalled();
  });
});

describe('routineDeleteRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id', async () => {
    const deps = makeDeps();
    const result = await routineDeleteRoute.handle({ input: 'missing', deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
  });

  it('unschedules and deletes an existing routine', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const scheduler = makeScheduler();
    const deps = makeDeps({ store, scheduler });
    const result = await routineDeleteRoute.handle({ input: routine.id, deps });
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(scheduler.unschedule).toHaveBeenCalledWith({ routineId: routine.id });
    expect(await store.get({ id: routine.id })).toBeNull();
  });

  it('still calls unschedule() even when the id turns out not to exist (matches OD\'s own unconditional unschedule-before-delete ordering)', async () => {
    const scheduler = makeScheduler();
    const deps = makeDeps({ scheduler });
    await routineDeleteRoute.handle({ input: 'missing', deps });
    expect(scheduler.unschedule).toHaveBeenCalledWith({ routineId: 'missing' });
  });
});

describe('routineRunNowRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id without invoking the scheduler', async () => {
    const scheduler = makeScheduler();
    const deps = makeDeps({ scheduler });
    const result = await routineRunNowRoute.handle({ input: 'missing', deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
    expect(scheduler.runNow).not.toHaveBeenCalled();
  });

  it('fires the routine and returns the started projectId/conversationId/agentRunId plus the refreshed routine', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const scheduler = makeScheduler({
      runNow: vi.fn(async () => ({
        projectId: 'p-live',
        conversationId: 'c-live',
        agentRunId: 'a-live',
        completion: Promise.resolve({ status: 'succeeded' as const }),
      })),
    });
    const deps = makeDeps({ store, scheduler });
    const result = await routineRunNowRoute.handle({ input: routine.id, deps });
    expect(result).toEqual({
      ok: true,
      value: {
        routine: expect.objectContaining({ id: routine.id }),
        run: null, // no host bridge wired in this test — see module doc
        projectId: 'p-live',
        conversationId: 'c-live',
        agentRunId: 'a-live',
      },
    });
    expect(scheduler.runNow).toHaveBeenCalledWith({ routineId: routine.id });
  });

  it('reflects a run recorded via a host-bridged store (the documented integration seam)', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const run: RoutineRun = {
      id: 'run-1',
      routineId: routine.id,
      trigger: 'manual',
      status: 'running',
      projectId: 'p-live',
      conversationId: 'c-live',
      agentRunId: 'a-live',
      startedAt: Date.now(),
      completedAt: null,
      summary: null,
      error: null,
      errorCode: null,
    };
    const scheduler = makeScheduler({
      runNow: vi.fn(async () => {
        // Simulate a host bridging RoutinePersistence.insertRun into the same store instance.
        store.recordRun({ run });
        return {
          projectId: run.projectId,
          conversationId: run.conversationId,
          agentRunId: run.agentRunId,
          completion: Promise.resolve({ status: 'succeeded' as const }),
        };
      }),
    });
    const deps = makeDeps({ store, scheduler });
    const result = await routineRunNowRoute.handle({ input: routine.id, deps });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.run).toEqual(run);
  });

  it('returns routine: null when the routine was deleted between the existence check and re-fetch', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const scheduler = makeScheduler({
      runNow: vi.fn(async () => {
        await store.delete({ id: routine.id });
        return {
          projectId: 'p',
          conversationId: 'c',
          agentRunId: 'a',
          completion: Promise.resolve({ status: 'succeeded' as const }),
        };
      }),
    });
    const deps = makeDeps({ store, scheduler });
    const result = await routineRunNowRoute.handle({ input: routine.id, deps });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.routine).toBeNull();
  });
});

describe('routineRunsListRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id', async () => {
    const deps = makeDeps();
    const result = await routineRunsListRoute.handle({ input: { id: 'missing', limit: 20, cursor: null }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
  });

  it('returns run history for an existing routine, respecting the limit', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    store.recordRun({ run: {
      id: 'run-1',
      routineId: routine.id,
      trigger: 'manual',
      status: 'succeeded',
      projectId: 'p',
      conversationId: 'c',
      agentRunId: 'a',
      startedAt: 1,
      completedAt: 2,
      summary: null,
      error: null,
      errorCode: null,
    } });
    const deps = makeDeps({ store });
    const result = await routineRunsListRoute.handle({ input: { id: routine.id, limit: 20, cursor: null }, deps });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.runs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// routineRoutes — the list, same-origin, and the confirmed-bug regression
// ---------------------------------------------------------------------------

describe('routineRoutes', () => {
  const serve = ({ deps, denyOrigins = false }: { deps: RoutineHttpDeps; denyOrigins?: boolean }) =>
    serveRoutes({ routes: routineRoutes({ deps, host: fakeDaemonRouteHost({}, denyOrigins ? { originPolicy: denyAllOrigins } : {}) }) });
  const send = async ({ deps, method = 'GET', path, body, denyOrigins = false }: { deps: RoutineHttpDeps; method?: string; path: string; body?: unknown; denyOrigins?: boolean }) => {
    const response = await serve({ deps, denyOrigins })(jsonRequest({ path, method }, { body }));
    return { status: response.status, body: await response.json() as unknown };
  };

  it('lists exactly the seven routine routes, the four writes behind the same-origin gate', () => {
    expect(describeRoutes({ routes: routineRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) })).toEqual([
      { method: 'GET', path: '/api/routines', gates: [] },
      { method: 'POST', path: '/api/routines', gates: ['same-origin'] },
      { method: 'GET', path: '/api/routines/:id', gates: [] },
      { method: 'PATCH', path: '/api/routines/:id', gates: ['same-origin'] },
      { method: 'DELETE', path: '/api/routines/:id', gates: ['same-origin'] },
      { method: 'POST', path: '/api/routines/:id/run', gates: ['same-origin'] },
      { method: 'GET', path: '/api/routines/:id/runs', gates: [] },
    ]);
  });

  it('does not require same-origin for the three read-only GET routes', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const deps = makeDeps({ store });
    const statuses = await Promise.all(['/api/routines', `/api/routines/${routine.id}`, `/api/routines/${routine.id}/runs`].map(async (path) => (await send({ deps, path, denyOrigins: true })).status));
    expect(statuses).toEqual([200, 200, 200]);
  });

  it.each([
    ['POST', '/api/routines', validCreateBody()],
    ['PATCH', '/api/routines/routine-1', {}],
    ['DELETE', '/api/routines/routine-1', undefined],
    ['POST', '/api/routines/routine-1/run', {}],
  ] as const)('requires same-origin for %s %s', async (method, path, body) => {
    expect((await send({ deps: makeDeps(), method, path, body, denyOrigins: true })).status).toBe(403);
  });

  it('serves GET and POST /api/routines end to end, creating a routine through the real JSON route pipeline', async () => {
    const deps = makeDeps();
    const created = await send({ deps, method: 'POST', path: '/api/routines', body: validCreateBody() });
    expect(created.status).toBe(201);
    const createdBody = created.body as { routine: { id: string; name: string } };
    expect(createdBody.routine.name).toBe('Daily brief');

    const listed = await send({ deps, path: '/api/routines' });
    expect(listed.status).toBe(200);
    expect((listed.body as { routines: { id: string }[] }).routines.map((routine) => routine.id)).toEqual([createdBody.routine.id]);
  });

  it('serves GET, PATCH, and DELETE /api/routines/:id end to end, then 404s the deleted id', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const scheduler = makeScheduler();
    const deps = makeDeps({ store, scheduler });

    const got = await send({ deps, path: `/api/routines/${routine.id}` });
    expect(got.status).toBe(200);
    expect((got.body as { routine: { id: string } }).routine.id).toBe(routine.id);

    const patched = await send({ deps, method: 'PATCH', path: `/api/routines/${routine.id}`, body: { name: 'renamed' } });
    expect(patched.status).toBe(200);
    expect((patched.body as { routine: { name: string } }).routine.name).toBe('renamed');
    expect(scheduler.rescheduleOne).toHaveBeenCalledWith({ routineId: routine.id });

    expect(await send({ deps, method: 'DELETE', path: `/api/routines/${routine.id}` })).toEqual({ status: 200, body: { ok: true } });

    expect(await send({ deps, path: `/api/routines/${routine.id}` })).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'routine not found' } },
    });
  });

  it('serves POST /api/routines/:id/run and GET /api/routines/:id/runs end to end', async () => {
    const store = createInMemoryRoutineStore({});
    const routine = await store.create(validCreateBody() as any);
    const deps = makeDeps({ store });

    const started = await send({ deps, method: 'POST', path: `/api/routines/${routine.id}/run` });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({
      run: null, // no host bridge wired in this test — see module doc
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
    });

    expect(await send({ deps, path: `/api/routines/${routine.id}/runs` })).toEqual({ status: 200, body: { runs: [], nextCursor: null } });
    expect((await send({ deps, path: `/api/routines/${routine.id}/runs?cursor=garbage` })).status).toBe(400);
  });

  it('rejects a cross-origin create request with 403 before the routine store is ever called', async () => {
    const store = createInMemoryRoutineStore({});
    const createSpy = vi.spyOn(store, 'create');
    const response = await send({ deps: makeDeps({ store }), method: 'POST', path: '/api/routines', body: validCreateBody(), denyOrigins: true });
    expect(response.status).toBe(403);
    expect(createSpy).not.toHaveBeenCalled();
  });

  describe('confirmed-bug regression: GET/:id, DELETE/:id, and GET/:id/runs must not crash (or silently 500-loop) on a throwing store, matching every sibling route\'s try/catch discipline', () => {
    function throwingStore(): RoutineStore {
      const boom = () => {
        throw new Error('store exploded');
      };
      return {
        list: async () => [],
        get: boom,
        create: async (input: unknown) =>
          ({ ...(input as object), id: 'x', nextRunAt: null, lastRun: null, createdAt: 0, updatedAt: 0 }) as Routine,
        update: boom,
        delete: boom,
        listRuns: boom,
        getLatestRun: async () => null,
      } as unknown as RoutineStore;
    }

    it.each([
      ['GET', '/api/routines/x'],
      ['DELETE', '/api/routines/x'],
      ['GET', '/api/routines/x/runs'],
    ] as const)('%s %s returns 500 INTERNAL_ERROR instead of throwing', async (method, path) => {
      const response = await send({ deps: makeDeps({ store: throwingStore() }), method, path });
      expect(response.status).toBe(500);
      expect((response.body as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
    });
  });
});


describe('host-bound routine factories', () => {
  it('POST ignores body ownerId and uses resolveCreator', async () => {
    const deps = makeDeps();
    const resolveCreator = vi.fn(async ({ context }: { context: { principalId: string } | undefined }) => context?.principalId ?? null);
    const spec = createRoutineCreateRoute({ path: '/admin/routines', copy: {} });
    const parsed = spec.parse({ body: validCreateBody({ ownerId: 'attacker' }), params: {}, query: {} });
    expect(parsed.ok).toBe(true); if (!parsed.ok) return;
    const result = await spec.handle({ input: parsed.value, deps: { ...deps, resolveCreator }, context: { principalId: 'owner' } });
    expect(result.ok && result.value.routine.creatorId).toBe('owner');
    expect(resolveCreator).toHaveBeenCalledWith({ context: { principalId: 'owner' } }, {});
  });
  it('missing authenticated creator refuses creation', async () => {
    const deps = makeDeps(); const create = vi.spyOn(deps.store, 'create');
    const spec = createRoutineCreateRoute({ path: '/admin/routines', copy: {} });
    const parsed = spec.parse({ body: validCreateBody(), params: {}, query: {} });
    expect(parsed.ok).toBe(true); if (!parsed.ok) return;
    expect(await spec.handle({ input: parsed.value, deps: { ...deps, resolveCreator: async () => null } })).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(create).not.toHaveBeenCalled();
  });
  it('POST accepts optional model and agentId', async () => {
    const deps = makeDeps(); const spec = createRoutineCreateRoute({ path: '/admin/routines', copy: {} });
    const parsed = spec.parse({ body: validCreateBody({ agentId: 'claude', model: 'model-1' }), params: {}, query: {} });
    expect(parsed.ok).toBe(true); if (!parsed.ok) return;
    expect(await spec.handle({ input: parsed.value, deps: { ...deps, resolveCreator: async () => 'owner' } })).toMatchObject({ ok: true,
      value: { routine: { agentId: 'claude', model: 'model-1' } } });
  });
  it('legacy no-creator creation', async () => {
    const deps = makeDeps();
    expect(await routineCreateRoute.handle({ input: validCreateBody() as Parameters<typeof deps.store.create>[0], deps })).toMatchObject({ ok: true });
    expect((await deps.store.list())[0]?.creatorId).toBeUndefined();
  });
  it.each([['SQLITE_BUSY', 'SERVICE_UNAVAILABLE', 'ROUTINES_BUSY'], ['SQLITE_FULL', 'INSUFFICIENT_STORAGE', 'ROUTINES_DISK_FULL']])(
    'maps %s without exposing driver text', async (code, expected, reason) => {
      const deps = makeDeps(); vi.spyOn(deps.store, 'list').mockRejectedValue(Object.assign(new Error('private path'), { code }));
      const spec = createRoutineListRoute({ path: '/admin/routines', copy: { [reason]: 'Unavailable' } });
      expect(await spec.handle({ input: undefined, deps })).toEqual({ ok: false, error: { code: expected, message: 'Unavailable', details: { reason } } });
    });
});

describe('host-bound routine route behavior', () => {
  const copy = { ROUTINE_NOT_FOUND: 'No saved routine here.', ROUTINE_RUN_ACTIVE: 'Wait for the current run.',
    ROUTINES_UNAVAILABLE: 'Wait for the scheduler.' };
  const path = '/admin/routines/:id';
  const params = { id: 'missing' };
  const missing = { ok: false, error: { code: 'NOT_FOUND', message: 'No saved routine here.', details: { reason: 'ROUTINE_NOT_FOUND' } } };

  it('relocalizes missing routine responses for detail, run history, and run now', async () => {
    const deps = makeDeps();
    expect(await createRoutineGetRoute({ path, copy }).handle({ input: 'missing', deps })).toEqual(missing);
    expect(await createRoutineRunsRoute({ path: path + '/runs', copy }).handle({ input: { id: 'missing', limit: 5, cursor: null }, deps })).toEqual(missing);
    expect(await createRoutineRunNowRoute({ path: path + '/run', copy }).handle({ input: 'missing', deps })).toEqual(missing);
    expect(deps.scheduler.runNow).not.toHaveBeenCalled();
  });

  it('translates an active run and a caller-safe lease refusal without conflating them', async () => {
    const deps = makeDeps();
    const routine = await deps.store.create({ name: 'Brief', prompt: 'Write brief', schedule: { kind: 'hourly', minute: 5 }, target: { mode: 'create_each_run' } });
    vi.mocked(deps.scheduler.runNow).mockRejectedValueOnce(new RoutineActiveError()).mockRejectedValueOnce(new ClientFacingError({ apiError: {
      code: 'SERVICE_UNAVAILABLE', message: 'Routine lease lost', details: { reason: 'ROUTINES_UNAVAILABLE' },
    } }));
    const run = createRoutineRunNowRoute({ path: path + '/run', copy });
    expect(await run.handle({ input: routine.id, deps })).toEqual({ ok: false, error: { code: 'CONFLICT', message: 'Wait for the current run.', details: { reason: 'ROUTINE_RUN_ACTIVE' } } });
    expect(await run.handle({ input: routine.id, deps })).toEqual({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Wait for the scheduler.', details: { reason: 'ROUTINES_UNAVAILABLE' } } });
  });

  it('uses a host default target only if the request omits one, and requires a target when both are absent', async () => {
    const deps = makeDeps();
    const spec = createRoutineCreateRoute({ path: '/admin/routines', copy });
    const parsed = spec.parse({ body: validCreateBody({ target: undefined }), params: {}, query: {} });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    const trusted = { ...deps, resolveCreator: async () => 'ana' };
    expect(await spec.handle({ input: parsed.value, deps: trusted })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'target is required' } });
    expect(await deps.store.list()).toEqual([]);
    const target = { mode: 'reuse', projectId: 'project-available' } as const;
    expect(await spec.handle({ input: parsed.value, deps: { ...trusted, defaults: { target } } })).toMatchObject({ ok: true, value: { routine: { target, creatorId: 'ana' } } });
    expect(await deps.store.list()).toMatchObject([{ target, creatorId: 'ana' }]);
    const explicit = spec.parse({ body: validCreateBody({ name: 'Explicit project choice' }), params: {}, query: {} });
    if (!explicit.ok) throw new Error(JSON.stringify(explicit.error));
    expect(await spec.handle({ input: explicit.value, deps: { ...trusted, defaults: { target } } })).toMatchObject({
      ok: true, value: { routine: { name: 'Explicit project choice', target: { mode: 'create_each_run' } } },
    });
    expect((await deps.store.list()).find(routine => routine.name === 'Explicit project choice')?.target)
      .toEqual({ mode: 'create_each_run' });

  });

  it('rejects invalid update and delete revisions before handing anything to the routine store', () => {
    const patch = createRoutineUpdateRoute({ path, copy });
    const remove = createRoutineDeleteRoute({ path, copy });
    for (const expectedRevision of [null, '3', 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(patch.parse({ params, query: {}, body: { name: 'New brief', expectedRevision } }))
        .toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'expectedRevision must be a positive safe integer' } });
    }
    expect(patch.parse({ params, query: {}, body: { schedule: { kind: 'unknown' } } }))
      .toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', details: { reason: 'INVALID_SCHEDULE' } } });
    for (const revision of ['0', '1.5', ' 3', '9007199254740992', ['3', '4']]) {
      expect(remove.parse({ params, query: { revision }, body: undefined }))
        .toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'revision must be a positive safe integer' } });
    }
    expect(remove.parse({ params: {}, query: {}, body: undefined })).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'id must be a non-empty path parameter' } });
  });

  it('forwards revisions to commits, reschedules only changed routines, and unschedules only a deletion', async () => {
    const fireAt = new Date(Date.UTC(2026, 10, 27, 13));
    const deps = makeDeps({ scheduler: makeScheduler({ nextRunAt: () => fireAt }) });
    const original = await deps.store.create({ name: 'Brief', prompt: 'Write brief', schedule: { kind: 'hourly', minute: 5 }, target: { mode: 'create_each_run' } });
    const update = vi.spyOn(deps.store, 'update');
    const removeFromStore = vi.spyOn(deps.store, 'delete');
    const params = { id: original.id };
    const patch = createRoutineUpdateRoute({ path, copy });
    const remove = createRoutineDeleteRoute({ path, copy });
    const patchInput = patch.parse({ params, query: {}, body: { name: 'Renamed brief', expectedRevision: 4 } });
    if (!patchInput.ok) throw new Error(JSON.stringify(patchInput.error));
    expect(await patch.handle({ input: patchInput.value, deps })).toMatchObject({ ok: true, value: { routine: { id: original.id, name: 'Renamed brief', nextRunAt: fireAt.getTime() } } });
    expect(update.mock.calls).toEqual([[{ id: original.id, patch: { name: 'Renamed brief' } }, { expectedRevision: 4 }]]);
    expect((await deps.store.get({ id: original.id }))?.name).toBe('Renamed brief');
    expect(deps.scheduler.rescheduleOne).toHaveBeenCalledExactlyOnceWith({ routineId: original.id });

    const deleteInput = remove.parse({ params, query: { revision: '5' }, body: undefined });
    if (!deleteInput.ok) throw new Error(JSON.stringify(deleteInput.error));
    expect(await remove.handle({ input: deleteInput.value, deps })).toEqual({ ok: true, value: { ok: true } });
    expect(await deps.store.get({ id: original.id })).toBeNull();
    const legacyDelete = remove.parse({ params: { id: 'missing' }, query: {}, body: undefined });
    if (!legacyDelete.ok) throw new Error(JSON.stringify(legacyDelete.error));
    expect(await remove.handle({ input: legacyDelete.value, deps })).toEqual(missing);
    expect(removeFromStore.mock.calls).toEqual([[{ id: original.id }, { expectedRevision: 5 }], [{ id: 'missing' }, {}]]);
    expect(deps.scheduler.unschedule).toHaveBeenCalledExactlyOnceWith({ routineId: original.id });
    expect(await patch.handle({ input: { id: 'missing', patch: { name: 'Never saved' } }, deps })).toEqual(missing);
    expect(deps.scheduler.rescheduleOne).toHaveBeenCalledExactlyOnceWith({ routineId: original.id });
  });

  it('maps unavailable storage on each write and rethrows an unexpected storage error unchanged', async () => {
    const deps = makeDeps();
    const busy = Object.assign(new Error('private database path'), { code: 'SQLITE_BUSY' });
    vi.spyOn(deps.store, 'create').mockRejectedValueOnce(busy);
    vi.spyOn(deps.store, 'update').mockRejectedValueOnce(busy);
    const unexpected = new Error('unexpected store failure');
    vi.spyOn(deps.store, 'delete').mockRejectedValueOnce(busy).mockRejectedValueOnce(unexpected);
    const create = createRoutineCreateRoute({ path, copy });
    const patch = createRoutineUpdateRoute({ path, copy });
    const remove = createRoutineDeleteRoute({ path, copy });
    const parsed = create.parse({ params, query: {}, body: validCreateBody() });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    const unavailable = { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Routine storage is unavailable', details: { reason: 'ROUTINES_BUSY' } } };
    expect(await create.handle({ input: parsed.value, deps: { ...deps, resolveCreator: async () => 'ana' } })).toEqual(unavailable);
    expect(await patch.handle({ input: { id: 'r', patch: { enabled: false } }, deps })).toEqual(unavailable);
    expect(await remove.handle({ input: { id: 'r' }, deps })).toEqual(unavailable);
    await expect(remove.handle({ input: { id: 'r' }, deps })).rejects.toBe(unexpected);
    expect(deps.scheduler.rescheduleOne).not.toHaveBeenCalled();
    expect(deps.scheduler.unschedule).not.toHaveBeenCalled();
  });
});
