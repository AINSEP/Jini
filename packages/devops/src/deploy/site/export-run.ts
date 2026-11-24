import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { ExportRunCounts, ExportRunSnapshot, ExportRunStatus } from "@jini-ai/core/contracts/site/export-run";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nowIso, type Clock } from "@jini-ai/core/primitives";
import { firstExportFailure } from "@jini-ai/devops/static-export/failure-summary";
/**
 * @file The static-site export run's single-flight state, owned by an instance from
 * {@link createExportRunner} so a SECOND caller — the `deployment_trigger_export`/
 * `deployment_get_export_status` agent tools and the read-only `deployment_diagnose_static_export`
 * (which reserves the same slot for a disposable export) — can trigger and poll the exact same run
 * the host's admin export route already does, instead of reimplementing it against a second,
 * independent run slot. The host creates ONE runner per process and hands that same instance to
 * every caller; two runners never share a slot.
 *
 * THIS FILE NEVER IMPORTS THE EXPORT ENGINE (the real `exportSite`/`ExportReport`). An earlier host
 * version imported the engine directly, and the engine at the time imported the host's app factory
 * whose module body booted the whole app (including the agent tool catalog) as a side effect of
 * merely loading it — closing a real cycle back into the still-loading tool-registration module and
 * throwing `ReferenceError: Cannot access ... before initialization` under `node --test`. Both
 * halves of that cycle are gone in the host now, but the injection below stays: it keeps the
 * deployments feature from depending on the export engine's whole graph at all.
 *
 * The fix is dependency injection instead of an import: `startExportRun` takes the actual export
 * engine as a parameter (typed structurally via {@link ExportEngine}, never by naming the engine's
 * own option/report types), and the host binds the real engine exactly once in its composition
 * root — the only place safe to import it. Every caller of `startExportRun` passes that bound
 * engine straight through.
 *
 * DISCLOSED CROSS-PROCESS GAP: a runner's slot is plain in-memory state, so it is
 * single-flight-correct only WITHIN one OS process. A host that serves its admin HTTP routes and a
 * standalone agent daemon as separate OS processes creates one runner in each — there is no
 * cross-process lock. A human clicking "Export" in the admin UI at the same moment an agent (running
 * through the daemon) calls `deployment_trigger_export` could therefore both observe "not running"
 * and both start writing into the same `outputDir` concurrently. Closing it for real needs either a
 * cross-process lock (e.g. a lockfile under `outputDir`) or routing the daemon's trigger back over
 * HTTP to the main process. An in-process agent surface that composes the SAME tool catalog inside
 * the main server shares the one runner with the HTTP route, so single-flight holds there.
 */

export type { ExportRunCounts, ExportRunSnapshot, ExportRunStatus };

/**
 * A structural mirror of the export engine's report — only the fields
 * `summarizeCompletedReport` actually reads. Declared locally, never imported, per this file's
 * header. The real report satisfies this structurally (it has every field below, with compatible
 * types), so passing the real engine as an {@link ExportEngine} type-checks with no cast at the one
 * place the host actually binds it.
 */
export interface ExportRunReportLike {
  routes: { succeeded: unknown[]; failed: { path: string; kind: string; reason: string }[] };
  assets: { succeeded: unknown[]; failed: { url: string; reason: string }[] };
  skippedManifestEntries: { reason: string; detail: string }[];
  unreferencedThemeFiles: string[];
  /** Bounded by the export engine to at most 200 entries. */
  droppedReferences: { page: string; url: string; attribute: string; reason: "not-exported" | "needs-server" }[];
  basePath?: string;
  basePathRewriteWarning?: string;
}

/**
 * The injected shape of the export engine, generic over whatever `routeDeps` type the caller
 * carries (in every real caller, the host's full route-deps object — never spelled out by name
 * here, see this file's header).
 */
export type ExportEngine<TRouteDeps> = (options: {
  routeDeps: TRouteDeps;
  outputDir: string;
  clean?: boolean;
  /** Present-but-`undefined` when the caller gave none: the key is always forwarded. */
  basePath?: string | undefined;
}, optional?: object) => Promise<ExportRunReportLike>;

/** The optional half of `startExportRun`'s arguments. */
export interface StartExportRunOptions {
  basePath?: string;
  productEvent?: { tracker: Tracker; userId: string; operationId: string; source: "admin" | "assistant" };
  onSettled?: (settled: { status: "completed" | "errored" }) => void;
}

