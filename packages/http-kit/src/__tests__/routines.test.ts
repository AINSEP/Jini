import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInMemoryRoutineStore,
  validateSchedule,
  type Routine,
  type RoutineRun,
  type RoutineStore,
} from '@jini-ai/daemon';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  registerRoutineRoutes,
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

vi.mock('../origin-validation.js', () => ({
  isLocalSameOrigin: vi.fn(() => true),
}));

// `validateSchedule`/`validateTarget` (real @jini-ai/daemon logic, unmocked in every other test in this
// file via the wrapping vi.fn below) always throw genuine `Error` instances in practice — confirmed by
// reading their source. `parseSchedule`'s `errorMessage` fallback for a non-Error throw is therefore
// dead through any real input; this mock lets exactly one test prove that defensive branch works
// without weakening real validation for every other test (the wrapper delegates to the actual
// implementation by default).
vi.mock('@jini-ai/daemon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jini-ai/daemon')>();
  return { ...actual, validateSchedule: vi.fn(actual.validateSchedule) };
});

interface MockApp {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  delete: (path: string, handler: any) => void;
  patch: (path: string, handler: any) => void;
  handlers: Record<string, (req: any, res: any) => Promise<void> | void>;
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const make = (method: string) => (path: string, handler: any) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return { get: make('get'), post: make('post'), put: make('put'), delete: make('delete'), patch: make('patch'), handlers };
}

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

const adapter = { resolvedPortRef: { current: 7456 } };

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
  return { store: createInMemoryRoutineStore(), scheduler: makeScheduler(), ...overrides };
}

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

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
      value: { id: 'routine-1', limit: 20 },
    });
  });

  it('honors a valid limit within range', () => {
    expect(routineRunsListRoute.parse({ body: {}, query: { limit: '50' }, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: { id: 'routine-1', limit: 50 },
    });
  });

  it('clamps a limit above 100 down to 100', () => {
    expect(routineRunsListRoute.parse({ body: {}, query: { limit: '500' }, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: { id: 'routine-1', limit: 100 },
    });
  });

  it('falls back to the default (20) for a falsy-parsed limit (0 or NaN), matching the OD `|| 20` fallback exactly', () => {
    // `Number(value) || 20`: only a falsy `Number(...)` result (0 or NaN) triggers the fallback —
    // a negative number is truthy in JS and does NOT trigger it (see the next test).
    expect(routineRunsListRoute.parse({ body: {}, query: { limit: '0' }, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: { id: 'routine-1', limit: 20 },
    });
    expect(routineRunsListRoute.parse({ body: {}, query: { limit: 'garbage' }, params: { id: 'routine-1' } })).toEqual(
      { ok: true, value: { id: 'routine-1', limit: 20 } },
    );
  });

  it('clamps a negative limit up to 1 rather than falling back to 20 (a negative number is truthy, so `|| 20` never triggers — only the Math.max(1, ...) floor does)', () => {
    expect(routineRunsListRoute.parse({ body: {}, query: { limit: '-5' }, params: { id: 'routine-1' } })).toEqual({
      ok: true,
      value: { id: 'routine-1', limit: 1 },
    });
  });

  it('takes the first element when limit is a repeated query param (array)', () => {
    expect(
      routineRunsListRoute.parse({ body: {}, query: { limit: ['5', '99'] }, params: { id: 'routine-1' } }),
    ).toEqual({ ok: true, value: { id: 'routine-1', limit: 5 } });
  });
});

// ---------------------------------------------------------------------------
// handle
// ---------------------------------------------------------------------------

describe('routineListRoute.handle', () => {
  it('returns an empty list for a fresh store', async () => {
    const deps = makeDeps();
    const result = await routineListRoute.handle(undefined, deps);
    expect(result).toEqual({ ok: true, value: { routines: [] } });
  });

  it('overlays the scheduler\'s live nextRunAt onto every listed routine', async () => {
    const store = createInMemoryRoutineStore();
    const routine = await store.create(validCreateBody() as any);
    const fireAt = new Date('2030-01-01T00:00:00Z');
    const scheduler = makeScheduler({ nextRunAt: vi.fn(() => fireAt) });
    const deps = makeDeps({ store, scheduler });

    const result = await routineListRoute.handle(undefined, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.routines).toHaveLength(1);
      expect(result.value.routines[0]!.nextRunAt).toBe(fireAt.getTime());
      expect(scheduler.nextRunAt).toHaveBeenCalledWith(routine.id);
    }
  });

  it('reports nextRunAt: null when the scheduler has nothing scheduled for a routine', async () => {
    const store = createInMemoryRoutineStore();
    await store.create(validCreateBody() as any);
    const deps = makeDeps({ store });
    const result = await routineListRoute.handle(undefined, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.routines[0]!.nextRunAt).toBeNull();
  });
});

