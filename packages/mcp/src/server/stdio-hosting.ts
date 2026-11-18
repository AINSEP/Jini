/**
 * Private opt-in stdio guards for `createMcpToolServer`: per-frame byte caps, FIFO request
 * execution through response writes, and EOF draining. The SDK keeps JSON parsing, dispatch and
 * serialization; these guards only sit between it and the host-owned streams.
 */
import { once, type EventEmitter } from 'node:events';
import { Transform, Writable, type Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { boundedMessage, type StdioMessage } from './adapters/stdio-codec.js';
import type { McpTransportLike } from './ports.js';
import { resolveSdkTransport } from './sdk-transport.js';

export interface StdioHostingOptions {
  readonly maxFrameBytes?: number;
  readonly serial?: boolean;
  readonly eof?: 'close' | 'drain';
}

/** Validate the opt-in limit before construction performs any I/O. */
export function validateFrameLimit({ maxFrameBytes }: StdioHostingOptions): void {
  if (maxFrameBytes === undefined) return;
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
    throw new RangeError('maxFrameBytes must be a positive safe integer');
  }
}

/** True when any hosting guard is requested; omitted options keep the legacy lifecycle. */
export function wantsStdioHosting({ maxFrameBytes, serial, eof }: StdioHostingOptions): boolean {
  return maxFrameBytes !== undefined || serial === true || eof === 'drain';
}

/** Count bytes per LF-terminated frame before the SDK's unbounded read buffer sees them.
 * Chunks pass through unchanged; the SDK still owns CRLF handling and malformed-JSON policy.
 */
function createFrameGuard({ maxFrameBytes }: { maxFrameBytes: number }) {
  let partial = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      let start = 0;
      for (let lf = chunk.indexOf(10); lf !== -1; lf = chunk.indexOf(10, start)) {
        if (partial + lf + 1 - start > maxFrameBytes) break;
        partial = 0;
        start = lf + 1;
      }
      partial += chunk.length - start;
      callback(partial > maxFrameBytes ? new RangeError('MCP incoming frame exceeds maxFrameBytes') : null, chunk);
    },
  });
  return { guard, hasTail: () => partial > 0 };
}

/** A high-water mark of 1 makes every SDK write wait for the host stdout's real write callback. */
function createWriteTracker({ stdout }: { stdout: Writable }): Writable {
  return new Writable({ highWaterMark: 1, write(chunk, encoding, callback) { stdout.write(chunk, encoding, callback); } });
}

/** Insert only the stream guards the options need; the host keeps ownership of stdin/stdout. */
function createGuardedStreams({ stdin, stdout, options: { maxFrameBytes, serial, eof } }: {
  stdin: Readable; stdout: Writable; options: StdioHostingOptions;
}) {
  const drain = eof === 'drain';
  const input = maxFrameBytes !== undefined || drain ? createFrameGuard({ maxFrameBytes: maxFrameBytes ?? Infinity }) : undefined;
  const output = serial === true || drain ? createWriteTracker({ stdout }) : undefined;
  if (input) stdin.pipe(input.guard);
  return { input, output, streams: { stdin: input?.guard ?? stdin, stdout: output ?? stdout } };
}

type GuardedStreams = ReturnType<typeof createGuardedStreams>;

/** Mutable bookkeeping for one hosting run, shared by the helpers below. */
interface HostingState {
  readonly stdin: Readable;
  readonly options: StdioHostingOptions;
  readonly input: GuardedStreams['input'];
  readonly output: GuardedStreams['output'];
  readonly inFlight: Set<Promise<void>>;
  readonly removers: Array<() => void>;
  readonly stop: AbortController;
  tail: Promise<void>;
  failure: { error: unknown } | undefined;
  closeTransport: (() => void) | undefined;
  stopped: boolean;
  disposed: Promise<{ error: unknown } | undefined> | undefined;
}

function listen({ state, emitter, event, fn }: {
  state: HostingState;
  emitter: EventEmitter;
  event: string;
  fn: (...args: any[]) => void;
}): void {
  emitter.on(event, fn);
  state.removers.push(() => emitter.off(event, fn));
}
function fail({ state, error }: { state: HostingState; error: unknown }): void {
  state.failure ??= { error };
  state.closeTransport?.();
}
async function writesDone({ output }: HostingState): Promise<void> {
  while (output && output.writableLength > 0) await once(output, 'drain');
}
/** Yield so SDK dispatch reaches handlers/sends, then wait until tracked writes complete. */
async function flushWrites(state: HostingState): Promise<void> {
  await setImmediate();
  await writesDone(state);
}
async function drainInput(state: HostingState): Promise<void> {
  try {
    await flushWrites(state);
    while (state.inFlight.size > 0) {
      await Promise.allSettled([...state.inFlight]);
      await flushWrites(state);
    }
    if (state.input?.hasTail()) state.failure ??= { error: new Error('MCP stdin ended with an unterminated frame') };
  } catch (error) { state.failure ??= { error }; }
  state.closeTransport?.();
}

