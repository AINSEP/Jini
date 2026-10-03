import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";

import type { AgentEvent, ChatMessage } from "@jini-ai/chat/core";
import type { ChatTransport, RunHandlers, StartRunInput } from "@jini-ai/chat/react";

import { decodeSseStream } from '@jini-ai/agent-runtime/providers/sse-decode';
import { createFetchSseTransport, buildJsonChatRequest, mapJsonChatSseFrame } from '../fetch-sse.js';
// The browser-safe decoder has a dedicated public leaf. Rebuild agent-runtime before this suite.
let fetchPort: typeof fetch;
const createTransport = () => createFetchSseTransport({
  endpoint: CHAT_URL, agentId: 'example-agent', fetch: (url, init) => fetchPort(url, init),
  ids: () => crypto.randomUUID(), decode: decodeSseStream, requestBuilder: buildJsonChatRequest,
  frameMapper: ({ frame }) => mapJsonChatSseFrame({ frame, directiveEventName: 'client_directive', streamError: 'chat error' }),
  maxHistoryMessages: 12, maxHistoryMessageChars: 2000,
  copy: { noUserMessage: 'no user message to send', missingBody: 'chat response had no stream body',
    requestFailed: ({ status }) => `chat request failed (${status})` },
});

/** Generalized characterization cases from the source widget; effect ports are injected. */

const CHAT_URL = "/example/chat";

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A raw frame with only a `data:` line — no `event:` line at all, exercising `parseSseFrame`'s
 *  `let event = "message"` default (a server keep-alive comment would instead omit `data:` entirely;
 *  see `streamResponse`'s keep-alive test). "message" matches none of `startRun`'s known event
 *  branches, so this doubles as the "unrecognized event name" case. */
function defaultEventFrame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(frames: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

/** Errors the response body's reader with `reason` on the first `read()` — models a stream that dies
 *  mid-flight (a dropped connection, e.g.) rather than one that never had a body at all. */
function erroringStreamResponse(reason: unknown, status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(reason);
    },
  });
  return new Response(stream, { status });
}

/** Keep fetch pending until the actual signal supplied by the transport aborts. */
function abortableFetchStub(): { fetch: typeof fetch; signal: () => AbortSignal } {
  let capturedSignal: AbortSignal;
  return {
    signal: () => capturedSignal,
    fetch: (async (_url: string, opts: RequestInit) => {
      capturedSignal = opts.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (capturedSignal.aborted) abort();
        else capturedSignal.addEventListener("abort", abort, { once: true });
      });
    }) as typeof fetch,
  };
}

function controlledStreamResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  return {
    response: new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    send: (frame: string) => controller.enqueue(new TextEncoder().encode(frame)),
    close: () => { try { controller.close(); } catch { /* transport canceled at end */ } },
  };
}

// Let the pump finish its pending reads while the response remains open.
const flushStream = () => new Promise<void>((resolve) => setImmediate(resolve));

function userMessage(content: string): ChatMessage {
  return { id: `msg-${content}`, role: "user", content };
}

function baseInput(history: ChatMessage[], signal?: AbortSignal): StartRunInput {
  return { history, signal: signal ?? new AbortController().signal };
}

function makeHandlers(): {
  handlers: RunHandlers;
  events: AgentEvent[];
  errors: Error[];
  doneCount: () => number;
  doneEvents: () => AgentEvent[] | null;
  donePromise: Promise<void>;
} {
  const events: AgentEvent[] = [];
  const errors: Error[] = [];
  let doneCount = 0;
  let doneEvents: AgentEvent[] | null = null;
  let resolveDone!: () => void;
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const handlers: RunHandlers = {
    onEvent: (ev) => events.push(ev),
    onError: (err) => errors.push(err),
    onDone: (finalEvents) => {
      doneCount += 1;
      doneEvents = finalEvents;
      resolveDone();
    },
  };
  return { handlers, events, errors, doneCount: () => doneCount, doneEvents: () => doneEvents, donePromise };
}

