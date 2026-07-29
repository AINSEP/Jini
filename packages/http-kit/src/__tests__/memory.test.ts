import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  memoryClearExtractionsRoute,
  memoryClearVerificationsRoute,
  memoryCreateEntryRoute,
  memoryDeleteEntryRoute,
  memoryListExtractionsRoute,
  memoryListVerificationsRoute,
  memoryOverviewRoute,
  memoryReadEntryRoute,
  memoryRemoveExtractionRoute,
  memoryRemoveVerificationRoute,
  memoryTreeRoute,
  memoryUpdateEntryRoute,
  memoryUpdateTreeNodeRoute,
  memoryWriteConfigRoute,
  memoryWriteIndexRoute,
  registerMemoryEventStream,
  registerMemoryRoutes,
  type MemoryExtractionLog,
  type MemoryHttpDeps,
  type MemoryNoteEntry,
  type MemoryNoteStore,
  type MemoryVerifyLog,
} from '../memory.js';

describe('void-input routes: parse() always succeeds with no input', () => {
  it.each([
    ['memoryOverviewRoute', memoryOverviewRoute],
    ['memoryTreeRoute', memoryTreeRoute],
    ['memoryListExtractionsRoute', memoryListExtractionsRoute],
    ['memoryClearExtractionsRoute', memoryClearExtractionsRoute],
    ['memoryListVerificationsRoute', memoryListVerificationsRoute],
    ['memoryClearVerificationsRoute', memoryClearVerificationsRoute],
  ] as const)('%s.parse() ignores any input and succeeds', (_name, route) => {
    expect(route.parse({ body: { garbage: true }, query: {}, params: {} })).toEqual({ ok: true, value: undefined });
  });
});

vi.mock('../origin-validation.js', () => ({
  isLocalSameOrigin: vi.fn(() => true),
}));

interface MockApp {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
  delete: (path: string, handler: any) => void;
  patch: (path: string, handler: any) => void;
  handlers: Record<string, (req: any, res: any) => Promise<void> | void>;
  order: string[];
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const order: string[] = [];
  const make = (method: string) => (path: string, handler: any) => {
    const key = `${method.toUpperCase()} ${path}`;
    handlers[key] = handler;
    order.push(key);
  };
  return { get: make('get'), post: make('post'), put: make('put'), delete: make('delete'), patch: make('patch'), handlers, order };
}

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

const adapter = { resolvedPortRef: { current: 7456 } };

const entry: MemoryNoteEntry = { id: 'user_hi', name: 'hi', description: '', type: 'user', updatedAt: 1000, body: 'hello' };

function makeNoteStore(overrides: Partial<MemoryNoteStore> = {}): MemoryNoteStore {
  return {
    events: new EventEmitter(),
    dir: vi.fn(() => '/data/notes'),
    readConfig: vi.fn(async () => ({ enabled: true })),
    writeConfig: vi.fn(async (_dataDir: string, patch) => ({ enabled: patch.enabled ?? true })),
    readIndex: vi.fn(async () => '# Notes\n'),
    writeIndex: vi.fn(async () => {}),
    listEntries: vi.fn(async () => [entry]),
    readEntry: vi.fn(async (_dataDir: string, id: string) => (id === entry.id ? entry : null)),
    upsertEntry: vi.fn(async (_dataDir: string, input) => ({ ...entry, ...input, id: input.id ?? entry.id, description: input.description ?? '' })),
    deleteEntry: vi.fn(async () => {}),
    updateTreeNode: vi.fn(async () => entry),
    buildTree: vi.fn(async () => []),
    ...overrides,
  };
}

function makeExtractionLog(overrides: Partial<MemoryExtractionLog> = {}): MemoryExtractionLog {
  return {
    events: new EventEmitter(),
    list: vi.fn(() => [{ id: 'ext-1' }]),
    remove: vi.fn(() => 1),
    clear: vi.fn(() => 3),
    ...overrides,
  };
}