describe('routineCreateRoute.handle', () => {
  it('creates a routine, reschedules it, and returns it with nextRunAt overlaid', async () => {
    const scheduler = makeScheduler({ nextRunAt: vi.fn(() => new Date('2030-01-01T00:00:00Z')) });
    const deps = makeDeps({ scheduler });
    const result = await routineCreateRoute.handle(
      { name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 1 }, target: { mode: 'create_each_run' }, context: {} },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.routine.name).toBe('n');
      expect(result.value.routine.nextRunAt).toBe(new Date('2030-01-01T00:00:00Z').getTime());
    }
    expect(scheduler.rescheduleOne).toHaveBeenCalledWith((await deps.store.list())[0]!.id);
  });

  it('rejects a reuse target whose project does not exist, when projectExists is supplied', async () => {
    const deps = makeDeps({ projectExists: vi.fn(() => false) });
    const result = await routineCreateRoute.handle(
      {
        name: 'n',
        prompt: 'p',
        schedule: { kind: 'hourly', minute: 1 },
        target: { mode: 'reuse', projectId: 'missing-project' },
        context: {},
      },
      deps,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'target project missing-project not found' },
    });
    expect(await deps.store.list()).toEqual([]);
  });

  it('accepts a reuse target whose project exists, when projectExists is supplied', async () => {
    const projectExists = vi.fn(() => true);
    const deps = makeDeps({ projectExists });
    const result = await routineCreateRoute.handle(
      {
        name: 'n',
        prompt: 'p',
        schedule: { kind: 'hourly', minute: 1 },
        target: { mode: 'reuse', projectId: 'proj-1' },
        context: {},
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(projectExists).toHaveBeenCalledWith('proj-1');
  });

  it('accepts any reuse target when projectExists is not supplied (permissive default)', async () => {
    const deps = makeDeps();
    const result = await routineCreateRoute.handle(
      {
        name: 'n',
        prompt: 'p',
        schedule: { kind: 'hourly', minute: 1 },
        target: { mode: 'reuse', projectId: 'whatever' },
        context: {},
      },
      deps,
    );
    expect(result.ok).toBe(true);
  });

  it('does not consult projectExists for a create_each_run target', async () => {
    const projectExists = vi.fn(() => false);
    const deps = makeDeps({ projectExists });
    const result = await routineCreateRoute.handle(
      { name: 'n', prompt: 'p', schedule: { kind: 'hourly', minute: 1 }, target: { mode: 'create_each_run' }, context: {} },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(projectExists).not.toHaveBeenCalled();
  });

  it('supports an async projectExists predicate', async () => {
    const deps = makeDeps({ projectExists: async () => true });
    const result = await routineCreateRoute.handle(
      {
        name: 'n',
        prompt: 'p',
        schedule: { kind: 'hourly', minute: 1 },
        target: { mode: 'reuse', projectId: 'proj-1' },
        context: {},
      },
      deps,
    );
    expect(result.ok).toBe(true);
  });
});

describe('routineGetRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id', async () => {
    const deps = makeDeps();
    const result = await routineGetRoute.handle('missing', deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
  });

  it('returns the routine with nextRunAt overlaid when found', async () => {
    const store = createInMemoryRoutineStore();
    const routine = await store.create(validCreateBody() as any);
    const fireAt = new Date('2030-06-01T00:00:00Z');
    const deps = makeDeps({ store, scheduler: makeScheduler({ nextRunAt: vi.fn(() => fireAt) }) });
    const result = await routineGetRoute.handle(routine.id, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.routine.nextRunAt).toBe(fireAt.getTime());
  });
});

