import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '@jini-ai/core';
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

vi.mock('@jini-ai/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@jini-ai/core')>(),
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

const adapter = { allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS', webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST', env: {}, resolvedPortRef: { current: 7456 } };

const entry: MemoryNoteEntry = { id: 'user_hi', name: 'hi', description: '', type: 'user', updatedAt: 1000, body: 'hello' };

function changeEmitter() {
  const emitter = new EventEmitter();
  return {
    // Native EventEmitter is a framework ABI, shared with the real note and history stores.
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
    listenerCount: emitter.listenerCount.bind(emitter),
  };
}

function makeNoteStore(overrides: Partial<MemoryNoteStore> = {}): MemoryNoteStore {
  return {
    events: changeEmitter(),
    dir: vi.fn(() => '/data/notes'),
    readConfig: vi.fn(async () => ({ enabled: true })),
    writeConfig: vi.fn(async ({ dataDir: _dataDir, patch }: Parameters<MemoryNoteStore['writeConfig']>[0]) => ({ enabled: patch.enabled ?? true })),
    readIndex: vi.fn(async () => '# Notes\n'),
    writeIndex: vi.fn(async () => { }),
    listEntries: vi.fn(async () => [entry]),
    readEntry: vi.fn(async ({ dataDir: _dataDir, id }: { dataDir: string; id: string }) => (id === entry.id ? entry : null)),
    upsertEntry: vi.fn(async ({ dataDir: _dataDir, input }: Parameters<MemoryNoteStore['upsertEntry']>[0]) => ({ ...entry, ...input, id: input.id ?? entry.id, description: input.description ?? '' })),
    deleteEntry: vi.fn(async () => { }),
    updateTreeNode: vi.fn(async () => entry),
    buildTree: vi.fn(async () => []),
    ...overrides,
  };
}

function makeExtractionLog(overrides: Partial<MemoryExtractionLog> = {}): MemoryExtractionLog {
  return {
    events: changeEmitter(),
    list: vi.fn(() => [{ id: 'ext-1' }]),
    remove: vi.fn(() => 1),
    clear: vi.fn(() => 3),
    ...overrides,
  };
}

function makeVerifyLog(overrides: Partial<MemoryVerifyLog> = {}): MemoryVerifyLog {
  return {
    events: changeEmitter(),
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
    const result = await memoryOverviewRoute.handle({ input: undefined, deps });
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
    const result = await memoryTreeRoute.handle({ input: undefined, deps });
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
    const result = await memoryUpdateTreeNodeRoute.handle({ input: { id: entry.id, patch: { name: 'new' } }, deps });
    expect(result.ok).toBe(true);
    expect(notes.updateTreeNode).toHaveBeenCalledWith({ dataDir: '/data', id: entry.id, patch: { name: 'new' } });
  });

  it('maps "note not found" to 404 NOT_FOUND', async () => {
    const notes = makeNoteStore({ updateTreeNode: vi.fn(async () => { throw new Error('note not found'); }) });
    const deps = makeDeps({ notes });
    const result = await memoryUpdateTreeNodeRoute.handle({ input: { id: 'missing', patch: {} }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'note not found' } });
  });

  it('maps any other thrown error to 400 BAD_REQUEST', async () => {
    const notes = makeNoteStore({ updateTreeNode: vi.fn(async () => { throw new Error('folders are derived'); }) });
    const deps = makeDeps({ notes });
    const result = await memoryUpdateTreeNodeRoute.handle({ input: { id: 'folder:x', patch: {} }, deps });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'folders are derived' } });
  });
});