function makeVerifyLog(overrides: Partial<MemoryVerifyLog> = {}): MemoryVerifyLog {
  return {
    events: new EventEmitter(),
    list: vi.fn(() => [{ id: 'ver-1' }]),
    remove: vi.fn(() => 1),
    clear: vi.fn(() => 2),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<MemoryHttpDeps> = {}): MemoryHttpDeps {
  return {
    notes: makeNoteStore(),
    extractions: makeExtractionLog(),
    verifications: makeVerifyLog(),
    dataDir: '/data',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

describe('memoryOverviewRoute', () => {
  it('success: returns enabled/rootDir/index/entries', async () => {
    const deps = makeDeps();
    const result = await memoryOverviewRoute.handle(undefined, deps);
    expect(result).toEqual({
      ok: true,
      value: { enabled: true, rootDir: '/data/notes', index: '# Notes\n', entries: [entry] },
    });
  });
});

describe('memoryTreeRoute', () => {
  it('success: returns enabled/rootDir/tree', async () => {
    const notes = makeNoteStore({ buildTree: vi.fn(async () => [{ id: 't1', parentId: null, path: '/', name: 'x', description: '', kind: 'entry' as const, type: 'user', createdAt: '2026', updatedAt: '2026', childrenCount: 0 }]) });
    const deps = makeDeps({ notes });
    const result = await memoryTreeRoute.handle(undefined, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tree).toHaveLength(1);
  });
});

describe('memoryUpdateTreeNodeRoute.parse', () => {
  it('malformed: rejects a missing id path parameter', () => {
    const result = memoryUpdateTreeNodeRoute.parse({ body: {}, query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'id must be a non-empty path parameter' } });
  });

  it('malformed: rejects a non-object body', () => {
    expect(memoryUpdateTreeNodeRoute.parse({ body: 'nope', query: {}, params: { id: 'x' } }).ok).toBe(false);
  });

  it('malformed: rejects a non-string patch field', () => {
    const result = memoryUpdateTreeNodeRoute.parse({ body: { name: 42 }, query: {}, params: { id: 'x' } });
    expect(result.ok).toBe(false);
  });

  it('accepts an empty patch', () => {
    expect(memoryUpdateTreeNodeRoute.parse({ body: {}, query: {}, params: { id: 'x' } })).toEqual({
      ok: true,
      value: { id: 'x', patch: {} },
    });
  });

  it('accepts a full patch', () => {
    const result = memoryUpdateTreeNodeRoute.parse({
      body: { name: 'n', description: 'd', type: 't', body: 'b' },
      query: {},
      params: { id: 'x' },
    });
    expect(result).toEqual({ ok: true, value: { id: 'x', patch: { name: 'n', description: 'd', type: 't', body: 'b' } } });
  });
});

describe('memoryUpdateTreeNodeRoute.handle', () => {
  it('success: updates the node and returns the refreshed tree', async () => {
    const notes = makeNoteStore();
    const deps = makeDeps({ notes });
    const result = await memoryUpdateTreeNodeRoute.handle({ id: entry.id, patch: { name: 'new' } }, deps);
    expect(result.ok).toBe(true);
    expect(notes.updateTreeNode).toHaveBeenCalledWith('/data', entry.id, { name: 'new' });
  });

  it('maps "note not found" to 404 NOT_FOUND', async () => {
    const notes = makeNoteStore({ updateTreeNode: vi.fn(async () => { throw new Error('note not found'); }) });
    const deps = makeDeps({ notes });
    const result = await memoryUpdateTreeNodeRoute.handle({ id: 'missing', patch: {} }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'note not found' } });
  });

  it('maps any other thrown error to 400 BAD_REQUEST', async () => {
    const notes = makeNoteStore({ updateTreeNode: vi.fn(async () => { throw new Error('folders are derived'); }) });
    const deps = makeDeps({ notes });
    const result = await memoryUpdateTreeNodeRoute.handle({ id: 'folder:x', patch: {} }, deps);
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'folders are derived' } });
  });
});