/** Bound outgoing frames on the SDK transport this run created. Narrow fakes have no send. */
function guardTransport(state: HostingState, transport: McpTransportLike): void {
  const { maxFrameBytes } = state.options;
  const sdk = resolveSdkTransport({ transport });
  if (maxFrameBytes === undefined || typeof sdk.send !== 'function') return;
  const send = sdk.send.bind(sdk);
  sdk.send = (message, sendOptions) => {
    let bounded: StdioMessage;
    try { bounded = boundedMessage({ message, maxFrameBytes }); } catch (error) { fail({ state, error }); throw error; }
    return send(bounded, sendOptions);
  };
}

/** Serial mode starts each handler only after the previous one settles and its response is written. */
function trackTask<T>(state: HostingState, { task, signal }: { task: () => Promise<T>; signal: AbortSignal | undefined }): Promise<T> {
  const serial = state.options.serial ?? false;
  // Behind another request, yield first so the SDK can send that request's response.
  const behind = state.inFlight.size > 0;
  const run = async (): Promise<T> => {
    if (serial) await (behind ? flushWrites(state) : writesDone(state));
    if (state.stopped || signal?.aborted) throw new Error('MCP request cancelled');
    return task();
  };
  const result = serial ? state.tail.then(run) : run();
  const settled = result.then(() => {}, () => {});
  state.inFlight.add(settled);
  void settled.then(() => state.inFlight.delete(settled));
  if (serial) state.tail = settled;
  return result;
}

/** Settles once `result` settled and its response write completed, or the run stopped; never rejects. */
async function awaitResponseWritten({ output, stop }: HostingState, { result }: { result: Promise<unknown> }): Promise<void> {
  await result.then(() => {}, () => {});
  await setImmediate();
  // Abortable unlike writesDone: a write still pending at dispose never drains.
  try { while (output && output.writableLength > 0) await once(output, 'drain', { signal: stop.signal }); } catch { /* run stopped */ }
}

/** Install EOF handling once connected; a failure recorded during connect closes at once. */
function watchEof({ state, close }: { state: HostingState; close: () => void }): void {
  const { input, stdin } = state;
  state.closeTransport = close;
  if (state.failure) return close();
  if (state.options.eof !== 'drain' || !input) {
    listen({ state, emitter: stdin, event: 'end', fn: close });
    listen({ state, emitter: stdin, event: 'close', fn: close });
    return;
  }
  // The guard ends only after the SDK consumed every buffered frame.
  listen({ state, emitter: input.guard, event: 'end', fn: () => void drainInput(state) });
  listen({
    state,
    emitter: stdin,
    event: 'close',
    fn: () => { if (!stdin.readableEnded) close(); },
  });
  // Embedding transports may not consume the guarded readable; still observe its end.
  input.guard.resume();
  if (input.guard.readableEnded) void drainInput(state);
}

async function disposeRun(state: HostingState): Promise<{ error: unknown } | undefined> {
  const { input, stdin, output } = state;
  state.stopped = true;
  state.stop.abort();
  state.closeTransport = undefined;
  if (input) { stdin.unpipe(input.guard); input.guard.destroy(); }
  output?.destroy();
  // One failed write errors this wrapper and then the borrowed stdout in later turns;
  // keep observing until both have reported, then restore the host's own listeners.
  await setImmediate();
  for (const remove of state.removers) remove();
  return state.failure;
}

/**
 * One run's guards. Stream failures and outgoing overflow are recorded and close the transport;
 * the host's hold-open promise rejects with the first recorded failure.
 * @complexity O(n) per n inbound bytes; O(r) bookkeeping for r accepted requests.
 */
export function createStdioHosting({ stdin, stdout, options }: { stdin: Readable; stdout: Writable; options: StdioHostingOptions }) {
  const { input, output, streams } = createGuardedStreams({ stdin, stdout, options });
  const state: HostingState = {
    stdin, options, input, output, inFlight: new Set(), removers: [], stop: new AbortController(),
    tail: Promise.resolve(), failure: undefined, closeTransport: undefined, stopped: false, disposed: undefined,
  };
  for (const stream of [stdin, stdout, input?.guard, output]) if (stream) listen({ state, emitter: stream, event: 'error', fn: (error: unknown) => fail({ state, error }) });

  return {
    /** The guarded pair handed to `createTransport` in place of the configured streams. */
    streams,
    guardTransport: ({ transport }: { transport: McpTransportLike }): void => guardTransport(state, transport),
    track: <T>(required: { task: () => Promise<T>; signal: AbortSignal | undefined }): Promise<T> => trackTask(state, required),
    responseWritten: ({ result }: { result: Promise<unknown> }): Promise<void> => awaitResponseWritten(state, { result }),
    watch: ({ close }: { close: () => void }): void => watchEof({ state, close }),
    /** Idempotent detach; queued handlers that have not started are skipped.
     * @returns The first recorded failure, which the run rejects with. */
    dispose(): Promise<{ error: unknown } | undefined> {
      state.disposed ??= disposeRun(state);
      return state.disposed;
    },
  };
}

export type StdioHosting = ReturnType<typeof createStdioHosting>;
