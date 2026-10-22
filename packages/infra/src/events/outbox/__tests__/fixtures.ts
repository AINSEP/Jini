import { vi } from 'vitest';
import type { OutboxRecord, OutboxWorkerArgs, Scheduler } from '../index.js';

export const NOW = '2026-02-21T12:00:00.000Z';
export interface TestEvent { id: string; name: string; occurredAt: string; workspaceId: string; payload: unknown }
export const scheduler: Scheduler = {
  schedule({ delayMs, callback }) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return { cancel() { clearTimeout(timer); } };
  },
};
export function row(id = 'evt-1', attempts = 1): OutboxRecord<TestEvent> {
  return { id, event: { id, name: 'demo.event', occurredAt: NOW, workspaceId: 'workspace-1', payload: { ok: true } },
    attempts, status: 'processing', nextAttemptAt: NOW, createdAt: NOW };
}
export function fixture(rows: OutboxRecord<TestEvent>[] = [row()]) {
  const outbox = {
    enqueue: vi.fn(async (_args: { event: TestEvent }) => {}),
    claimPending: vi.fn(async (_args: { batchSize: number; nowIso: string; claimLeaseMs: number }) => rows),
    markDelivered: vi.fn(async (_args: { id: string; claimToken?: string }) => {}),
    markFailed: vi.fn(async (_args: { id: string; claimToken?: string; error: string; nextAttemptAt: string; nextStatus: 'pending' | 'failed' }) => {}),
  };
  const bus = { publish: vi.fn(async (_args: { event: TestEvent }) => {}) };
  const logger = { error: vi.fn((_args: { message: string }, _optional?: { error?: unknown }) => {}) };
  const args: OutboxWorkerArgs<TestEvent> = { outbox, bus, logger, scheduler, clock: { nowMs: () => Date.parse(NOW) }, random: () => 0 };
  return { args, outbox, bus, logger };
}
export function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
