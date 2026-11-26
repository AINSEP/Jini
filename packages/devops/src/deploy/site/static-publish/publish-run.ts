import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import type { PublishJobSnapshot, DeployPublishProgress } from "@jini-ai/devops/deploy";
import { publishStaticSite, type StaticPublishDeps, type StaticPublishInput } from "./adapter.js";
import type { PublishHistoryEntry, PublishHistoryStore, PublishTrigger } from "./publish-history.js";
import { publicPublishConfigFields } from "./publish-history.js";
import type { StaticPublishOutcome, StaticPublishTargetId } from "@jini-ai/devops/deploy/site/static-publish/types";

/**
 * @file This sub-feature's process-local single-flight state for a real publish, extracted out of
 * `server/routes/admin/system/publish-site.ts` (2026-08-16, Terra audit finding #1) so a SECOND
 * caller — `deployment_execute_static_publish` (`publish-agent-tools.ts`, the assistant's
 * MCP-UI-confirmed publish tool) — can share the exact same guard the admin route's own trigger
 * already enforced, instead of calling {@link publishStaticSite} directly with no tracking at all.
 *
 * Before this file existed, `publish-site.ts` held its own PRIVATE `currentRun` module variable and
 * checked it before every trigger; `publish-agent-tools.ts` had no equivalent slot to check at all
 * (not merely a bug in its own guard — there was structurally nothing for it to check, since the
 * state lived un-exported in a `src/server/**` file this domain must never import from — see this
 * module's placement note below). Two publishes to the same or even different targets both run a
 * fresh `clean` export into a shared per-target output directory (`adapter.ts`'s `publishOutputDir`);
 * a human clicking "Publish" in the admin UI at the same moment an agent's confirmed
 * `deployment_execute_static_publish` call reached its own `publishStaticSite` invocation could
 * clean and rewrite the same directory out from under each other. This became reachable the day
 * `deployment_execute_static_publish` went from unwired to a real, agent-callable tool.
 *
 * Lives in `static-publish/`, not this domain's sibling `features/deployments/export-run.ts` — a
 * DIFFERENT sub-feature (this file's own imports are `static-publish/adapter.ts`'s `publishStaticSite`
 * only, never `#src/features/site-export/index`), but the SAME reasoning `export-run.ts`'s header gives for its own
 * placement applies here too: `apps/website/src/server/inbound/admin-http/routes/system/publish-site.ts` (a `src/server/**` file)
 * is free to import FROM this domain, but `publish-agent-tools.ts`'s own `tool-registrations.ts`-style
 * rule (see `deployments/tool-registrations.ts`'s file header) forbids the reverse — a domain's
 * tool-wiring file must never import from `src/server/**`. Putting the shared slot here, not there,
 * is what lets both callers import ONE real module without either one crossing that back-edge.
 *
 * DISCLOSED CROSS-PROCESS GAP, same shape `export-run.ts`'s own header already discloses for its own
 * `currentRun`: this module's publish-job store is process-local, single-flight-correct only
 * WITHIN one OS process. Tovu's admin HTTP server and the standalone agent daemon
 * (`assistant/agent-daemon-server.ts`) each load their own independent copy of this module — there is
 * no cross-process lock, and this file does not attempt to add one (that is a design change, e.g. a
 * lockfile under the publish output directory or routing the daemon's call back over HTTP to the main
 * process — out of scope for this fix, which closes the WITHIN-process gap only). The in-process BYOK
 * execution mode (`apps/website/src/server/runtime/composition/modules/assistant-byok.ts`, composing the same tool catalog inside the main
 * server process) shares this exact module instance with the admin HTTP route, so single-flight holds
 * there — which is the concrete scenario this fix closes (a human using the admin UI's Static Site tab
 * and the assistant dock in the SAME running server, at the same time).
 *
 * ## Publish history (2026-08-16, Defect 2; reworked same day into an append-only DB table)
 *
 * The SAME reason this module exists in the first place — one shared slot both `publish-site.ts`'s
 * HTTP trigger route and `deployment_execute_static_publish` settle through — is why publish HISTORY
 * is also recorded here rather than in either caller: recording it once, at the one place both routes
 * already converge, means neither call site needs to change to gain it. `settleWithOutcome`/
 * `settleWithError` above are this module's PRE-EXISTING job (the single-flight snapshot); recording
 * history is a separate, additional side effect performed alongside them, not folded into them, so a
 * reader auditing "what does settling a run do to the shared snapshot" is not also reading unrelated
 * persistence code. See `./publish-history.ts`'s own header for the storage design (an append-only
 * `publish_history` table, `src/platform/db/schema.sqlite.ts`; migration `0043`).
 *
 * `historyStore` is a REQUIRED parameter on {@link startPublishRun} — deliberately no module-level default the way this file's original
 * (file-backed) design had one. A DB-backed store needs a live `ContentDb` handle to construct, and
 * only the composition root (`apps/website/src/server/runtime/composition/deps.ts`/`apps/website/src/server/runtime/composition/app.ts`) has one; a module-level singleton
 * constructed at import time cannot get one without either module-load-time I/O (this module's own
 * prior header explicitly avoided that) or a global mutable setter (a worse shape than just requiring
 * the argument). Both real callers thread it from `RouteDeps.publishHistoryStore` — `publish-site.ts`
 * passes `deps.publishHistoryStore` straight through; `publish-agent-tools.ts`'s
 * `StaticPublishToolDeps` does the same, with its own `historyStore` field staying a TEST-ONLY
 * override on top (see that file's own doc). Every test in `publish-run.unit.test.ts` already passes
 * an explicit `InMemoryPublishHistoryStore`, so this change needed no test-signature updates.
 *
 * `toHistoryEntry` below also decides `triggeredBy` (`'admin_ui'` vs `'agent_tool'`) — not a
 * caller-supplied field, but a trigger bound by each caller of {@link startPublishRun}
 * when it calls {@link recordHistoryIfPublished}, since which function ran IS the answer
 * (see `publish-history.ts`'s own `PublishTrigger` doc).
 */

