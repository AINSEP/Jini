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
import { openSqliteConnection } from '@jini-ai/db/sqlite';
import { type SqliteDb, type SqliteSyncOpener } from '@jini-ai/core/contracts/storage';
import { join } from 'node:path';
import { createAgentRuntimeBindings, createNativeAgentRuntime, type AgentRuntimeState, type NativeAgentRuntime } from '@jini-ai/agent-runtime';
import type { AgentRuntimePort } from '@jini-ai/daemon/ports/agent-runtime';
import { type AiTraceSink } from '@jini-ai/core/contracts/ai-trace';

import { createToolRegistry, type ToolRegistry } from '@jini-ai/core';
import {
  createAgentExecutor,
  createInMemoryEventLog,
  createRunByteJournal,
  createRunLifecycle,
  createToolExecutor,
  resumableFromProcessExit,
  withAiTracing,
  type AiTracingOptions,
  type AgentExecutor,
  type EventLog,
  type RunLifecycle,
  type RunRetrySideEffectState,
  type ToolExecutor,
} from '@jini-ai/daemon';
import { openSqliteEventLog } from '@jini-ai/daemon/store/event-log/sqlite';
import { createSystemClock } from '@jini-ai/platform/system';
import { nodeAtomicWriter, nodeFileLock } from '@jini-ai/node-adapters/fs';
import { nodeCommandShell, nodeProcessControl, nodeSpawnPort } from '@jini-ai/node-adapters/process';
import type { AgentExecutorRuntimePorts } from '@jini-ai/daemon/ports/runtime';

/** Where a composition's durable state lives. */
export type JiniKernelStorage =
  /** No files touched. Runs and their events vanish with the process — right for tests and for an
   * embedded host that treats runs as ephemeral. Features needing a real database file
   * (`daemonDb`, `toolCatalog`, `xai`) cannot be activated against it. */
  | { readonly kind: 'memory' }
  /** `<dataDir>/events.db` + `<dataDir>/journal.db`. The directory must already exist. */
  | { readonly kind: 'sqlite'; readonly dataDir: string; readonly open: SqliteSyncOpener };

/** The raw sqlite handle and its path, borrowed by `health`/`daemonDb`/`toolCatalog`. */
export interface KernelSqliteAccess {
  readonly connection: SqliteDb;
  readonly eventsDbPath: string;
  readonly dataDir: string;
}

/**
 * An `EventLog` that may or may not hold an OS resource. `@jini-ai/daemon/store/event-log/sqlite`'s `SqliteEventLog` adds
 * `close({})`; `@jini-ai/daemon`'s in-memory reference adapter has nothing to release and so declares
 * none. Modelling `close` as optional lets the base treat both storage kinds uniformly instead of
 * branching on which one it happens to hold.
 */
export type ClosableEventLog = EventLog & { close?: (requiredArgs: Record<string, never>) => Promise<void> };

export interface JiniKernelBase {
  readonly eventLog: ClosableEventLog;
  readonly journalEventLog: ClosableEventLog;
  readonly lifecycle: RunLifecycle;
  readonly agentExecutor: AgentExecutor;
  /** One runtime shared by this kernel's discovery and executor paths. */
  readonly agentRuntime: NativeAgentRuntime;
  /** The single registry every active feature's tools land in, and the only one `toolExecutor` reads. */
  readonly registry: ToolRegistry;
  readonly toolExecutor: ToolExecutor;
  /** `null` under memory storage. Owned here; features borrow and must never close it. */
  readonly sqlite: KernelSqliteAccess | null;
  /** Closes every handle this base opened, in the same order the standalone daemon always has. */
  close(): Promise<void>;
}

/** What the preset builds its native agent runtime from: an owned state and the Codex / Pi definition policies. The executor takes the bound runtime, never these. */
export interface KernelAgentRuntimeOptions {
  readonly runtimeState?: AgentRuntimeState;
  readonly codexDisablePlugins?: boolean;
  readonly piGracefulShutdownMs?: number;
  /** Binds the preset's native runtime to the executor's port; default `createAgentRuntimeBindings`. A host decorating the port (or a test scripting one member) wraps the default binding it is handed. */
  readonly bindAgentRuntime?: (required: { runtime: NativeAgentRuntime }) => AgentRuntimePort;
}

