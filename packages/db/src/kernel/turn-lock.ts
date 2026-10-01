/**
 * @file Many `run()` bodies OR one transaction at a time, first come first served.
 *
 * Needed where every caller shares ONE connection (better-sqlite3, PGlite): a transaction is just
 * `BEGIN` on that connection, so a `run()` body from an unrelated request that executes while it is
 * open would land inside it — and roll back with it (the SQLite lock-in audit, §3.6, "latent
 * hazard"). A transaction therefore waits until in-flight `run()` bodies finish, and `run()` bodies
 * that arrive while a transaction is open or queued wait for it. FIFO, so neither side starves.
 */

type Kind = "shared" | "exclusive";

interface Waiter {
  kind: Kind;
  grant: () => void;
}

export class TurnLock {
  private shared = 0;
  private exclusive = false;
  private readonly waiting: Waiter[] = [];

  acquire(kind: Kind): Promise<void> {
    if (this.waiting.length === 0 && this.fits(kind)) {
      this.take(kind);
      return Promise.resolve();
    }
    return new Promise((grant) => this.waiting.push({ kind, grant }));
  }

  release(kind: Kind): void {
    if (kind === "exclusive") this.exclusive = false;
    else this.shared -= 1;
    while (this.waiting.length > 0 && this.fits(this.waiting[0]!.kind)) {
      const next = this.waiting.shift()!;
      this.take(next.kind);
      next.grant();
    }
  }

  private fits(kind: Kind): boolean {
    return kind === "exclusive" ? !this.exclusive && this.shared === 0 : !this.exclusive;
  }

  private take(kind: Kind): void {
    if (kind === "exclusive") this.exclusive = true;
    else this.shared += 1;
  }
}
