/**
 * @module json-ipc
 *
 * Newline-delimited JSON IPC over a unix socket / Windows named pipe. Provides a
 * server that decodes one JSON frame per connection (UTF-8 safe across chunk
 * boundaries), runs a handler, and replies `{ok,result}`/`{ok:false,error}`, plus
 * a client request with timeout. Includes opt-in structured tracing (gated by
 * `JINI_JSON_IPC_TRACE`) and stale-socket cleanup before binding. The trace
 * sequence counter is module-private singleton state. Depends on `node:fs`,
 * `node:net`, `node:path`, `node:string_decoder`, the shared net close helper,
 * the IPC-path recognizer, and the public IPC types.
 */

import { lstat, mkdir, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { createServer as createNetServer } from "node:net";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";

import { redactSecrets } from "@injini/core";

import { isWindowsNamedPipePath } from "./ipc-path.js";
import { closeServer } from "./net.js";
import type { JsonIpcHandler, JsonIpcServerHandle } from "./types.js";

/** Default cap on one connection's single frame (SEC-004): bytes received before a newline
 *  arrives. Generous for any realistic request/response payload while still bounding a
 *  streamed-without-a-newline attacker/misbehaving peer to a fixed amount of memory. */
const DEFAULT_MAX_FRAME_BYTES = 1_000_000;

/** Default idle deadline (SEC-004): a connection that has not delivered one complete
 *  newline-terminated frame within this window is dropped rather than held open forever. */
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

let jsonIpcTraceSeq = 0;

/**
 * @internal Whether JSON-IPC tracing is enabled via `JINI_JSON_IPC_TRACE`.
 */
function jsonIpcTraceEnabled(): boolean {
  const value = process.env.JINI_JSON_IPC_TRACE;
  return value === "1" || value === "true" || value === "yes";
}

/**
 * @internal Allocate a per-connection trace id.
 */
function nextJsonIpcTraceId(): string {
  jsonIpcTraceSeq += 1;
  return `ipc-${process.pid}-${jsonIpcTraceSeq}`;
}

/**
 * @internal Elapsed milliseconds since `startedAt` (an hrtime bigint).
 */
function jsonIpcTraceDurationMs(startedAt: bigint): number {
  return Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
}

/**
 * @internal Produce a compact, PII-light summary of a message for tracing.
 */
function summarizeJsonIpcMessage(message: unknown): Record<string, unknown> {
  if (message == null || typeof message !== "object") return { type: typeof message };
  const input = message as { input?: unknown; type?: unknown };
  const summary: Record<string, unknown> = { type: typeof input.type === "string" ? input.type : typeof input.type };
  if ("input" in input) {
    summary.hasInput = true;
    if (input.input != null && typeof input.input === "object") {
      summary.inputKeys = Object.keys(input.input as Record<string, unknown>).sort();
    } else {
      summary.inputType = typeof input.input;
    }
  }
  return summary;
}

/**
 * @internal Emit a trace line to stderr when tracing is enabled.
 */
function traceJsonIpc(event: string, details: Record<string, unknown>): void {
  if (!jsonIpcTraceEnabled()) return;
  console.error("[jini sidecar] json ipc trace", { event, ...details });
}

/**
 * @internal Extract a Node error `code` string from an unknown thrown value.
 */
function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error == null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return code == null ? null : String(code);
}

/**
 * @internal Extract a human-readable message from an unknown thrown value.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Shape an unknown error into the `{code?,message}` IPC error payload.
 *
 * Exported (previously module-private) for direct unit testing: its only
 * current caller (a `JSON.parse` frame-parse failure) always passes a
 * codeless `SyntaxError`, so the `code`-present branch below is real,
 * generically useful behavior (any future caller with a Node-style errno
 * error benefits from it) with no in-tree caller that happens to have one in
 * hand today — matching this repo's "extract into a directly-testable pure
 * function" convention rather than narrowing the type away.
 */
export function jsonIpcError(error: unknown): { code?: string; message: string } {
  return {
    ...(errorCode(error) == null ? {} : { code: errorCode(error) as string }),
    message: errorMessage(error),
  };
}

/**
 * @internal Decide whether a unix socket path is a stale (dead) endpoint safe to
 * unlink: it exists as a socket but refuses/ENOENTs on connect.
 */