export type PublishRunStatus = "idle" | "running" | "completed" | "errored";

export interface PublishRunSnapshot {
  readonly jobId?: string;
  readonly requestId?: string;
  readonly progress?: DeployPublishProgress;
  status: PublishRunStatus;
  startedAtIso: string | null;
  finishedAtIso: string | null;
  target: StaticPublishTargetId | null;
  /** Present only once `status` is `"completed"` or `"errored"` AND the run reached a real outcome
   *  (an unexpected throw out of `publishStaticSite` populates `error` instead). */
  result?: StaticPublishOutcome;
  /** Populated only when the run settled via an unexpected throw rather than a normal
   *  `StaticPublishOutcome` — a message, never the raw error object, same boundary
   *  `export-run.ts`'s own `error` field crosses. */
  error?: string;
}

const IDLE_RUN: PublishRunSnapshot = { status: "idle", startedAtIso: null, finishedAtIso: null, target: null };

/** Process-local job store — see this file's header for exactly which callers share ONE instance
 *  of it and which do not. */


/**
 * Maps a settled `outcome` into the durable record this run's publish produced — `undefined` when
 * nothing was actually published (`outcome.ok === false`; see {@link PublishHistoryEntry}'s own doc
 * on why a failure is never recorded at all, not recorded-as-failed). `owner`/`repo`/`branch`/
 * `commitSha` are the HOST's own facts, read off `outcome.providerMetadata` (whatever the target
 * module reports, string values only) — never off `input.config`, and never by naming a target here.
 * `deploymentId` is always carried through when the outcome has one.
 *
 * @complexity O(1) — fixed-shape field mapping, no iteration.
 */
function toHistoryEntry(
  { input, outcome, clock, triggeredBy }: {
    input: StaticPublishInput;
    outcome: StaticPublishOutcome;
    clock: { nowIso(): string };
    triggeredBy: PublishTrigger;
  },
  _options = {},
): PublishHistoryEntry | undefined {
  if (!outcome.ok) return undefined;
  const meta = outcome.providerMetadata ?? {};
  return {
    target: outcome.targetId,
    url: outcome.url,
    reachable: outcome.ok === true,
    status: outcome.status,
    projectName: input.projectName,
    publishedAt: clock.nowIso(),
    triggeredBy,
    ...stringField(meta, "owner"),
    ...stringField(meta, "repo"),
    ...stringField(meta, "branch"),
    ...stringField(meta, "commitSha"),
    ...(outcome.basePath !== undefined ? { basePath: outcome.basePath } : {}),
    ...(outcome.deploymentId !== undefined ? { deploymentId: outcome.deploymentId } : {}),
  };
}

