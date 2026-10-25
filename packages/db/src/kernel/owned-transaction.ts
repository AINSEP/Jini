import type { StorageKernel } from "./port.js";

/** Private access to the kernel's scope checks; public transactions retain their join semantics. */
export interface OwnedTransactionControl {
  assertAvailable(): void;
  /** `onSettled` runs after commit/rollback but before the turn lock is released. */
  transaction<T>(work: () => Promise<T>, optional?: { onSettled?: () => void }): Promise<T>;
}

export const ownedTransactions = new WeakMap<StorageKernel<unknown>, OwnedTransactionControl>();

/** Refuse unknown kernels rather than promising atomicity over an executor we do not own. */
export function ownedTransactionOf({ kernel }: { kernel: StorageKernel<unknown> }, _optional: {} = {}): OwnedTransactionControl {
  const control = ownedTransactions.get(kernel);
  if (control === undefined) throw new Error("an owned transaction requires a kernel built by buildKernel");
  return control;
}
