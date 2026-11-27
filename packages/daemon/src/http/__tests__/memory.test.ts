import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingOriginPolicy } from '@jini-ai/core/contracts/server/testing';
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
  memoryRoutes,
  type MemoryExtractionLog,
  type MemoryHttpDeps,
  type MemoryRouteDeps,
  type MemoryNoteEntry,
  type MemoryNoteStore,
  type MemoryVerifyLog,
} from '../memory.js';
import { describeRoutes } from '../route-table.js';
import { fakeDaemonRouteHost, injectedRecordingReporter } from './fakes/route-host.js';
import { jsonRequest, serveRoutes } from './fakes/serve-routes.js';
import { readFrames } from './fakes/sse-reader.js';

/** What a client is told when the memory store throws: no dependency text, only this sentence and a request ID. */
const STORE_FAILURE_SENTENCE = 'The memory store could not complete the request. Copy the request ID and report this problem.';
const storeFailureAnswer = { ok: false, error: { code: 'INTERNAL_ERROR', message: STORE_FAILURE_SENTENCE, requestId: expect.any(String) } };

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

const testOriginPolicy = createRecordingOriginPolicy();


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

function makeDeps(overrides: Partial<MemoryRouteDeps> = {}): MemoryRouteDeps {
  return {
    reportInternalError: fakeDaemonRouteHost().reportInternalError,
    notes: makeNoteStore(),
    extractions: makeExtractionLog(),
    verifications: makeVerifyLog(),
    dataDir: '/data',
    ...overrides,
  };
}

