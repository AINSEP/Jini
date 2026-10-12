/** Shared lazy browser ownership, extracted from the host screenshot lifecycle. */
import type { RenderBrowser } from "./render-page.js";

/** Anything with an async `close` — a Playwright `Browser` satisfies it structurally. */
export interface ClosableBrowser {
  close(): Promise<void>;
}

export interface LazyBrowser<B extends ClosableBrowser> {
  /** The running browser, launching it on first use. A failed launch is retried on the next call. */
  acquire(required?: {}, optional?: {}): Promise<B>;
  /** Marks the end of one use; with `idleCloseMs` set, the browser closes once that long passes unused. */
  release(required?: {}, optional?: {}): void;
  /** Closes now. Safe to call repeatedly and when nothing was launched. */
  close(required?: {}, optional?: {}): Promise<void>;
}

export interface LazyBrowserTimers {
  setTimeout(work: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const NODE_TIMERS: LazyBrowserTimers = {
  // `unref`: an idle-close timer must never keep a finishing process (or a test runner) alive.
  setTimeout: (work, ms) => setTimeout(work, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * @param required.launch - Starts the browser; called at most once per launched lifetime.
 * @param optional.idleCloseMs - Close this long after the last `release`; omitted, only `close` closes.
 * @param optional.timers - Injected for tests.
 * @complexity O(1) per call.
 */
export function createLazyBrowser<B extends ClosableBrowser>(
  { launch }: { launch: () => Promise<B> },
  { idleCloseMs, timers = NODE_TIMERS }: { idleCloseMs?: number; timers?: LazyBrowserTimers } = {},
): LazyBrowser<B> {
  let browser: Promise<B> | null = null;
  let active = 0;
  let idleTimer: unknown = null;

  function cancelIdleClose(): void {
    if (idleTimer === null) return;
    timers.clearTimeout(idleTimer);
    idleTimer = null;
  }

  async function close(): Promise<void> {
    cancelIdleClose();
    const closing = browser;
    browser = null;
    if (closing === null) return;
    try {
      await (await closing).close();
    } catch {
      // A launch that failed has nothing to close; a close that failed leaves nothing to retry.
    }
  }

  return {
    acquire() {
      cancelIdleClose();
      active += 1;
      const launching = browser ?? Promise.resolve().then(launch);
      browser = launching;
      // A failed launch must not be cached, or every later capture would replay the same rejection.
      launching.catch(() => {
        active = Math.max(0, active - 1);
        if (browser === launching) browser = null;
      });
      return launching;
    },
    release() {
      active = Math.max(0, active - 1);
      if (active > 0) return;
      if (idleCloseMs === undefined || browser === null) return;
      cancelIdleClose();
      idleTimer = timers.setTimeout(() => { idleTimer = null; void close(); }, idleCloseMs);
    },
    close,
  };
}

/** A lease retains a shared process while its isolated context is in use. */
export interface RenderBrowserLease { browser: RenderBrowser; release(): void }
export interface RenderBrowserPool {
  acquire(required: Record<string, never>, optional?: { signal?: AbortSignal }): Promise<RenderBrowserLease>;
  close(required?: Record<string, never>, optional?: Record<string, never>): Promise<void>;
}

/** Reuse the lazy owner with a firm concurrent-context cap. Busy calls fail before launching.
 * Late/cancelled acquisition releases its lease; idle timers never close an active sibling.
 * @complexity O(1) per call; at most maxConcurrent contexts and one browser process. */
export function createRenderBrowserPool(
  { launch }: { launch: () => Promise<RenderBrowser> },
  { maxConcurrent = 2, idleCloseMs = 60_000, timers }: { maxConcurrent?: number; idleCloseMs?: number; timers?: LazyBrowserTimers } = {},
): RenderBrowserPool {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error("maxConcurrent must be a positive integer");
  const lazy = createLazyBrowser({ launch }, { idleCloseMs, ...(timers ? { timers } : {}) });
  let active = 0;
  return {
    async acquire(_required, { signal } = {}) {
      signal?.throwIfAborted();
      if (active >= maxConcurrent) throw Object.assign(new Error("Render capacity is busy; retry shortly"), { code: "WEB_RENDER_BUSY" });
      active += 1;
      let released = false;
      let acquired = false;
      const release = () => { if (!released) { released = true; active -= 1; if (acquired) lazy.release(); } };
      const acquisition = lazy.acquire();
      // Cancellation frees render capacity immediately; a late successful launch still releases
      // its lazy reference, without closing a browser another capture may already be using.
      void acquisition.then(() => { acquired = true; if (released) lazy.release(); }, () => {});
      let onAbort: (() => void) | undefined;
      try {
        const browser = signal ? await Promise.race([
          acquisition,
          new Promise<never>((_resolve, reject) => {
            onAbort = () => reject(signal.reason);
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
          }),
        ]) : await acquisition;
        acquired = true;
        signal?.throwIfAborted();
        return { browser, release };
      } catch (error) { release(); throw error; }
      finally { if (onAbort) signal?.removeEventListener("abort", onAbort); }
    },
    close: () => lazy.close(),
  };
}
