/**
 * @file Reads an event-stream `Response` frame by frame, the way a client sees it. A read that
 * would wait for ever fails the test after a short deadline with what had arrived, and "nothing
 * more is sent" is asserted by waiting a moment and finding the stream still silent. Not published.
 */

/** How long a read may wait for a frame that was promised. */
const READ_DEADLINE_MS = 2_000;
/** How long "nothing arrives" is watched for. */
const SILENCE_MS = 25;

export interface FrameReader {
  /** The next `count` complete frames (each ended by a blank line), without that separator. */
  next(count?: number): Promise<string[]>;
  /** Every frame to the end of the stream; resolves only when the server ends it. */
  rest(): Promise<string[]>;
  /** Resolves true when no frame arrives for a short while and the stream is still open; false if a frame or the end came. */
  stillSilent(): Promise<boolean>;
  /** The client goes away: the body is cancelled. */
  cancel(): Promise<void>;
}

/** @param required.response - A streaming answer (it must have a body). */
export function readFrames({ response }: { readonly response: Response }, _optional: Record<string, never> = {}): FrameReader {
  if (response.body === null) throw new Error('the response has no body to read frames from');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let ended = false;
  /** One read in flight at most: its result is applied when it arrives, even if the caller stopped waiting. */
  let inflight: Promise<void> | undefined;
  const readOnce = (): Promise<void> => (inflight ??= reader.read().then(({ done, value }) => {
    inflight = undefined;
    if (done) ended = true;
    else pending += decoder.decode(value, { stream: true });
  }));

  async function pull(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`the stream sent nothing for ${READ_DEADLINE_MS} ms; pending bytes: ${JSON.stringify(pending)}`)), READ_DEADLINE_MS); });
    try { await Promise.race([readOnce(), deadline]); } finally { clearTimeout(timer); }
  }
  const take = (): string | undefined => {
    const at = pending.indexOf('\n\n');
    if (at < 0) return undefined;
    const frame = pending.slice(0, at);
    pending = pending.slice(at + 2);
    return frame;
  };
  return {
    async next(count = 1) {
      const frames: string[] = [];
      while (frames.length < count) {
        const frame = take();
        if (frame !== undefined) { frames.push(frame); continue; }
        if (ended) throw new Error(`the stream ended after ${frames.length} of ${count} frames`);
        await pull();
      }
      return frames;
    },
    async rest() {
      const frames: string[] = [];
      for (;;) {
        const frame = take();
        if (frame !== undefined) { frames.push(frame); continue; }
        if (ended) return frames;
        await pull();
      }
    },
    async stillSilent() {
      if (pending.includes('\n\n') || ended) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const quiet = new Promise<'quiet'>((resolve) => { timer = setTimeout(() => resolve('quiet'), SILENCE_MS); });
      const outcome = await Promise.race([readOnce().then(() => 'read' as const), quiet]);
      clearTimeout(timer);
      return outcome === 'quiet';
    },
    cancel: () => reader.cancel(),
  };
}