export interface CreateJiniKernelBaseOptions {
  readonly storage: JiniKernelStorage;
  /** Extra `createAgentExecutor` options (e.g. `mcpJsonInjection`). `lifecycle`/`journal`/`classifyFailure` are kernel-owned. */
  readonly agentExecutor?: Omit<NonNullable<Parameters<typeof createAgentExecutor>[1]>, 'journal' | 'classifyFailure'>
    & Partial<Pick<Parameters<typeof createAgentExecutor>[0], 'hostEnv' | 'runtime'>> & KernelAgentRuntimeOptions;
  /** Optional AI-run tracing: every run's normalized agent events are also recorded to `sink`. Absent = no tracing, no cost. */
  readonly aiTrace?: AiTracingOptions & { readonly sink: AiTraceSink };
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
  return resumableFromProcessExit({ code: context.code, signal: context.signal },
    context.sideEffects === undefined ? {} : { sideEffects: context.sideEffects });
}

function tracedIfConfigured(lifecycle: RunLifecycle, aiTrace: CreateJiniKernelBaseOptions['aiTrace']): { lifecycle: RunLifecycle; disposeTracing: () => void } {
  if (!aiTrace) return { lifecycle, disposeTracing: () => {} };
  const { sink, ...options } = aiTrace;
  const traced = withAiTracing({ lifecycle, sink }, options);
  return { lifecycle: traced, disposeTracing: traced.dispose };
}

async function closeFailedAcquisition(
  { featureConnection, opened }: { featureConnection: SqliteDb | undefined; opened: readonly ClosableEventLog[] },
  _optional: Record<string, never> = {},
): Promise<void> {
  // Every acquired handle is attempted even if another closer fails. Preserve the boot error.
  try { featureConnection?.close(); } catch { /* Keep the boot failure. */ }
  await Promise.allSettled(opened.map((log) => log.close?.({})));
}

function createKernelAgentRuntime(
  { options }: { options: CreateJiniKernelBaseOptions },
  _optional: Record<string, never> = {},
): NativeAgentRuntime {
  return createNativeAgentRuntime({ env: options.agentExecutor?.hostEnv ?? process.env }, {
    ...(options.agentExecutor?.runtimeState ? { state: options.agentExecutor.runtimeState } : {}),
    ...(options.agentExecutor?.codexDisablePlugins !== undefined ? { codex: { disablePlugins: options.agentExecutor.codexDisablePlugins } } : {}),
    ...(options.agentExecutor?.piGracefulShutdownMs !== undefined ? { pi: { gracefulShutdownMs: options.agentExecutor.piGracefulShutdownMs } } : {}),
  });
}

/** The shared binding of a native runtime to the executor's port; the compiler proves it matches, with no cast. */
function bindNativeAgentRuntime({ runtime }: { runtime: NativeAgentRuntime }, _optional: Record<string, never> = {}): AgentRuntimePort {
  return createAgentRuntimeBindings({ runtime }) satisfies AgentRuntimePort;
}

/** The Node implementations of the OS-facing ports one agent executor needs, bound once from platform. */
function nodeAgentExecutorRuntime({ hostEnv }: { hostEnv: NodeJS.ProcessEnv }, _optional: Record<string, never> = {}): AgentExecutorRuntimePorts {
  return { spawn: nodeSpawnPort, processes: nodeProcessControl, fileLock: nodeFileLock, writer: nodeAtomicWriter, commandShell: nodeCommandShell({ env: hostEnv }) };
}

interface KernelStorageHandles {
  eventLog: ClosableEventLog;
  journalEventLog: ClosableEventLog;
  lifecycle: RunLifecycle;
  disposeTracing: () => void;
  journal: ReturnType<typeof createRunByteJournal>;
  sqlite: KernelSqliteAccess | null;
}

