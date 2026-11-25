/**
 * @file `withIdleTurn`: an exclusive, NON-queuing turn on a one-connection kernel (better-sqlite3,
 * PGlite), taken only while the kernel is idle.
 *
 * Why: every caller of such a kernel shares ONE connection, and a kernel transaction is just a
 * `BEGIN` on it. Maintenance that must not land inside someone else's transaction (a bounded
 * `PRAGMA incremental_vacuum`, for instance) needs the file's turn lock to itself — but serving
 * traffic must never queue behind maintenance, so admission refuses instead of waiting.
 *
 * Invariants: the body runs only while this process holds the file's turn lock exclusively (I1);
 * admission never waits and never overtakes a queued caller (I2); it refuses inside a kernel scope,
 * with a foreign transaction open, or on a kernel without a turn lock (I3); kernel calls on the same
 * file inside the body throw (I4); the lock is released even when the body throws, and the body's
 * error is never caught (I5). Never call it from a migration: the runner's transaction scope makes
 * it refuse with "in-scope" (I6).
 */
import type { KyselyKernel } from "./port.js";

/**
 * Why a turn was not taken. "busy": kernel work holds or waits for the lock — it clears by itself.
 * "in-scope": the caller is inside a kernel run/transaction (or holds the lock through another
 * kernel). "transaction-open": the shared connection is in a transaction the kernel does not own.
 * "unsupported": a multi-connection kernel, or one not built by `buildKernel`.
 */
export type IdleTurnRefusal = "busy" | "in-scope" | "transaction-open" | "unsupported";
export type IdleTurnResult<T> =
  | { readonly ran: true; readonly value: T }
  | { readonly ran: false; readonly reason: IdleTurnRefusal };

/** Private per-kernel control, registered by `buildKernel` (the same pattern as `registerOwnedTransaction`). */
export interface IdleTurnControl {
  /** Synchronous admission plus exclusive take: the release function, or the refusal. */
  tryTake(): { readonly release: () => void } | { readonly refusal: IdleTurnRefusal };
  /** Runs `body` with the lock marked held for this async chain, so nested kernel calls throw (I4). */
  runHeld<T>(body: () => Promise<T>): Promise<T>;
}

const controls = new WeakMap<KyselyKernel<unknown>, IdleTurnControl>();

/** Records the control of a kernel built by `buildKernel`. Not exported from the package. */
export function registerIdleTurn(
  { kernel, control }: { kernel: KyselyKernel<unknown>; control: IdleTurnControl },
  _optional: Record<string, never> = {},
): void {
  controls.set(kernel, control);
}

/** A wrapper kernel (schema-scoped, owned connection) shares its source's lock and control. */
export function inheritIdleTurn(
  { from, to }: { from: KyselyKernel<unknown>; to: KyselyKernel<unknown> },
  _optional: Record<string, never> = {},
): void {
  const control = controls.get(from);
  if (control !== undefined) controls.set(to, control);
}

/**
 * Run `body` in an exclusive turn on a one-connection kernel, only if the kernel is idle right now.
 * Never queues (I2), never joins a transaction (I3), always releases (I5).
 * @complexity O(1) admission plus the body.
 */
export async function withIdleTurn<T, DB = unknown>(
  { kernel, body }: { kernel: KyselyKernel<DB>; body: () => Promise<T> },
  _optional: Record<string, never> = {},
): Promise<IdleTurnResult<T>> {
  const control = controls.get(kernel as KyselyKernel<unknown>);
  if (control === undefined) return { ran: false, reason: "unsupported" };
  await kernel.ready;
  const taken = control.tryTake();
  if ("refusal" in taken) return { ran: false, reason: taken.refusal };
  try {
    return { ran: true, value: await control.runHeld(body) };
  } finally {
    taken.release();
  }
}