describe('routineUpdateRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id', async () => {
    const deps = makeDeps();
    const result = await routineUpdateRoute.handle({ id: 'missing', patch: { name: 'x' } }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
  });

  it('applies the patch, reschedules, and returns the updated routine', async () => {
    const store = createInMemoryRoutineStore();
    const routine = await store.create(validCreateBody() as any);
    const scheduler = makeScheduler();
    const deps = makeDeps({ store, scheduler });
    const result = await routineUpdateRoute.handle({ id: routine.id, patch: { name: 'renamed' } }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.routine.name).toBe('renamed');
    expect(scheduler.rescheduleOne).toHaveBeenCalledWith(routine.id);
  });

  it('validates a reuse target project via projectExists before applying the patch', async () => {
    const store = createInMemoryRoutineStore();
    const routine = await store.create(validCreateBody() as any);
    const projectExists = vi.fn(() => false);
    const deps = makeDeps({ store, projectExists });
    const result = await routineUpdateRoute.handle(
      { id: routine.id, patch: { target: { mode: 'reuse', projectId: 'missing' } } },
      deps,
    );
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'target project missing not found' } });
    // The store was never mutated since the check failed before store.update() was called.
    expect((await store.get(routine.id))!.target).toEqual({ mode: 'create_each_run' });
  });

  it('does not consult projectExists when the patch has no target field', async () => {
    const store = createInMemoryRoutineStore();
    const routine = await store.create(validCreateBody() as any);
    const projectExists = vi.fn(() => false);
    const deps = makeDeps({ store, projectExists });
    const result = await routineUpdateRoute.handle({ id: routine.id, patch: { name: 'x' } }, deps);
    expect(result.ok).toBe(true);
    expect(projectExists).not.toHaveBeenCalled();
  });
});

describe('routineDeleteRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id', async () => {
    const deps = makeDeps();
    const result = await routineDeleteRoute.handle('missing', deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
  });

  it('unschedules and deletes an existing routine', async () => {
    const store = createInMemoryRoutineStore();
    const routine = await store.create(validCreateBody() as any);
    const scheduler = makeScheduler();
    const deps = makeDeps({ store, scheduler });
    const result = await routineDeleteRoute.handle(routine.id, deps);
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(scheduler.unschedule).toHaveBeenCalledWith(routine.id);
    expect(await store.get(routine.id)).toBeNull();
  });

  it('still calls unschedule() even when the id turns out not to exist (matches OD\'s own unconditional unschedule-before-delete ordering)', async () => {
    const scheduler = makeScheduler();
    const deps = makeDeps({ scheduler });
    await routineDeleteRoute.handle('missing', deps);
    expect(scheduler.unschedule).toHaveBeenCalledWith('missing');
  });
});

describe('routineRunNowRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id without invoking the scheduler', async () => {
    const scheduler = makeScheduler();
    const deps = makeDeps({ scheduler });
    const result = await routineRunNowRoute.handle('missing', deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
    expect(scheduler.runNow).not.toHaveBeenCalled();
  });

  it('fires the routine and returns the started projectId/conversationId/agentRunId plus the refreshed routine', async () => {
    const store = createInMemoryRoutineStore();
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
    const result = await routineRunNowRoute.handle(routine.id, deps);
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
    expect(scheduler.runNow).toHaveBeenCalledWith(routine.id);
  });

  it('reflects a run recorded via a host-bridged store (the documented integration seam)', async () => {
    const store = createInMemoryRoutineStore();
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
        store.recordRun(run);
        return {
          projectId: run.projectId,
          conversationId: run.conversationId,
          agentRunId: run.agentRunId,
          completion: Promise.resolve({ status: 'succeeded' as const }),
        };
      }),
    });
    const deps = makeDeps({ store, scheduler });
    const result = await routineRunNowRoute.handle(routine.id, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.run).toEqual(run);
  });

  it('returns routine: null when the routine was deleted between the existence check and re-fetch', async () => {
    const store = createInMemoryRoutineStore();
    const routine = await store.create(validCreateBody() as any);
    const scheduler = makeScheduler({
      runNow: vi.fn(async () => {
        await store.delete(routine.id);
        return {
          projectId: 'p',
          conversationId: 'c',
          agentRunId: 'a',
          completion: Promise.resolve({ status: 'succeeded' as const }),
        };
      }),
    });
    const deps = makeDeps({ store, scheduler });
    const result = await routineRunNowRoute.handle(routine.id, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.routine).toBeNull();
  });
});

