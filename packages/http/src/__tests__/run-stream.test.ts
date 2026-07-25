import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryEventLog, createRunLifecycle, type RunLifecycle, type StreamSubscribeResult } from '@jini/daemon';
import {
  handleRunStreamRequest,
  registerRunStreamRoute,
  type RunStreamDeps,
  type RunStreamEncoder,
} from '../run-stream.js';

function makeReqRes() {
  const req = new EventEmitter();
  const res = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() };
  return { req, res };
}

function writtenEvents(res: { write: ReturnType<typeof vi.fn> }): unknown[] {
  return res.write.mock.calls
    .map((call: unknown[]) => call[0] as string)
    .filter((chunk: string) => chunk.startsWith('data: '))
    .map((chunk: string) => JSON.parse(chunk.slice('data: '.length, chunk.length - 2)));
}

async function makeRealLifecycle() {
  return createRunLifecycle({ eventLog: createInMemoryEventLog() });
}

const testEncoder: RunStreamEncoder = {
  encode(event) {
    if (event.kind === 'agent' && event.payload.type === 'text_delta') {
      return { kind: 'agent.message', text: event.payload.delta };
    }
    if (event.kind === 'end') {
      return { kind: 'run.lifecycle', status: 'completed' };
    }
    return { kind: event.kind };
  },
};

function streamDeps(lifecycle: RunLifecycle): RunStreamDeps {
  return { lifecycle, encoder: testEncoder };
}