/** `{ [key]: value }` when `meta[key]` is a string, else `{}` — host metadata is untyped data. */
function stringField<K extends string>(meta: Readonly<Record<string, unknown>>, key: K): { [P in K]?: string } {
  const value = meta[key];
  return (typeof value === "string" ? { [key]: value } : {}) as { [P in K]?: string };
}

/**
 * Records a settled outcome's history, if it produced one — best-effort, never throws and never
 * changes what the caller reports. A failed history write (a DB error, a full disk) must not turn an
 * otherwise-successful publish into a reported failure: the caller already has the TRUE outcome from
 * {@link publishStaticSite} and returns it regardless: losing "where did we last publish" is a
 * strictly smaller problem than a hard error on this genuinely non-essential bookkeeping step layered
 * on top of a publish that already succeeded.
 *
 * @complexity One registry load, O(f*c) public-field filtering, one history insert.
 */
async function recordHistoryIfPublished(
  { deps, historyStore, input, outcome, clock, triggeredBy }: {
    deps: StaticPublishDeps;
    historyStore: PublishHistoryStore;
    input: StaticPublishInput;
    outcome: StaticPublishOutcome;
    clock: { nowIso(): string };
    triggeredBy: PublishTrigger;
  },
  _options = {},
): Promise<void> {
  const entry = toHistoryEntry({ input, outcome, clock, triggeredBy });
  if (entry === undefined || !outcome.ok) return;
  const credentialId = outcome.credentialId ?? input.credentialId;
  try {
    // Reuse the descriptor contract, never copy raw config or the resolved credential into history.
    // A registry reload failure must not erase the pre-existing outcome-only history behavior.
    const registry = await deps.loadDeployTargets({ workspaceId: input.workspaceId }).catch(() => {
      // Loader errors may embed plugin config or credentials; log only the failed operation.
      deps.warn("[static-publish] destination registry reload failed; recording outcome only");
      return undefined;
    });
    const target = registry?.get(input.config.target);
    await historyStore.recordSuccess({ workspaceId: input.workspaceId, entry: {
      ...entry,
      ...(credentialId !== undefined ? { credentialId } : {}),
      ...(target !== undefined ? { configFields: publicPublishConfigFields({ descriptor: target.descriptor, config: {
        ...input.config, ...target.module.destinationConfig?.({ providerMetadata: outcome.providerMetadata }),
      } }) } : {}),
    } });
  } catch (error) {
    // Keep the true publish result; database errors can embed secret parameters.
    deps.warn("[static-publish] destination history write failed after publish", describeErrorForLog({ err: error }));
  }
}

/**
 * The current/most recent publish run's status, exactly as both callers report it (the HTTP status
 * poll route, and — indirectly, via a thrown/returned refusal — the agent tool).
 *
 * @returns `IDLE_RUN` if no run has ever started in this process.
 * @complexity O(1).
 */
export function getPublishRunSnapshot(deps: Pick<StaticPublishDeps, "publishJobs">, _optional = {}): PublishRunSnapshot {
  return deps.publishJobs.latest() ?? IDLE_RUN;
}

/** Capture one accepted/settled publish at the shared run owner. No provider payload leaves here.
 * @complexity O(1) time and space per run. */
function publishEvent(required: { deps: StaticPublishDeps; input: StaticPublishInput; operationId: string; outcome?: "completed" | "errored" }, _optional = {}): void {
  const { deps, input, operationId, outcome } = required;
  if (!input.productEvent) return;
  void deps.tracker?.capture({ name: outcome ? "deploy_finished" : "site_publish_started", userId: input.productEvent.userId }, { properties: { operationId, eventId: `publish:${operationId}:${outcome ?? "started"}`, target: input.config.target, source: input.productEvent.source, ...(outcome ? { outcome } : {}) } });
}

/** Scoped job lookup for transport adapters; permission checks belong to the caller.
 * No export bytes, credentials or raw provider error objects enter a snapshot.
 * @complexity O(1) by ID; O(20) for the site's latest retained job.
 */
export function getPublishJobSnapshot({ deps, workspaceId, jobId, requestId }: { deps: Pick<StaticPublishDeps, "publishJobs">; workspaceId: string; jobId?: string; requestId?: string }, _options = {}): PublishJobSnapshot<StaticPublishOutcome> | undefined {
  return deps.publishJobs.get({ scopeId: workspaceId, ...(jobId !== undefined ? { jobId } : {}), ...(requestId !== undefined ? { requestId } : {}) });
}

