/**
 * @module kernel-base
 *
 * The infrastructure every composition owns regardless of which features it activates: the durable
 * (or in-memory) event log, the run lifecycle, the byte journal, the agent executor, the one shared
 * `ToolRegistry`/`ToolExecutor` pair, and — for sqlite storage — the raw database connection.
 *
 * **The database connection belongs here, not to a feature.** It is borrowed by the readiness probe
 * (`health`), by the raw db-operations tools (`daemonDb`), and by the durable tool catalog
 * (`toolCatalog`) — three independently-selectable features. Had any one of them owned it, disabling
 * that feature would have silently broken the others: turning off `daemonDb` would leave `health`'s
 * readiness probe with nothing to check, which is a much worse failure than the one it was meant to
 * simplify, because a readiness probe that stops probing still answers `200`. Ownership by the base,
 * borrowing by features, is what makes the feature set genuinely independent.
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';

import { createToolRegistry, type ToolRegistry } from '@jini-ai/core';
import {
  createAgentExecutor,
  createInMemoryEventLog,
  createRunByteJournal,
  createRunLifecycle,
  createToolExecutor,
  resumableFromProcessExit,
  type AgentExecutor,
  type EventLog,
  type RunLifecycle,
  type RunRetrySideEffectState,
  type ToolExecutor,
} from '@jini-ai/daemon';
import { createSqliteEventLog } from '@jini-ai/sqlite';

/** Where a composition's durable state lives. */
export type JiniKernelStorage =
  /** No files touched. Runs and their events vanish with the process — right for tests and for an
   * embedded host that treats runs as ephemeral. Features needing a real database file
   * (`daemonDb`, `toolCatalog`, `xai`) cannot be activated against it. */
  | { readonly kind: 'memory' }
  /** `<dataDir>/events.db` + `<dataDir>/journal.db`. The directory must already exist. */
  | { readonly kind: 'sqlite'; readonly dataDir: string };

/** The raw sqlite handle and its path, borrowed by `health`/`daemonDb`/`toolCatalog`. */
export interface KernelSqliteAccess {
  readonly connection: Database.Database;
  readonly eventsDbPath: string;
  readonly dataDir: string;
}

/**
 * An `EventLog` that may or may not hold an OS resource. `@jini-ai/sqlite`'s `SqliteEventLog` adds
 * `close()`; `@jini-ai/daemon`'s in-memory reference adapter has nothing to release and so declares
 * none. Modelling `close` as optional lets the base treat both storage kinds uniformly instead of
 * branching on which one it happens to hold.
 */
export type ClosableEventLog = EventLog & { close?: () => Promise<void> };

export interface JiniKernelBase {
  readonly eventLog: ClosableEventLog;
  readonly journalEventLog: ClosableEventLog;
  readonly lifecycle: RunLifecycle;
  readonly agentExecutor: AgentExecutor;
  /** The single registry every active feature's tools land in, and the only one `toolExecutor` reads. */
  readonly registry: ToolRegistry;
  readonly toolExecutor: ToolExecutor;
  /** `null` under memory storage. Owned here; features borrow and must never close it. */
  readonly sqlite: KernelSqliteAccess | null;
  /** Closes every handle this base opened, in the same order the standalone daemon always has. */
  close(): Promise<void>;
}

export interface CreateJiniKernelBaseOptions {
  readonly storage: JiniKernelStorage;
  /** Extra `createAgentExecutor` options (e.g. `mcpJsonInjection`). `lifecycle`/`journal`/`classifyFailure` are kernel-owned. */
  readonly agentExecutor?: Omit<Parameters<typeof createAgentExecutor>[0], 'lifecycle' | 'journal' | 'classifyFailure'>;
}

/**
 * The zero-config retry classifier every composition gets. Delegates entirely to `@jini-ai/daemon`'s
 * `resumableFromProcessExit` — see that function's own doc for the classification policy.
 */
