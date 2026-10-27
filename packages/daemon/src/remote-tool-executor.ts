/**
 * @module remote-tool-executor
 *
 * A `ToolExecutor` whose calls run in ANOTHER process on the same machine: the client end of
 * `@jini-ai/daemon/http`'s `registerToolExecutionRoutes`. A host whose agent runtime lives in one
 * process and whose gated tool surface lives in another (a slim daemon beside a site server) wires
 * this in where an in-process executor would go; the far side's own executor still authorizes,
 * confirms, audits and runs the call, so nothing is gated twice here and nothing is gated less.
 *
 * Wire protocol (one POST per call, `application/x-ndjson` response):
 * - request body `{ executionId, principal, run: { id }, toolId, input, context? }`, where `context`
 *   is opaque host JSON from `contextFor`;
 * - a 200 status line is flushed BEFORE the far executor is called, then zero or more
 *   `{"type":"surface","emission":…}` lines, then exactly one `{"type":"result","result":…}` or
 *   `{"type":"throw","error":{"name","message","code?"}}` line;
 * - every refusal (400/401/403/413/503) is a non-200 status sent before the far executor runs.
 *
 * At-most-once. This client never retries. A failure is thrown as a {@link ToolRpcError} with one of
 * two codes, and a caller decides what to tell the model from the code alone:
 * - `TOOL_NOT_DISPATCHED`: the socket never connected, or the far side answered with a non-200
 *   status. Nothing ran, so the caller may retry.
 * - `TOOL_OUTCOME_UNKNOWN`: anything else after the request was written — a reset, a hang-up, an end
 *   with no terminal line, a malformed line. "No headers seen yet" is NOT proof that nothing ran: a
 *   TCP reset can discard bytes the far side already sent, so the call may have committed.
 *
 * Transport is `node:http.request` with a fresh connection per call (`agent: false`), never `fetch`
 * and never a pooled keep-alive socket: a reused socket the far side already closed fails with a
 * reset after the write, which would turn a call that never ran into an "outcome unknown" one. There
 * is no idle timeout because a tool may legitimately park on a human for a long time.
 */
import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import { ToolInputError, type Principal, type RunRef, type SurfaceEmission, type SurfaceEmitter } from '@jini-ai/core';
import type { ToolExecutionResult, ToolExecutor } from './tool-executor.js';

export type ToolRpcErrorCode = 'TOOL_NOT_DISPATCHED' | 'TOOL_OUTCOME_UNKNOWN';

/** A remote tool call that failed in transport. `code` says whether the call may have run; see the module doc. */
export class ToolRpcError extends Error {
  readonly code: ToolRpcErrorCode;

  constructor({ code, message }: { readonly code: ToolRpcErrorCode; readonly message: string }, optional: ErrorOptions = {}) {
    super(message, optional);
    this.name = 'ToolRpcError';
    this.code = code;
  }
}

/** The POST body `registerToolExecutionRoutes` accepts. */
export interface ToolExecutionWireRequest {
  readonly executionId: string;
  readonly principal: Principal;
  readonly run: RunRef;
  readonly toolId: string;
  readonly input: unknown;
  /** Opaque host JSON, handed to the far side's `runWithContext`. */
  readonly context?: unknown;
}

/** What a far-side throw carries over the wire. */
export interface ToolExecutionWireError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

/** One NDJSON line of a tool-execution response. */
export type ToolExecutionWireLine =
  | { readonly type: 'surface'; readonly emission: SurfaceEmission }
  | { readonly type: 'result'; readonly result: ToolExecutionResult }
  | { readonly type: 'throw'; readonly error: ToolExecutionWireError };

type TerminalWireLine = Exclude<ToolExecutionWireLine, { readonly type: 'surface' }>;

export const TOOL_EXECUTIONS_ROUTE_PATH = '/internal/tool-executions';

export interface RemoteToolExecutorRequired {
  /** Origin of the far server, e.g. `http://127.0.0.1:3000`. */
  readonly baseUrl: string;
  /** Bearer secret the far route checks. */
  readonly token: string;
}

