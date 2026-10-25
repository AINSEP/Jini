import { AsyncLocalStorage } from "node:async_hooks";
import type { SqliteClient } from "./types.js";
import type { StorageKernel } from "../kernel/port.js";

export interface SqliteLease { active: boolean; acquired: boolean }
export interface CheckedState {
  context: AsyncLocalStorage<SqliteLease>;
  lease?: SqliteLease;
  quarantined: boolean;
  cleanupAllowed: boolean;
}

export const checkedStates = new WeakMap<SqliteClient, CheckedState>();
export const checkedClients = new WeakSet<SqliteClient>();
export const rawKernelClients = new WeakSet<SqliteClient>();

/** The reverse of the driver's kernel cache, plus the owning kernels openSqliteFileKernel returns. */
export const connectionsByKernel = new WeakMap<StorageKernel<unknown>, SqliteClient>();

/** A typed failure from the opt-in checked client; the native failure remains its cause. */
export class SqliteClientError extends Error {
  readonly code: "unsafe_integer" | "commit_failed" | "rollback_failed" | "quarantined" | "session_expired" | "transaction_busy";

  constructor(required: { code: SqliteClientError["code"] }, optional: { cause?: unknown } = {}) {
    super(required.code, { cause: optional.cause });
    this.code = required.code;
    this.name = "SqliteClientError";
  }
}

/** Checks both queued work's lifetime and the shared native handle's health. */
export function assertCheckedAvailable({ state }: { state: CheckedState }, _optional: {} = {}): void {
  if (state.quarantined) throw new SqliteClientError({ code: "quarantined" });
  const current = state.context.getStore();
  if (current?.active === false) throw new SqliteClientError({ code: "session_expired" });
  if (state.lease?.acquired === true && current !== state.lease) throw new SqliteClientError({ code: "transaction_busy" });
}