/** One process-local export slot and the four operations that share it. */
export interface ExportRunner {
  getExportRunSnapshot(this: void): ExportRunSnapshot;
  startExportRun<TRouteDeps extends { clock: Clock; exportOutputRootDir: string }>(
    this: void,
    required: { routeDeps: TRouteDeps; runExportSite: ExportEngine<TRouteDeps>; clean: boolean },
    optional?: StartExportRunOptions,
  ): ExportRunSnapshot;
  assertExportNotRunning(this: void, _required: Record<string, never>, _optional?: Record<string, never>): void;
  diagnoseStaticExport<TRouteDeps extends { clock: Clock }>(
    this: void,
    required: { routeDeps: TRouteDeps; runExportSite: ExportEngine<TRouteDeps> },
    _optional?: Record<string, never>,
  ): Promise<ExportRunDiagnostics>;
}

/** The "completed" fields of {@link ExportRunSnapshot}, as the diagnostic returns them. */
export type ExportRunDiagnostics = Pick<
  ExportRunSnapshot,
  "basePath" | "ok" | "counts" | "failedRoutes" | "failedAssets" | "skippedManifestEntries" | "unreferencedThemeFiles" | "droppedReferences" | "basePathRewriteWarning"
>;

/** Slims a full export report down to `ExportRunSnapshot`'s "completed" fields. */
function summarizeCompletedReport(report: ExportRunReportLike): ExportRunDiagnostics {
  return {
    ...(report.basePath !== undefined ? { basePath: report.basePath } : {}),
    ok: firstExportFailure({ report }) === undefined,
    counts: {
      routesSucceeded: report.routes.succeeded.length,
      routesFailed: report.routes.failed.length,
      assetsSucceeded: report.assets.succeeded.length,
      assetsFailed: report.assets.failed.length,
    },
    failedRoutes: report.routes.failed.map((f) => ({ path: f.path, kind: f.kind, reason: f.reason })),
    failedAssets: report.assets.failed.map((f) => ({ url: f.url, reason: f.reason })),
    skippedManifestEntries: report.skippedManifestEntries,
    unreferencedThemeFiles: report.unreferencedThemeFiles,
    droppedReferences: report.droppedReferences,
    ...(report.basePathRewriteWarning !== undefined ? { basePathRewriteWarning: report.basePathRewriteWarning } : {}),
  };
}

/**
 * Creates one export slot. The host creates exactly ONE per process and shares it between its
 * admin export route and the deployments agent tools — see this file's header for which callers
 * share an instance and which (a separate daemon process) do not.
 *
 * @returns Closures over the instance's slot; safe to destructure.
 * @complexity O(1).
 */
/** Turns a failed run's caught value into the text the errored snapshot stores (host-owned wording). */
export type DescribeExportError = (required: { error: unknown }) => string;

