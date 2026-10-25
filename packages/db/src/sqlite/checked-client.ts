import type { SqliteClient, SqliteStatement } from "./types.js";
import { assertCheckedAvailable, checkedClients, checkedStates, rawKernelClients, SqliteClientError, type CheckedState } from "./checked-state.js";
import { AsyncLocalStorage } from "node:async_hooks";

export interface IntegerStatement extends SqliteStatement {
  safeIntegers(enabled: boolean): unknown;
}
export type IntegerSource = Omit<SqliteClient, "prepare"> & { prepare(source: string): IntegerStatement };
export interface CheckedSqliteClient extends SqliteClient { readonly checked: true }

const clients = new WeakMap<SqliteClient, CheckedSqliteClient>();

function numberCell({ value }: { value: unknown }, _optional: {} = {}): unknown {
  if (typeof value !== "bigint") return value;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new SqliteClientError({ code: "unsafe_integer" });
  }
  return Number(value);
}

/** Decode cells only, preserving blobs and other non-integer values by identity. */
function decodeRow({ row }: { row: unknown }, _optional: {} = {}): unknown {
  if (Array.isArray(row)) return row.map((value) => numberCell({ value }));
  if (row === null || typeof row !== "object" || ArrayBuffer.isView(row)) return numberCell({ value: row });
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numberCell({ value })]));
}

function checkedStatement({ statement, state }: { statement: IntegerStatement; state: CheckedState }, _optional: {} = {}): SqliteStatement {
  statement.safeIntegers(true);
  return {
    get reader() { return statement.reader; },
    all(...parameters) {
      assertCheckedAvailable({ state });
      return statement.all(...parameters).map((row) => decodeRow({ row }));
    },
    run(...parameters) {
      assertCheckedAvailable({ state });
      const result = statement.run(...parameters);
      return { changes: numberCell({ value: result.changes }) as number, lastInsertRowid: numberCell({ value: result.lastInsertRowid }) as number };
    },
    *iterate(...parameters) {
      assertCheckedAvailable({ state });
      const iterator = statement.iterate(...parameters);
      try {
        while (true) {
          assertCheckedAvailable({ state });
          const next = iterator.next();
          if (next.done) return;
          yield decodeRow({ row: next.value });
        }
      } finally {
        iterator.return?.();
      }
    },
  };
}

function execChecked({ database, state, source }: { database: IntegerSource; state: CheckedState; source: string }, _optional: {} = {}): unknown {
  const command = source.trim().replace(/;$/, "").toUpperCase();
  // Cleanup must remain possible after an uncertain COMMIT quarantines the handle.
  if (command !== "ROLLBACK" || !state.cleanupAllowed) assertCheckedAvailable({ state });
  if (command === "ROLLBACK") state.cleanupAllowed = false;
  try {
    return database.exec(source);
  } catch (cause) {
    if (command !== "COMMIT" && command !== "ROLLBACK") throw cause;
    state.quarantined = true;
    if (command === "COMMIT") state.cleanupAllowed = database.inTransaction;
    throw new SqliteClientError({ code: command === "COMMIT" ? "commit_failed" : "rollback_failed" }, { cause });
  }
}

/**
 * Borrow a native handle with exact integer decoding and shared quarantine/lease state.
 * Memoized by handle; refuses handles already owned by a raw kernel. Does not close the host handle.
 * @complexity O(cells) per result, O(1) additional rows for lazy iteration.
 */
export function createCheckedSqliteClient(required: { database: IntegerSource }, _optional: {} = {}): CheckedSqliteClient {
  const { database } = required;
  const known = clients.get(database);
  if (known !== undefined) return known;
  if (rawKernelClients.has(database)) throw new Error("cannot mix raw and checked SQLite kernel ownership");
  const state: CheckedState = { context: new AsyncLocalStorage(), quarantined: false, cleanupAllowed: false };
  const client: CheckedSqliteClient = {
    checked: true,
    get memory() { return database.memory; },
    get name() { return database.name; },
    get inTransaction() { return database.inTransaction; },
    exec: (source) => execChecked({ database, state, source }),
    prepare(source) {
      assertCheckedAvailable({ state });
      return checkedStatement({ statement: database.prepare(source), state });
    },
    pragma(source) { assertCheckedAvailable({ state }); return database.pragma(source); },
    backup(destination) { assertCheckedAvailable({ state }); return database.backup(destination); },
    close() {},
  };
  clients.set(database, client);
  clients.set(client, client);
  checkedStates.set(database, state);
  checkedStates.set(client, state);
  checkedClients.add(client);
  return client;
}