async function staleUnixSocketExists(socketPath: string): Promise<boolean> {
  try {
    const stat = await lstat(socketPath);
    if (!stat.isSocket()) return false;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }

  return await new Promise<boolean>((resolveStale, rejectStale) => {
    const socket = createConnection(socketPath);
    // No `settled`-flag re-entrancy guard: `connect`/`error` are each
    // registered with `.once()` (which self-removes *before* invoking the
    // listener), and `settle` itself calls `removeAllListeners()` as its
    // first side effect — so no code path here can ever invoke `settle`
    // twice. A prior version carried a defensive `if (settled) return;` that
    // was provably unreachable (verified empirically this session: forcing
    // a second event through a fake socket finds zero listeners and crashes
    // the process outright, rather than reaching that guard — see
    // source-map.md's 2026-07-22 entry) — removed as a real refactor rather
    // than padded with a test that can't exercise real behavior.
    const settle = (callback: () => void) => {
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };

    socket.once("connect", () => settle(() => resolveStale(false)));
    socket.once("error", (error) => {
      const code = errorCode(error);
      if (code === "ENOENT" || code === "ECONNREFUSED") {
        settle(() => resolveStale(true));
        return;
      }
      settle(() => rejectStale(error));
    });
  });
}

/**
 * Prepare a socket path for binding: ensure the parent dir exists and
 * unlink a stale socket (no-op for Windows named pipes).
 *
 * Exported (previously module-private) for direct unit testing: its
 * Windows-named-pipe early return is real, load-bearing behavior (skipping
 * filesystem staging that would be meaningless — or fail outright — for a
 * pipe path), but this repo's CI runs on Linux, so the only way to actually
 * *bind* one end-to-end and observe the early return's effect is on real
 * Windows. Testing this function directly (asserting no filesystem call
 * happens) verifies the real behavior on every platform this runs on.
 */
export async function prepareIpcPath(socketPath: string): Promise<void> {
  if (isWindowsNamedPipePath(socketPath)) return;
  await mkdir(dirname(socketPath), { recursive: true });
  if (await staleUnixSocketExists(socketPath)) await rm(socketPath, { force: true });
}

/**
 * Start a newline-delimited JSON IPC server on a unix socket / named pipe: each
 * connection carries one JSON request, the handler's result is written back as
 * `{ok:true,result}` (or `{ok:false,error}` on parse/handler failure).
 * @returns A handle whose `close()` stops the server and unlinks the socket.
 */
