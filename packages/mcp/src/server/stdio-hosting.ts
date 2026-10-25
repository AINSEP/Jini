/**
 * Private opt-in stdio guards for `createMcpToolServer`: per-frame byte caps, FIFO request
 * execution through response writes, and EOF draining. The SDK keeps JSON parsing, dispatch and
 * serialization; these guards only sit between it and the host-owned streams.
 */
import { once, type EventEmitter } from 'node:events';
import { Transform, Writable, type Readable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { isJSONRPCErrorResponse, isJSONRPCResultResponse, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
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

/** Measure the SDK's actual serialization; an oversized response becomes a bounded error.
 * @throws RangeError when a request/notification or the minimal replacement exceeds the cap.
 */
function boundedMessage({ message, maxFrameBytes }: { message: JSONRPCMessage; maxFrameBytes: number }): JSONRPCMessage {
  if (Buffer.byteLength(serializeMessage(message)) <= maxFrameBytes) return message;
  if (!isJSONRPCResultResponse(message) && !isJSONRPCErrorResponse(message)) {
    throw new RangeError('MCP outgoing frame exceeds maxFrameBytes');
  }
  const replacement: JSONRPCMessage = { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Response exceeds maxFrameBytes' } };
  if (Buffer.byteLength(serializeMessage(replacement)) > maxFrameBytes) {
    throw new RangeError('MCP error response exceeds maxFrameBytes');
  }
  return replacement;
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

/**
 * One run's guards. Stream failures and outgoing overflow are recorded and close the transport;
 * the host's hold-open promise rejects with the first recorded failure.
 * @complexity O(n) per n inbound bytes; O(r) bookkeeping for r accepted requests.
 */
export function createStdioHosting({ stdin, stdout, options }: { stdin: Readable; stdout: Writable; options: StdioHostingOptions }) {
  const { maxFrameBytes, serial = false } = options;
  const { input, output, streams } = createGuardedStreams({ stdin, stdout, options });
  const inFlight = new Set<Promise<void>>();
  const removers: Array<() => void> = [];
  let tail: Promise<void> = Promise.resolve();
  let failure: { error: unknown } | undefined;
  let closeTransport: (() => void) | undefined;
  let stopped = false;
  const stop = new AbortController();
  let disposed: Promise<{ error: unknown } | undefined> | undefined;

  const listen = (emitter: EventEmitter, event: string, fn: (...args: any[]) => void) => {
    emitter.on(event, fn);
    removers.push(() => emitter.off(event, fn));
  };
  const fail = (error: unknown) => {
    failure ??= { error };
    closeTransport?.();
  };
  for (const stream of [stdin, stdout, input?.guard, output]) if (stream) listen(stream, 'error', fail);

  async function writesDone() {
    while (output && output.writableLength > 0) await once(output, 'drain');
  }

  /** Yield so SDK dispatch reaches handlers/sends, then wait until tracked writes complete. */
  async function flushWrites() {
    await setImmediate();
    await writesDone();
  }

  async function drain() {
    try {
      await flushWrites();
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
        await flushWrites();
      }
      if (input?.hasTail()) failure ??= { error: new Error('MCP stdin ended with an unterminated frame') };
    } catch (error) { failure ??= { error }; }
    closeTransport?.();
  }

  return {
    /** The guarded pair handed to `createTransport` in place of the configured streams. */
    streams,
    /** Bound outgoing frames on the SDK transport this run created. Narrow fakes have no send. */
    guardTransport({ transport }: { transport: McpTransportLike }): void {
      const sdk = resolveSdkTransport({ transport });
      if (maxFrameBytes === undefined || typeof sdk.send !== 'function') return;
      const send = sdk.send.bind(sdk);
      sdk.send = (message, sendOptions) => {
        let bounded: JSONRPCMessage;
        try { bounded = boundedMessage({ message, maxFrameBytes }); } catch (error) { fail(error); throw error; }
        return send(bounded, sendOptions);
      };
    },
    /** Serial mode starts each handler only after the previous one settles and its response is written. */
    track<T>({ task, signal }: { task: () => Promise<T>; signal: AbortSignal | undefined }): Promise<T> {
      // Behind another request, yield first so the SDK can send that request's response.
      const behind = inFlight.size > 0;
      const run = async (): Promise<T> => {
        if (serial) await (behind ? flushWrites() : writesDone());
        if (stopped || signal?.aborted) throw new Error('MCP request cancelled');
        return task();
      };
      const result = serial ? tail.then(run) : run();
      const settled = result.then(() => {}, () => {});
      inFlight.add(settled);
      void settled.then(() => inFlight.delete(settled));
      if (serial) tail = settled;
      return result;
    },
    /** Settles once `result` settled and its response write completed, or the run stopped; never rejects. */
    async responseWritten({ result }: { result: Promise<unknown> }): Promise<void> {
      await result.then(() => {}, () => {});
      await setImmediate();
      // Abortable unlike writesDone: a write still pending at dispose never drains.
      try { while (output && output.writableLength > 0) await once(output, 'drain', { signal: stop.signal }); } catch { /* run stopped */ }
    },
    /** Install EOF handling once connected; a failure recorded during connect closes at once. */
    watch({ close }: { close: () => void }): void {
      closeTransport = close;
      if (failure) return close();
      if (options.eof !== 'drain' || !input) {
        listen(stdin, 'end', close);
        listen(stdin, 'close', close);
        return;
      }
      // The guard ends only after the SDK consumed every buffered frame.
      listen(input.guard, 'end', () => void drain());
      listen(stdin, 'close', () => { if (!stdin.readableEnded) close(); });
      // Embedding transports may not consume the guarded readable; still observe its end.
      input.guard.resume();
      if (input.guard.readableEnded) void drain();
    },
    /** Idempotent detach; queued handlers that have not started are skipped.
     * @returns The first recorded failure, which the run rejects with. */
    dispose(): Promise<{ error: unknown } | undefined> {
      disposed ??= (async () => {
        stopped = true;
        stop.abort();
        closeTransport = undefined;
        if (input) { stdin.unpipe(input.guard); input.guard.destroy(); }
        output?.destroy();
        // One failed write errors this wrapper and then the borrowed stdout in later turns;
        // keep observing until both have reported, then restore the host's own listeners.
        await setImmediate();
        for (const remove of removers) remove();
        return failure;
      })();
      return disposed;
    },
  };
}

export type StdioHosting = ReturnType<typeof createStdioHosting>;
