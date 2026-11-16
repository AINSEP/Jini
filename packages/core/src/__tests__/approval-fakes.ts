import type { ApprovalSchedulerPort } from '../approval.js';
import type { IdGenerator } from '../primitives/ids.js';

export const fixedIds = (id: string): IdGenerator => ({ newId: () => id });

export interface FakeApprovalScheduler extends ApprovalSchedulerPort {
  readonly pending: ReadonlyMap<number, { callback: () => void; delayMs: number }>;
  /** Run every scheduled callback still pending, as if its delay had elapsed. */
  fireAll(): void;
}

export function fakeScheduler(): FakeApprovalScheduler {
  const pending = new Map<number, { callback: () => void; delayMs: number }>();
  let next = 0;
  return {
    pending,
    schedule: ({ callback, delayMs }) => { const handle = next++; pending.set(handle, { callback, delayMs }); return handle; },
    cancel: ({ handle }) => { pending.delete(handle as number); },
    fireAll: () => { for (const [handle, entry] of [...pending]) { pending.delete(handle); entry.callback(); } },
  };
}
