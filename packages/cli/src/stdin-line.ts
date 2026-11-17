/**
 * @module stdin-line
 *
 * Reads a one-line request from a stream (normally stdin) and then keeps watching that stream.
 * A secret sent this way (for example a link token) never becomes argv. A parent process that
 * keeps the stream open after the line and closes it to cancel gets cancellation on every
 * platform, and also when the parent crashes.
 */
import { PayloadTooLargeError } from './prompt.js';

/** What this reader needs of the stream. `unref` is absent when stdin is a file rather than a pipe. */
export type RequestLineStream = Pick<NodeJS.ReadableStream, 'on' | 'once'> & { unref?: () => unknown };

export interface ReadStdinRequestLineOptions {
  /** Longest accepted line in bytes, newline excluded. Default 16 KiB. */
  maxBytes?: number;
  /** The rejection when the line is over `maxBytes`. Default: a `PayloadTooLargeError`. */
  tooLarge?: () => Error;
  /** The abort reason set on `stop` when the stream ends after the line was read. */
  stopped?: () => unknown;
}

const DEFAULT_MAX_BYTES = 16 * 1024;

/**
 * The first line of `input`, then keeps watching: the stream ending after that line aborts `stop`.
 * Input that ends with no newline is still a request, with nothing left to watch. Later bytes are dropped.
 * `unref` lets the process exit once its work is done, with the stream still open.
 * @throws {PayloadTooLargeError} (or the error `tooLarge` builds) when the line is over `maxBytes`.
 * @complexity O(request bytes); holds at most one chunk past the cap.
 */
export function readStdinRequestLine(
  { input, stop }: { input: RequestLineStream; stop: AbortController },
  optional: ReadStdinRequestLineOptions = {},
): Promise<string> {
  const maxBytes = optional.maxBytes ?? DEFAULT_MAX_BYTES;
  const tooLarge = optional.tooLarge ?? (() => new PayloadTooLargeError({ message: 'The request line is too large.' }));
  const stopped = optional.stopped ?? (() => new Error('The input ended, so the operation was stopped.'));
  return new Promise((resolve, reject) => {
    let received: Buffer = Buffer.alloc(0), finishedReading = false, lineSeen = false;
    input.on('data', (chunk: string | Buffer) => {
      if (finishedReading) return;
      received = Buffer.concat([received, Buffer.from(chunk)]);
      const newline = received.indexOf(10);
      if ((newline === -1 ? received.length : newline) > maxBytes) {
        finishedReading = true;
        reject(tooLarge());
      } else if (newline !== -1) {
        finishedReading = lineSeen = true;
        input.unref?.();
        resolve(received.subarray(0, newline).toString('utf8'));
      }
    });
    const ended = () => {
      if (lineSeen) stop.abort(stopped());
      else resolve(received.toString('utf8'));
    };
    input.once('end', ended);
    input.once('close', ended);
    input.once('error', ended);
  });
}
