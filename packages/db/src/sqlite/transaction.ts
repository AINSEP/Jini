import type { RawBuilder, StorageKernel } from "../kernel/port.js";
import { ownedTransactionOf } from "../kernel/owned-transaction.js";
import type { CheckedSqliteClient } from "./checked-client.js";
import { assertCheckedAvailable, checkedClients, checkedStates, connectionsByKernel, SqliteClientError, type CheckedState, type SqliteLease } from "./checked-state.js";

export type Work<T> = (input: { session: TransactionSession }) => Promise<T>;
export interface TransactionSession {
  query<R>(required: { statement: RawBuilder<R> }, optional?: {}): Promise<R[]>;
  execute(required: { statement: RawBuilder<unknown> }, optional?: {}): Promise<void>;
  transaction<T>(required: { work: Work<T> }, optional?: {}): Promise<T>;
}

class FailedOutcome extends Error {
  readonly outcome: unknown;
  constructor({ outcome }: { outcome: unknown }, _optional: {} = {}) {
    super("returned failed outcome", { cause: outcome });
    this.outcome = outcome;
  }
}

function sessionFor({ kernel, state, lease }: { kernel: StorageKernel<unknown>; state: CheckedState; lease: SqliteLease }, _optional: {} = {}): TransactionSession {
  const check = () => {
    if (!lease.active) throw new SqliteClientError({ code: "session_expired" });
    assertCheckedAvailable({ state });
  };
  const session: TransactionSession = {
    async query({ statement }, _optional = {}) {
      check();
      return kernel.run(async (db) => { check(); return (await statement.execute(db)).rows; });
    },
    async execute({ statement }, _optional = {}) {
      check();
      await kernel.run(async (db) => { check(); await statement.execute(db); });
    },
    async transaction({ work }, _optional = {}) { check(); return work({ session }); },
  };
  return session;
}

/**
 * Exclusively lease a matching checked kernel. Nested session work joins; only the root result
 * decides optional failed-Outcome rollback. A session is revoked even when cleanup fails.
 * @throws SqliteClientError or the original body error; AggregateError preserves cleanup failures.
 */
export async function withSqliteTransaction<T>(
  required: { client: CheckedSqliteClient; kernel: StorageKernel<unknown>; work: Work<T> },
  optional: { rollbackOnFailedOutcome?: boolean } = {}
): Promise<T> {
  const { client, kernel, work } = required;
  const state = checkedStates.get(client);
  if (!checkedClients.has(client) || state === undefined || connectionsByKernel.get(kernel) !== client) throw new Error("a matching checked SQLite client and kernel are required");
  assertCheckedAvailable({ state });
  if (state.lease !== undefined) throw new SqliteClientError({ code: "transaction_busy" });
  if (client.inTransaction) throw new Error("an owned transaction cannot join an existing or foreign transaction");
  const control = ownedTransactionOf({ kernel });
  control.assertAvailable();
  const lease: SqliteLease = { active: true, acquired: false };
  state.lease = lease;
  const session = sessionFor({ kernel, state, lease });
  try {
    return await state.context.run(lease, () => control.transaction(async () => {
      // Reserve first to reject overlaps, but let earlier shared runs finish before taking control.
      lease.acquired = true;
      const result = await work({ session });
      if (optional.rollbackOnFailedOutcome === true && isFailedOutcome({ value: result })) throw new FailedOutcome({ outcome: result });
      return result;
    }));
  } catch (error) {
    if (error instanceof FailedOutcome) return error.outcome as T;
    if (error instanceof AggregateError) {
      throw new AggregateError(error.errors.map((part: unknown) => part instanceof FailedOutcome ? part.outcome : part), error.message);
    }
    throw error;
  } finally {
    lease.active = false;
    delete state.lease;
  }
}

function isFailedOutcome({ value }: { value: unknown }, _optional: {} = {}): boolean {
  return value !== null && typeof value === "object" && "ok" in value && value.ok === false;
}