describe('memoryWriteIndexRoute', () => {
  it('success: writes the index and echoes it back', async () => {
    const notes = makeNoteStore();
    const deps = makeDeps({ notes });
    const result = await memoryWriteIndexRoute.handle('# new index', deps);
    expect(result).toEqual({ ok: true, value: { index: '# new index' } });
    expect(notes.writeIndex).toHaveBeenCalledWith('/data', '# new index');
  });

  it('parse defaults to an empty string when index is missing/non-string', () => {
    expect(memoryWriteIndexRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: '' });
    expect(memoryWriteIndexRoute.parse({ body: { index: 42 }, query: {}, params: {} })).toEqual({ ok: true, value: '' });
  });

  it('parse defaults to an empty string when the body itself is not an object', () => {
    expect(memoryWriteIndexRoute.parse({ body: 'nope', query: {}, params: {} })).toEqual({ ok: true, value: '' });
    expect(memoryWriteIndexRoute.parse({ body: null, query: {}, params: {} })).toEqual({ ok: true, value: '' });
  });

  it('parse passes a genuine string index value through', () => {
    expect(memoryWriteIndexRoute.parse({ body: { index: '# real index' }, query: {}, params: {} })).toEqual({
      ok: true,
      value: '# real index',
    });
  });

  it('maps a thrown write error to 400', async () => {
    const notes = makeNoteStore({ writeIndex: vi.fn(async () => { throw new Error('write failed'); }) });
    const result = await memoryWriteIndexRoute.handle('x', makeDeps({ notes }));
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'write failed' } });
  });

  it('stringifies a non-Error throw', async () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    const notes = makeNoteStore({ writeIndex: vi.fn(async () => { throw 'raw string failure'; }) });
    const result = await memoryWriteIndexRoute.handle('x', makeDeps({ notes }));
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'raw string failure' } });
  });
});

describe('memoryWriteConfigRoute', () => {
  it('parse: malformed body is rejected', () => {
    expect(memoryWriteConfigRoute.parse({ body: 'nope', query: {}, params: {} }).ok).toBe(false);
  });

  it('parse: a non-boolean enabled is rejected', () => {
    expect(memoryWriteConfigRoute.parse({ body: { enabled: 'yes' }, query: {}, params: {} }).ok).toBe(false);
  });

  it('parse: an omitted enabled produces an empty patch', () => {
    expect(memoryWriteConfigRoute.parse({ body: {}, query: {}, params: {} })).toEqual({ ok: true, value: {} });
  });

  it('parse: a valid boolean enabled parses through', () => {
    expect(memoryWriteConfigRoute.parse({ body: { enabled: true }, query: {}, params: {} })).toEqual({
      ok: true,
      value: { enabled: true },
    });
  });

  it('success: toggles enabled', async () => {
    const notes = makeNoteStore();
    const result = await memoryWriteConfigRoute.handle({ enabled: false }, makeDeps({ notes }));
    expect(result).toEqual({ ok: true, value: { enabled: false } });
    expect(notes.writeConfig).toHaveBeenCalledWith('/data', { enabled: false });
  });

  it('maps a thrown config error to 400', async () => {
    const notes = makeNoteStore({ writeConfig: vi.fn(async () => { throw new Error('bad config'); }) });
    const result = await memoryWriteConfigRoute.handle({ enabled: true }, makeDeps({ notes }));
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'bad config' } });
  });
});