export function createExportRunner({ describeError }: { describeError: DescribeExportError }, _optional: Record<string, never> = {}): ExportRunner {
  /** The idle snapshot this runner reports before its first run. */
  const IDLE_RUN: ExportRunSnapshot = { status: "idle", startedAtIso: null, finishedAtIso: null, outputDir: null };
  /** The instance's mutable slot — every operation below reads and writes this one value. */
  let currentRun: ExportRunSnapshot = IDLE_RUN;

  /**
   * The current/most recent export run's status, exactly as the HTTP status-poll route reports it.
   *
   * @returns `IDLE_RUN` if no run has ever started on this runner.
   * @complexity O(1).
   */
  function getExportRunSnapshot(): ExportRunSnapshot {
    return currentRun;
  }

  /**
   * Starts a new export run unconditionally and returns the "running" snapshot immediately — the
   * export itself continues in the background ("seconds to minutes").
   *
   * Caller contract: the caller must have already confirmed `getExportRunSnapshot().status !==
   * "running"` in the SAME synchronous stretch of the event loop, with no `await` in between (both
   * the admin export route's POST handler and the `deployment_trigger_export` handler do exactly
   * this) — that is what makes "one export at a time" hold even under two concurrent callers in the
   * same process. This function does not re-check, so calling it while a run is already in flight
   * would silently start a second one; it is deliberately not the guard itself.
   *
   * @param required.routeDeps - The same full composition-root deps object the injected
   * `runExportSite` needs to boot an in-process copy of the app. Opaque to this function beyond
   * `.clock.nowMs()` and `.exportOutputRootDir` — passed straight through to `runExportSite`.
   * `exportOutputRootDir` is resolved ONCE by the host's composition root (its env override, then
   * the served site's export folder) — this function never reads `process.env` itself, and a test
   * overrides the directory by setting this field on the fake `routeDeps` it constructs, not by
   * mutating real process env vars.
   * @param required.runExportSite - The actual export engine, injected by the caller — see this
   * file's header for why it is never imported here directly.
   * @param required.clean - Forwarded to `runExportSite`; wipes `outputDir` first when `true`.
   * @param optional.basePath - Forwarded to `runExportSite`; see the engine's own `basePath` doc.
   * @param optional.onSettled - Told the run's final status once it settles (the route's product event).
   * @returns The new "running" snapshot (not a promise — the export's own completion is observed
   * later via `getExportRunSnapshot`).
   * @complexity O(1) synchronously; the awaited export itself is O(routes + assets) over HTTP, per
   * the engine's own complexity note.
   */
  function startExportRun<TRouteDeps extends { clock: Clock; exportOutputRootDir: string }>(
    required: { routeDeps: TRouteDeps; runExportSite: ExportEngine<TRouteDeps>; clean: boolean },
    optional?: StartExportRunOptions,
  ): ExportRunSnapshot {
    const { routeDeps, runExportSite, clean } = required;
    const outputDir = routeDeps.exportOutputRootDir;
    const startedAtIso = nowIso({ clock: routeDeps.clock });
    currentRun = { status: "running", startedAtIso, finishedAtIso: null, outputDir };

    // Deliberately not awaited — the caller (an HTTP route or a tool handler) returns the "running"
    // snapshot immediately; a later poll observes the outcome via getExportRunSnapshot(). Both
    // branches always update currentRun, so a poller can never observe a stale "running" snapshot
    // after the promise has actually settled.
    void runExportSite({ routeDeps, outputDir, clean, basePath: optional?.basePath })
      .then((report) => {
        currentRun = {
          status: "completed",
          startedAtIso,
          finishedAtIso: nowIso({ clock: routeDeps.clock }),
          outputDir,
          ...summarizeCompletedReport(report),
        };
      })
      .catch((err: unknown) => {
        currentRun = {
          status: "errored",
          startedAtIso,
          finishedAtIso: nowIso({ clock: routeDeps.clock }),
          outputDir,
          error: describeError({ error: err }),
        };
      })
      .finally(() => {
        const status = currentRun.status === "completed" ? "completed" : "errored";
        const event = optional?.productEvent;
        void event?.tracker.capture({ name: "site_exported", userId: event.userId }, { properties: { outcome: status, operationId: event.operationId, eventId: `export:${event.operationId}`, source: event.source } });
        optional?.onSettled?.({ status });
      });

    return currentRun;
  }

  /** Refuse a concurrent trigger or diagnostic using this runner's export state. */
  function assertExportNotRunning(_r: Record<string, never>, _o: Record<string, never> = {}): void {
    if (currentRun.status === "running") {
      throw Object.assign(new Error("an export is already running — call deployment_get_export_status to see its progress, this will not resolve on retry"), { code: "ALREADY_RUNNING" });
    }
  }

  /** Run the injected engine in disposable storage and return only report diagnostics.
   * Reserves currentRun before the first await; restores the previous status after cleanup.
   * Engine/storage errors propagate, and the slot is released even if cleanup fails.
   * @complexity One export pass plus removal of its temporary output files.
   */
  async function diagnoseStaticExport<TRouteDeps extends { clock: Clock }>(
    required: { routeDeps: TRouteDeps; runExportSite: ExportEngine<TRouteDeps> },
    _o: Record<string, never> = {},
  ): Promise<ExportRunDiagnostics> {
    assertExportNotRunning({});
    const previous = currentRun;
    currentRun = { status: "running", startedAtIso: nowIso({ clock: required.routeDeps.clock }), finishedAtIso: null, outputDir: null };
    let outputDir: string | undefined;
    try {
      outputDir = await mkdtemp(path.join(tmpdir(), "static-export-diagnostics-"));
      currentRun = { ...currentRun, outputDir };
      const report = await required.runExportSite({ routeDeps: required.routeDeps, outputDir, clean: false });
      return summarizeCompletedReport(report);
    } finally {
      try { if (outputDir !== undefined) await rm(outputDir, { recursive: true, force: true }); }
      finally { currentRun = previous; }
    }
  }

  return { getExportRunSnapshot, startExportRun, assertExportNotRunning, diagnoseStaticExport };
}