export async function createJsonIpcServer({
  handler,
  socketPath,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
}: {
  handler: JsonIpcHandler;
  socketPath: string;
  /** Reject a connection whose single frame exceeds this many bytes before a newline arrives (SEC-004). @default 1_000_000 */
  maxFrameBytes?: number;
  /** Drop a connection that has not delivered one complete frame within this many ms (SEC-004). @default 30_000 */
  idleTimeoutMs?: number;
}): Promise<JsonIpcServerHandle> {
  await prepareIpcPath(socketPath);
  const server = createNetServer((socket) => {
    let buffer = "";
    let receivedBytes = 0;
    // One-request-per-connection guard (SEC-004): the `data` listener is `async`, so its
    // synchronous prefix (up to the first `await`) always finishes — and can set this flag —
    // before Node dispatches the next queued `data` event on this same socket. Once a frame has
    // been claimed, any further bytes on this connection (a second frame arriving while the
    // handler is still awaiting, or trailing garbage after the first frame) are ignored rather
    // than starting a second concurrent handler call / response race.
    let handled = false;
    // Decode UTF-8 across chunk boundaries: a multibyte character (e.g. CJK,
    // 3 bytes) can be split across two `data` events. `chunk.toString()` per
    // chunk would turn each half into U+FFFD, corrupting the payload (observed
    // as `???`/`◆?◆?◆?` in exported CJK artifacts). StringDecoder holds an
    // incomplete trailing sequence until the next chunk completes it.
    const decoder = new StringDecoder("utf8");
    const traceId = nextJsonIpcTraceId();
    const startedAt = process.hrtime.bigint();
    traceJsonIpc("server.connection", { socketPath, traceId });

    // Idle deadline (SEC-004): a peer that opens a connection and never completes a
    // newline-terminated frame (or dribbles bytes indefinitely) would otherwise hold the
    // connection — and this closure's buffer — open forever.
    const idleTimer = setTimeout(() => {
      // Defense-in-depth, not reachable through any real timer/socket
      // interleaving: every real path that sets `handled = true` (a
      // complete frame arriving, or the oversized-frame guard) calls
      // `clearTimeout(idleTimer)` in the very same synchronous prefix of a
      // single `data`-listener invocation — and Node/V8's single-threaded
      // execution model means no other callback (including this one) can
      // run in between that assignment and the `clearTimeout` call. Kept as
      // a real fail-safe (in case a future edit reorders that sequence)
      // rather than asserted away — see source-map.md's 2026-07-22 entry.
      if (handled) return;
      handled = true;
      traceJsonIpc("server.idle_timeout", {
        durationMs: jsonIpcTraceDurationMs(startedAt),
        idleTimeoutMs,
        socketPath,
        traceId,
      });
      socket.destroy();
    }, idleTimeoutMs);
    idleTimer.unref();

    socket.on("error", (error) => {
      // `error instanceof Error` here is defense-in-depth, not reachable
      // through real socket usage: @types/node itself types a `Socket`'s
      // `'error'` listener parameter as `Error` (not `unknown`), matching
      // Node's own real implementation, which only ever emits genuine
      // `Error`/`SystemError` instances for this event — verified against
      // the installed `@types/node`'s `net.d.ts` this session; not asserted
      // away since a test would have to manually `.emit()` a fabricated
      // non-Error value to reach the other side, which isn't real socket
      // behavior (see source-map.md's 2026-07-22 entry).
      traceJsonIpc("server.socket_error", {
        durationMs: jsonIpcTraceDurationMs(startedAt),
        error: error instanceof Error ? error.message : String(error),
        socketPath,
        traceId,
      });
    });
    socket.on("close", () => {
      clearTimeout(idleTimer);
      traceJsonIpc("server.socket_close", {
        durationMs: jsonIpcTraceDurationMs(startedAt),
        socketPath,
        traceId,
      });
    });
    socket.on("data", async (chunk) => {
      if (handled) return;
      traceJsonIpc("server.data", {
        bytes: chunk.byteLength,
        durationMs: jsonIpcTraceDurationMs(startedAt),
        socketPath,
        traceId,
      });
      receivedBytes += chunk.byteLength;
      if (receivedBytes > maxFrameBytes) {
        handled = true;
        clearTimeout(idleTimer);
        traceJsonIpc("server.frame_too_large", {
          durationMs: jsonIpcTraceDurationMs(startedAt),
          maxFrameBytes,
          receivedBytes,
          socketPath,
          traceId,
        });
        socket.end(
          `${JSON.stringify({
            ok: false,
            error: { code: "FRAME_TOO_LARGE", message: "request frame exceeds the maximum size" },
          })}\n`,
        );
        return;
      }
      buffer += decoder.write(chunk);
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) return;
      handled = true; // Claim the connection before awaiting the handler — see the flag's own doc above.
      clearTimeout(idleTimer);
      const frame = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      let message: unknown;
      try {
        message = JSON.parse(frame);
      } catch (error) {
        // `error instanceof Error` here is defense-in-depth, not reachable
        // through a real `JSON.parse` failure: it only ever throws a
        // genuine `SyntaxError` (an `Error` instance) for any string input
        // — never a non-Error value — matching the same reasoning as the
        // socket-error `instanceof Error` checks above (see
        // source-map.md's 2026-07-22 entry).
        traceJsonIpc("server.frame_parse_failed", {
          durationMs: jsonIpcTraceDurationMs(startedAt),
          error: error instanceof Error ? error.message : String(error),
          frameBytes: Buffer.byteLength(frame),
          socketPath,
          traceId,
        });
        socket.end(
          `${JSON.stringify({
            ok: false,
            error: jsonIpcError(error),
          })}\n`,
        );
        return;
      }
      const messageSummary = summarizeJsonIpcMessage(message);
      traceJsonIpc("server.frame_parsed", {
        durationMs: jsonIpcTraceDurationMs(startedAt),
        frameBytes: Buffer.byteLength(frame),
        message: messageSummary,
        socketPath,
        traceId,
      });
      try {
        traceJsonIpc("server.handler_start", {
          durationMs: jsonIpcTraceDurationMs(startedAt),
          message: messageSummary,
          socketPath,
          traceId,
        });
        const result = await handler(message);
        traceJsonIpc("server.handler_success", {
          durationMs: jsonIpcTraceDurationMs(startedAt),
          message: messageSummary,
          socketPath,
          traceId,
        });
        socket.end(`${JSON.stringify({ ok: true, result })}\n`);
      } catch (error) {
        // SEC-004: a handler failure can embed paths, credentials, or other host detail (the
        // same trust-boundary concern as SEC-005's HTTP fix). The peer gets a stable code plus
        // the traceId as a correlation handle; the real detail is redacted and logged
        // server-side only, unconditionally (not gated behind JINI_JSON_IPC_TRACE).
        const redactedDetail = redactSecrets(error instanceof Error ? error.message : String(error));
        // eslint-disable-next-line no-console
        console.error(`[@injini/sidecar] json-ipc handler failed (traceId=${traceId})`, redactedDetail);
        traceJsonIpc("server.handler_failed", {
          durationMs: jsonIpcTraceDurationMs(startedAt),
          error: redactedDetail,
          message: messageSummary,
          socketPath,
          traceId,
        });
        socket.end(
          `${JSON.stringify({
            ok: false,
            error: { code: "HANDLER_ERROR", message: "internal error", requestId: traceId },
          })}\n`,
        );
      }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(socketPath, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  return {
    async close() {
      await closeServer(server);
      if (!isWindowsNamedPipePath(socketPath)) await rm(socketPath, { force: true });
    },
  };
}

/**
 * Send one newline-delimited JSON request over a unix socket / named pipe and
 * resolve with the server's `result`, rejecting on error response or timeout.
 * @returns The server's `result` payload.
 */
export async function requestJsonIpc<T = any>(
  socketPath: string,
  payload: unknown,
  { timeoutMs = 1500 }: { timeoutMs?: number } = {},
): Promise<T> {
  return await new Promise<T>((resolveRequest, rejectRequest) => {
    const socket = createConnection(socketPath);
    const traceId = nextJsonIpcTraceId();
    const startedAt = process.hrtime.bigint();
    let settled = false;
    let buffer = "";
    // See the server reader above: decode UTF-8 across chunk boundaries so a
    // multibyte character split across two `data` events is not corrupted.
    const decoder = new StringDecoder("utf8");
    const messageSummary = summarizeJsonIpcMessage(payload);
    traceJsonIpc("client.connect_start", { message: messageSummary, socketPath, timeoutMs, traceId });
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      traceJsonIpc("client.timeout", {
        durationMs: jsonIpcTraceDurationMs(startedAt),
        message: messageSummary,
        socketPath,
        timeoutMs,
        traceId,
      });
      socket.destroy();
      settle(() => rejectRequest(new Error(`IPC request timed out: ${socketPath}`)));
    }, timeoutMs);

    socket.on("connect", () => {
      traceJsonIpc("client.connected", {
        durationMs: jsonIpcTraceDurationMs(startedAt),
        message: messageSummary,
        socketPath,
        traceId,
      });
      const frame = `${JSON.stringify(payload)}\n`;
      traceJsonIpc("client.write_start", {
        bytes: Buffer.byteLength(frame),
        durationMs: jsonIpcTraceDurationMs(startedAt),
        message: messageSummary,
        socketPath,
        traceId,
      });
      const flushed = socket.write(frame, () => {
        traceJsonIpc("client.write_callback", {
          durationMs: jsonIpcTraceDurationMs(startedAt),
          message: messageSummary,
          socketPath,
          traceId,
        });
      });
      if (!flushed) {
        socket.once("drain", () => {
          traceJsonIpc("client.drain", {
            durationMs: jsonIpcTraceDurationMs(startedAt),
            message: messageSummary,
            socketPath,
            traceId,
          });
        });
      }
    });
    socket.on("data", (chunk) => {
      traceJsonIpc("client.data", {
        bytes: chunk.byteLength,
        durationMs: jsonIpcTraceDurationMs(startedAt),
        message: messageSummary,
        socketPath,
        traceId,
      });
      buffer += decoder.write(chunk);
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) return;
      socket.end();
      settle(() => {
        const response = JSON.parse(buffer.slice(0, newlineIndex)) as {
          error?: { code?: string; message?: string; requestId?: string };
          ok: boolean;
          result?: T;
        };
        if (!response.ok) {
          traceJsonIpc("client.response_error", {
            durationMs: jsonIpcTraceDurationMs(startedAt),
            error: response.error?.message ?? "IPC request failed",
            message: messageSummary,
            socketPath,
            traceId,
          });
          const rejection = new Error(response.error?.message ?? "IPC request failed") as Error & {
            code?: string;
            requestId?: string;
          };
          if (response.error?.code !== undefined) rejection.code = response.error.code;
          if (response.error?.requestId !== undefined) rejection.requestId = response.error.requestId;
          rejectRequest(rejection);
          return;
        }
        traceJsonIpc("client.response_success", {
          durationMs: jsonIpcTraceDurationMs(startedAt),
          message: messageSummary,
          socketPath,
          traceId,
        });
        resolveRequest(response.result as T);
      });
    });
    socket.on("error", (error) => {
      // Same defense-in-depth, not-reachable-through-real-usage reasoning as
      // the server-side `error instanceof Error` check above (see that
      // comment + source-map.md's 2026-07-22 entry).
      traceJsonIpc("client.socket_error", {
        durationMs: jsonIpcTraceDurationMs(startedAt),
        error: error instanceof Error ? error.message : String(error),
        message: messageSummary,
        socketPath,
        traceId,
      });
      settle(() => rejectRequest(error));
    });
    socket.on("close", () => {
      traceJsonIpc("client.socket_close", {
        durationMs: jsonIpcTraceDurationMs(startedAt),
        message: messageSummary,
        socketPath,
        traceId,
      });
    });
  });
}
