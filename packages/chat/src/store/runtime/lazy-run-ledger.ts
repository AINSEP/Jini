import type { ChatRunLedger } from '../../core/durable-runs/ledger-contracts.js';

/**
 * A {@link ChatRunLedger} over a database the host opens only on first real use (a test
 * composition root whose routes may never touch chat history should not pay for a database).
 * The host owns opening and memoizing the kernel; building a ledger per call must be cheap
 * (one kernel per connection), which keeps the database lazy.
 * @param peek The already-open kernel, or undefined when nothing has opened it yet.
 * @param open Opens (once) and returns the kernel; every writing or durable call goes through it.
 * @param ledgerFor Builds the host's ledger (including any host wrappers) over one kernel.
 * @complexity O(1) per call beyond the delegated ledger operation.
 */
export function createLazyChatRunLedger<K>(
  { peek, open, ledgerFor }: { peek: () => K | undefined; open: () => K; ledgerFor: (required: { kernel: K }) => ChatRunLedger },
  _optional = {},
): ChatRunLedger {
  const opened = (): ChatRunLedger => ledgerFor({ kernel: open() });
  return {
    hasActiveRuns: async () => { const kernel = peek(); return kernel !== undefined ? ledgerFor({ kernel }).hasActiveRuns({}, {}) : false; },
    get durable() { return opened().durable; },
    unlessSettled: (required, optional) => opened().unlessSettled(required, optional),
    settle: (settlement, optional) => opened().settle(settlement, optional),
    checkpoint: (progress, optional) => opened().checkpoint(progress, optional),
    // A database nobody has opened yet holds no stuck rows, so boot-time reconcile does not open it.
    reconcileInterrupted: async (required, optional) => {
      const kernel = peek();
      return kernel !== undefined ? ledgerFor({ kernel }).reconcileInterrupted(required, optional) : 0;
    },
  };
}