describe('memoryWriteIndexRoute', () => {
  it('success: writes the index and echoes it back', async () => {
    const notes = makeNoteStore();
    const deps = makeDeps({ notes });
    const result = await memoryWriteIndexRoute.handle({ input: '# new index', deps });
    expect(result).toEqual({ ok: true, value: { index: '# new index' } });
    expect(notes.writeIndex).toHaveBeenCalledWith({ dataDir: '/data', body: '# new index' });
  });

  // These two previously asserted that a missing, mistyped, or entirely absent body parsed to `''`
  // — which then *succeeded*, writing an empty string over the user's whole memory index. A typo in
  // the field name (`{ typo: "…" }`) silently destroyed the document it was meant to update, and
  // the caller got a 200. Clearing the index is a legitimate thing to want, so it stays possible —
  // but it now takes explicitly saying so with `{ index: "" }`, which no typo produces.
  it('parse rejects a body with no index field rather than treating it as a clear', () => {
    expect(memoryWriteIndexRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
    expect(memoryWriteIndexRoute.parse({ body: { typo: 'intended content' }, query: {}, params: {} }).ok).toBe(false);
  });

  it('parse rejects a non-string index rather than treating it as a clear', () => {
    for (const index of [42, null, [], {}, true]) {
      expect(memoryWriteIndexRoute.parse({ body: { index }, query: {}, params: {} }).ok).toBe(false);
    }
  });

  it('parse rejects a body that is not an object at all', () => {
    expect(memoryWriteIndexRoute.parse({ body: 'nope', query: {}, params: {} }).ok).toBe(false);
    expect(memoryWriteIndexRoute.parse({ body: null, query: {}, params: {} }).ok).toBe(false);
  });

  it('parse still allows an explicit clear', () => {
    expect(memoryWriteIndexRoute.parse({ body: { index: '' }, query: {}, params: {} })).toEqual({ ok: true, value: '' });
  });

  it('parse passes a genuine string index value through', () => {
    expect(memoryWriteIndexRoute.parse({ body: { index: '# real index' }, query: {}, params: {} })).toEqual({
      ok: true,
      value: '# real index',
    });
  });

  it('maps a thrown write error to 400', async () => {
    const notes = makeNoteStore({ writeIndex: vi.fn(async () => { throw new Error('write failed'); }) });
    const result = await memoryWriteIndexRoute.handle({ input: 'x', deps: makeDeps({ notes }) });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'write failed' } });
  });

  it('stringifies a non-Error throw', async () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    const notes = makeNoteStore({ writeIndex: vi.fn(async () => { throw 'raw string failure'; }) });
    const result = await memoryWriteIndexRoute.handle({ input: 'x', deps: makeDeps({ notes }) });
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
    const result = await memoryWriteConfigRoute.handle({ input: { enabled: false }, deps: makeDeps({ notes }) });
    expect(result).toEqual({ ok: true, value: { enabled: false } });
    expect(notes.writeConfig).toHaveBeenCalledWith({ dataDir: '/data', patch: { enabled: false } });
  });

  it('maps a thrown config error to 400', async () => {
    const notes = makeNoteStore({ writeConfig: vi.fn(async () => { throw new Error('bad config'); }) });
    const result = await memoryWriteConfigRoute.handle({ input: { enabled: true }, deps: makeDeps({ notes }) });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'bad config' } });
  });
});

describe('extraction history routes', () => {
  it('memoryListExtractionsRoute: returns the log list', async () => {
    const extractions = makeExtractionLog();
    const result = await memoryListExtractionsRoute.handle({ input: undefined, deps: makeDeps({ extractions }) });
    expect(result).toEqual({ ok: true, value: { extractions: [{ id: 'ext-1' }] } });
  });

  it('memoryClearExtractionsRoute: clears and reports removed count', async () => {
    const extractions = makeExtractionLog();
    const result = await memoryClearExtractionsRoute.handle({ input: undefined, deps: makeDeps({ extractions }) });
    expect(result).toEqual({ ok: true, value: { removed: 3 } });
  });

  it('memoryRemoveExtractionRoute: removes by id', async () => {
    const extractions = makeExtractionLog();
    const result = await memoryRemoveExtractionRoute.handle({ input: 'ext-1', deps: makeDeps({ extractions }) });
    expect(result).toEqual({ ok: true, value: { removed: 1 } });
    expect(extractions.remove).toHaveBeenCalledWith({ id: 'ext-1' });
  });

  it('memoryRemoveExtractionRoute.parse: malformed missing id', () => {
    expect(memoryRemoveExtractionRoute.parse({ body: {}, query: {}, params: {} }).ok).toBe(false);
  });
});

