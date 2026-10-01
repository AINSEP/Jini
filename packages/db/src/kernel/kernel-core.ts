import { AsyncLocalStorage } from "node:async_hooks";

import type { Kysely } from "kysely";

import {
  type StorageCapabilities,
  type StorageDialect,
  type StorageKernel,
  type StorageTransport,
  UnsupportedCapabilityError,
} from "./port.js";
import { TurnLock } from "./turn-lock.js";

/**
 * @file The transaction rules every driver shares, so they cannot differ by dialect: a test that
 * passes on PGlite passes on SQLite for the same reason.
 *
 * The caller's async context (AsyncLocalStorage) records whether it is inside a `run()` body or a
 * transaction, and which executor that is. Nested `transaction()` joins; nested `run()` reuses the
 * executor; `transaction()` inside `run()` throws (it would wait on the caller's own turn).
 */

/** What a driver supplies. Everything else about a kernel is built here. */
export interface KernelDriver<DB> {
  dialect: StorageDialect;
  transport: StorageTransport;
  capabilities: StorageCapabilities;
  ready: Promise<void>;
  base: Kysely<DB>;
  /** One real transaction; `body` gets its executor. Commit on resolve, roll back on throw. */
  begin<T>(body: (tx: Kysely<DB>) => Promise<T>): Promise<T>;
  /** `StorageKernel.lockKey` on the open transaction's executor. */
  lockKey(tx: Kysely<DB>, key: string): Promise<void>;
  /** Share one connection between all callers: take turns (see `turn-lock.ts`). */
  oneConnection: boolean;
  /**
   * The turn lock to take turns on, when several connections in this process open the SAME
   * database (two better-sqlite3 handles on one file): they must take turns as one, or one
   * connection's `BEGIN IMMEDIATE` busy-waits, thread blocked, on a transaction that can then never
   * commit. Omitted: a lock of this kernel's own.
   */
  turnLock?: TurnLock | undefined;
  /**
   * A transaction on the connection that this kernel did not open (a legacy `BEGIN IMMEDIATE` site
   * not converted yet). While one is open, kernel calls join it — the same pass-through the legacy
   * runners use — instead of failing on a nested `BEGIN`. Removed once no legacy site remains.
   */
  foreignTransactionOpen?(): boolean;
  /** `StorageKernel.backupTo`; required when `capabilities.backup` is true. */
  backup?(destPath: string): Promise<void>;
  close(): Promise<void>;
}

type Scope<DB> = { kind: "run" | "transaction"; db: Kysely<DB> };

/** The turn locks the caller's async context holds, across every kernel in the process. */
const heldLocks = new AsyncLocalStorage<ReadonlySet<TurnLock>>();

/**
 * Takes `lock` for `body`, unless this call chain already holds it through ANOTHER kernel (a second
 * connection to the same database): that would wait on its own turn forever, so it throws.
 */
async function takingTurn<T>(lock: TurnLock | undefined, kind: "shared" | "exclusive", body: () => Promise<T>): Promise<T> {
  if (lock === undefined) return body();
  const held = heldLocks.getStore();
  if (held?.has(lock)) {
    throw new Error(
      "this call chain already holds another connection to the same database file; use one connection (one kernel) for the whole unit of work"
    );
  }
  await lock.acquire(kind);
  try {
    return await heldLocks.run(new Set([...(held ?? []), lock]), body);
  } finally {
    lock.release(kind);
  }
}

export function buildKernel<DB>(driver: KernelDriver<DB>): StorageKernel<DB> {
  const scope = new AsyncLocalStorage<Scope<DB>>();
  const lock = driver.oneConnection ? (driver.turnLock ?? new TurnLock()) : undefined;
  let ownTransactions = 0;
  const joinsForeign = () => ownTransactions === 0 && driver.foreignTransactionOpen?.() === true;

  function require(capability: keyof StorageCapabilities): void {
    if (!driver.capabilities[capability]) throw new UnsupportedCapabilityError(capability, driver.transport);
  }

  async function run<T>(fn: (db: Kysely<DB>) => T | Promise<T>): Promise<T> {
    await driver.ready;
    const current = scope.getStore();
    if (current !== undefined) return fn(current.db);
    if (joinsForeign()) return fn(driver.base);
    return takingTurn(lock, "shared", async () => scope.run({ kind: "run", db: driver.base }, () => fn(driver.base)));
  }

  async function transaction<T>(fn: () => Promise<T>): Promise<T> {
    require("interactiveTransactions");
    await driver.ready;
    const current = scope.getStore();
    if (current?.kind === "transaction") return fn();
    if (current?.kind === "run") {
      throw new Error(
        "transaction() was called inside a run() body; start the transaction first and call run() inside it"
      );
    }
    if (joinsForeign()) return fn();
    return takingTurn(lock, "exclusive", async () => {
      ownTransactions += 1;
      try {
        return await driver.begin((tx) => scope.run({ kind: "transaction", db: tx }, fn));
      } finally {
        ownTransactions -= 1;
      }
    });
  }

  async function lockKey(key: string): Promise<void> {
    const current = scope.getStore();
    // A joined legacy transaction counts: it is the same `BEGIN IMMEDIATE` on SQLite.
    if (current?.kind !== "transaction" && !joinsForeign()) {
      throw new Error("lockKey() must be called inside transaction()");
    }
    await driver.lockKey(current?.db ?? driver.base, key);
  }

  return {
    dialect: driver.dialect,
    transport: driver.transport,
    capabilities: driver.capabilities,
    ready: driver.ready,
    run,
    transaction,
    lockKey,
    query: async (statement) => (await run((db) => statement.execute(db))).rows,
    execute: async (statement) => {
      await run((db) => statement.execute(db));
    },
    inTransaction: () => scope.getStore()?.kind === "transaction",
    require,
    async backupTo(destPath) {
      require("backup");
      if (driver.backup === undefined) throw new UnsupportedCapabilityError("backup", driver.transport);
      if (scope.getStore()?.kind === "transaction") throw new Error("backupTo() must be called outside a transaction");
      await driver.ready;
      await driver.backup(destPath);
    },
    close: () => driver.close(),
  };
}
