/** Internal deadline shared by every asynchronous step of one page observation. */
export class PageWorkTimeout extends Error {
  constructor({ timeoutMs }: { timeoutMs: number }) {
    super(`page work timed out after ${timeoutMs}ms`);
  }
}

/** A timeout is a budget for the whole page, not a fresh allowance for each browser operation. */
export class PageWorkBudget {
  private readonly expiresAt: number;
  private readonly timeoutMs: number;

  constructor({ timeoutMs }: { timeoutMs: number }) {
    this.timeoutMs = timeoutMs;
    this.expiresAt = Date.now() + timeoutMs;
  }

  remainingMs(): number { return Math.max(0, this.expiresAt - Date.now()); }

  /** Races even APIs without native timeouts (evaluation/cookies) and never starts expired work.
   * @complexity O(1) time and space apart from the injected operation. */
  async run<T>({ work }: { work: () => Promise<T> }): Promise<T> {
    const remaining = this.remainingMs();
    if (remaining <= 0) throw new PageWorkTimeout({ timeoutMs: this.timeoutMs });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new PageWorkTimeout({ timeoutMs: this.timeoutMs })), remaining);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Always initiate resource release, but a stalled close must not extend an exhausted budget.
   * Pending Playwright operations are interrupted by context/browser close; late rejections are handled.
   * @complexity O(1) aside from resource release. */
  async release({ close }: { close: () => Promise<void> }): Promise<void> {
    const closing = close();
    if (this.remainingMs() <= 0) {
      void closing.catch(() => {});
      return;
    }
    try {
      await this.run({ work: () => closing });
    } catch (error) {
      if (!(error instanceof PageWorkTimeout)) throw error;
    }
  }
}
