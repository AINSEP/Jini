import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLocalSameOrigin } from '../origin-validation.js';
import {
  mediaGenerateRoute,
  mediaTaskDeleteRoute,
  mediaTaskGetRoute,
  mediaTaskListRoute,
  registerMediaRoutes,
  type MediaHttpDeps,
} from '../media.js';

type MediaDispatchEngine = MediaHttpDeps['engine'];
type MediaGenerationResult = Awaited<ReturnType<MediaDispatchEngine['generate']>>;
type MediaTaskStore = MediaHttpDeps['taskStore'];
type MediaTask = NonNullable<Awaited<ReturnType<MediaTaskStore['get']>>>;

function createInMemoryMediaTaskStore(): MediaTaskStore {
  const tasks = new Map<string, MediaTask>();
  const clone = (task: MediaTask): MediaTask => ({
    ...task,
    progress: [...task.progress],
    file: task.file == null ? null : structuredClone(task.file),
    error: task.error == null ? null : { ...task.error },
  });

  return {
    async create(input) {
      const now = Date.now();
      const task: MediaTask = {
        id: input.id,
        ownerRef: input.ownerRef,
        status: input.status ?? 'queued',
        ...(input.surface !== undefined ? { surface: input.surface } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        progress: [...(input.progress ?? [])],
        file: input.file ?? null,
        error: input.error ?? null,
        startedAt: input.startedAt ?? now,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      tasks.set(task.id, task);
      return clone(task);
    },
    async get(id) {
      const task = tasks.get(id);
      return task ? clone(task) : null;
    },
    async update(id, patch) {
      const task = tasks.get(id);
      if (!task) return null;
      const {
        surface: currentSurface,
        model: currentModel,
        ...taskWithoutOptionalIdentity
      } = task;
      const { surface: patchSurface, model: patchModel, ...patchWithoutOptionalIdentity } = patch;
      const nextSurface = patchSurface === null ? undefined : (patchSurface ?? currentSurface);
      const nextModel = patchModel === null ? undefined : (patchModel ?? currentModel);
      const updated: MediaTask = {
        ...taskWithoutOptionalIdentity,
        ...patchWithoutOptionalIdentity,
        ...(nextSurface !== undefined ? { surface: nextSurface } : {}),
        ...(nextModel !== undefined ? { model: nextModel } : {}),
        progress: patch.progress === undefined ? task.progress : [...patch.progress],
        updatedAt: Date.now(),
      };
      tasks.set(id, updated);
      return clone(updated);
    },
    async listByOwner(ownerRef, options) {
      const terminal = new Set(['done', 'failed', 'interrupted']);
      return [...tasks.values()]
        .filter((task) => task.ownerRef === ownerRef)
        .filter((task) => options?.includeTerminal === true || !terminal.has(task.status))
        .map(clone);
    },
    async delete(id) {
      tasks.delete(id);
    },
  };
}

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
}

function makeApp(): MockApp {
  const handlers: MockApp['handlers'] = {};
  const make = (method: string) => (path: string, handler: any) => {
    handlers[`${method.toUpperCase()} ${path}`] = handler;
  };
  return { get: make('get'), post: make('post'), put: make('put'), delete: make('delete'), patch: make('patch'), handlers };
}

function makeJsonRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

const adapter = { resolvedPortRef: { current: 7456 } };

function fakeResult(overrides: Partial<MediaGenerationResult> = {}): MediaGenerationResult {
  return {
    bytes: Buffer.from('hello'),
    providerNote: 'ok',
    providerId: 'stub',
    usedStubFallback: false,
    warnings: [],
    ...overrides,
  };
}

function makeEngine(generate: MediaDispatchEngine['generate']): MediaDispatchEngine {
  return { generate };
}

function makeDeps(overrides: Partial<MediaHttpDeps> = {}): MediaHttpDeps {
  return {
    engine: makeEngine(async () => fakeResult()),
    taskStore: createInMemoryMediaTaskStore(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(isLocalSameOrigin).mockReturnValue(true);
});

describe('mediaGenerateRoute.parse', () => {
  it('rejects a non-object body', () => {
    const result = mediaGenerateRoute.parse({ body: 'nope', query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'body must be a JSON object' } });
  });

  it('rejects a missing ownerRef with a structured validation issue', () => {
    const result = mediaGenerateRoute.parse({ body: { surface: 'image', model: 'dall-e-3' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toEqual({ kind: 'validation', issues: [{ path: 'ownerRef', message: 'required non-empty string' }] });
    }
  });

  it('rejects a whitespace-only ownerRef the same as a missing one', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: '   ', surface: 'image', model: 'm' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing surface', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', model: 'm' }, query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'surface must be one of: image, video, audio' } });
  });

  it('rejects an invalid surface', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'smell', model: 'm' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a missing model', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'image' }, query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'model must be a non-empty string', details: { kind: 'validation', issues: [{ path: 'model', message: 'required non-empty string' }] } } });
  });

  it('rejects an invalid audioKind', () => {
    const result = mediaGenerateRoute.parse({
      body: { ownerRef: 'r1', surface: 'audio', model: 'm', audioKind: 'symphony' },
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid speechFormat', () => {
    const result = mediaGenerateRoute.parse({
      body: { ownerRef: 'r1', surface: 'audio', model: 'm', speechFormat: 'ogg' },
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string prompt', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'image', model: 'm', prompt: 42 }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string aspect', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'image', model: 'm', aspect: 16 }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string voice', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'audio', model: 'm', voice: 7 }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string language', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'audio', model: 'm', language: 7 }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string wireModel', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'image', model: 'm', wireModel: 7 }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-numeric length', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'video', model: 'm', length: 'ten' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-numeric duration', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'audio', model: 'm', duration: 'ten' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-numeric promptInfluence', () => {
    const result = mediaGenerateRoute.parse({
      body: { ownerRef: 'r1', surface: 'audio', model: 'm', promptInfluence: 'high' },
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-boolean loop', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'video', model: 'm', loop: 'yes' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects an imageRef missing dataUrl', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'image', model: 'm', imageRef: {} }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects imageRefs that is not an array', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'image', model: 'm', imageRefs: 'nope' }, query: {}, params: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid entry inside imageRefs', () => {
    const result = mediaGenerateRoute.parse({
      body: { ownerRef: 'r1', surface: 'image', model: 'm', imageRefs: [{ dataUrl: 'data:x' }, { nope: true }] },
      query: {},
      params: {},
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a minimal well-formed body', () => {
    const result = mediaGenerateRoute.parse({ body: { ownerRef: 'r1', surface: 'image', model: 'dall-e-3' }, query: {}, params: {} });
    expect(result).toEqual({ ok: true, value: { ownerRef: 'r1', request: { surface: 'image', model: 'dall-e-3' } } });
  });

  it('accepts a fully-populated body, threading every optional field through', () => {
    const result = mediaGenerateRoute.parse({
      body: {
        ownerRef: 'r1',
        surface: 'audio',
        model: 'tts-1',
        prompt: 'say hi',
        aspect: '16:9',
        length: 10,
        duration: 5,
        voice: 'alloy',
        audioKind: 'speech',
        language: 'en',
        loop: true,
        promptInfluence: 0.5,
        wireModel: 'tts-1-wire',
        speechFormat: 'wav',
        imageRef: { dataUrl: 'data:image/png;base64,abc' },
        imageRefs: [{ dataUrl: 'data:image/png;base64,def' }],
      },
      query: {},
      params: {},
    });
    expect(result).toEqual({
      ok: true,
      value: {
        ownerRef: 'r1',
        request: {
          surface: 'audio',
          model: 'tts-1',
          prompt: 'say hi',
          aspect: '16:9',
          length: 10,
          duration: 5,
          voice: 'alloy',
          audioKind: 'speech',
          language: 'en',
          loop: true,
          promptInfluence: 0.5,
          imageRef: { dataUrl: 'data:image/png;base64,abc' },
          imageRefs: [{ dataUrl: 'data:image/png;base64,def' }],
          wireModel: 'tts-1-wire',
          speechFormat: 'wav',
        },
      },
    });
  });
});

describe('mediaGenerateRoute.handle', () => {
  it('creates and returns a queued task immediately, without waiting for generation to finish', async () => {
    let resolveGenerate: (() => void) | undefined;
    const engine = makeEngine(
      () =>
        new Promise((resolve) => {
          resolveGenerate = () => resolve(fakeResult());
        }),
    );
    const deps = makeDeps({ engine });
    const result = await mediaGenerateRoute.handle({ ownerRef: 'owner-1', request: { surface: 'image', model: 'm' } }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.task).toMatchObject({ ownerRef: 'owner-1', status: 'queued', surface: 'image', model: 'm' });
    }
    resolveGenerate?.();
  });

  it('the background generation transitions the task through running to done, with a base64 data URL and warnings as progress', async () => {
    const deps = makeDeps({
      engine: makeEngine(async () => fakeResult({ providerNote: 'rendered', providerId: 'nanobanana', warnings: ['clamped length'] })),
    });
    const result = await mediaGenerateRoute.handle({ ownerRef: 'owner-1', request: { surface: 'image', model: 'm' } }, deps);
    expect(result.ok).toBe(true);
    const taskId = result.ok ? result.value.task.id : '';

    await vi.waitFor(async () => {
      const task = await deps.taskStore.get(taskId);
      expect(task?.status).toBe('done');
    });
    const task = await deps.taskStore.get(taskId);
    expect(task?.file).toMatchObject({
      dataUrl: `data:image/png;base64,${Buffer.from('hello').toString('base64')}`,
      providerId: 'nanobanana',
      providerNote: 'rendered',
      usedStubFallback: false,
    });
    expect(task?.progress).toEqual(['clamped length']);
    expect(task?.endedAt).not.toBeNull();
  });

  it('includes suggestedExt on the task file when the engine result provides one', async () => {
    const deps = makeDeps({ engine: makeEngine(async () => fakeResult({ suggestedExt: 'png' })) });
    const result = await mediaGenerateRoute.handle({ ownerRef: 'owner-1', request: { surface: 'image', model: 'm' } }, deps);
    const taskId = result.ok ? result.value.task.id : '';
    await vi.waitFor(async () => {
      const task = await deps.taskStore.get(taskId);
      expect(task?.status).toBe('done');
    });
    const task = await deps.taskStore.get(taskId);
    expect(task?.file).toMatchObject({ suggestedExt: 'png' });
  });

  it.each([
    ['image', undefined, 'image/png'],
    ['video', undefined, 'video/mp4'],
    ['audio', undefined, 'audio/mpeg'],
    ['audio', 'wav', 'audio/wav'],
    ['audio', 'flac', 'audio/flac'],
    ['audio', 'aac', 'audio/aac'],
    ['audio', 'opus', 'audio/opus'],
  ] as const)('picks the right mime type for surface=%s speechFormat=%s', async (surface, speechFormat, mime) => {
    const deps = makeDeps();
    const result = await mediaGenerateRoute.handle(
      { ownerRef: 'owner-1', request: { surface, model: 'm', ...(speechFormat ? { speechFormat } : {}) } },
      deps,
    );
    const taskId = result.ok ? result.value.task.id : '';
    await vi.waitFor(async () => {
      const task = await deps.taskStore.get(taskId);
      expect(task?.status).toBe('done');
    });
    const task = await deps.taskStore.get(taskId);
    expect((task?.file as { dataUrl: string }).dataUrl.startsWith(`data:${mime};base64,`)).toBe(true);
  });

  it('SEC-005: a failed background generation marks the task failed with a redacted error, and reports via onInternalError', async () => {
    const onInternalError = vi.fn();
    const deps = makeDeps({
      onInternalError,
      engine: makeEngine(async () => {
        throw new Error('vendor API key rejected: sk-secret-123');
      }),
    });
    const result = await mediaGenerateRoute.handle({ ownerRef: 'owner-1', request: { surface: 'image', model: 'm' } }, deps);
    const taskId = result.ok ? result.value.task.id : '';

    await vi.waitFor(async () => {
      const task = await deps.taskStore.get(taskId);
      expect(task?.status).toBe('failed');
    });
    const task = await deps.taskStore.get(taskId);
    expect(task?.error).toEqual({ message: 'an internal error occurred', code: 'INTERNAL_ERROR' });
    expect(onInternalError).toHaveBeenCalledTimes(1);
    const context = onInternalError.mock.calls[0]![0];
    expect(context.source).toBe('media-generate-dispatch');
    expect(context.taskId).toBe(taskId);
    expect(context.ownerRef).toBe('owner-1');
    expect(context.error).toBeInstanceOf(Error);
  });

  it('SEC-005: redacts a taskStore.create() failure to a generic INTERNAL_ERROR and reports it via onInternalError', async () => {
    const onInternalError = vi.fn();
    const realStore = createInMemoryMediaTaskStore();
    const deps = makeDeps({
      onInternalError,
      taskStore: {
        ...realStore,
        create: async () => {
          throw new Error('disk full');
        },
      },
    });
    const result = await mediaGenerateRoute.handle({ ownerRef: 'owner-1', request: { surface: 'image', model: 'm' } }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) });
    }
    const context = onInternalError.mock.calls[0]![0];
    expect(context.source).toBe('media-task-store');
    expect(context.taskId).toBeNull();
    expect(context.ownerRef).toBe('owner-1');
  });

  it('AUD-003 regression: a taskStore write failure inside the background failure handler never produces an unhandled rejection', async () => {
    const onInternalError = vi.fn();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    const realStore = createInMemoryMediaTaskStore();
    let updateCallCount = 0;
    const deps = makeDeps({
      onInternalError,
      engine: makeEngine(async () => {
        throw new Error('vendor call failed');
      }),
      taskStore: {
        ...realStore,
        update: async (id: string, patch: Parameters<typeof realStore.update>[1]) => {
          updateCallCount += 1;
          // The 2nd call is the catch arm writing the 'failed' status — simulate the task store
          // already being closed by then (e.g. daemon shutdown mid-generation), the exact race
          // AUD-003 found.
          if (updateCallCount === 2) {
            throw new Error('The database connection is not open');
          }
          return realStore.update(id, patch);
        },
      },
    });

    const result = await mediaGenerateRoute.handle({ ownerRef: 'owner-1', request: { surface: 'image', model: 'm' } }, deps);
    expect(result.ok).toBe(true);

    await vi.waitFor(() => {
      expect(onInternalError).toHaveBeenCalledTimes(2);
    });
    // Let a macrotask pass so any unhandled rejection this path introduced would have surfaced.
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', onUnhandledRejection);

    expect(unhandledRejections).toEqual([]);
    expect(onInternalError.mock.calls[0]![0]).toMatchObject({ source: 'media-generate-dispatch', error: new Error('vendor call failed') });
    expect(onInternalError.mock.calls[1]![0]).toMatchObject({
      source: 'media-generate-dispatch',
      error: new Error('The database connection is not open'),
    });
  });

  it('SEC-005: falls back to console.error when no onInternalError sink is supplied', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({
      engine: makeEngine(async () => {
        throw new Error('boom');
      }),
    });
    const result = await mediaGenerateRoute.handle({ ownerRef: 'owner-1', request: { surface: 'image', model: 'm' } }, deps);
    const taskId = result.ok ? result.value.task.id : '';
    await vi.waitFor(async () => {
      const task = await deps.taskStore.get(taskId);
      expect(task?.status).toBe('failed');
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });
});

describe('mediaTaskGetRoute.parse (parseTaskId)', () => {
  it('rejects a missing id path parameter', () => {
    const result = mediaTaskGetRoute.parse({ body: undefined, query: {}, params: {} });
    expect(result).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'id must be a non-empty path parameter' } });
  });

  it('accepts a well-formed id', () => {
    const result = mediaTaskGetRoute.parse({ body: undefined, query: {}, params: { id: 't1' } });
    expect(result).toEqual({ ok: true, value: 't1' });
  });
});

