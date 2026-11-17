import { REAL_CAPTURE_CLOCK, type CaptureClock } from "./capture-clock.js";

/** Internal deadline shared by every asynchronous step of one page observation. */
export class PageWorkTimeout extends Error {
  constructor({ timeoutMs }: { timeoutMs: number }) {
    super(`page work timed out after ${timeoutMs}ms`);
    this.name = "PageWorkTimeout";
  }
}

/** The ordinary-work limit of a capture that keeps a fallback reserve. It is a PageWorkTimeout, so every
 * existing handler that lets a page timeout through keeps doing so; the renderer alone tells it apart. */
export class PageWorkDeadline extends PageWorkTimeout {}

/** A timeout is a budget for the whole page, not a fresh allowance for each browser operation. */
export class PageWorkBudget {
  private readonly expiresAt: number;
  private readonly timeoutMs: number;
  private readonly signal: AbortSignal | undefined;
  private readonly clock: CaptureClock;
  private readonly workDeadlineMs: number | undefined;
  private workEndsAt: number | undefined;

  /** `workDeadlineMs` ends the ordinary-work phase early; `endWorkPhase()` then lifts it for the fallback window. */
  constructor(
    { timeoutMs }: { timeoutMs: number },
    { signal, clock = REAL_CAPTURE_CLOCK, workDeadlineMs }: { signal?: AbortSignal; clock?: CaptureClock; workDeadlineMs?: number } = {},
  ) {
    this.signal = signal;
    this.timeoutMs = timeoutMs;
    this.clock = clock;
    this.expiresAt = clock.now() + timeoutMs;
    this.workDeadlineMs = workDeadlineMs;
    this.workEndsAt = workDeadlineMs === undefined ? undefined : clock.now() + workDeadlineMs;
  }

  /** Time left to the limit that applies now: the work deadline during the work phase, else the total. */
  remainingMs(): number { return Math.max(0, (this.workEndsAt ?? this.expiresAt) - this.clock.now()); }

  /** From now on only the total budget limits work (the fallback window). Safe to call more than once. */
  endWorkPhase(): void { this.workEndsAt = undefined; }

  /** The error for hitting the limit that applies now. */
  expiredError(): PageWorkTimeout {
    return this.workDeadlineMs !== undefined && this.workEndsAt !== undefined
      ? new PageWorkDeadline({ timeoutMs: this.workDeadlineMs })
      : new PageWorkTimeout({ timeoutMs: this.timeoutMs });
  }

  /** Races even APIs without native timeouts (evaluation/cookies) and never starts expired work.
   * @complexity O(1) time and space apart from the injected operation. */
  async run<T>({ work }: { work: () => Promise<T> }): Promise<T> {
    this.signal?.throwIfAborted();
    const remaining = this.remainingMs();
    if (remaining <= 0) throw this.expiredError();
    let timer: unknown;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        work(),
        ...(this.signal ? [new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(this.signal!.reason);
          this.signal!.addEventListener("abort", onAbort, { once: true });
          if (this.signal!.aborted) onAbort();
        })] : []),
        new Promise<never>((_resolve, reject) => {
          timer = this.clock.setTimeout(() => reject(this.expiredError()), remaining);
        }),
      ]);
    } finally {
      this.clock.clearTimeout(timer);
      if (onAbort) this.signal?.removeEventListener("abort", onAbort);
    }
  }

  /** Always initiate resource release, but a stalled close must not extend an exhausted budget.
   * Pending Playwright operations are interrupted by context/browser close; late rejections are handled.
   * @complexity O(1) aside from resource release. */
  async release({ close }: { close: () => Promise<void> }): Promise<void> {
    const closing = close();
    if (this.remainingMs() <= 0 || this.signal?.aborted) {
      void closing.catch(() => {});
      return;
    }
    try {
      await new PageWorkBudget({ timeoutMs: this.remainingMs() }, { clock: this.clock, ...(this.signal ? { signal: this.signal } : {}) }).run({ work: () => closing });
    } catch (error) {
      if (!(error instanceof PageWorkTimeout) && !this.signal?.aborted) throw error;
    }
  }
}