describe('verification history routes', () => {
  it('memoryListVerificationsRoute: returns the log list', async () => {
    const verifications = makeVerifyLog();
    const result = await memoryListVerificationsRoute.handle({ input: undefined, deps: makeDeps({ verifications }) });
    expect(result).toEqual({ ok: true, value: { verifications: [{ id: 'ver-1' }] } });
  });

  it('memoryClearVerificationsRoute: clears and reports removed count', async () => {
    const verifications = makeVerifyLog();
    const result = await memoryClearVerificationsRoute.handle({ input: undefined, deps: makeDeps({ verifications }) });
    expect(result).toEqual({ ok: true, value: { removed: 2 } });
  });

  it('memoryRemoveVerificationRoute: removes by id', async () => {
    const verifications = makeVerifyLog();
    const result = await memoryRemoveVerificationRoute.handle({ input: 'ver-1', deps: makeDeps({ verifications }) });
    expect(result).toEqual({ ok: true, value: { removed: 1 } });
    expect(verifications.remove).toHaveBeenCalledWith({ id: 'ver-1' });
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
    const result = await memoryCreateEntryRoute.handle({ input: { name: 'n', type: 'user' }, deps: makeDeps({ notes }) });
    expect(result.ok).toBe(true);
    expect(notes.upsertEntry).toHaveBeenCalledWith({ dataDir: '/data', input: { name: 'n', type: 'user' } });
  });

  it('memoryCreateEntryRoute.handle maps a thrown validation error to 400', async () => {
    const notes = makeNoteStore({ upsertEntry: vi.fn(async () => { throw new Error('note entry requires `name` and a valid `type`'); }) });
    const result = await memoryCreateEntryRoute.handle({ input: { name: 'n', type: 'bogus' }, deps: makeDeps({ notes }) });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'note entry requires `name` and a valid `type`' } });
  });

  it('memoryReadEntryRoute: success returns the entry', async () => {
    const result = await memoryReadEntryRoute.handle({ input: entry.id, deps: makeDeps() });
    expect(result).toEqual({ ok: true, value: { entry } });
  });

  it('memoryReadEntryRoute: 404 when missing', async () => {
    const result = await memoryReadEntryRoute.handle({ input: 'missing', deps: makeDeps() });
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
    await memoryUpdateEntryRoute.handle({ input: { id: entry.id, input: { name: 'n', type: 'user' } }, deps: makeDeps({ notes }) });
    expect(notes.upsertEntry).toHaveBeenCalledWith({ dataDir: '/data', input: { name: 'n', type: 'user', id: entry.id } });
  });

  it('memoryUpdateEntryRoute.handle maps a thrown error to 400', async () => {
    const notes = makeNoteStore({ upsertEntry: vi.fn(async () => { throw new Error('bad'); }) });
    const result = await memoryUpdateEntryRoute.handle({ input: { id: 'x', input: { name: 'n', type: 't' } }, deps: makeDeps({ notes }) });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'bad' } });
  });

  it('memoryDeleteEntryRoute.handle success', async () => {
    const notes = makeNoteStore();
    const result = await memoryDeleteEntryRoute.handle({ input: entry.id, deps: makeDeps({ notes }) });
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(notes.deleteEntry).toHaveBeenCalledWith({ dataDir: '/data', id: entry.id });
  });

  it('memoryDeleteEntryRoute.handle maps a thrown error to 400', async () => {
    const notes = makeNoteStore({ deleteEntry: vi.fn(async () => { throw new Error('delete failed'); }) });
    const result = await memoryDeleteEntryRoute.handle({ input: 'x', deps: makeDeps({ notes }) });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'delete failed' } });
  });
});

