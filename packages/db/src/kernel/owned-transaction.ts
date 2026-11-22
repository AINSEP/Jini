import type { KyselyKernel } from "./port.js";

/** Private access to the kernel's scope checks; public transactions retain their join semantics. */
export interface OwnedTransactionControl {
  assertAvailable(): void;
  /** `onSettled` runs after commit/rollback but before the turn lock is released. */
  transaction<T>(work: () => Promise<T>, optional?: { onSettled?: () => void }): Promise<T>;
}

const ownedTransactions = new WeakMap<KyselyKernel<unknown>, OwnedTransactionControl>();

/** Records the control of a kernel built by buildKernel. */
export function registerOwnedTransaction({ kernel, control }: { kernel: KyselyKernel<unknown>; control: OwnedTransactionControl }, _optional: Record<string, never> = {}): void {
  ownedTransactions.set(kernel, control);
}

/** A kernel derived from another (schema-scoped, owned connection) shares its control, when it has one. */
export function inheritOwnedTransaction({ from, to }: { from: KyselyKernel<unknown>; to: KyselyKernel<unknown> }, _optional: Record<string, never> = {}): void {
  const control = ownedTransactions.get(from);
  if (control !== undefined) ownedTransactions.set(to, control);
}

/** Refuse unknown kernels rather than promising atomicity over an executor we do not own. */
export function ownedTransactionOf({ kernel }: { kernel: KyselyKernel<unknown> }, _optional: {} = {}): OwnedTransactionControl {
  const control = ownedTransactions.get(kernel);
  if (control === undefined) throw new Error("an owned transaction requires a kernel built by buildKernel");
  return control;
}