describe('mediaTaskGetRoute.handle', () => {
  it('returns NOT_FOUND for an unknown task id', async () => {
    const deps = makeDeps();
    const result = await mediaTaskGetRoute.handle('nope', deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'media task not found' } });
  });

  it('returns the task for a known id', async () => {
    const deps = makeDeps();
    const task = await deps.taskStore.create({ id: 't1', ownerRef: 'owner-1' });
    const result = await mediaTaskGetRoute.handle('t1', deps);
    expect(result).toEqual({ ok: true, value: { task } });
  });

  it('SEC-005: redacts task-store read failures and reports the real error only to the host sink', async () => {
    const onInternalError = vi.fn();
    const realStore = createInMemoryMediaTaskStore();
    const deps = makeDeps({
      onInternalError,
      taskStore: {
        ...realStore,
        get: async () => {
          throw new Error('/private/jini.sqlite: disk I/O error');
        },
      },
    });

    const result = await mediaTaskGetRoute.handle('t1', deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) },
    });
    expect(JSON.stringify(result)).not.toContain('/private/jini.sqlite');
    expect(onInternalError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'media-task-store', taskId: 't1', ownerRef: null }),
    );
  });
});

describe('mediaTaskDeleteRoute.handle', () => {
  it('returns NOT_FOUND for an unknown task id', async () => {
    const deps = makeDeps();
    const result = await mediaTaskDeleteRoute.handle('nope', deps);
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'media task not found' } });
  });

  it('deletes an existing task, and a subsequent get sees it gone', async () => {
    const deps = makeDeps();
    await deps.taskStore.create({ id: 't1', ownerRef: 'owner-1' });
    const result = await mediaTaskDeleteRoute.handle('t1', deps);
    expect(result).toEqual({ ok: true, value: { ok: true } });
    expect(await deps.taskStore.get('t1')).toBeNull();
  });

  it('SEC-005: redacts task-store delete failures with the known task owner', async () => {
    const onInternalError = vi.fn();
    const realStore = createInMemoryMediaTaskStore();
    await realStore.create({ id: 't1', ownerRef: 'owner-1' });
    const deps = makeDeps({
      onInternalError,
      taskStore: {
        ...realStore,
        delete: async () => {
          throw new Error('sqlite file /private/tasks.db is locked');
        },
      },
    });

    const result = await mediaTaskDeleteRoute.handle('t1', deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) },
    });
    expect(JSON.stringify(result)).not.toContain('/private/tasks.db');
    expect(onInternalError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'media-task-store', taskId: 't1', ownerRef: 'owner-1' }),
    );
  });
});

