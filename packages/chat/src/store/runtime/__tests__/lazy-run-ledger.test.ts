import { describe, expect, it, vi } from 'vitest';
import type { ChatRunLedger, ChatRunRecoveryOptions } from '../../../core/durable-runs/ledger-contracts.js';
import { createLazyChatRunLedger } from '../lazy-run-ledger.js';

/** A recording ledger per kernel, and a lazily "opened" kernel the test controls. */
function harness() {
  let kernel: string | undefined;
  const open = vi.fn(() => (kernel ??= 'k1'));
  const built: string[] = [];
  const durable = { find: vi.fn() } as unknown as NonNullable<ChatRunLedger['durable']>;
  const reconcileInterrupted = vi.fn(async (_required?: { now?: number }, _optional?: ChatRunRecoveryOptions) => 7);
  const ledgerFor = ({ kernel: k }: { kernel: string }): ChatRunLedger => {
    built.push(k);
    return {
      durable,
      hasActiveRuns: async () => true,
      unlessSettled: async (required) => ({ settled: false, value: await required.write() }) as never,
      settle: async () => true,
      checkpoint: async () => true,
      reconcileInterrupted,
    };
  };
  const ledger = createLazyChatRunLedger({ peek: () => kernel, open, ledgerFor });
  return { ledger, open, built, durable, reconcileInterrupted };
}

describe('createLazyChatRunLedger', () => {
  it('answers boot-time probes without opening an unopened database', async () => {
    const h = harness();
    expect(await h.ledger.hasActiveRuns()).toBe(false);
    expect(await h.ledger.reconcileInterrupted()).toBe(0);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.built).toEqual([]);
  });

  it('opens the database for writes and durable reads, then delegates every call to that kernel', async () => {
    const h = harness();
    expect(await h.ledger.settle({ runId: 'r' } as never)).toBe(true);
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(await h.ledger.checkpoint({ runId: 'r' } as never)).toBe(true);
    expect(h.ledger.durable).toBe(h.durable);
    expect(await h.ledger.unlessSettled({ run: { runId: 'r' } as never, write: async () => 5 })).toEqual({ settled: false, value: 5 });
    expect(await h.ledger.hasActiveRuns()).toBe(true);
    expect(await h.ledger.reconcileInterrupted()).toBe(7);
    expect(new Set(h.built)).toEqual(new Set(['k1']));
  });
});

it('forwards both recovery objects including admission unchanged', async () => {
  const h = harness(); await h.ledger.settle({ runId: 'r' } as never);
  const required = { now: 42 }; const optional = { admit: vi.fn(async () => 'leave-owned' as const), recover: vi.fn(async () => true) };
  expect(await h.ledger.reconcileInterrupted(required, optional)).toBe(7);
  expect(h.reconcileInterrupted.mock.calls[0]?.[0]).toBe(required);
  expect(h.reconcileInterrupted.mock.calls[0]?.[1]).toBe(optional);
});
