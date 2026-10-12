/** Internal deadline shared by every asynchronous step of one page observation. */
export class PageWorkTimeout extends Error {
  constructor({ timeoutMs }: { timeoutMs: number }) {
    super(`page work timed out after ${timeoutMs}ms`);
    this.name = "PageWorkTimeout";
  }
}

/** A timeout is a budget for the whole page, not a fresh allowance for each browser operation. */
export class PageWorkBudget {
  private readonly expiresAt: number;
  private readonly timeoutMs: number;
  private readonly signal: AbortSignal | undefined;

  constructor({ timeoutMs }: { timeoutMs: number }, { signal }: { signal?: AbortSignal } = {}) {
    this.signal = signal;
    this.timeoutMs = timeoutMs;
    this.expiresAt = Date.now() + timeoutMs;
  }

  remainingMs(): number { return Math.max(0, this.expiresAt - Date.now()); }

  /** Races even APIs without native timeouts (evaluation/cookies) and never starts expired work.
   * @complexity O(1) time and space apart from the injected operation. */
  async run<T>({ work }: { work: () => Promise<T> }): Promise<T> {
    this.signal?.throwIfAborted();
    const remaining = this.remainingMs();
    if (remaining <= 0) throw new PageWorkTimeout({ timeoutMs: this.timeoutMs });
    let timer: ReturnType<typeof setTimeout> | undefined;
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
          timer = setTimeout(() => reject(new PageWorkTimeout({ timeoutMs: this.timeoutMs })), remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
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
      await new PageWorkBudget({ timeoutMs: this.remainingMs() }, this.signal ? { signal: this.signal } : {}).run({ work: () => closing });
    } catch (error) {
      if (!(error instanceof PageWorkTimeout) && !this.signal?.aborted) throw error;
    }
  }
}