export interface RemoteToolExecutorOptional {
  /** Injectable `node:http.request`; tests use it to observe or fail the transport. */
  readonly request?: typeof http.request;
  /** Builds the opaque per-call `context` the far side receives. Omitted → no `context` field. */
  readonly contextFor?: (required: { readonly principal: Principal; readonly run: RunRef; readonly toolId: string }, optional?: Record<string, never>) => unknown;
}

interface CallSettlers {
  readonly resolve: (result: ToolExecutionResult) => void;
  readonly reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object field each line type must carry. */
const LINE_FIELDS: ReadonlyMap<unknown, string> = new Map([['surface', 'emission'], ['result', 'result'], ['throw', 'error']]);

/** Parses one NDJSON line; `null` means malformed, which the caller treats as outcome unknown. */
export function parseToolExecutionLine({ text }: { readonly text: string }, _optional: Record<string, never> = {}): ToolExecutionWireLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const field = isRecord(value) ? LINE_FIELDS.get(value.type) : undefined;
  if (field === undefined || !isRecord((value as Record<string, unknown>)[field])) return null;
  const line = value as unknown as ToolExecutionWireLine;
  if (line.type === 'throw' && typeof line.error.message !== 'string') return null;
  return line;
}

/**
 * Turns a far-side throw back into an error a local caller can branch on. `ToolInputError` keeps its
 * class, because the in-process executor throws it for an unknown tool id and callers test it with
 * `instanceof`. Anything else becomes a plain `Error` carrying the same name, message and code.
 */
export function rehydrateToolExecutionError({ error }: { readonly error: ToolExecutionWireError }, _optional: Record<string, never> = {}): Error {
  if (error.name === 'ToolInputError') return new ToolInputError({ message: error.message });
  const rebuilt = new Error(error.message) as Error & { code?: string };
  rebuilt.name = typeof error.name === 'string' ? error.name : 'Error';
  if (typeof error.code === 'string') rebuilt.code = error.code;
  return rebuilt;
}

function rpcError(code: ToolRpcErrorCode, detail: string, cause?: unknown): ToolRpcError {
  const prefix = code === 'TOOL_NOT_DISPATCHED' ? 'remote tool call was not dispatched' : 'remote tool call outcome is unknown';
  return new ToolRpcError({ code, message: `${prefix}: ${detail}` }, cause === undefined ? {} : { cause });
}

/** Marks `connected` once the request's socket finishes connecting (or immediately for an open one). */
function trackConnect(req: http.ClientRequest, onConnect: () => void): void {
  req.once('socket', (socket) => {
    if (socket.connecting) socket.once('connect', onConnect);
    else onConnect();
  });
}

/**
 * Reads the NDJSON stream. Surfaces are forwarded strictly in order and the terminal line settles
 * only after every earlier surface was delivered. A surface the local emitter rejects is dropped: the
 * far handler cannot observe that rejection, and failing the call over a display-only message
 * would turn a committed call into an unknown one.
 */
function readToolStream(
  { res, settle, fail }: { readonly res: http.IncomingMessage; readonly settle: (line: TerminalWireLine) => void; readonly fail: (detail: string) => void },
  { emitSurface }: { readonly emitSurface?: SurfaceEmitter | undefined },
): void {
  let buffer = '';
  let terminal = false;
  let surfaces: Promise<void> = Promise.resolve();
  const onLine = (text: string): void => {
    if (terminal || text.trim() === '') return;
    const line = parseToolExecutionLine({ text });
    if (line === null) { terminal = true; fail('malformed response line'); return; }
    if (line.type === 'surface') {
      surfaces = surfaces.then(() => emitSurface?.(line.emission)).catch(() => undefined);
      return;
    }
    terminal = true;
    void surfaces.then(() => settle(line));
  };
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(onLine);
  });
  // Once the terminal line is in hand the outcome is known, so a later reset cannot unsettle it.
  const failUnlessTerminal = (detail: string): void => { if (!terminal) fail(detail); };
  res.on('end', () => { onLine(buffer); failUnlessTerminal('response ended without a terminal line'); });
  res.on('aborted', () => failUnlessTerminal('response aborted'));
  res.on('error', (error) => failUnlessTerminal(`response error: ${error.message}`));
}