beforeEach(() => {
  testOriginPolicy.set({ allow: true });
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

  it('answers any other thrown error with the fixed sentence and a request ID, and gives the sink the text', async () => {
    const notes = makeNoteStore({ updateTreeNode: vi.fn(async () => { throw new Error('folders are derived'); }) });
    const deps = makeDeps({ notes });
    const result = await memoryUpdateTreeNodeRoute.handle({ input: { id: 'folder:x', patch: {} }, deps });
    expect(result).toEqual(storeFailureAnswer);
    expect(JSON.stringify(result)).not.toContain('folders are derived');
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

  it('answers a thrown write error with the fixed sentence and a request ID', async () => {
    const notes = makeNoteStore({ writeIndex: vi.fn(async () => { throw new Error('write failed'); }) });
    const result = await memoryWriteIndexRoute.handle({ input: 'x', deps: makeDeps({ notes }) });
    expect(result).toEqual(storeFailureAnswer);
    expect(JSON.stringify(result)).not.toContain('write failed');
  });

  it('answers a non-Error throw the same way, and the sink gets the raw value', async () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    const notes = makeNoteStore({ writeIndex: vi.fn(async () => { throw 'raw string failure'; }) });
    const onInternalError = vi.fn();
    const result = await memoryWriteIndexRoute.handle({ input: 'x', deps: makeDeps({ notes, reportInternalError: injectedRecordingReporter({ record: onInternalError }) }) });
    expect(result).toEqual(storeFailureAnswer);
    expect(onInternalError.mock.calls[0]![0]).toMatchObject({ error: 'raw string failure', source: 'memory/index-write' });
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

  it('answers a thrown config error with the fixed sentence and a request ID', async () => {
    const notes = makeNoteStore({ writeConfig: vi.fn(async () => { throw new Error('bad config'); }) });
    const result = await memoryWriteConfigRoute.handle({ input: { enabled: true }, deps: makeDeps({ notes }) });
    expect(result).toEqual(storeFailureAnswer);
    expect(JSON.stringify(result)).not.toContain('bad config');
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
  it('never sends the store exception text, including a filesystem path, to the client: the sink gets it', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({
      notes: makeNoteStore({ upsertEntry: vi.fn(async () => { throw new Error("EACCES: permission denied, open '/home/op/.data/notes/x.md'"); }) }), reportInternalError: injectedRecordingReporter({ record: onInternalError }),
    });
    const result = await memoryCreateEntryRoute.handle({ input: { name: 'n', type: 't' }, deps });
    expect(result).toEqual(storeFailureAnswer);
    expect(JSON.stringify(result)).not.toContain('/home/op');
    expect((onInternalError.mock.calls[0]![0].error as Error).message).toBe("EACCES: permission denied, open '/home/op/.data/notes/x.md'");
    expect(onInternalError.mock.calls[0]![0]).toMatchObject({ source: 'memory/entry-create' });
  });

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

  it('memoryCreateEntryRoute.handle answers a store-side validation error like any other store failure (the store\'s text is not shown)', async () => {
    const notes = makeNoteStore({ upsertEntry: vi.fn(async () => { throw new Error('note entry requires `name` and a valid `type`'); }) });
    const result = await memoryCreateEntryRoute.handle({ input: { name: 'n', type: 'bogus' }, deps: makeDeps({ notes }) });
    expect(result).toEqual(storeFailureAnswer);
    expect(JSON.stringify(result)).not.toContain('valid `type`');
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

  it('memoryUpdateEntryRoute.handle answers a thrown error with the fixed sentence and a request ID', async () => {
    const notes = makeNoteStore({ upsertEntry: vi.fn(async () => { throw new Error('bad'); }) });
    const result = await memoryUpdateEntryRoute.handle({ input: { id: 'x', input: { name: 'n', type: 't' } }, deps: makeDeps({ notes }) });
    expect(result).toEqual(storeFailureAnswer);
  });

  it('memoryDeleteEntryRoute.handle success', async () => {
    const notes = makeNoteStore();
    const result = await memoryDeleteEntryRoute.handle({ input: entry.id, deps: makeDeps({ notes }) });
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(notes.deleteEntry).toHaveBeenCalledWith({ dataDir: '/data', id: entry.id });
  });

  it('memoryDeleteEntryRoute.handle answers a thrown error with the fixed sentence and a request ID', async () => {
    const notes = makeNoteStore({ deleteEntry: vi.fn(async () => { throw new Error('delete failed'); }) });
    const result = await memoryDeleteEntryRoute.handle({ input: 'x', deps: makeDeps({ notes }) });
    expect(result).toEqual(storeFailureAnswer);
    expect(JSON.stringify(result)).not.toContain('delete failed');
  });
});

/** The memory routes on an in-memory server, behind the recording origin policy. */
function serve(deps: MemoryHttpDeps) {
  const host = fakeDaemonRouteHost({}, { originPolicy: testOriginPolicy });
  return { host, fetch: serveRoutes({ routes: memoryRoutes({ deps, host }) }) };
}

const listeners = (deps: MemoryHttpDeps) => [
  (deps.notes.events as unknown as EventEmitter).listenerCount('change'),
  (deps.extractions.events as unknown as EventEmitter).listenerCount('attempt'),
  (deps.verifications.events as unknown as EventEmitter).listenerCount('verify'),
];

describe('GET /api/memory/events — the multiplexed stream', () => {
  const open = (deps: MemoryHttpDeps, init: RequestInit = {}) => serve(deps).fetch(new Request('http://local/api/memory/events', init));

  it('opens with the event-stream headers and a connected frame (cursor 0) right away, with no heartbeat', async () => {
    const deps = makeDeps();
    const { fetch, host } = serve(deps);
    const response = await fetch(new Request('http://local/api/memory/events'));
    expect([response.status, response.headers.get('content-type')]).toEqual([200, 'text/event-stream; charset=utf-8']);
    const frames = readFrames({ response });
    const [first] = await frames.next();
    expect(first).toContain('id: 0\nevent: connected');
    expect(host.scheduler.pending).toBe(0);
    await frames.cancel();
  });

  it('uses native event emitters and relays all three channels as change, extraction and verify frames, in order', async () => {
    const events = [new EventEmitter(), new EventEmitter(), new EventEmitter()];
    const deps = makeDeps({
      notes: makeNoteStore({ events: events[0]! }),
      extractions: makeExtractionLog({ events: events[1]! }),
      verifications: makeVerifyLog({ events: events[2]! }),
    });
    const frames = readFrames({ response: await open(deps) });
    events[0]!.emit('change', { kind: 'upsert', id: 'note' });
    events[1]!.emit('attempt', { id: 'extraction' });
    events[2]!.emit('verify', { id: 'verification' });
    const received = await frames.next(4);
    expect(received.map((frame) => frame.split('\n')[1])).toEqual(['event: connected', 'event: change', 'event: extraction', 'event: verify']);
    expect(received[1]).toContain('"kind":"upsert"');
    expect(received.map((frame) => frame.split('\n')[0])).toEqual(['id: 0', 'id: 1', 'id: 2', 'id: 3']);
    await frames.cancel();
  });

  it.each([
    ['notes', 'change', 'change', { kind: 'upsert', id: 'x', at: 1 }],
    ['extractions', 'attempt', 'extraction', { id: 'ext-2', phase: 'success' }],
    ['verifications', 'verify', 'verify', { id: 'ver-2', status: 'fail' }],
  ] as const)('relays only the %s emitter\'s "%s" event, as an SSE "%s" frame carrying its payload', async (source, emitted, frameName, payload) => {
    const deps = makeDeps();
    const frames = readFrames({ response: await open(deps) });
    await frames.next();
    (deps[source].events as unknown as EventEmitter).emit(emitted, payload);
    const [frame] = await frames.next();
    expect(frame).toContain(`event: ${frameName}`);
    expect(frame).toContain(JSON.stringify(payload).slice(1, -1));
    expect(await frames.stillSilent()).toBe(true);
    await frames.cancel();
  });

  it('removes all three listeners when the client cancels the stream, and nothing is delivered after', async () => {
    const deps = makeDeps();
    const frames = readFrames({ response: await open(deps) });
    await frames.next();
    expect(listeners(deps)).toEqual([1, 1, 1]);
    await frames.cancel();
    expect(listeners(deps)).toEqual([0, 0, 0]);
  });

  it('removes all three listeners when the client aborts', async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    const frames = readFrames({ response: await open(deps, { signal: controller.signal }) });
    await frames.next();
    controller.abort();
    await vi.waitFor(() => expect(listeners(deps)).toEqual([0, 0, 0]));
  });

  it('leaves no listener behind when the client had already left before the stream was built', async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    controller.abort();
    await open(deps, { signal: controller.signal }).catch(() => undefined);
    expect(listeners(deps)).toEqual([0, 0, 0]);
  });

  it('refuses a cross-origin request before subscribing anything: 403 FORBIDDEN, not a stream, zero listeners', async () => {
    testOriginPolicy.set({ allow: false });
    const deps = makeDeps();
    const response = await open(deps);
    expect([response.status, response.headers.get('content-type')]).toEqual([403, 'application/json; charset=utf-8']);
    expect(await response.json()).toEqual({ error: expect.objectContaining({ code: 'FORBIDDEN' }) });
    expect(listeners(deps)).toEqual([0, 0, 0]);
  });
});

describe('memoryRoutes', () => {
  it('lists every ported route exactly once, with the same-origin gate named on the writes and on the stream', () => {
    expect(describeRoutes({ routes: memoryRoutes({ deps: makeDeps(), host: fakeDaemonRouteHost() }) }).map((route) => `${route.method} ${route.path} [${route.gates.join(',')}]`)).toEqual([
      'GET /api/memory []',
      'GET /api/memory/tree []',
      'PATCH /api/memory/tree/:id [same-origin]',
      'PUT /api/memory/index [same-origin]',
      'PATCH /api/memory/config [same-origin]',
      'GET /api/memory/events [same-origin]',
      'GET /api/memory/extractions []',
      'DELETE /api/memory/extractions [same-origin]',
      'DELETE /api/memory/extractions/:id [same-origin]',
      'GET /api/memory/verifications []',
      'DELETE /api/memory/verifications [same-origin]',
      'DELETE /api/memory/verifications/:id [same-origin]',
      'POST /api/memory [same-origin]',
      'GET /api/memory/:id []',
      'PUT /api/memory/:id [same-origin]',
      'DELETE /api/memory/:id [same-origin]',
    ]);
  });

  it('a store failure goes through the host reporter: the fixed sentence and the request ID to the client, the real error to the host', async () => {
    const notes = makeNoteStore({ writeIndex: vi.fn(async () => { throw new Error("EACCES: permission denied, open '/srv/secret/index.md'"); }) });
    const { fetch, host } = serve(makeDeps({ notes }));
    const response = await fetch(jsonRequest({ path: '/api/memory/index', method: 'PUT' }, { body: { index: '# x' } }));
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL_ERROR', message: STORE_FAILURE_SENTENCE, requestId: 'req-1' } });
    expect(text).not.toContain('/srv/secret');
    expect(host.reports).toHaveLength(1);
    expect(host.reports[0]).toMatchObject({ logSource: 'memory/index-write', requestId: 'req-1' });
    expect((host.reports[0]!.report.error as Error).message).toContain('/srv/secret/index.md');
  });

  it('the store\'s one expected refusal, "note not found", still answers 404 NOT_FOUND through the route list', async () => {
    const notes = makeNoteStore({ updateTreeNode: vi.fn(async () => { throw new Error('note not found'); }) });
    const response = await serve(makeDeps({ notes })).fetch(jsonRequest({ path: '/api/memory/tree/x', method: 'PATCH' }, { body: { name: 'n' } }));
    expect([response.status, await response.json()]).toEqual([404, { error: { code: 'NOT_FOUND', message: 'note not found' } }]);
  });

  it('forwards a parsed config patch to the store', async () => {
    const notes = makeNoteStore();
    const response = await serve(makeDeps({ notes })).fetch(jsonRequest({ path: '/api/memory/config', method: 'PATCH' }, { body: { enabled: false } }));
    expect(notes.writeConfig).toHaveBeenCalledWith({ dataDir: '/data', patch: { enabled: false } });
    expect([response.status, await response.json()]).toEqual([200, { enabled: false }]);
  });

  it('a static sub-resource path reaches its own handler and any other slug reaches the entry handler, whatever the listing order', async () => {
    const notes = makeNoteStore();
    const { fetch } = serve(makeDeps({ notes }));
    expect((await (await fetch(jsonRequest({ path: '/api/memory/tree' }))).json() as { tree: unknown }).tree).toEqual([]);
    expect((await (await fetch(jsonRequest({ path: '/api/memory/extractions' }))).json() as { extractions: unknown }).extractions).toEqual([{ id: 'ext-1' }]);
    expect((await (await fetch(jsonRequest({ path: '/api/memory/verifications' }))).json() as { verifications: unknown }).verifications).toEqual([{ id: 'ver-1' }]);
    await fetch(jsonRequest({ path: '/api/memory/abc' }));
    expect(notes.readEntry).toHaveBeenCalledWith({ dataDir: '/data', id: 'abc' });
  });

  it('requires same-origin on mutating routes: blocks a cross-origin POST', async () => {
    testOriginPolicy.set({ allow: false });
    const response = await serve(makeDeps()).fetch(jsonRequest({ path: '/api/memory', method: 'POST' }, { body: { name: 'n', type: 't' } }));
    expect(response.status).toBe(403);
  });

  it('allows cross-origin GET reads (no requireSameOrigin on read routes)', async () => {
    testOriginPolicy.set({ allow: false });
    expect((await serve(makeDeps()).fetch(jsonRequest({ path: '/api/memory' }))).status).toBe(200);
  });

  it('a malformed create request never reaches upsertEntry', async () => {
    const notes = makeNoteStore();
    const response = await serve(makeDeps({ notes })).fetch(jsonRequest({ path: '/api/memory', method: 'POST' }, { body: { name: 'n' } }));
    expect(response.status).toBe(400);
    expect(notes.upsertEntry).not.toHaveBeenCalled();
  });
});

/**
 * Every mounted path routes through the real route table: this is the one place the sixteen paths (including
 * the six static sub-resources that must resolve before the `/api/memory/:id` shapes) are exercised as a
 * served list, with the body the transport parsed from real JSON bytes fed to each spec's `parse` step.
 */
describe('memoryRoutes — every route end to end on a route table', () => {
  async function send(deps: MemoryHttpDeps, method: string, routePath: string, body?: unknown) {
    const response = await serve(deps).fetch(jsonRequest({ path: routePath, method }, body === undefined ? {} : { body }));
    return { status: response.status, body: await response.json() };
  }

  it('serves the overview and tree GET routes end to end', async () => {
    const deps = makeDeps();
    expect(await send(deps, 'GET', '/api/memory')).toEqual({ status: 200, body: { enabled: true, rootDir: '/data/notes', index: '# Notes\n', entries: [entry] } });
    expect(await send(deps, 'GET', '/api/memory/tree')).toEqual({ status: 200, body: { enabled: true, rootDir: '/data/notes', tree: [] } });
  });

  it('serves entry CRUD end to end: create, read, update, delete, each forwarding the real parsed body to the note store', async () => {
    const notes = makeNoteStore();
    const deps = makeDeps({ notes });
    expect((await send(deps, 'POST', '/api/memory', { name: 'n', type: 'user' })).status).toBe(201);
    expect(notes.upsertEntry).toHaveBeenCalledWith({ dataDir: '/data', input: { name: 'n', type: 'user' } });
    expect(await send(deps, 'GET', `/api/memory/${entry.id}`)).toEqual({ status: 200, body: { entry } });
    expect((await send(deps, 'PUT', `/api/memory/${entry.id}`, { name: 'n2', type: 'user' })).status).toBe(200);
    expect(notes.upsertEntry).toHaveBeenCalledWith({ dataDir: '/data', input: { name: 'n2', type: 'user', id: entry.id } });
    expect(await send(deps, 'DELETE', `/api/memory/${entry.id}`)).toEqual({ status: 200, body: { ok: true } });
    expect(notes.deleteEntry).toHaveBeenCalledWith({ dataDir: '/data', id: entry.id });
  });

  it('serves the tree-node patch, raw-index write, and config-patch routes end to end', async () => {
    const notes = makeNoteStore();
    const deps = makeDeps({ notes });
    expect(await send(deps, 'PATCH', `/api/memory/tree/${entry.id}`, { name: 'renamed' })).toEqual({ status: 200, body: { entry, tree: [] } });
    expect(notes.updateTreeNode).toHaveBeenCalledWith({ dataDir: '/data', id: entry.id, patch: { name: 'renamed' } });
    expect(await send(deps, 'PUT', '/api/memory/index', { index: '# hi' })).toEqual({ status: 200, body: { index: '# hi' } });
    expect(notes.writeIndex).toHaveBeenCalledWith({ dataDir: '/data', body: '# hi' });
    expect(await send(deps, 'PATCH', '/api/memory/config', { enabled: false })).toEqual({ status: 200, body: { enabled: false } });
    expect(notes.writeConfig).toHaveBeenCalledWith({ dataDir: '/data', patch: { enabled: false } });
  });

  it('serves the extraction and verification history routes end to end (list, remove-one, clear)', async () => {
    const extractions = makeExtractionLog();
    const verifications = makeVerifyLog();
    const deps = makeDeps({ extractions, verifications });
    expect(await send(deps, 'GET', '/api/memory/extractions')).toEqual({ status: 200, body: { extractions: [{ id: 'ext-1' }] } });
    expect(await send(deps, 'DELETE', '/api/memory/extractions/ext-1')).toEqual({ status: 200, body: { removed: 1 } });
    expect(extractions.remove).toHaveBeenCalledWith({ id: 'ext-1' });
    expect(await send(deps, 'DELETE', '/api/memory/extractions')).toEqual({ status: 200, body: { removed: 3 } });
    expect(await send(deps, 'GET', '/api/memory/verifications')).toEqual({ status: 200, body: { verifications: [{ id: 'ver-1' }] } });
    expect(await send(deps, 'DELETE', '/api/memory/verifications/ver-1')).toEqual({ status: 200, body: { removed: 1 } });
    expect(verifications.remove).toHaveBeenCalledWith({ id: 'ver-1' });
    expect(await send(deps, 'DELETE', '/api/memory/verifications')).toEqual({ status: 200, body: { removed: 2 } });
  });

  it('answers 404 for a memory entry that does not exist', async () => {
    expect(await send(makeDeps(), 'GET', '/api/memory/missing')).toEqual({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'memory not found' } } });
  });

  it('rejects a cross-origin mutating request with 403 before reaching the note store', async () => {
    testOriginPolicy.set({ allow: false });
    const notes = makeNoteStore();
    expect((await send(makeDeps({ notes }), 'POST', '/api/memory', { name: 'n', type: 'user' })).status).toBe(403);
    expect(notes.upsertEntry).not.toHaveBeenCalled();
  });
});

it('treats a non-string tree patch field as invalid instead of silently clearing it', async () => {
  const updateTreeNode = vi.fn<MemoryNoteStore['updateTreeNode']>();
  const deps = makeDeps({ notes: makeNoteStore({ updateTreeNode }) });
  const response = await serve(deps).fetch(jsonRequest({ path: '/api/memory/tree/note-1', method: 'PATCH' }, {
    body: { name: 'Preserve this valid name', description: null },
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: 'BAD_REQUEST', message: 'description must be a string when provided' } });
  expect(updateTreeNode).not.toHaveBeenCalled();
});
