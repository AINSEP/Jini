import type { CaptureClock } from "../capture-clock.js";

/** Reads the host's real timer once, at load: a fake clock must be able to wait for real macrotasks. */
const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const nextMacrotask = (): Promise<void> => new Promise(resolve => hostSetTimeout(resolve, 0));

interface PendingTimer { id: number; at: number; fn: () => void }

/** A virtual clock for `renderPage` tests. Time moves only through `advance`, which fires due timers in
 * time order and lets every promise they release settle before moving on. */
export class FakeCaptureClock implements CaptureClock {
  private current = 0;
  private nextId = 1;
  private timers: PendingTimer[] = [];

  now(): number { return this.current; }

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.push({ id, at: this.current + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter(timer => timer.id !== handle);
  }

  deadlineSignal(ms: number): AbortSignal {
    const controller = new AbortController();
    this.setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
    return controller.signal;
  }

  /** Timers still waiting. A finished capture leaves none behind. */
  pendingTimers(): number { return this.timers.length; }

  /** Move virtual time forward by `ms`, firing each due timer at its own instant. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    await nextMacrotask();
    for (let due = this.takeDue(target); due; due = this.takeDue(target)) {
      this.current = Math.max(this.current, due.at);
      due.fn();
      await nextMacrotask();
    }
    this.current = target;
    await nextMacrotask();
  }

  /** Remove and return the earliest timer due at or before `target`; ties keep creation order. */
  private takeDue(target: number): PendingTimer | undefined {
    const due = this.timers.filter(timer => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (due) this.timers = this.timers.filter(timer => timer !== due);
    return due;
  }
}