describe('mediaTaskListRoute.parse', () => {
  it('rejects a missing ownerRef query parameter', () => {
    const result = mediaTaskListRoute.parse({ body: undefined, query: {}, params: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toEqual({ kind: 'validation', issues: [{ path: 'ownerRef', message: 'required non-empty string' }] });
    }
  });

  it('rejects a whitespace-only ownerRef', () => {
    const result = mediaTaskListRoute.parse({ body: undefined, query: { ownerRef: '  ' }, params: {} });
    expect(result.ok).toBe(false);
  });

  it('picks the first value when ownerRef is repeated', () => {
    const result = mediaTaskListRoute.parse({ body: undefined, query: { ownerRef: ['first', 'second'] }, params: {} });
    expect(result).toEqual({ ok: true, value: { ownerRef: 'first', options: { includeTerminal: false } } });
  });

  it('defaults includeTerminal to false when absent', () => {
    const result = mediaTaskListRoute.parse({ body: undefined, query: { ownerRef: 'r1' }, params: {} });
    expect(result).toEqual({ ok: true, value: { ownerRef: 'r1', options: { includeTerminal: false } } });
  });

  it('parses includeTerminal=true, and treats any other value as false', () => {
    expect(mediaTaskListRoute.parse({ body: undefined, query: { ownerRef: 'r1', includeTerminal: 'true' }, params: {} })).toEqual({
      ok: true,
      value: { ownerRef: 'r1', options: { includeTerminal: true } },
    });
    expect(mediaTaskListRoute.parse({ body: undefined, query: { ownerRef: 'r1', includeTerminal: 'nah' }, params: {} })).toEqual({
      ok: true,
      value: { ownerRef: 'r1', options: { includeTerminal: false } },
    });
    expect(
      mediaTaskListRoute.parse({ body: undefined, query: { ownerRef: 'r1', includeTerminal: ['true', 'false'] }, params: {} }),
    ).toEqual({ ok: true, value: { ownerRef: 'r1', options: { includeTerminal: true } } });
  });
});

describe('mediaTaskListRoute.handle', () => {
  it('lists only tasks scoped to the given ownerRef', async () => {
    const deps = makeDeps();
    await deps.taskStore.create({ id: 't1', ownerRef: 'owner-1' });
    await deps.taskStore.create({ id: 't2', ownerRef: 'owner-2' });
    const result = await mediaTaskListRoute.handle({ ownerRef: 'owner-1', options: {} }, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasks.map((t) => t.id)).toEqual(['t1']);
    }
  });

  it('excludes terminal tasks unless includeTerminal is set', async () => {
    const deps = makeDeps();
    await deps.taskStore.create({ id: 't1', ownerRef: 'owner-1', status: 'done' });
    await deps.taskStore.create({ id: 't2', ownerRef: 'owner-1', status: 'queued' });
    const withoutTerminal = await mediaTaskListRoute.handle({ ownerRef: 'owner-1', options: { includeTerminal: false } }, deps);
    expect(withoutTerminal.ok && withoutTerminal.value.tasks.map((t) => t.id)).toEqual(['t2']);
    const withTerminal = await mediaTaskListRoute.handle({ ownerRef: 'owner-1', options: { includeTerminal: true } }, deps);
    expect(withTerminal.ok && withTerminal.value.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('SEC-005: redacts task-store list failures with the requested owner scope', async () => {
    const onInternalError = vi.fn();
    const realStore = createInMemoryMediaTaskStore();
    const deps = makeDeps({
      onInternalError,
      taskStore: {
        ...realStore,
        listByOwner: async () => {
          throw new Error('driver detail: /private/tasks.db');
        },
      },
    });

    const result = await mediaTaskListRoute.handle({ ownerRef: 'owner-1', options: {} }, deps);
    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred', requestId: expect.any(String) },
    });
    expect(JSON.stringify(result)).not.toContain('/private/tasks.db');
    expect(onInternalError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'media-task-store', taskId: null, ownerRef: 'owner-1' }),
    );
  });
});