describe("createTransport", () => {
  let savedFetch: typeof fetch;
  let transport: ChatTransport;

  beforeEach(() => {
    savedFetch = fetch;
    transport = createTransport();
  });

  afterEach(() => {
    fetchPort = savedFetch;
  });

  describe("startRun", () => {
    it("throws without calling fetch when history has no user turn", async () => {
      let fetchCalled = false;
      fetchPort = (async () => {
        fetchCalled = true;
        return streamResponse([sseFrame("end", { reason: "stop" })]);
      }) as typeof fetch;

      const { handlers } = makeHandlers();
      await assert.rejects(
        () => transport.startRun(baseInput([{ id: "a1", role: "assistant", content: "hi" }]), handlers),
        (err: Error) => {
          assert.equal(err.message, "no user message to send");
          return true;
        },
      );
      assert.equal(fetchCalled, false, "fetch must not fire when there is nothing to send");
    });

    it("posts the latest user message with no credentials or auth header", async () => {
      let capturedUrl: string | undefined;
      let capturedInit: RequestInit | undefined;
      fetchPort = (async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return streamResponse([sseFrame("end", { reason: "stop" })]);
      }) as typeof fetch;

      const { handlers, donePromise } = makeHandlers();
      const { runId } = await transport.startRun(baseInput([userMessage("hello there")]), handlers);
      await donePromise;

      assert.equal(capturedUrl, CHAT_URL);
      assert.equal(capturedInit?.method, "POST");
      assert.equal((capturedInit?.headers as Record<string, string>)["Content-Type"], "application/json");
      assert.equal(capturedInit && "credentials" in capturedInit, false, "no cookie/session credentials sent");
      assert.equal(new Headers(capturedInit?.headers).has("Authorization"), false);
      const body = JSON.parse(capturedInit?.body as string) as { message: string; history: unknown[] };
      assert.equal(body.message, "hello there");
      assert.deepEqual(body.history, []);
      assert.match(runId, /^[0-9a-f-]{36}$/i);
    });

    it("streams text and client_directive frames through onEvent and collects both for onDone", async () => {
      fetchPort = (async () =>
        streamResponse([
          sseFrame("text", { delta: "Hi " }),
          sseFrame("text", { delta: "there" }),
          sseFrame("client_directive", { type: "highlight_entry", title: "My Post" }),
          sseFrame("end", { reason: "stop" }),
        ])) as typeof fetch;

      const { handlers, events, doneCount, doneEvents, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.deepEqual(events, [
        { kind: "text", text: "Hi " },
        { kind: "text", text: "there" },
        { kind: "ext", name: "client_directive", data: { type: "highlight_entry", title: "My Post" } },
      ]);
      assert.equal(doneCount(), 1);
      assert.deepEqual(doneEvents(), events);
    });

    it("preserves split frames, split delimiters, and split UTF-8 bytes", async () => {
      const textFrame = sseFrame("text", { delta: "Hi 🌍 café" });
      const encoded = new TextEncoder().encode(textFrame);
      const emojiStart = Buffer.from(encoded).indexOf(Buffer.from("🌍"));
      const cuts = [5, emojiStart + 1, emojiStart + 3, encoded.length - 1];
      fetchPort = (async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          let offset = 0;
          for (const cut of cuts) {
            controller.enqueue(encoded.slice(offset, cut));
            offset = cut;
          }
          controller.enqueue(encoded.slice(offset));
          controller.enqueue(new TextEncoder().encode(sseFrame("client_directive", { type: "highlight_entry", title: "Café" })));
          controller.enqueue(new TextEncoder().encode(sseFrame("end", { reason: "stop" })));
          controller.close();
        },
      }))) as typeof fetch;
      const { handlers, events, errors, doneCount, doneEvents, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;
      assert.deepEqual(errors, []);
      assert.deepEqual(events, [
        { kind: "text", text: "Hi 🌍 café" },
        { kind: "ext", name: "client_directive", data: { type: "highlight_entry", title: "Café" } },
      ]);
      assert.equal(doneCount(), 1);
      assert.deepEqual(doneEvents(), events);
    });

    it("delivers text while the response is still open, before end or EOF", async () => {
      const stream = controlledStreamResponse();
      fetchPort = (async () => stream.response) as typeof fetch;
      const { handlers, events, errors, doneCount, doneEvents, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      try {
        stream.send(sseFrame("text", { delta: "first" }));
        await flushStream();
        assert.deepEqual(events, [{ kind: "text", text: "first" }]);
        assert.equal(doneCount(), 0);
        stream.send(sseFrame("end", { reason: "stop" }));
        await flushStream();
        assert.equal(doneCount(), 1);
        assert.deepEqual(doneEvents(), events);
        assert.deepEqual(errors, []);
      } finally {
        stream.close();
      }
      await donePromise;
    });

    it("drains multiple coalesced frames exactly once and in order", async () => {
      fetchPort = (async () => streamResponse([
        sseFrame("text", { delta: "one" }) +
        sseFrame("text", { delta: "two" }) +
        sseFrame("client_directive", { type: "highlight_entry", title: "Post" }) +
        sseFrame("end", { reason: "stop" }),
      ])) as typeof fetch;
      const { handlers, events, errors, doneCount, doneEvents, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;
      assert.deepEqual(events, [
        { kind: "text", text: "one" },
        { kind: "text", text: "two" },
        { kind: "ext", name: "client_directive", data: { type: "highlight_entry", title: "Post" } },
      ]);
      assert.deepEqual(errors, []);
      assert.equal(doneCount(), 1);
      assert.deepEqual(doneEvents(), events);
    });

    it("passes client_directive data through unvalidated, whatever shape it is", async () => {
      fetchPort = (async () =>
        streamResponse([sseFrame("client_directive", { anything: [1, 2, 3] }), sseFrame("end", { reason: "stop" })])) as typeof fetch;

      const { handlers, events, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.deepEqual(events, [{ kind: "ext", name: "client_directive", data: { anything: [1, 2, 3] } }]);
    });

    it("surfaces an error frame via onError without ending the run, then still ends on a later end frame", async () => {
      const stream = controlledStreamResponse();
      fetchPort = (async () => stream.response) as typeof fetch;
      const { handlers, events, errors, doneCount, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      try {
        stream.send(sseFrame("error", { message: "upstream hiccup" }));
        await flushStream();
        assert.equal(errors.length, 1);
        assert.equal(doneCount(), 0, "an error frame must not finish the run");
        stream.send(sseFrame("text", { delta: "still going" }));
        await flushStream();
        assert.deepEqual(events, [{ kind: "text", text: "still going" }]);
        assert.equal(doneCount(), 0, "text after the error must not finish the run");
        stream.send(sseFrame("end", { reason: "stop" }));
        await flushStream();
        assert.equal(doneCount(), 1, "end finishes the run before EOF");
      } finally {
        stream.close();
      }
      await donePromise;

      assert.equal(errors.length, 1);
      assert.equal(errors[0]?.message, "upstream hiccup");
      assert.deepEqual(events, [{ kind: "text", text: "still going" }], "processing must continue past the error frame");
      assert.equal(doneCount(), 1, "onDone fires exactly once, from the end frame, not the error");
    });

    it("falls back to a generic error message when an error frame carries no message", async () => {
      fetchPort = (async () => streamResponse([sseFrame("error", {}), sseFrame("end", { reason: "stop" })])) as typeof fetch;

      const { handlers, errors, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.equal(errors.length, 1);
      assert.equal(errors[0]?.message, "chat error");
    });

    it("ends the run when the stream closes with no explicit end frame", async () => {
      fetchPort = (async () => streamResponse([sseFrame("text", { delta: "partial" })])) as typeof fetch;

      const { handlers, events, doneCount, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.deepEqual(events, [{ kind: "text", text: "partial" }]);
      assert.equal(doneCount(), 1);
    });

    it("reports malformed JSON once, finishes once, and removes the active run", async () => {
      let signal!: AbortSignal;
      fetchPort = (async (_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return streamResponse(["event: text\ndata: {bad\n\n"]);
      }) as typeof fetch;
      const { handlers, events, errors, doneCount, doneEvents, donePromise } = makeHandlers();
      const { runId } = await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;
      assert.equal(errors.length, 1);
      assert.ok(errors[0] instanceof SyntaxError);
      assert.deepEqual(events, []);
      assert.equal(doneCount(), 1);
      assert.deepEqual(doneEvents(), []);
      await transport.stopRun(runId);
      assert.equal(signal.aborted, false, "a finished run must no longer be cancellable");
    });

    it("skips a keep-alive comment frame (no data: line) without crashing or forwarding it", async () => {
      fetchPort = (async () =>
        streamResponse([": keep-alive\n\n", sseFrame("text", { delta: "after keep-alive" }), sseFrame("end", { reason: "stop" })])) as typeof fetch;

      const { handlers, events, doneCount, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.deepEqual(events, [{ kind: "text", text: "after keep-alive" }]);
      assert.equal(doneCount(), 1);
    });

    it("ignores a frame with no event: line (defaults to \"message\", matches no known kind)", async () => {
      fetchPort = (async () =>
        streamResponse([defaultEventFrame({ delta: "ignored" }), sseFrame("end", { reason: "stop" })])) as typeof fetch;

      const { handlers, events, doneCount, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.deepEqual(events, [], "an unrecognized event name must not be forwarded");
      assert.equal(doneCount(), 1);
    });

    it("reports onError with the server's parsed error body when the response is not ok", async () => {
      fetchPort = (async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 })) as typeof fetch;

      const { handlers, errors, doneCount, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.equal(errors.length, 1);
      assert.equal(errors[0]?.message, "rate limited");
      assert.equal(doneCount(), 1, "a non-ok response still finishes the run");
    });

    it("falls back to a status-coded message when a non-ok response body is not JSON", async () => {
      fetchPort = (async () => new Response("<html>502</html>", { status: 502 })) as typeof fetch;

      const { handlers, errors, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.equal(errors.length, 1);
      assert.equal(errors[0]?.message, "chat request failed (502)");
    });

    it("throws 'no stream body' when the response has no body at all", async () => {
      fetchPort = (async () => new Response(null, { status: 200 })) as typeof fetch;

      const { handlers, errors, doneCount, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.equal(errors.length, 1);
      assert.equal(errors[0]?.message, "chat response had no stream body");
      assert.equal(doneCount(), 1);
    });

    it("finishes with no onError when input.signal aborts before the response resolves", async () => {
      const pending = abortableFetchStub();
      fetchPort = pending.fetch;

      const controller = new AbortController();
      const { handlers, events, errors, doneCount, doneEvents, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")], controller.signal), handlers);
      assert.equal(pending.signal().aborted, false);
      controller.abort();
      assert.equal(pending.signal().aborted, true, "input cancellation must abort fetch");
      await donePromise;

      assert.equal(errors.length, 0, "an abort we caused is not a reportable failure");
      assert.equal(events.length, 0);
      assert.equal(doneCount(), 1);
      assert.deepEqual(doneEvents(), []);
    });

    it("finishes with no onError when stopRun aborts an in-flight request", async () => {
      const pending = abortableFetchStub();
      fetchPort = pending.fetch;

      const { handlers, errors, doneCount, donePromise } = makeHandlers();
      const { runId } = await transport.startRun(baseInput([userMessage("hi")]), handlers);
      assert.equal(pending.signal().aborted, false);
      await transport.stopRun(runId);
      assert.equal(pending.signal().aborted, true, "stopRun must abort fetch");
      await donePromise;

      assert.equal(errors.length, 0);
      assert.equal(doneCount(), 1);
    });

    it("reports onError for a DOMException that is not an AbortError (e.g. a dropped stream)", async () => {
      fetchPort = (async () => erroringStreamResponse(new DOMException("connection reset", "NetworkError"))) as typeof fetch;

      const { handlers, errors, doneCount, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.equal(errors.length, 1);
      assert.equal(errors[0]?.message, "connection reset");
      assert.equal(doneCount(), 1);
    });

    it("wraps a non-Error stream rejection reason in an Error before reporting it", async () => {
      fetchPort = (async () => erroringStreamResponse("boom-non-error")) as typeof fetch;

      const { handlers, errors, donePromise } = makeHandlers();
      await transport.startRun(baseInput([userMessage("hi")]), handlers);
      await donePromise;

      assert.equal(errors.length, 1);
      assert.ok(errors[0] instanceof Error);
      assert.equal(errors[0]?.message, "boom-non-error");
    });

    it("bounds the history sent to the server: excludes the latest turn, drops empty-content turns, keeps only the most recent 12 prior turns, and truncates any turn over 2000 chars", async () => {
      const priors: ChatMessage[] = [];
      for (let i = 0; i < 14; i += 1) {
        if (i === 5) {
          priors.push({ id: `p${i}`, role: "assistant", content: "   " }); // whitespace-only -> filtered
        } else if (i === 10) {
          priors.push({ id: `p${i}`, role: "user", content: "x".repeat(2500) }); // over the char cap -> truncated
        } else {
          priors.push({ id: `p${i}`, role: i % 2 === 0 ? "user" : "assistant", content: `prior-${i}` });
        }
      }
      const history = [...priors, userMessage("the actual question")];

      let capturedBody: { message: string; history: { role: string; content: string }[] } | undefined;
      fetchPort = (async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return streamResponse([sseFrame("end", { reason: "stop" })]);
      }) as typeof fetch;

      const { handlers, donePromise } = makeHandlers();
      await transport.startRun(baseInput(history), handlers);
      await donePromise;

      assert.ok(capturedBody);
      assert.equal(capturedBody?.message, "the actual question");
      // Kept priors: oldest-dropped-first down to the most recent 12 (indices 2..13), then index 5
      // (whitespace-only) filtered out -> 11 entries; index 10's content truncated to 2000 chars.
      const kept = capturedBody!.history;
      assert.equal(kept.length, 11);
      assert.deepEqual(
        kept.map((m) => m.role),
        [2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => (i % 2 === 0 ? "user" : "assistant")),
      );
      assert.equal(kept[0]?.content, "prior-2", "index 0 and 1 (oldest) were dropped by the 12-turn cap");
      const truncated = kept.find((m) => m.content.startsWith("x"));
      assert.ok(truncated, "the over-cap entry survived the count cap (it's within the most recent 12)");
      assert.equal(truncated?.content.length, 2000);
      assert.equal(truncated?.content, "x".repeat(2000));
      assert.ok(
        kept.every((m) => m.content.trim().length > 0),
        "no whitespace-only entry should survive",
      );
    });
  });

  describe("reattachRun", () => {
    it("resolves immediately by calling onDone with an empty event log, without calling fetch", async () => {
      let fetchCalled = false;
      fetchPort = (async () => {
        fetchCalled = true;
        return streamResponse([]);
      }) as typeof fetch;

      const { handlers, doneCount, doneEvents } = makeHandlers();
      await transport.reattachRun("some-run-id", handlers);

      assert.equal(doneCount(), 1);
      assert.deepEqual(doneEvents(), []);
      assert.equal(fetchCalled, false);
    });
  });

  describe("fetchRunStatus", () => {
    it("always resolves null (no server-side run registry to query)", async () => {
      const status = await transport.fetchRunStatus("any-run-id");
      assert.equal(status, null);
    });
  });

  describe("stopRun", () => {
    it("is a no-op for an unknown or already-finished runId", async () => {
      await assert.doesNotReject(() => transport.stopRun("never-started"));
    });
  });
});

describe('transport instance lifecycle and decoder reuse', () => {
  it('does not start a fetch for an already-aborted signal', async () => {
    const fetchSpy = async () => { throw new Error('must not fetch'); };
    const transport = createFetchSseTransport({ endpoint: '/host', agentId: 'agent', fetch: fetchSpy,
      ids: () => 'run', decode: decodeSseStream, requestBuilder: buildJsonChatRequest,
      frameMapper: ({ frame }) => mapJsonChatSseFrame({ frame, directiveEventName: 'page', streamError: 'stream failure' }),
      maxHistoryMessages: 0, maxHistoryMessageChars: 10,
      copy: { noUserMessage: 'missing question', missingBody: 'missing body', requestFailed: ({ status }) => `HTTP ${status}` } });
    const controller = new AbortController();
    controller.abort();
    const result = makeHandlers();
    await transport.startRun(baseInput([userMessage('question')], controller.signal), result.handlers);
    await result.donePromise;
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.errors, []);
    assert.equal(result.doneCount(), 1);
  });
  it('honors cancelSignal and removes listeners after settlement', async () => {
    const pending = abortableFetchStub();
    fetchPort = pending.fetch;
    const transport = createTransport();
    const cancel = new AbortController();
    const result = makeHandlers();
    await transport.startRun({ ...baseInput([userMessage('hi')]), cancelSignal: cancel.signal }, result.handlers);
    cancel.abort();
    await result.donePromise;
    assert.equal(pending.signal().aborted, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.doneCount(), 1);
  });
  it('does not dispatch frames following an end frame in the same chunk', async () => {
    fetchPort = async () => streamResponse([sseFrame('text', { delta: 'before' }) + sseFrame('end', {}) + sseFrame('text', { delta: 'after' })]);
    const result = makeHandlers();
    await createTransport().startRun(baseInput([userMessage('hi')]), result.handlers);
    await result.donePromise;
    assert.deepEqual(result.events, [{ kind: 'text', text: 'before' }]);
    assert.deepEqual(result.doneEvents(), [{ kind: 'text', text: 'before' }]);
    assert.equal(result.doneCount(), 1);
  });
  it('uses the shared decoder for CRLF, multiline data and a final unterminated frame', async () => {
    fetchPort = async () => streamResponse(['event: text\r\ndata: {"delta":\r\ndata: "café"}\r\n\r\nevent: text\r\ndata: {"delta":"final"}']);
    const result = makeHandlers();
    await createTransport().startRun(baseInput([userMessage('hi')]), result.handlers);
    await result.donePromise;
    assert.deepEqual(result.events, [{ kind: 'text', text: 'café' }, { kind: 'text', text: 'final' }]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.doneCount(), 1);
  });
  it('keeps active run IDs isolated between factories, even when hosts return the same ID', async () => {
    const first = abortableFetchStub();
    const second = abortableFetchStub();
    const factory = (fetch: typeof globalThis.fetch) => createFetchSseTransport({ endpoint: '/host', agentId: 'agent', fetch,
      ids: () => 'same', decode: decodeSseStream, requestBuilder: buildJsonChatRequest,
      frameMapper: () => ({}), maxHistoryMessages: 0, maxHistoryMessageChars: 10,
      copy: { noUserMessage: 'missing question', missingBody: 'missing body', requestFailed: ({ status }) => `HTTP ${status}` } });
    const a = factory(first.fetch), b = factory(second.fetch);
    const resultA = makeHandlers(), resultB = makeHandlers();
    await a.startRun(baseInput([userMessage('a')]), resultA.handlers);
    await b.startRun(baseInput([userMessage('b')]), resultB.handlers);
    await a.stopRun('same');
    await resultA.donePromise;
    assert.equal(first.signal().aborted, true);
    assert.equal(second.signal().aborted, false);
    assert.equal(resultB.doneCount(), 0);
    await b.stopRun('same');
    await resultB.donePromise;
  });
  it('preserves latest message bytes and gives the host request builder its agent identity', async () => {
    let request: import('../fetch-sse.js').FetchSseRequest | undefined;
    const transport = createFetchSseTransport({ endpoint: '/host', agentId: 'host-agent', fetch: async () => streamResponse([]),
      ids: () => 'run', decode: decodeSseStream,
      requestBuilder: args => { request = args; return buildJsonChatRequest(args); },
      frameMapper: () => ({}), maxHistoryMessages: 0, maxHistoryMessageChars: 10,
      copy: { noUserMessage: 'missing question', missingBody: 'missing body', requestFailed: ({ status }) => `HTTP ${status}` } });
    const result = makeHandlers();
    await transport.startRun(baseInput([userMessage('  keep spaces  ')]), result.handlers);
    await result.donePromise;
    assert.equal(request!.message, '  keep spaces  ');
    assert.equal(request!.agentId, 'host-agent');
    assert.deepEqual(request!.history, []);
  });
});

describe('mapping and setup failures', () => {
  const args = () => ({ endpoint: '/host', agentId: 'agent', fetch: async () => streamResponse([]), ids: () => 'run',
    decode: decodeSseStream, requestBuilder: buildJsonChatRequest, frameMapper: () => ({}),
    maxHistoryMessages: 2, maxHistoryMessageChars: 10,
    copy: { noUserMessage: 'missing question', missingBody: 'missing body', requestFailed: ({ status }: { status: number }) => `HTTP ${status}` } });
  it('rejects missing host identity/endpoint and invalid history bounds', () => {
    assert.throws(() => createFetchSseTransport({ ...args(), endpoint: '' }), /Endpoint and agent identity/);
    assert.throws(() => createFetchSseTransport({ ...args(), agentId: '' }), /Endpoint and agent identity/);
    for (const n of [-1, Infinity, 1.5]) {
      assert.throws(() => createFetchSseTransport({ ...args(), maxHistoryMessages: n }), /history limit/);
      assert.throws(() => createFetchSseTransport({ ...args(), maxHistoryMessageChars: n }), /history limit/);
    }
  });
  it('rejects a duplicate ID without replacing the first active controller', async () => {
    const pending = abortableFetchStub();
    const transport = createFetchSseTransport({ ...args(), fetch: pending.fetch });
    const first = makeHandlers();
    await transport.startRun(baseInput([userMessage('hi')]), first.handlers);
    await assert.rejects(() => transport.startRun(baseInput([userMessage('again')]), makeHandlers().handlers), /unique and nonempty/);
    await transport.stopRun('run');
    await first.donePromise;
    assert.equal(pending.signal().aborted, true);
    assert.equal(first.doneCount(), 1);
  });
  it('rejects an empty generated ID', async () => {
    const transport = createFetchSseTransport({ ...args(), ids: () => '' });
    await assert.rejects(() => transport.startRun(baseInput([userMessage('hi')]), makeHandlers().handlers), /unique and nonempty/);
  });
  it('does not register listeners when the request builder throws', async () => {
    let ids = 0;
    const transport = createFetchSseTransport({ ...args(), ids: () => { ids += 1; return 'id'; }, requestBuilder: () => { throw new Error('builder refused'); } });
    await assert.rejects(() => transport.startRun(baseInput([userMessage('hi')]), makeHandlers().handlers), { message: 'builder refused' });
    assert.equal(ids, 0);
  });
  it('removes the input abort listener and cancels the response reader when an end frame arrives', async () => {
    let signal!: AbortSignal;
    let cancellations = 0;
    const controller = new AbortController();
    const transport = createFetchSseTransport({ ...args(), frameMapper: ({ frame }) => mapJsonChatSseFrame({ frame, directiveEventName: 'page', streamError: 'stream failure' }),
      fetch: async (_url, init) => {
        signal = init.signal as AbortSignal;
        return new Response(new ReadableStream<Uint8Array>({
          start(c) { c.enqueue(new TextEncoder().encode(sseFrame('end', {}))); },
          cancel() { cancellations += 1; },
        }));
      } });
    const result = makeHandlers();
    await transport.startRun(baseInput([userMessage('hi')], controller.signal), result.handlers);
    await result.donePromise;
    await flushStream();
    controller.abort();
    assert.equal(signal.aborted, false, 'settled input subscriptions must be removed');
    assert.equal(cancellations, 1);
    assert.equal(result.doneCount(), 1);
  });
  it('telemetry failures cannot break a successful run', async () => {
    const transport = createFetchSseTransport(args(), { onLifecycle: () => { throw new Error('telemetry failed'); } });
    const result = makeHandlers();
    await transport.startRun(baseInput([userMessage('hi')]), result.handlers);
    await result.donePromise;
    assert.deepEqual(result.errors, []);
    assert.equal(result.doneCount(), 1);
  });
  it('validates JSON text payloads and ignores frames without data', () => {
    const map = (event: string | null, data: string) => mapJsonChatSseFrame({ frame: { event, data }, directiveEventName: 'page', streamError: 'failure' });
    assert.deepEqual(map('text', ''), {});
    assert.throws(() => map('text', '{"delta":4}'), { message: 'Invalid text frame' });
    assert.throws(() => map('text', 'null'), { message: 'Invalid text frame' });
    assert.deepEqual(map(null, '{"delta":"unknown"}'), {});
    assert.deepEqual(map('page', '{"action":"x"}'), { event: { kind: 'ext', name: 'page', data: { action: 'x' } } });
    assert.equal(map('error', '{}').error!.message, 'failure');
  });
});