export function classifyRunFailureForRetry(context: {
  code: number | null;
  signal: string | null;
  sideEffects?: Pick<RunRetrySideEffectState, 'userVisibleOutputSeen' | 'toolCallSeen'>;
}): boolean {
  return resumableFromProcessExit(context.code, context.signal, context.sideEffects);
}

/**
 * Opens every kernel-owned resource and rehydrates durable run history.
 *
 * @throws If rehydration fails against a corrupt or unreadable durable history. Every handle this
 * call had already opened is closed before it rethrows, so a failed boot never leaks a sqlite file
 * handle — the invariant the standalone daemon has always maintained.
 */
export async function createJiniKernelBase(options: CreateJiniKernelBaseOptions): Promise<JiniKernelBase> {
  const isSqlite = options.storage.kind === 'sqlite';
  const dataDir = options.storage.kind === 'sqlite' ? options.storage.dataDir : null;
  const eventsDbPath = dataDir === null ? null : join(dataDir, 'events.db');

  // One acquisition block, one cleanup path — and **every** acquisition is inside it. Opening even
  // the first event log outside the block would reintroduce exactly the leak this shape exists to
  // prevent: `events.db` opens, `journal.db` fails (corrupt file, or a directory sitting where a
  // database was expected), and the first handle stays open for the lifetime of a process that has
  // no kernel. The second sqlite connection and the rehydration are grouped here for the same
  // reason: all four can fail after handles are already open, and two try/catch blocks with
  // near-identical cleanup is how one of them eventually drifts and starts leaking.
  const opened: ClosableEventLog[] = [];
  const openEventLog = (path: string | null): ClosableEventLog => {
    const log = path === null ? createInMemoryEventLog() : createSqliteEventLog(path);
    opened.push(log);
    return log;
  };

  let sqlite: KernelSqliteAccess | null = null;
  let eventLog!: ClosableEventLog;
  let journalEventLog!: ClosableEventLog;
  let lifecycle!: RunLifecycle;
  let journal!: ReturnType<typeof createRunByteJournal>;
  try {
    eventLog = openEventLog(eventsDbPath);
    // Gap 1's byte journal gets its own store, deliberately separate from `eventLog`: that log
    // replays every entry it holds to SSE subscribers as a `RunProtocolEvent`, and a journal entry
    // has no corresponding protocol-event kind.
    journalEventLog = openEventLog(dataDir === null ? null : join(dataDir, 'journal.db'));

    if (isSqlite && eventsDbPath !== null && dataDir !== null) {
      // A *second* connection to the same `events.db` the log above owns — safe: both run in WAL
      // mode, which permits multiple concurrently open handles on one file within a single process.
      sqlite = { connection: new Database(eventsDbPath), eventsDbPath, dataDir };
    }

    journal = createRunByteJournal(journalEventLog);
    lifecycle = createRunLifecycle({ eventLog });
    await lifecycle.rehydrate();
  } catch (error) {
    sqlite?.connection.close();
    await Promise.all(opened.map((log) => log.close?.()));
    throw error;
  }

  const agentExecutor = createAgentExecutor({
    ...options.agentExecutor,
    lifecycle,
    journal,
    classifyFailure: classifyRunFailureForRetry,
  });

  const registry = createToolRegistry();
  // Created eagerly against the still-empty registry, and that is correct: `ToolExecutor` resolves
  // a registration at execute time, not at construction, so features composed later can contribute
  // tools this executor will find. It is what lets a feature's routes take the executor as a
  // dependency while its own tools register in the same pass.
  const toolExecutor = createToolExecutor({ registry });

  let closed: Promise<void> | null = null;
  return {
    eventLog,
    journalEventLog,
    lifecycle,
    agentExecutor,
    registry,
    toolExecutor,
    sqlite,
    close(): Promise<void> {
      closed ??= (async () => {
        sqlite?.connection.close();
        await Promise.all([eventLog.close?.(), journalEventLog.close?.()]);
      })();
      return closed;
    },
  };
}