describe('registerMediaRoutes', () => {
  it('mounts exactly the four media routes', () => {
    const app = makeApp();
    registerMediaRoutes(app as any, makeDeps(), adapter);
    expect(Object.keys(app.handlers).sort()).toEqual(
      ['POST /api/media/generate', 'GET /api/media/tasks/:id', 'DELETE /api/media/tasks/:id', 'GET /api/media/tasks'].sort(),
    );
  });

  it('requires same-origin for generate: blocks a cross-origin request with 403', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerMediaRoutes(app as any, makeDeps(), adapter);
    const res = makeJsonRes();
    await app.handlers['POST /api/media/generate']!({ body: { ownerRef: 'r1', surface: 'image', model: 'm' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('requires same-origin for delete: blocks a cross-origin request with 403', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    registerMediaRoutes(app as any, makeDeps(), adapter);
    const res = makeJsonRes();
    await app.handlers['DELETE /api/media/tasks/:id']!({ body: undefined, query: {}, params: { id: 't1' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does not require same-origin for get/list', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const app = makeApp();
    const deps = makeDeps();
    registerMediaRoutes(app as any, deps, adapter);
    const res1 = makeJsonRes();
    await app.handlers['GET /api/media/tasks/:id']!({ body: undefined, query: {}, params: { id: 'nope' } }, res1);
    expect(res1.status).toHaveBeenCalledWith(404);
    const res2 = makeJsonRes();
    await app.handlers['GET /api/media/tasks']!({ body: undefined, query: { ownerRef: 'r1' }, params: {} }, res2);
    expect(res2.status).toHaveBeenCalledWith(200);
  });

  it('mounted POST /api/media/generate returns 202 with the queued task through the real Adapter pipeline', async () => {
    const app = makeApp();
    const deps = makeDeps();
    registerMediaRoutes(app as any, deps, adapter);
    const res = makeJsonRes();
    await app.handlers['POST /api/media/generate']!({ body: { ownerRef: 'r1', surface: 'image', model: 'm' }, query: {}, params: {} }, res);
    expect(res.status).toHaveBeenCalledWith(202);
    const [body] = res.json.mock.calls[0]!;
    expect(body.task).toMatchObject({ ownerRef: 'r1', status: 'queued' });
  });
});

/**
 * Real Express server on a real socket. Every test above drives a route's `handle`/`parse` directly
 * or a handler-capturing `MockApp` stub — neither actually resolves an Express path, feeds a spec's
 * `parse` a body Express itself parsed from real JSON bytes, or reads a query string the way
 * `req.query` really shapes one (a repeated/boolean-like `includeTerminal=true` string). This block
 * is the only place `registerMediaRoutes` is exercised as a listening server: it proves all four
 * mounted paths route correctly (the three verbs on `/api/media/tasks/:id` plus the sibling
 * `/api/media/tasks` list), that the declared `202`/`200`/`404` status codes reach the wire, and
 * that a real cross-origin `fetch` is rejected before the task store is ever touched.
 */
describe('registerMediaRoutes — real Express server on a real socket', () => {
  const servers: Server[] = [];
  const adapterRef = { resolvedPortRef: { current: 0 } };

  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  async function listen(deps: MediaHttpDeps): Promise<string> {
    const app = express();
    app.use(express.json());
    registerMediaRoutes(app as never, deps, adapterRef as never);
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

  it('serves POST /api/media/generate end to end, returning the freshly-queued task through the real Adapter pipeline', async () => {
    const base = await listen(makeDeps());
    const result = await send(base, 'POST', '/api/media/generate', { ownerRef: 'r1', surface: 'image', model: 'm1' });
    expect(result.status).toBe(202);
    expect((result.body as { task: Record<string, unknown> }).task).toMatchObject({
      ownerRef: 'r1',
      status: 'queued',
      surface: 'image',
      model: 'm1',
    });
  });

  it('serves GET then DELETE /api/media/tasks/:id end to end against the real task store, then 404s the deleted id', async () => {
    const taskStore = createInMemoryMediaTaskStore();
    const base = await listen(makeDeps({ taskStore }));
    const created = await taskStore.create({ id: 't1', ownerRef: 'r1', status: 'done' });

    expect(await send(base, 'GET', '/api/media/tasks/t1')).toEqual({ status: 200, body: { task: created } });
    expect(await send(base, 'DELETE', '/api/media/tasks/t1')).toEqual({ status: 200, body: { ok: true } });
    expect(await send(base, 'GET', '/api/media/tasks/t1')).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'media task not found' } },
    });
  });

  it('serves GET /api/media/tasks end to end, scoped by the real ownerRef query string and excluding terminal tasks unless includeTerminal=true', async () => {
    const taskStore = createInMemoryMediaTaskStore();
    const base = await listen(makeDeps({ taskStore }));
    await taskStore.create({ id: 'queued-1', ownerRef: 'r1', status: 'queued' });
    await taskStore.create({ id: 'done-1', ownerRef: 'r1', status: 'done' });
    await taskStore.create({ id: 'other-owner', ownerRef: 'r2', status: 'queued' });

    const active = await send(base, 'GET', '/api/media/tasks?ownerRef=r1');
    expect(active.status).toBe(200);
    expect((active.body as { tasks: { id: string }[] }).tasks.map((task) => task.id)).toEqual(['queued-1']);

    const all = await send(base, 'GET', '/api/media/tasks?ownerRef=r1&includeTerminal=true');
    expect((all.body as { tasks: { id: string }[] }).tasks.map((task) => task.id).sort()).toEqual(['done-1', 'queued-1']);
  });

  it('rejects a cross-origin generate request with 403 before the task store is ever called', async () => {
    vi.mocked(isLocalSameOrigin).mockReturnValue(false);
    const taskStore = createInMemoryMediaTaskStore();
    const createSpy = vi.spyOn(taskStore, 'create');
    const base = await listen(makeDeps({ taskStore }));
    const response = await send(
      base,
      'POST',
      '/api/media/generate',
      { ownerRef: 'r1', surface: 'image', model: 'm1' },
      'http://evil.example.com',
    );
    expect(response.status).toBe(403);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