function beginRun({ deps, input, clock, jobId }: { deps: StaticPublishDeps; input: StaticPublishInput; clock: { nowIso(): string }; jobId: string }, _options = {}): void {
  deps.publishJobs.begin({ jobId, ...(input.requestId ? { requestId: input.requestId } : {}), scopeId: input.workspaceId, target: input.config.target, startedAtIso: clock.nowIso() });
}

function settleWithOutcome({ deps, jobId, outcome, clock }: { deps: StaticPublishDeps; jobId: string; outcome: StaticPublishOutcome; clock: { nowIso(): string } }, _options = {}): void {
  if (outcome.ok) deps.publishJobs.progress({ jobId, progress: { url: outcome.url,
    ...(outcome.deploymentId ? { deploymentCreated: true, deploymentId: outcome.deploymentId } : {}) } });
  deps.publishJobs.settle({ jobId, status: outcome.ok ? "completed" : "errored", finishedAtIso: clock.nowIso(), result: outcome });
}

function settleWithError({ deps, jobId, err, clock }: { deps: StaticPublishDeps; jobId: string; err: unknown; clock: { nowIso(): string } }, _options = {}): void {
  // Unexpected exceptions can embed credentials. Provider errors use the adapter's safe outcome.
  deps.publishJobs.settle({ jobId, status: "errored", finishedAtIso: clock.nowIso(), error: deps.redactSecretShapes({ text: err instanceof Error ? err.message : String(err) }).text });
}

/** Bind provider progress to this job, independently of the initiating tool's signal. */
function jobInput({ deps, input, jobId }: { deps: StaticPublishDeps; input: StaticPublishInput; jobId: string }, _options = {}): StaticPublishInput {
  return { ...input, onProgress: ({ progress }, _options = {}) => deps.publishJobs.progress({ jobId, progress }) };
}

/**
 * Starts a new publish run unconditionally and returns the "running" snapshot immediately — the
 * publish itself continues in the background. Used by `publish-site.ts`'s HTTP trigger route, which
 * returns `202` and lets the caller poll {@link getPublishRunSnapshot} for the outcome (same
 * fire-and-forget shape as `export-run.ts`'s `startExportRun`, which this mirrors).
 *
 * Caller contract: the caller must have already confirmed `getPublishRunSnapshot().status !==
 * "running"` in the SAME synchronous stretch of the event loop, with no `await` in between. The
 * shared Jini store also refuses a second running job, so a missed caller guard fails closed rather
 * than starting concurrent exports. This preserves the caller contract (`startExportRun`'s own
 * doc, restated here rather than merely cross-referenced since violating it is exactly the bug this
 * whole file exists to close).
 *
 * @param required.historyStore - See this file's header ("Publish history") — REQUIRED, no module-level
 *   default; real callers pass `RouteDeps.publishHistoryStore`, tests pass an
 *   `InMemoryPublishHistoryStore`.
 * @param optional.onSettled - Told the run's final status once it settles (the route's product event).
 * @complexity O(1) synchronously; the awaited publish itself is bounded by `publishStaticSite`'s own
 *   complexity note (one export pass plus one provider's fixed poll budget).
 */
export function startPublishRun(
  { deps, input, clock, historyStore }: {
    deps: StaticPublishDeps;
    input: StaticPublishInput;
    clock: { nowIso(): string };
    historyStore: PublishHistoryStore;
  },
  optional: {
    onSettled?: (settled: { status: "completed" | "errored" }) => void;
    triggeredBy?: PublishTrigger;
  } = {},
): PublishRunSnapshot {
  const operationId = input.idGen.newId();
  beginRun({ deps, input, clock, jobId: operationId });
  publishEvent({ deps, input, operationId });

  void publishStaticSite(deps, jobInput({ deps, input, jobId: operationId }))
    .then(async (outcome) => {
      // Record first: callers that refresh destinations once the snapshot completes must see this run.
      await recordHistoryIfPublished({ deps, historyStore, input, outcome, clock, triggeredBy: optional.triggeredBy ?? "admin_ui" });
      settleWithOutcome({ deps, jobId: operationId, outcome, clock });
    })
    .catch((err: unknown) => settleWithError({ deps, jobId: operationId, err, clock }))
    .finally(() => {
      const status = deps.publishJobs.get({ scopeId: input.workspaceId, jobId: operationId })?.status === "completed" ? "completed" : "errored";
      publishEvent({ deps, input, operationId, outcome: status });
      optional.onSettled?.({ status });
    });

  return getPublishRunSnapshot(deps);
}