describe('handleRunStreamRequest — real RunLifecycle integration', () => {
  it('forwards a text_delta agent event as an encoded agent.message SSE event', async () => {
    const lifecycle = await makeRealLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1', runId: 'run-1' });
    const { req, res } = makeReqRes();

    // `handleRunStreamRequest` resolves once subscribed (it does not wait for the run to finish)
    // — awaiting it fully before emitting further events guarantees the subscription is live
    // before this test drives them, rather than racing the two independent async chains.
    await handleRunStreamRequest(req as any, res as any, run.id, streamDeps(lifecycle));
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: 'hi' } });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const events = writtenEvents(res);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'agent.message', text: 'hi' }));
  });

  it('closes the SSE connection once the run reaches its terminal end event', async () => {
    const lifecycle = await makeRealLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1', runId: 'run-2' });
    const { req, res } = makeReqRes();

    await handleRunStreamRequest(req as any, res as any, run.id, streamDeps(lifecycle));
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('replays a run that was already terminal before the SSE request arrived, then closes', async () => {
    const lifecycle = await makeRealLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1', runId: 'run-3' });
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: 'already done' } });
    await lifecycle.finish({ runId: run.id, status: 'succeeded', code: 0, signal: null, resumable: false });

    const { req, res } = makeReqRes();
    await handleRunStreamRequest(req as any, res as any, run.id, streamDeps(lifecycle));

    const events = writtenEvents(res);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'agent.message', text: 'already done' }));
    expect(events).toContainEqual(expect.objectContaining({ kind: 'run.lifecycle', status: 'completed' }));
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from the run when the client disconnects before the run ends', async () => {
    const lifecycle = await makeRealLifecycle();
    const { run } = await lifecycle.start({ contextRef: 'ctx-1', runId: 'run-4' });
    const { req, res } = makeReqRes();

    await handleRunStreamRequest(req as any, res as any, run.id, streamDeps(lifecycle));
    (req as EventEmitter).emit('close');

    // If unsubscribe genuinely ran, a subsequent emit() on the same run must not reach `res.write`
    // for a *new* SSE data event, since this connection no longer has an active subscriber.
    const writeCallsBeforeEmit = res.write.mock.calls.length;
    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: 'after disconnect' } });
    expect(res.write.mock.calls.length).toBe(writeCallsBeforeEmit);
  });

  it('sends an {error} SSE event and closes when the run is unknown', async () => {
    const lifecycle = await makeRealLifecycle();
    const { req, res } = makeReqRes();

    await handleRunStreamRequest(req as any, res as any, 'nonexistent-run', streamDeps(lifecycle));

    const events = writtenEvents(res);
    expect(events).toContainEqual({ error: 'unknown-run' });
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe('handleRunStreamRequest — non-ok StreamSubscribeResult kinds', () => {
  it('reports a replay-gap result and closes', async () => {
    const fakeLifecycle = {
      stream: vi.fn(
        async (): Promise<StreamSubscribeResult> => ({ kind: 'replay-gap', requestedCursor: '5', oldestAvailableCursor: '10' }),
      ),
    } as unknown as RunLifecycle;
    const { req, res } = makeReqRes();

    await handleRunStreamRequest(req as any, res as any, 'run-x', streamDeps(fakeLifecycle));

    expect(writtenEvents(res)).toContainEqual({ error: 'replay-gap' });
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('reports an invalid-cursor result and closes', async () => {
    const fakeLifecycle = {
      stream: vi.fn(async (): Promise<StreamSubscribeResult> => ({ kind: 'invalid-cursor', requestedCursor: 'bogus' })),
    } as unknown as RunLifecycle;
    const { req, res } = makeReqRes();

    await handleRunStreamRequest(req as any, res as any, 'run-x', streamDeps(fakeLifecycle));

    expect(writtenEvents(res)).toContainEqual({ error: 'invalid-cursor' });
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe('handleRunStreamRequest — disconnect and failure containment', () => {
  it('unsubscribes when the client disconnects while durable replay is still pending', async () => {
    let releaseReplay!: () => void;
    const replayPending = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const unsubscribe = vi.fn();
    const fakeLifecycle = {
      stream: vi.fn(async (): Promise<StreamSubscribeResult> => {
        await replayPending;
        return { kind: 'ok', unsubscribe };
      }),
    } as unknown as RunLifecycle;
    const { req, res } = makeReqRes();

    const handling = handleRunStreamRequest(req as any, res as any, 'run-pending', streamDeps(fakeLifecycle));
    await vi.waitFor(() => expect(fakeLifecycle.stream).toHaveBeenCalledTimes(1));
    (req as EventEmitter).emit('close');
    releaseReplay();
    await handling;

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('contains a throwing replay encoder, closes the stream, reports it, and unsubscribes', async () => {
    const unsubscribe = vi.fn();
    const replayEvent = {
      eventId: 'evt-1',
      runId: 'run-replay',
      sequence: 1,
      at: Date.now(),
      kind: 'agent',
      payload: { type: 'text_delta', delta: 'replayed' },
    };
    const fakeLifecycle = {
      stream: vi.fn(async (_runId: string, onEvent: (event: typeof replayEvent) => void): Promise<StreamSubscribeResult> => {
        onEvent(replayEvent);
        return { kind: 'ok', unsubscribe };
      }),
    } as unknown as RunLifecycle;
    const onInternalError = vi.fn();
    const encoder: RunStreamEncoder = {
      encode: vi.fn(() => {
        throw new Error('broken composition-root encoder');
      }),
    };
    const { req, res } = makeReqRes();

    await handleRunStreamRequest(req as any, res as any, 'run-replay', {
      lifecycle: fakeLifecycle,
      encoder,
      onInternalError,
    });

    expect(res.end).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onInternalError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'encoder', runId: 'run-replay', error: expect.any(Error) }),
    );
  });

  it('sends falsy non-null encoder outputs instead of dropping them', async () => {
    const fakeLifecycle = {
      stream: vi.fn(async (_runId: string, onEvent: (event: any) => void): Promise<StreamSubscribeResult> => {
        onEvent({ kind: 'agent', payload: { type: 'status', label: 'falsy payload' } });
        return { kind: 'ok', unsubscribe: vi.fn() };
      }),
    } as unknown as RunLifecycle;
    const { req, res } = makeReqRes();

    await handleRunStreamRequest(req as any, res as any, 'run-falsy', {
      lifecycle: fakeLifecycle,
      encoder: { encode: () => false },
    });

    expect(writtenEvents(res)).toContain(false);
  });

  it('contains a rejected lifecycle replay without producing an unhandled route promise', async () => {
    const replayError = new Error('sqlite replay failed');
    const fakeLifecycle = {
      stream: vi.fn(async () => {
        throw replayError;
      }),
    } as unknown as RunLifecycle;
    const onInternalError = vi.fn();
    const { req, res } = makeReqRes();

    await expect(
      handleRunStreamRequest(req as any, res as any, 'run-replay-failure', {
        lifecycle: fakeLifecycle,
        encoder: testEncoder,
        onInternalError,
      }),
    ).resolves.toBeUndefined();

    expect(res.end).toHaveBeenCalledTimes(1);
    expect(onInternalError).toHaveBeenCalledWith({
      source: 'lifecycle',
      runId: 'run-replay-failure',
      error: replayError,
    });
  });

  it('the Express glue converts an unexpected pre-stream throw into a generic 500 response', async () => {
    let handler: ((req: any, res: any) => Promise<void>) | undefined;
    const app = {
      get: vi.fn((_path: string, routeHandler: typeof handler) => {
        handler = routeHandler;
      }),
    };
    const onInternalError = vi.fn();
    registerRunStreamRoute(app as any, {
      lifecycle: {} as RunLifecycle,
      encoder: testEncoder,
      onInternalError,
    });
    const res = {
      writeHead: vi.fn(() => {
        throw new Error('socket header write failed');
      }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      headersSent: false,
      writableEnded: false,
    };

    await handler!({ params: { runId: 'run-route-failure' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred' },
    });
    expect(onInternalError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'route', runId: 'run-route-failure', error: expect.any(Error) }),
    );
  });
});

/** Reads from `res`'s SSE body stream until `expectedSubstring` appears (bounded — fails the test via a thrown error rather than hanging forever if it never shows up), then cancels the reader. Guards against the connection's already-replayed 'start' event and the target event landing in separate `read()` calls / chunks. */
async function readSseUntil(res: Response, expectedSubstring: string): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    const { value, done } = await reader.read();
    if (done) break;
    accumulated += decoder.decode(value, { stream: true });
    if (accumulated.includes(expectedSubstring)) {
      await reader.cancel();
      return accumulated;
    }
  }
  await reader.cancel();
  throw new Error(`expected substring not found within bound: ${expectedSubstring}\ngot: ${accumulated}`);
}

describe('registerRunStreamRoute — real Express server on a real socket, not fake req/res', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("streams a run's encoded events over a real SSE connection", async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog() });
    const { run } = await lifecycle.start({ contextRef: 'ctx', runId: 'express-run-1' });

    const app = express();
    registerRunStreamRoute(app, streamDeps(lifecycle));
    server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${run.id}/agui-stream`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    await lifecycle.emit(run.id, { event: 'agent', data: { type: 'text_delta', delta: 'hello from express' } });
    const body = await readSseUntil(res, '"text":"hello from express"');
    expect(body).toContain('"kind":"agent.message"');
  });
});
