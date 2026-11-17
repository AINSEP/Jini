/**
 * @file Reads a streamed answer (an event stream or a line stream) piece by piece, the way a
 * client on the other end of the connection sees it. The characterization suite asserts on the
 * exact pieces and on what is, or is not, sent between two of them, so every read has a deadline:
 * a stream that stays silent fails the test with what had arrived instead of hanging it.
 */
import type { RouteHarness } from './harness.js';
import { concretePath } from './probes.js';

/** How long one read may wait for the bytes it was promised. */
const READ_DEADLINE_MS = 4_000;

export interface OpenedStream {
  readonly response: Response;
  /** The next `count` complete pieces (each ended by the separator), without the separator. */
  next(count?: number): Promise<string[]>;
  /** Every piece from here to the end of the stream; resolves only when the server ends it. */
  rest(): Promise<string[]>;
  /** The client goes away. */
  abort(): void;
}

class StreamSilentError extends Error {}

function deadline(received: string): { promise: Promise<never>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new StreamSilentError(`the stream sent nothing for ${READ_DEADLINE_MS} ms; pending bytes: ${JSON.stringify(received)}`)), READ_DEADLINE_MS);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Opens `route` (`METHOD /path`) and returns a reader over its answer.
 * @param optional.separator - What ends one piece: a blank line for an event stream (default), `\n` for a line stream.
 * @param optional.query - Appended to the path as is, with its leading `?`.
 */
export async function openStream(
  { harness, route }: { harness: RouteHarness; route: string },
  { headers = {}, query = '', body, separator = '\n\n' }: { headers?: Record<string, string>; query?: string; body?: string; separator?: string } = {},
): Promise<OpenedStream> {
  const [method = 'GET', path = '/'] = route.split(' ');
  const controller = new AbortController();
  const request = new Request(`http://harness.invalid${concretePath(path)}${query}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body }),
    signal: controller.signal,
  });
  // The headers of a stream must arrive before its first piece; a route that holds them back fails here.
  const opening = deadline('(no headers yet)');
  const response = await Promise.race([harness.fetch(request), opening.promise]).finally(() => { opening.cancel(); });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let ended = reader === undefined;

  const pull = async (): Promise<void> => {
    const limit = deadline(pending);
    try {
      const chunk = await Promise.race([reader!.read(), limit.promise]);
      if (chunk.done) ended = true;
      else pending += decoder.decode(chunk.value, { stream: true });
    } finally {
      limit.cancel();
    }
  };
  const takePieces = (count: number): string[] => {
    const pieces = pending.split(separator);
    const complete = pieces.slice(0, -1).slice(0, count);
    pending = pieces.slice(complete.length).join(separator);
    return complete;
  };
  const completeCount = (): number => pending.split(separator).length - 1;

  return {
    response,
    next: async (count = 1) => {
      while (completeCount() < count) {
        if (ended) throw new Error(`the stream ended with ${completeCount()} of ${count} pieces; pending bytes: ${JSON.stringify(pending)}`);
        await pull();
      }
      return takePieces(count);
    },
    rest: async () => {
      while (!ended) await pull();
      const pieces = takePieces(Number.POSITIVE_INFINITY);
      return pending.length > 0 ? [...pieces, pending] : pieces;
    },
    abort: () => controller.abort(),
  };
}