describe('extraction history routes', () => {
  it('memoryListExtractionsRoute: returns the log list', async () => {
    const extractions = makeExtractionLog();
    const result = await memoryListExtractionsRoute.handle(undefined, makeDeps({ extractions }));
    expect(result).toEqual({ ok: true, value: { extractions: [{ id: 'ext-1' }] } });
  });

  it('memoryClearExtractionsRoute: clears and reports removed count', async () => {
    const extractions = makeExtractionLog();
    const result = await memoryClearExtractionsRoute.handle(undefined, makeDeps({ extractions }));
    expect(result).toEqual({ ok: true, value: { removed: 3 } });
  });

  it('memoryRemoveExtractionRoute: removes by id', async () => {
    const extractions = makeExtractionLog();
    const result = await memoryRemoveExtractionRoute.handle('ext-1', makeDeps({ extractions }));
    expect(result).toEqual({ ok: true, value: { removed: 1 } });
    expect(extractions.remove).toHaveBeenCalledWith('ext-1');
  });

  it('memoryRemoveExtractionRoute.parse: malformed missing id', () => {
    expect(memoryRemoveExtractionRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
  });
});

describe('verification history routes', () => {
  it('memoryListVerificationsRoute: returns the log list', async () => {
    const verifications = makeVerifyLog();
    const result = await memoryListVerificationsRoute.handle(undefined, makeDeps({ verifications }));
    expect(result).toEqual({ ok: true, value: { verifications: [{ id: 'ver-1' }] } });
  });

  it('memoryClearVerificationsRoute: clears and reports removed count', async () => {
    const verifications = makeVerifyLog();
    const result = await memoryClearVerificationsRoute.handle(undefined, makeDeps({ verifications }));
    expect(result).toEqual({ ok: true, value: { removed: 2 } });
  });

  it('memoryRemoveVerificationRoute: removes by id', async () => {
    const verifications = makeVerifyLog();
    const result = await memoryRemoveVerificationRoute.handle('ver-1', makeDeps({ verifications }));
    expect(result).toEqual({ ok: true, value: { removed: 1 } });
    expect(verifications.remove).toHaveBeenCalledWith('ver-1');
  });
});

describe('entry CRUD', () => {
  describe('memoryCreateEntryRoute.parse', () => {
    it('malformed: rejects a non-object body', () => {
      expect(memoryCreateEntryRoute.parse({ body: null, query: {}, params: {} }).ok).toBe(false);
    });

    it('malformed: rejects a missing name', () => {
      const result = memoryCreateEntryRoute.parse({ body: { type: 'user' }, query: {}, params: {} });
      expect(result).toEqual({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'name is required', details: { kind: 'validation', issues: [{ path: 'name', message: 'required non-empty string' }] } },
      });
    });

    it('malformed: rejects a missing type', () => {
      expect(memoryCreateEntryRoute.parse({ body: { name: 'n' }, query: {}, params: {} }).ok).toBe(false);
    });

    it('malformed: rejects a non-string description/body', () => {
      expect(memoryCreateEntryRoute.parse({ body: { name: 'n', type: 't', description: 5 }, query: {}, params: {} }).ok).toBe(false);
      expect(memoryCreateEntryRoute.parse({ body: { name: 'n', type: 't', body: 5 }, query: {}, params: {} }).ok).toBe(false);
    });

    it('accepts a minimal valid entry, omitting description/body entirely', () => {
      expect(memoryCreateEntryRoute.parse({ body: { name: 'n', type: 't' }, query: {}, params: {} })).toEqual({
        ok: true,
        value: { name: 'n', type: 't' },
      });
    });

    it('accepts a full entry, including description and body', () => {
      expect(
        memoryCreateEntryRoute.parse({ body: { name: 'n', type: 't', description: 'd', body: 'b' }, query: {}, params: {} }),
      ).toEqual({ ok: true, value: { name: 'n', type: 't', description: 'd', body: 'b' } });
    });
  });

  it('memoryCreateEntryRoute.handle success', async () => {
    const notes = makeNoteStore();
    const result = await memoryCreateEntryRoute.handle({ name: 'n', type: 'user' }, makeDeps({ notes }));
    expect(result.ok).toBe(true);
    expect(notes.upsertEntry).toHaveBeenCalledWith('/data', { name: 'n', type: 'user' });
  });

  it('memoryCreateEntryRoute.handle maps a thrown validation error to 400', async () => {
    const notes = makeNoteStore({ upsertEntry: vi.fn(async () => { throw new Error('note entry requires `name` and a valid `type`'); }) });
    const result = await memoryCreateEntryRoute.handle({ name: 'n', type: 'bogus' }, makeDeps({ notes }));
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'note entry requires `name` and a valid `type`' } });
  });

  it('memoryReadEntryRoute: success returns the entry', async () => {
    const result = await memoryReadEntryRoute.handle(entry.id, makeDeps());
    expect(result).toEqual({ ok: true, value: { entry } });
  });

  it('memoryReadEntryRoute: 404 when missing', async () => {
    const result = await memoryReadEntryRoute.handle('missing', makeDeps());
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'memory not found' } });
  });

  describe('memoryUpdateEntryRoute.parse', () => {
    it('malformed: rejects a missing id', () => {
      expect(memoryUpdateEntryRoute.parse({ body: { name: 'n', type: 't' }, query: {}, params: {} }).ok).toBe(false);
    });

    it('malformed: rejects an invalid entry body even with a valid id', () => {
      expect(memoryUpdateEntryRoute.parse({ body: {}, query: {}, params: { id: 'x' } }).ok).toBe(false);
    });

    it('accepts a valid id + entry body', () => {
      expect(memoryUpdateEntryRoute.parse({ body: { name: 'n', type: 't' }, query: {}, params: { id: 'x' } })).toEqual({
        ok: true,
        value: { id: 'x', input: { name: 'n', type: 't' } },
      });
    });
  });

  it('memoryUpdateEntryRoute.handle success forwards id through to upsertEntry', async () => {
    const notes = makeNoteStore();
    await memoryUpdateEntryRoute.handle({ id: entry.id, input: { name: 'n', type: 'user' } }, makeDeps({ notes }));
    expect(notes.upsertEntry).toHaveBeenCalledWith('/data', { name: 'n', type: 'user', id: entry.id });
  });

  it('memoryUpdateEntryRoute.handle maps a thrown error to 400', async () => {
    const notes = makeNoteStore({ upsertEntry: vi.fn(async () => { throw new Error('bad'); }) });
    const result = await memoryUpdateEntryRoute.handle({ id: 'x', input: { name: 'n', type: 't' } }, makeDeps({ notes }));
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'bad' } });
  });

  it('memoryDeleteEntryRoute.handle success', async () => {
    const notes = makeNoteStore();
    const result = await memoryDeleteEntryRoute.handle(entry.id, makeDeps({ notes }));
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(notes.deleteEntry).toHaveBeenCalledWith('/data', entry.id);
  });

  it('memoryDeleteEntryRoute.handle maps a thrown error to 400', async () => {
    const notes = makeNoteStore({ deleteEntry: vi.fn(async () => { throw new Error('delete failed'); }) });
    const result = await memoryDeleteEntryRoute.handle('x', makeDeps({ notes }));
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'delete failed' } });
  });
});