function settleTerminal(line: TerminalWireLine, settlers: CallSettlers): void {
  if (line.type === 'result') settlers.resolve(line.result);
  else settlers.reject(rehydrateToolExecutionError({ error: line.error }));
}

/** Starts one POST that settles through `settlers`; returns a cancel that destroys it and resolves `cancelled`. */
function startCall(
  { url, token, body, executionId, settlers }: { readonly url: URL; readonly token: string; readonly body: string; readonly executionId: string; readonly settlers: CallSettlers },
  { request, emitSurface }: { readonly request: typeof http.request; readonly emitSurface?: SurfaceEmitter | undefined },
): () => void {
  let settled = false;
  let connected = false;
  const finish = (outcome: () => void, destroy: boolean): void => {
    if (settled) return;
    settled = true;
    if (destroy) req.destroy();
    outcome();
  };
  const unknown = (detail: string, cause?: unknown): void => finish(() => settlers.reject(rpcError('TOOL_OUTCOME_UNKNOWN', detail, cause)), true);
  const req = request(url, {
    method: 'POST',
    agent: false,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  });
  trackConnect(req, () => { connected = true; });
  req.on('error', (error) => {
    if (!connected) finish(() => settlers.reject(rpcError('TOOL_NOT_DISPATCHED', error.message, error)), true);
    else unknown(error.message, error);
  });
  req.on('response', (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      finish(() => settlers.reject(rpcError('TOOL_NOT_DISPATCHED', `HTTP ${res.statusCode ?? 'unknown'}`)), true);
      return;
    }
    readToolStream({
      res,
      settle: (line) => finish(() => settleTerminal(line, settlers), false),
      fail: (detail) => unknown(detail),
    }, { emitSurface });
  });
  req.end(body);
  return () => finish(() => settlers.resolve({ executionId, status: 'cancelled' }), true);
}

function wireBody({ executionId, principal, run, toolId, input, context }: ToolExecutionWireRequest): string {
  return JSON.stringify({ executionId, principal, run: { id: run.id }, toolId, input, ...(context === undefined ? {} : { context }) });
}

/**
 * Creates the client `ToolExecutor` for a far `registerToolExecutionRoutes` endpoint.
 *
 * - `execute` streams one call; a caller `signal` (or `cancel` with the id sent on the wire) destroys
 *   the request, which the far route turns into its own abort, and settles locally as `cancelled`
 *   — the same result an in-process executor gives a cancelled call.
 * - `getAuditRecord` returns `null`: the far side owns the audit trail.
 * - `resumeConfirmation` throws: confirmations park on, and are answered on, the far side.
 *
 * @complexity O(response bytes) per call; `cancel` is an O(1) map lookup.
 */
export function createRemoteToolExecutor(
  { baseUrl, token }: RemoteToolExecutorRequired,
  { request = http.request, contextFor }: RemoteToolExecutorOptional = {},
): ToolExecutor {
  const url = new URL(TOOL_EXECUTIONS_ROUTE_PATH, baseUrl);
  const inFlight = new Map<string, () => void>();

  async function execute(
    { principal, run, toolId, input }: { readonly principal: Principal; readonly run: RunRef; readonly toolId: string; readonly input: unknown },
    { signal, emitSurface }: { readonly signal?: AbortSignal; readonly emitSurface?: SurfaceEmitter } = {},
  ): Promise<ToolExecutionResult> {
    const executionId = randomUUID();
    if (signal?.aborted) return { executionId, status: 'cancelled' };
    const body = wireBody({ executionId, principal, run, toolId, input, context: contextFor?.({ principal, run, toolId }) });
    let settlers!: CallSettlers;
    const promise = new Promise<ToolExecutionResult>((resolve, reject) => { settlers = { resolve, reject }; });
    const cancel = startCall({ url, token, body, executionId, settlers }, { request, emitSurface });
    inFlight.set(executionId, cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await promise;
    } finally {
      inFlight.delete(executionId);
      signal?.removeEventListener('abort', cancel);
    }
  }

  return {
    execute,
    resumeConfirmation: () => {
      throw new Error('remote tool executions are confirmed on the executing server');
    },
    cancel: ({ executionId }) => inFlight.get(executionId)?.(),
    getAuditRecord: () => null,
  };
}