describe('registerMemoryEventStream', () => {
  it('uses native event emitters and cleans up the multiplexed stream on disconnect', () => {
    const app = makeApp();
    const events = [new EventEmitter(), new EventEmitter(), new EventEmitter()];
    const deps = makeDeps({
      notes: makeNoteStore({ events: events[0]! }),
      extractions: makeExtractionLog({ events: events[1]! }),
      verifications: makeVerifyLog({ events: events[2]! }),
    });
    registerMemoryEventStream({ app: app as any, deps, adapter }, {});
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({ headers: { host: '127.0.0.1:7456' } }, res);
    events[0]!.emit('change', { id: 'note' });
    events[1]!.emit('attempt', { id: 'extraction' });
    events[2]!.emit('verify', { id: 'verification' });
    expect(res.write.mock.calls.map(([frame]) => frame)).toEqual([
      expect.stringContaining('event: connected'),
      expect.stringContaining('event: change'),
      expect.stringContaining('event: extraction'),
      expect.stringContaining('event: verify'),
    ]);
    res.emitClose();
    expect(events.map((emitter) => emitter.eventNames())).toEqual([[], [], []]);
    events[0]!.emit('change', { id: 'after-close' });
    expect(res.write).toHaveBeenCalledTimes(4);
  });
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
    registerMemoryEventStream({ app: app as any, deps, adapter });
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({ headers: { host: '127.0.0.1:7456' } }, res);
    expect(res.write.mock.calls[0]![0]).toContain('event: connected');
  });

  it('relays a notes "change" event as an SSE "change" event', () => {
    const app = makeApp();
    const notes = makeNoteStore();
    const deps = makeDeps({ notes });
    registerMemoryEventStream({ app: app as any, deps, adapter });
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({ headers: { host: '127.0.0.1:7456' } }, res);
    res.write.mockClear();
    (notes.events as unknown as EventEmitter).emit('change', { kind: 'upsert', id: 'x', at: 1 });
    expect(res.write.mock.calls[0]![0]).toContain('event: change');
    expect(res.write.mock.calls[0]![0]).toContain('"kind":"upsert"');
  });

  it('relays an extractions "attempt" event as an SSE "extraction" event', () => {
    const app = makeApp();
    const extractions = makeExtractionLog();
    const deps = makeDeps({ extractions });
    registerMemoryEventStream({ app: app as any, deps, adapter });
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({ headers: { host: '127.0.0.1:7456' } }, res);
    res.write.mockClear();
    (extractions.events as unknown as EventEmitter).emit('attempt', { id: 'ext-2', phase: 'success' });
    expect(res.write.mock.calls[0]![0]).toContain('event: extraction');
  });

  it('relays a verifications "verify" event as an SSE "verify" event', () => {
    const app = makeApp();
    const verifications = makeVerifyLog();
    const deps = makeDeps({ verifications });
    registerMemoryEventStream({ app: app as any, deps, adapter });
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({ headers: { host: '127.0.0.1:7456' } }, res);
    res.write.mockClear();
    (verifications.events as unknown as EventEmitter).emit('verify', { id: 'ver-2', status: 'fail' });
    expect(res.write.mock.calls[0]![0]).toContain('event: verify');
  });

  it('unsubscribes all three listeners on client disconnect', () => {
    const app = makeApp();
    const notes = makeNoteStore();
    const extractions = makeExtractionLog();
    const verifications = makeVerifyLog();
    const deps = makeDeps({ notes, extractions, verifications });
    registerMemoryEventStream({ app: app as any, deps, adapter });
    const res = makeSseRes();
    app.handlers['GET /api/memory/events']!({ headers: { host: '127.0.0.1:7456' } }, res);
    expect((notes.events as unknown as EventEmitter).listenerCount('change')).toBe(1);
    expect((extractions.events as unknown as EventEmitter).listenerCount('attempt')).toBe(1);
    expect((verifications.events as unknown as EventEmitter).listenerCount('verify')).toBe(1);
    res.emitClose();
    expect((notes.events as unknown as EventEmitter).listenerCount('change')).toBe(0);
    expect((extractions.events as unknown as EventEmitter).listenerCount('attempt')).toBe(0);
    expect((verifications.events as unknown as EventEmitter).listenerCount('verify')).toBe(0);
  });
});