describe('routineRunsListRoute.handle', () => {
  it('returns NOT_FOUND for an unknown id', async () => {
    const deps = makeDeps();
    const result = await routineRunsListRoute.handle({ id: 'missing', limit: 20 }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'routine not found' } });
  });

  it('returns run history for an existing routine, respecting the limit', async () => {
    const store = createInMemoryRoutineStore();
    const routine = await store.create(validCreateBody() as any);
    store.recordRun({
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
    });
    const deps = makeDeps({ store });
    const result = await routineRunsListRoute.handle({ id: routine.id, limit: 20 }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.runs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// registerRoutineRoutes — mounting, same-origin, and the confirmed-bug regression
// ---------------------------------------------------------------------------

describe('registerRoutineRoutes', () => {
  it('mounts exactly the seven routine routes, nothing else', () => {
    const app = makeApp();
    registerRoutineRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(
      [
        'GET /api/routines',
        'POST /api/routines',
        'GET /api/routines/:id',
        'PATCH /api/routines/:id',
        'DELETE /api/routines/:id',
        'POST /api/routines/:id/run',
        'GET /api/routines/:id/runs',
      ].sort(),
    );
  });

  it('does not require same-origin for the three read-only GET routes', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    const store = createInMemoryRoutineStore();
    const routine = await store.create(validCreateBody() as any);
    registerRoutineRoutes(app as any, makeDeps({ store }), adapter);

    const listRes = makeRes();
    await app.handlers['GET /api/routines']!({ body: {}, query: {}, params: {} }, listRes);
    expect(listRes.status).toHaveBeenCalledWith(200);

    const getRes = makeRes();
    await app.handlers['GET /api/routines/:id']!({ body: {}, query: {}, params: { id: routine.id } }, getRes);
    expect(getRes.status).toHaveBeenCalledWith(200);

    const runsRes = makeRes();
    await app.handlers['GET /api/routines/:id/runs']!({ body: {}, query: {}, params: { id: routine.id } }, runsRes);
    expect(runsRes.status).toHaveBeenCalledWith(200);
  });

  it('requires same-origin for POST /api/routines', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerRoutineRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['POST /api/routines']!({ body: validCreateBody(), query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('requires same-origin for PATCH /api/routines/:id', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerRoutineRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['PATCH /api/routines/:id']!({ body: {}, query: {}, params: { id: 'routine-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('requires same-origin for DELETE /api/routines/:id', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerRoutineRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['DELETE /api/routines/:id']!({ body: {}, query: {}, params: { id: 'routine-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('requires same-origin for POST /api/routines/:id/run', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerRoutineRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['POST /api/routines/:id/run']!({ body: {}, query: {}, params: { id: 'routine-1' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('mounted POST /api/routines creates a routine end to end through the real Adapter pipeline', async () => {
    const app = makeApp();
    const deps = makeDeps();
    registerRoutineRoutes(app as any, deps, adapter);
    const res = makeRes();
    await app.handlers['POST /api/routines']!({ body: validCreateBody(), query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const [body] = res.json.mock.calls[0]!;
    expect(body.routine.name).toBe('Daily brief');
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

    it('GET /api/routines/:id returns 500 INTERNAL_ERROR instead of throwing', async () => {
      const app = makeApp();
      registerRoutineRoutes(app as any, makeDeps({ store: throwingStore() }), adapter);
      const res = makeRes();
      await expect(
        app.handlers['GET /api/routines/:id']!({ body: {}, query: {}, params: { id: 'x' } }, res),
      ).resolves.toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(500);
      const [body] = res.json.mock.calls[0]!;
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('DELETE /api/routines/:id returns 500 INTERNAL_ERROR instead of throwing', async () => {
      const app = makeApp();
      registerRoutineRoutes(app as any, makeDeps({ store: throwingStore() }), adapter);
      const res = makeRes();
      await expect(
        app.handlers['DELETE /api/routines/:id']!({ body: {}, query: {}, params: { id: 'x' } }, res),
      ).resolves.toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('GET /api/routines/:id/runs returns 500 INTERNAL_ERROR instead of throwing', async () => {
      const app = makeApp();
      registerRoutineRoutes(app as any, makeDeps({ store: throwingStore() }), adapter);
      const res = makeRes();
      await expect(
        app.handlers['GET /api/routines/:id/runs']!({ body: {}, query: {}, params: { id: 'x' } }, res),
      ).resolves.toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