/** Open the event logs, byte journal and run lifecycle; a failure after any handle opened closes them all first. */
async function openKernelStorage({ options }: { options: CreateJiniKernelBaseOptions }): Promise<KernelStorageHandles> {
  const sqliteStorage = options.storage.kind === 'sqlite' ? options.storage : null;
  const dataDir = sqliteStorage?.dataDir ?? null;
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
    let log: ClosableEventLog;
    if (path === null) log = createInMemoryEventLog({});
    else {
      // A non-null path is derived only from sqliteStorage above.
      log = openSqliteEventLog({ file: path, open: sqliteStorage!.open, clock: createSystemClock() });
    }
    opened.push(log);
    return log;
  };

  let sqlite: KernelSqliteAccess | null = null;
  let featureConnection: SqliteDb | undefined;
  let eventLog!: ClosableEventLog;
  let journalEventLog!: ClosableEventLog;
  let lifecycle!: RunLifecycle;
  let disposeTracing = (): void => {};
  let journal!: ReturnType<typeof createRunByteJournal>;
  try {
    eventLog = openEventLog(eventsDbPath);
    // Gap 1's byte journal gets its own store, deliberately separate from `eventLog`: that log
    // replays every entry it holds to SSE subscribers as a `RunProtocolEvent`, and a journal entry
    // has no corresponding protocol-event kind.
    journalEventLog = openEventLog(dataDir === null ? null : join(dataDir, 'journal.db'));

    if (sqliteStorage && eventsDbPath !== null && dataDir !== null) {
      // A *second* connection to the same `events.db` the log above owns — safe: both run in WAL
      // mode, which permits multiple concurrently open handles on one file within a single process.
      featureConnection = openSqliteConnection({ filePath: eventsDbPath, open({ filePath }, settings) {
        featureConnection = sqliteStorage.open(filePath, settings);
        return featureConnection;
      } });
      sqlite = { connection: featureConnection, eventsDbPath, dataDir };
    }

    journal = createRunByteJournal({ eventLog: journalEventLog });
    ({ lifecycle, disposeTracing } = tracedIfConfigured(createRunLifecycle({ eventLog }), options.aiTrace));
    await lifecycle.rehydrate({});
  } catch (error) {
    await closeFailedAcquisition({ featureConnection, opened });
    throw error;
  }
  return { eventLog, journalEventLog, lifecycle, disposeTracing, journal, sqlite };
}

/**
 * Opens every kernel-owned resource and rehydrates durable run history.
 *
 * @throws If rehydration fails against a corrupt or unreadable durable history. Every handle this
 * call had already opened is closed before it rethrows, so a failed boot never leaks a sqlite file
 * handle — the invariant the standalone daemon has always maintained.
 */
export async function createJiniKernelBase(options: CreateJiniKernelBaseOptions): Promise<JiniKernelBase> {
  const { eventLog, journalEventLog, lifecycle, disposeTracing, journal, sqlite } = await openKernelStorage({ options });

  const agentRuntime = createKernelAgentRuntime({ options });
  // The preset is a Node host: it binds the Node implementations unless the caller supplies its own.
  const { runtime = nodeAgentExecutorRuntime({ hostEnv: agentRuntime.hostEnv }), runtimeState: _state, codexDisablePlugins: _codex, piGracefulShutdownMs: _pi, bindAgentRuntime = bindNativeAgentRuntime, ...executorOptions } = options.agentExecutor ?? {};
  const agentExecutor = createAgentExecutor({ lifecycle, runtime, hostEnv: agentRuntime.hostEnv, agentRuntime: bindAgentRuntime({ runtime: agentRuntime }) }, {
    ...executorOptions,
    journal,
    classifyFailure: classifyRunFailureForRetry,
  });

  const registry = createToolRegistry({});
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
    agentRuntime,
    registry,
    toolExecutor,
    sqlite,
    close(): Promise<void> {
      closed ??= (async () => {
        try { await agentRuntime.dispose({}); } finally {
          // After the runtime stops its runs (their traces finish with real outcomes); releases the
          // traces and terminal waits still open so a retained kernel keeps none of them. Never throws.
          disposeTracing();
          try { sqlite?.connection.close(); } finally {
            await Promise.all([eventLog.close?.({}), journalEventLog.close?.({})]);
          }
        }
      })();
      return closed;
    },
  };
}
