import type { ResolvedFederatedConnection } from "./config.js";
import { withPresetOrigin, type AttachFederatedToolsResult } from "./bootstrap.js";
import type { FederationReloadResult } from "./reload.js";
import { buildFederatedRefusalPrefix } from "./refusal-notice.js";
import type { FederationRefusalMessages } from "./messages.js";

/**
 * @file One federation runtime per process, shared by every host root that federates (a daemon, a
 * BYOK turn loop). Boot and reload own one accounting state: `start()` seeds it, `reload()` extends
 * it, and `reports()`/`refusalPrefix()` read it live. Separate state for these views would allow drift.
 *
 * Architectural role:
 * Composition. No I/O of its own — every I/O call (`boot`, `resolveConnections`, the reload
 * coordinator, preset resolution) is a parameter, so this file is importable and testable without
 * booting a real process, matching `bootstrap.ts` and `reload.ts`'s own posture. The host binds its
 * registry, approval deps, preset registry and messages into those closures.
 */

/** Where the admission report goes. Injected so tests assert on it instead of scraping stdout, and
 * so a future structured logger is a parameter change rather than an edit. */
export interface FederationHostLogger {
  info(required: { message: string }, optional?: { error?: unknown }): void;
  warn(required: { message: string }, optional?: { error?: unknown }): void;
}

type RuntimeReports = AttachFederatedToolsResult["reports"];
type RuntimeConnectFailures = AttachFederatedToolsResult["connectFailures"];

/** The host's reload coordinator, already bound to its registry/deps/attach — usually
 * `createFederationReloadCoordinator` from `reload.ts` wrapped by the host's own adapter. */
export interface FederationRuntimeReloader {
  reload(): Promise<FederationReloadResult>;
}

/** Host-bound I/O the runtime drives. */
export interface CreateFederationRuntimeRequired {
  /** Reads the operator-editable roster fresh. Called once at boot and once per actual reload pass,
   *  never once per `reload()` caller — see `reload.ts`'s own coalescing doc. */
  readonly resolveConnections: () => Promise<readonly ResolvedFederatedConnection[]>;
  /** The boot pass: the host's attach bound to its registry, deps and preset registry. Presets are
   *  the host's concern here; the runtime only hands over the roster as `extraConnections`. */
  readonly boot: (args: { extraConnections: readonly ResolvedFederatedConnection[]; logger: FederationHostLogger }) => Promise<AttachFederatedToolsResult>;
  /** Re-resolves the preset registry for each reload pass. */
  readonly resolvePresetConnections: (args: { logger: FederationHostLogger }) => readonly ResolvedFederatedConnection[];
  /** Builds the reload coordinator once the boot pass has seeded the accounting. */
  readonly createReloadCoordinator: (args: {
    resolveConnections: () => Promise<readonly ResolvedFederatedConnection[]>;
    logger: FederationHostLogger;
    initiallyAdmitted: readonly string[];
    initiallyAwaitingGrants: readonly string[];
  }) => FederationRuntimeReloader;
  /** Refusal-prefix copy for {@link FederationRuntime.refusalPrefix}. */
  readonly messages: FederationRefusalMessages;
  /** The host's log sink for boot/reload lines (a host typically prefixes them per process). */
  readonly logger: FederationHostLogger;
}

export interface CreateFederationRuntimeOptions {
  /**
   * Resolved before `start()`'s own boot pass ever calls `boot` — e.g. an installed-extension
   * registration promise, so a federated id can never win a registration race against an
   * installed-extension id for the same slot. Defaults to an already-resolved promise.
   */
  readonly after?: Promise<void>;
  /** Called once per reload pass that actually admitted something new — never for a no-op reload.
   *  A daemon rebinds its live tool catalog here; a BYOK loop rebuilds its search index. */
  readonly onAdmitted?: (result: FederationReloadResult) => void;
  /** Refresh installed guidance on the same operator-triggered path; true invalidates discovery. */
  readonly beforeReload?: () => Promise<boolean>;
}