describe('registerMemoryEventStream', () => {
  function makeSseRes() {
    const closeListeners: Array<() => void> = [];
    const res = {
      write: vi.fn((_chunk: string) => true),
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      end: vi.fn(() => {
        res.writableEnded = true;
      }),
      writableEnded: false,
      on: vi.fn((event: string, listener: () => void) => {
        if (event === 'close') closeListeners.push(listener);
      }),
      emitClose: () => closeListeners.forEach((l) => l()),
    };
    return res;
  }

  it('sends a connected event immediately on open', () => {
    const app = makeApp();
    const deps = makeDeps();
    registerMemoryEventStream(app as any, deps);
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({}, res);
    expect(res.write.mock.calls[0]![0]).toContain('event: connected');
  });

  it('relays a notes "change" event as an SSE "change" event', () => {
    const app = makeApp();
    const notes = makeNoteStore();
    const deps = makeDeps({ notes });
    registerMemoryEventStream(app as any, deps);
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({}, res);
    res.write.mockClear();
    (notes.events as EventEmitter).emit('change', { kind: 'upsert', id: 'x', at: 1 });
    expect(res.write.mock.calls[0]![0]).toContain('event: change');
    expect(res.write.mock.calls[0]![0]).toContain('"kind":"upsert"');
  });

  it('relays an extractions "attempt" event as an SSE "extraction" event', () => {
    const app = makeApp();
    const extractions = makeExtractionLog();
    const deps = makeDeps({ extractions });
    registerMemoryEventStream(app as any, deps);
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({}, res);
    res.write.mockClear();
    (extractions.events as EventEmitter).emit('attempt', { id: 'ext-2', phase: 'success' });
    expect(res.write.mock.calls[0]![0]).toContain('event: extraction');
  });

  it('relays a verifications "verify" event as an SSE "verify" event', () => {
    const app = makeApp();
    const verifications = makeVerifyLog();
    const deps = makeDeps({ verifications });
    registerMemoryEventStream(app as any, deps);
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({}, res);
    res.write.mockClear();
    (verifications.events as EventEmitter).emit('verify', { id: 'ver-2', status: 'fail' });
    expect(res.write.mock.calls[0]![0]).toContain('event: verify');
  });

  it('unsubscribes all three listeners on client disconnect', () => {
    const app = makeApp();
    const notes = makeNoteStore();
    const extractions = makeExtractionLog();
    const verifications = makeVerifyLog();
    const deps = makeDeps({ notes, extractions, verifications });
    registerMemoryEventStream(app as any, deps);
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({}, res);
    expect((notes.events as EventEmitter).listenerCount('change')).toBe(1);
    expect((extractions.events as EventEmitter).listenerCount('attempt')).toBe(1);
    expect((verifications.events as EventEmitter).listenerCount('verify')).toBe(1);
    res.emitClose();
    expect((notes.events as EventEmitter).listenerCount('change')).toBe(0);
    expect((extractions.events as EventEmitter).listenerCount('attempt')).toBe(0);
    expect((verifications.events as EventEmitter).listenerCount('verify')).toBe(0);
  });
});