describe('registerMemoryRoutes', () => {
  it('mounts from argument objects and forwards a parsed config patch to the store', async () => {
    const app = makeApp();
    const notes = makeNoteStore();
    registerMemoryRoutes({ app: app as any, deps: makeDeps({ notes }), adapter }, {});
    const res = makeRes();
    await app.handlers['PATCH /api/memory/config']!({ body: { enabled: false }, query: {}, params: {} }, res);
    expect(notes.writeConfig).toHaveBeenCalledWith({ dataDir: '/data', patch: { enabled: false } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ enabled: false });
  });
  it('mounts every ported route exactly once', () => {
    const app = makeApp();
    registerMemoryRoutes({ app: app as any, deps: makeDeps(), adapter });
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
    registerMemoryRoutes({ app: app as any, deps: makeDeps(), adapter });
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
    registerMemoryRoutes({ app: app as any, deps: makeDeps(), adapter });
    const res = makeRes();
    await app.handlers['POST /api/memory']!({ body: { name: 'n', type: 't' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows cross-origin GET reads (no requireSameOrigin on read routes)', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerMemoryRoutes({ app: app as any, deps: makeDeps(), adapter });
    const res = makeRes();
    await app.handlers['GET /api/memory']!({ body: {}, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('end to end: a malformed create request never reaches upsertEntry', async () => {
    const app = makeApp();
    const notes = makeNoteStore();
    registerMemoryRoutes({ app: app as any, deps: makeDeps({ notes }), adapter });
    const res = makeRes();
    await app.handlers['POST /api/memory']!({ body: { name: 'n' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(notes.upsertEntry).not.toHaveBeenCalled();
  });
});

/**
 * Real Express server on a real socket. Every test above calls a route's `handle`/`parse` directly
 * or drives a handler-capturing `MockApp` stub — neither actually resolves an Express path, feeds a
 * spec's `parse` a body Express itself parsed from real JSON bytes, or observes the status code
 * Express writes to the wire. This block is the only place `registerMemoryRoutes`/
 * `registerMemoryEventStream` are exercised as a listening server: it proves all sixteen mounted
 * paths actually route (including the six static sub-resources — `/tree`, `/index`, `/config`,
 * `/events`, `/extractions`, `/verifications` — that must resolve before the `/api/memory/:id`
 * catch-all shapes), that `express.json()` feeds each spec's `parse` step the shape it expects, and
 * that a real SSE response is readable over a real socket rather than only through a hand-rolled
 * fake `res`.
 */
describe('registerMemoryRoutes / registerMemoryEventStream — real Express server on a real socket', () => {
  const servers: Server[] = [];
  const adapterRef = { allowedOriginsEnvVar: 'JINI_ALLOWED_ORIGINS', webPortEnvVar: 'JINI_WEB_PORT', bindHostEnvVar: 'JINI_BIND_HOST', env: {}, resolvedPortRef: { current: 0 } };

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function listen(deps: MemoryHttpDeps): Promise<string> {
    const app = express();
    app.use(express.json());
    registerMemoryRoutes({ app: app as never, deps, adapter: adapterRef as never });
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);
    adapterRef.resolvedPortRef.current = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${adapterRef.resolvedPortRef.current}`;
  }

  async function send(base: string, method: string, routePath: string, body?: unknown, origin = base) {
    const response = await fetch(`${base}${routePath}`, {
      method,
      headers: { 'content-type': 'application/json', origin },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }

  it('serves the overview and tree GET routes end to end', async () => {
    const base = await listen(makeDeps());
    expect(await send(base, 'GET', '/api/memory')).toEqual({
      status: 200,
      body: { enabled: true, rootDir: '/data/notes', index: '# Notes\n', entries: [entry] },
    });
    expect(await send(base, 'GET', '/api/memory/tree')).toEqual({
      status: 200,
      body: { enabled: true, rootDir: '/data/notes', tree: [] },
    });
  });

  it('serves entry CRUD end to end: create, read, update, delete, each forwarding the real parsed body to the note store', async () => {
    const notes = makeNoteStore();
    const base = await listen(makeDeps({ notes }));

    const created = await send(base, 'POST', '/api/memory', { name: 'n', type: 'user' });
    expect(created.status).toBe(201);
    expect(notes.upsertEntry).toHaveBeenCalledWith({ dataDir: '/data', input: { name: 'n', type: 'user' } });

    expect(await send(base, 'GET', `/api/memory/${entry.id}`)).toEqual({ status: 200, body: { entry } });

    const updated = await send(base, 'PUT', `/api/memory/${entry.id}`, { name: 'n2', type: 'user' });
    expect(updated.status).toBe(200);
    expect(notes.upsertEntry).toHaveBeenCalledWith({ dataDir: '/data', input: { name: 'n2', type: 'user', id: entry.id } });

    expect(await send(base, 'DELETE', `/api/memory/${entry.id}`)).toEqual({ status: 200, body: { ok: true } });
    expect(notes.deleteEntry).toHaveBeenCalledWith({ dataDir: '/data', id: entry.id });
  });

  it('serves the tree-node patch, raw-index write, and config-patch routes end to end', async () => {
    const notes = makeNoteStore();
    const base = await listen(makeDeps({ notes }));

    const patched = await send(base, 'PATCH', `/api/memory/tree/${entry.id}`, { name: 'renamed' });
    expect(patched).toEqual({ status: 200, body: { entry, tree: [] } });
    expect(notes.updateTreeNode).toHaveBeenCalledWith({ dataDir: '/data', id: entry.id, patch: { name: 'renamed' } });

    expect(await send(base, 'PUT', '/api/memory/index', { index: '# hi' })).toEqual({
      status: 200,
      body: { index: '# hi' },
    });
    expect(notes.writeIndex).toHaveBeenCalledWith({ dataDir: '/data', body: '# hi' });

    expect(await send(base, 'PATCH', '/api/memory/config', { enabled: false })).toEqual({
      status: 200,
      body: { enabled: false },
    });
    expect(notes.writeConfig).toHaveBeenCalledWith({ dataDir: '/data', patch: { enabled: false } });
  });

  it('serves the extraction and verification history routes end to end (list, remove-one, clear)', async () => {
    const extractions = makeExtractionLog();
    const verifications = makeVerifyLog();
    const base = await listen(makeDeps({ extractions, verifications }));

    expect(await send(base, 'GET', '/api/memory/extractions')).toEqual({ status: 200, body: { extractions: [{ id: 'ext-1' }] } });
    expect(await send(base, 'DELETE', '/api/memory/extractions/ext-1')).toEqual({ status: 200, body: { removed: 1 } });
    expect(extractions.remove).toHaveBeenCalledWith({ id: 'ext-1' });
    expect(await send(base, 'DELETE', '/api/memory/extractions')).toEqual({ status: 200, body: { removed: 3 } });

    expect(await send(base, 'GET', '/api/memory/verifications')).toEqual({ status: 200, body: { verifications: [{ id: 'ver-1' }] } });
    expect(await send(base, 'DELETE', '/api/memory/verifications/ver-1')).toEqual({ status: 200, body: { removed: 1 } });
    expect(verifications.remove).toHaveBeenCalledWith({ id: 'ver-1' });
    expect(await send(base, 'DELETE', '/api/memory/verifications')).toEqual({ status: 200, body: { removed: 2 } });
  });

  it('answers 404 over the wire for a memory entry that does not exist', async () => {
    const base = await listen(makeDeps());
    expect(await send(base, 'GET', '/api/memory/missing')).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'memory not found' } },
    });
  });

  it('rejects a cross-origin mutating request with 403 before reaching the note store', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const notes = makeNoteStore();
    const base = await listen(makeDeps({ notes }));
    const response = await send(base, 'POST', '/api/memory', { name: 'n', type: 'user' }, 'http://evil.example.com');
    expect(response.status).toBe(403);
    expect(notes.upsertEntry).not.toHaveBeenCalled();
  });

  it('serves a real SSE stream on /api/memory/events, readable over a real socket', async () => {
    const base = await listen(makeDeps());
    const controller = new AbortController();
    const response = await fetch(`${base}/api/memory/events`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
    const firstEvent = JSON.parse(dataLine!.slice('data: '.length)) as { kind: string; data: { at: number } };
    expect(firstEvent.kind).toBe('connected');
    expect(typeof firstEvent.data.at).toBe('number');

    controller.abort();
  });

  it('rejects a cross-origin request to /api/memory/events before opening the SSE stream', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const base = await listen(makeDeps());
    const response = await fetch(`${base}/api/memory/events`, {
      headers: { origin: 'http://evil.example.com' },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).not.toContain('text/event-stream');
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code: 'FORBIDDEN' }),
    });
  });
});