export interface FederationRuntime {
  /** The boot pass: presets plus the roster `resolveConnections` returns. Single-flight and
   *  idempotent — calling it any number of times performs the boot pass exactly once and every call
   *  shares that one result. Never rejects: attach absorbs per-connection failures, and this
   *  runtime catches failures from `after` and `resolveConnections` so callers can await boot
   *  unconditionally and `started` reaches its terminal state. */
  start(): Promise<void>;
  /** Re-admits every roster connection not yet admitted. Resolves `{newlyAdmittedConnectionIds: [],
   *  reports: []}` with no roster read at all if `start()` was never called — there is nothing yet to
   *  extend. Installed guidance can refresh independently before a lazy federation boot.
   *  If a `start()` is in flight, waits for it first, so a reload can never run against a
   *  boot pass's stale pre-seed state. */
  reload(): Promise<FederationReloadResult>;
  /** A live read of the merged boot-plus-every-reload admission accounting. */
  reports(): RuntimeReports;
  /** A live read of the merged boot-plus-every-reload CONNECT failures — one entry per
   *  connection that never reached admission at all (bad spawn, timed-out handshake, malformed
   *  listing), so it has no entry in `reports()` either. Same shape and same merge discipline as
   *  `reports()`. */
  connectFailures(): RuntimeConnectFailures;
  /** The refusal-prefix text for `reports()`, cached and recomputed only when `reports()` changes —
   *  `""` when there is nothing to report. */
  refusalPrefix(): string;
  /** Whether the boot pass has completed — successfully or not; see `start()`'s own doc. */
  readonly started: boolean;
  /**
   * The boot roster's connection ids — `undefined` until `resolveConnections()` resolves
   * (the roster itself is not known yet), then fixed for the rest of boot. Lets a caller building a
   * federation boot status tell "a real, pending roster connection" apart from "never configured at
   * all" while `!started`, without waiting for the whole boot pass — `undefined` and `[]` are
   * different claims.
   */
  configuredConnectionIds(): readonly string[] | undefined;
}

type Bound = { required: CreateFederationRuntimeRequired; options: CreateFederationRuntimeOptions; logger: FederationHostLogger };

/** Roster connections that were admitted with an empty grant: the reload coordinator must not
 * re-handshake them until the owner's grants change.
 * @complexity O(c + r) in boot connections and reports.
 */
export function selectAwaitingGrantConnectionIds({ connections, reports }: { connections: readonly ResolvedFederatedConnection[]; reports: RuntimeReports }, _optional = {}): string[] {
  const emptyGrantIds = new Set(connections.filter(connection => connection.config.allowedToolNames.length === 0).map(connection => connection.config.connectionId));
  return reports.filter(entry => !entry.isPreset && entry.report.admitted.length === 0 && emptyGrantIds.has(entry.connectionId))
    .map(entry => entry.connectionId);
}

function buildRuntimeReloadCoordinator({ required, logger }: Bound, { connections, mergedReports }: { connections: readonly ResolvedFederatedConnection[]; mergedReports: RuntimeReports }): FederationRuntimeReloader {
  return required.createReloadCoordinator({
    // Presets can arrive after a failed desktop listener bind. The existing coordinator
    // retries only unadmitted identities and still freezes every successfully admitted tool.
    resolveConnections: async () => [
      ...required.resolvePresetConnections({ logger }).map(connection => withPresetOrigin({ connection })),
      ...await required.resolveConnections(),
    ],
    logger,
    initiallyAdmitted: mergedReports.map((entry) => entry.connectionId),
    initiallyAwaitingGrants: selectAwaitingGrantConnectionIds({ connections, reports: mergedReports }),
  });
}

/** A reload's own connect failures are merged unconditionally, even when nothing was newly
 * admitted — a reload that only ever fails a connection must still make that failure visible. Every
 * connection this pass attempted (admitted or failed) first drops its older entry: a now-admitted
 * one must leave the list (the admissions wire documents `connections`/`configFailures` as
 * disjoint), and a repeat failure replaces rather than piling up one entry per reload.
 * @complexity O(f + a) in prior failures and this pass's attempts.
 */
export function mergeReloadConnectFailures({ previous, result }: { previous: RuntimeConnectFailures; result: FederationReloadResult }, _optional = {}): RuntimeConnectFailures {
  const attemptedIds = new Set([...result.newlyAdmittedConnectionIds, ...result.connectFailures.map((entry) => entry.connectionId)]);
  if (attemptedIds.size === 0) return previous;
  return [...previous.filter((entry) => !attemptedIds.has(entry.connectionId)), ...result.connectFailures];
}