describe('registerMemoryRoutes', () => {
  it('mounts every ported route exactly once', () => {
    const app = makeApp();
    registerMemoryRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(
      [
        'GET /api/memory',
        'GET /api/memory/tree',
        'PATCH /api/memory/tree/:id',
        'PUT /api/memory/index',
        'PATCH /api/memory/config',
        'GET /api/memory/events',
        'GET /api/memory/extractions',
        'DELETE /api/memory/extractions',
        'DELETE /api/memory/extractions/:id',
        'GET /api/memory/verifications',
        'DELETE /api/memory/verifications',
        'DELETE /api/memory/verifications/:id',
        'POST /api/memory',
        'GET /api/memory/:id',
        'PUT /api/memory/:id',
        'DELETE /api/memory/:id',
      ].sort(),
    );
  });

  it('mounts static sub-resource routes before the /:id catch-all routes (Express registration-order matters)', () => {
    const app = makeApp();
    registerMemoryRoutes(app as any, makeDeps(), adapter);
    const idxOfTree = app.order.indexOf('GET /api/memory/tree');
    const idxOfExtractions = app.order.indexOf('GET /api/memory/extractions');
    const idxOfVerifications = app.order.indexOf('GET /api/memory/verifications');
    const idxOfGetId = app.order.indexOf('GET /api/memory/:id');
    const idxOfPutId = app.order.indexOf('PUT /api/memory/:id');
    const idxOfDeleteId = app.order.indexOf('DELETE /api/memory/:id');
    expect(idxOfTree).toBeGreaterThanOrEqual(0);
    expect(idxOfTree).toBeLessThan(idxOfGetId);
    expect(idxOfExtractions).toBeLessThan(idxOfGetId);
    expect(idxOfVerifications).toBeLessThan(idxOfGetId);
    expect(idxOfGetId).toBeLessThan(idxOfPutId);
    expect(idxOfPutId).toBeLessThan(idxOfDeleteId);
  });

  it('requires same-origin on mutating routes: blocks a cross-origin POST', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerMemoryRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['POST /api/memory']!({ body: { name: 'n', type: 't' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows cross-origin GET reads (no requireSameOrigin on read routes)', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerMemoryRoutes(app as any, makeDeps(), adapter);
    const res = makeRes();
    await app.handlers['GET /api/memory']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('end to end: a malformed create request never reaches upsertEntry', async () => {
    const app = makeApp();
    const notes = makeNoteStore();
    registerMemoryRoutes(app as any, makeDeps({ notes }), adapter);
    const res = makeRes();
    await app.handlers['POST /api/memory']!({ body: { name: 'n' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(notes.upsertEntry).not.toHaveBeenCalled();
  });
});