function createFederationAccounting(bound: Bound, getStartPromise: () => Promise<void> | undefined) {
  let mergedReports: RuntimeReports = [];
  let mergedConnectFailures: RuntimeConnectFailures = [];
  let cachedPrefix = "";
  let startedFlag = false;
  let coordinator: FederationRuntimeReloader | undefined;
  let configuredConnectionIds: readonly string[] | undefined;

  function recomputePrefix(): void {
    cachedPrefix = buildFederatedRefusalPrefix({ snapshot: mergedReports, messages: bound.required.messages });
  }

  async function reload(): Promise<FederationReloadResult> {
    // Federation remains lazy before the first BYOK turn; installed guidance still needs the
    // operator's reload now. An in-flight boot must finish before refreshing either catalog.
    const startPromise = getStartPromise();
    if (startPromise) await startPromise;

    const installedChanged = await bound.options.beforeReload?.() ?? false;
    const result: FederationReloadResult = coordinator ? await coordinator.reload()
      : { newlyAdmittedConnectionIds: [], reports: [], connectFailures: [] };
    // Does not touch `cachedPrefix`: `buildFederatedRefusalPrefix` is a pure function of
    // `mergedReports` alone, and a connect failure never produces a report entry to feed it.
    mergedConnectFailures = mergeReloadConnectFailures({ previous: mergedConnectFailures, result });
    if (result.newlyAdmittedConnectionIds.length === 0 && !installedChanged) return result;

    const refreshedIds = new Set(result.reports.map(entry => entry.connectionId));
    mergedReports = [...mergedReports.filter(entry => !refreshedIds.has(entry.connectionId)), ...result.reports];
    recomputePrefix();
    bound.options.onAdmitted?.(result);
    return result;
  }
  function seed(attached: AttachFederatedToolsResult, connections: readonly ResolvedFederatedConnection[]): void {
    mergedReports = attached.reports;
    mergedConnectFailures = attached.connectFailures;
    recomputePrefix();
    coordinator = buildRuntimeReloadCoordinator(bound, { connections, mergedReports });
  }
  return { reload, seed, configure: (ids: readonly string[]) => { configuredConnectionIds = ids; }, complete: () => { startedFlag = true; },
    reports: () => mergedReports, connectFailures: () => mergedConnectFailures, refusalPrefix: () => cachedPrefix,
    configuredConnectionIds: () => configuredConnectionIds, get started() { return startedFlag; } };
}

/**
 * Builds one process's federation runtime. Nothing here performs I/O until `start()` or `reload()` is
 * called — constructing this is free, which is what lets a host build it unconditionally and leave
 * starting it to whichever root decides when.
 *
 * @complexity O(1) to construct; `start()`/`reload()` inherit their cost from the injected `boot`
 * and reload coordinator.
 */
export function createFederationRuntime(required: CreateFederationRuntimeRequired, options: CreateFederationRuntimeOptions = {}): FederationRuntime {
  const { logger } = required;
  let startPromise: Promise<void> | undefined;
  const accounting = createFederationAccounting({ required, options, logger }, () => startPromise);

  async function runStart(): Promise<void> {
    // Catch prerequisites as well as attachment: a failed roster read must complete boot's
    // lifecycle so later calls are diagnosed as failed rather than "still connecting" forever.
    // Optional federation failures cannot disable the native assistant.
    try {
      await (options.after ?? Promise.resolve());
      const connections = await required.resolveConnections();
      accounting.configure(connections.map((connection) => connection.config.connectionId));
      const attached = await required.boot({ extraConnections: connections, logger });
      accounting.seed(attached, connections);
    } catch (error) {
      logger.warn({ message: `mcp-federation: boot pass failed, continuing without federated tools — ${messageOf({ error })}` });
    } finally {
      accounting.complete();
    }
  }

  function start(): Promise<void> {
    if (!startPromise) startPromise = runStart();
    return startPromise;
  }

  return { start, reload: accounting.reload, reports: accounting.reports, connectFailures: accounting.connectFailures,
    refusalPrefix: accounting.refusalPrefix, configuredConnectionIds: accounting.configuredConnectionIds,
    get started() { return accounting.started; } };
}

/** Local copy of `bootstrap.ts`'s private helper of the same name — a one-line reduction, not a
 *  policy this module needs to stay byte-identical with. */
function messageOf({ error }: { error: unknown }, _optional = {}): string {
  return error instanceof Error ? error.message : String(error);
}
