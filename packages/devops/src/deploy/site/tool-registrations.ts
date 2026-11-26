import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import { toolMetadata } from '@jini-ai/core/tool-metadata/deployments';
import { type Clock } from "@jini-ai/core/primitives";
import { adaptLegacyAuthorize } from "@jini-ai/core";
import { buildDomainRegistrations, indexCatalogById, isRecord, optionalBoolean, optionalString, requireInputRecord, requireNoInput, requireString, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import type { requireToolPermission } from "@jini-ai/core";
// `ToolInputError` specifically — see `features/post/tool-registrations.ts`'s identical import for
// why: the marker `@jini-ai/daemon`'s `ToolExecutor` reads to classify a rejection 400 rather than
// redacting it into a message-stripped 500.
import { ToolInputError } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { ToolContributor } from "@jini-ai/core";
import { deploymentsAgentToolCatalog } from "@jini-ai/devops/deploy/site/agent-tools";
import type { readDockerfileSource, writeDockerfileSourceWithIfMatch } from "@jini-ai/devops/deploy/site/dockerfile";
import type { ExportRunner } from "./export-run.js";
import type { ExportEngine, ExportRunReportLike } from "@jini-ai/devops/deploy/site/export-run";

/**
 * @file The Deployments domain's half of the agent-tool wiring split — maps
 * `agent-tools.ts`'s five catalog entries onto the same domain logic the admin HTTP routes already
 * use, as `ToolRegistration`s. All five are wired; none is excluded (see `agent-tools.ts`'s file
 * header for why this domain, unlike Recovery/Database, has no token-gated/human-only entry).
 *
 * Authorization shape: none of `startExportRun`/`getExportRunSnapshot`/`readDockerfileSource`/
 * `writeDockerfileSourceWithIfMatch` call `authorize()`
 * internally (they mirror the plain domain functions the admin routes already call inline), so
 * every handler below calls the kit's `requireToolPermission` itself — the same shape
 * `recovery`/`database` already use.
 *
 * deployment_set_dockerfile requires an ifMatch etag through writeDockerfileSourceWithIfMatch,
 * so concurrent admin/tool edits cannot silently overwrite each other; dockerfile.ts owns the rationale.
 */

/**
 * The exact slice of the route-deps bag this domain's tool handlers read. Declared structurally,
 * never naming `server/routes/types`'s `RouteDeps` — same discipline every OTHER domain's
 * `tool-registrations.ts` already follows (see `features/recovery/tool-registrations.ts`'s file
 * header), now including this one.
 *
 * exportSiteBound captures full application dependencies at the composition root. The export-run
 * adapter must destructure only outputDir/clean/basePath instead of forwarding ExportEngine's
 * routeDeps field: an excess field on a non-literal argument can pass TypeScript and replace the
 * full application bag with this narrow tool bag. The root's spread order and this adapter both
 * enforce that boundary; the owning integration test covers it.
 */
export interface DeploymentsToolDeps extends ExportRunner {
  readonly requireToolPermission: typeof requireToolPermission;
  readonly readDockerfileSource: typeof readDockerfileSource;
  readonly writeDockerfileSourceWithIfMatch: typeof writeDockerfileSourceWithIfMatch;
  readonly tracker?: Tracker;
  readonly idGen?: { newId(): string };
  readonly authorize: AuthorizeFn;
  readonly workspaceId: string;
  readonly clock: Clock;
  readonly exportOutputRootDir: string;
  /**
   * The pre-bound export call this domain uses for `deployment_trigger_export` — see this
   * interface's own doc above for the fuller design reasoning, and `routes/types.ts`'s
   * `exportSiteBound` for what this really is and why it is named differently from
   * `RouteDeps.runExportSite`. Returns `ExportRunReportLike` (`export-run.ts`'s own structural
   * mirror of the real `ExportReport`) rather than the real type, deliberately: this domain already
   * imports `ExportRunReportLike` from its sibling `export-run.ts`, so reusing it here avoids a
   * fresh `#src/features/site-export/index` type import — the real `RouteDeps.exportSiteBound` (which returns the
   * real `ExportReport`) already satisfies this structurally (same reasoning `ExportEngine`'s own
   * doc gives for its return type).
   */
  readonly exportSiteBound: (options: { outputDir: string; clean?: boolean; basePath?: string }) => Promise<ExportRunReportLike>;
}

const CATALOG_BY_ID = indexCatalogById({ catalog: deploymentsAgentToolCatalog });

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const deploymentsDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> startExportRun (export-run.ts) -> exportSite: writes a folder of HTML/CSS/JS/asset files to
  //    disk. A real mutation, same classification as `backup_create_restore_point`.
  ["deployment_trigger_export", "mutates-durable-state"],
  // -> routeDeps.getExportRunSnapshot(): reads a process-local in-memory variable. No I/O of any kind.
  ["deployment_get_export_status", "none"],
  // -> disposable export: no persistent artifacts, credentials or publish calls.
  ["deployment_diagnose_static_export", "none"],
  // -> readDockerfileSource (dockerfile.ts): one existence check, one file read. No write.
  ["deployment_get_dockerfile", "none"],
  // -> writeDockerfileSource (dockerfile.ts): one file write to the repo-root Dockerfile.
  ["deployment_set_dockerfile", "mutates-durable-state"],
]);

/**
 * Picks only the three fields `exportSiteBound` declares from an `ExportEngine` call, omitting an
 * absent `clean`/`basePath` rather than forwarding it as an explicit `undefined` key. Never copies
 * the engine options' `routeDeps` field (see `buildDeploymentsRegistrations`'s comment for why).
 * Exported so the omission contract is testable directly: this module's own callers in
 * `export-run.ts` always pass a boolean `clean`, but `ExportEngine` declares it optional.
 * @complexity O(1).
 */
export function pickExportSiteOptions({ outputDir, clean, basePath }: { outputDir: string; clean?: boolean | undefined; basePath?: string | undefined }): { outputDir: string; clean?: boolean; basePath?: string } {
  return { outputDir, ...(clean !== undefined ? { clean } : {}), ...(basePath !== undefined ? { basePath } : {}) };
}

async function triggerExportTool(required: { routeDeps: DeploymentsToolDeps; engine: ExportEngine<DeploymentsToolDeps>; ctx: ToolExecutionContext }, _optional = {}): Promise<unknown> {
  const { routeDeps, engine, ctx } = required;
  const candidate = { value: ctx.input };
  if (ctx.input !== undefined && !isRecord(candidate)) throw new ToolInputError({ message: "input must be an object" });
  const input = isRecord(candidate) ? candidate.value : {};
  await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "system.export" }, { entityType: "site-export" });

  // No `await` between this check and `startExportRun` below — matches `export-site.ts`'s own
  // "no await between check and set" atomicity comment exactly, so a tool call and a concurrent
  // HTTP trigger in this SAME process can never both observe "not running" (see `export-run.ts`'s
  // file header for the one case where this process is not the same one: the standalone daemon).
  routeDeps.assertExportNotRunning({});

  const clean = optionalBoolean({ input: input, key: "clean" }) ?? false;
  const basePath = optionalString({ input: input, key: "basePath" });
  return routeDeps.startExportRun({ routeDeps, runExportSite: engine, clean }, { ...(basePath === undefined ? {} : { basePath }), ...(routeDeps.tracker && routeDeps.idGen ? { productEvent: { tracker: routeDeps.tracker, userId: ctx.principal.id, operationId: routeDeps.idGen.newId(), source: "assistant" as const } } : {}) });
}

export function buildDeploymentsRegistrations(routeDeps: DeploymentsToolDeps): ToolRegistration[] {
  // Explicit destructuring, not `(opts) => routeDeps.exportSiteBound(opts)` — `ExportEngine`'s
  // own options object always carries a `routeDeps` field (`export-run.ts`), and forwarding it
  // wholesale would let that narrow `DeploymentsToolDeps` value reach `exportSiteBound` under a
  // `routeDeps` key nobody asked for (its own type has no such parameter, so `tsc` would not
  // catch the excess property on this non-literal argument). Picking only the three fields
  // `exportSiteBound` actually declares means the narrow deps here never travel at all — see
  // `DeploymentsToolDeps`'s own doc above and this file's regression test.
  const engine: ExportEngine<DeploymentsToolDeps> = (options, _optional = {}) => routeDeps.exportSiteBound(pickExportSiteOptions(options));
  const handlers: Record<string, ToolHandler> = {
    deployment_trigger_export: (ctx) => triggerExportTool({ routeDeps, engine, ctx }),

    deployment_diagnose_static_export: async (ctx) => {
      requireNoInput({ input: ctx.input });
      await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "system.read" }, { entityType: "site-export" });
      return routeDeps.diagnoseStaticExport({ routeDeps, runExportSite: engine });
    },

    deployment_get_export_status: async (ctx) => {
      requireNoInput({ input: ctx.input });
      await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "system.read" }, { entityType: "site-export" });
      return routeDeps.getExportRunSnapshot();
    },


    deployment_get_dockerfile: async (ctx) => {
      requireNoInput({ input: ctx.input });
      await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "system.read" }, { entityType: "dockerfile-source" });
      return routeDeps.readDockerfileSource();
    },

    deployment_set_dockerfile: async (ctx) => {
      // Both fields validated before the permission check, same order `deployment_trigger_export`
      // above already uses — a shape rejection should never need an authorize() round trip first.
      const input = requireInputRecord({ input: ctx.input });
      const contents = requireString({ input: input, key: "contents" });
      const ifMatch = requireString({ input: input, key: "ifMatch" });
      await routeDeps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "system.write" }, { entityType: "dockerfile-source" });

      ctx.signal.throwIfAborted();
      const result = routeDeps.writeDockerfileSourceWithIfMatch({ contents, ifMatch });
      if (!result.ok) {
        // Thrown, not returned — `ToolExecutor` reads a thrown error as the failed execution and
        // surfaces its `.message` to the model, so the message itself IS the model's only channel
        // for "what happened and what to do next" (Terra audit finding C5's "agent check and fix"
        // requirement). Names the concrete recovery path (re-read, reconcile, retry) rather than a
        // bare "conflict" — and includes the current contents inline so the model can reconcile in
        // the same turn instead of spending a second tool call on deployment_get_dockerfile first
        // (it MAY still call it, e.g. to double-check nothing changed again in the meantime).
        //
        // `ToolInputError`, not a bare `Error` — same reclassification `features/post/
        // tool-registrations.ts`'s `toModelFacingUpdateError` applies to `PostVersionConflictError`:
        // a stale `ifMatch` is exactly "the caller's input was the problem and a DIFFERENT input (the
        // fresh etag echoed below) fixes it," which is what the marker means, not a trick to defeat
        // the redaction. A bare `Error` here would reach the model as a message-stripped 500,
        // discarding the one thing it needs — the current contents/etag to reconcile against.
        throw new ToolInputError({ message: `deployment_set_dockerfile: refused — the Dockerfile changed on the server since your 'ifMatch' ('${ifMatch}') was read; its current etag is now '${result.current.etag}'. ` +
            `The file's CURRENT contents (as of right now, echoed here so you don't have to call deployment_get_dockerfile again just to see them) are:\n\n${result.current.exists ? result.current.contents : "(the file does not exist)"}\n\n` +
            `Reconcile your intended change against these current contents, then retry deployment_set_dockerfile with contents built on top of them and ifMatch set to '${result.current.etag}'. If you want to confirm nothing has changed a second time before retrying, call deployment_get_dockerfile again first. This will not resolve on retry with the same ifMatch.` });
      }
      return result.snapshot;
    },
  };

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "deployments",
    catalogModule: "@jini-ai/devops/deploy/site/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: deploymentsDerivedRisk,
  });
}

/**
 * Contributes Deployments's AI tools; called once by the composition root's
 * `installFirstPartyToolContributors()`, never as an import side effect.
 * Credential lookup and GitHub-login extraction are injected into credential owners so this
 * feature does not acquire a runtime path back to the assistant through credential discovery.
 */
export function contributeDeploymentsTools(): ToolContributor<DeploymentsToolDeps, unknown> {
  return { domain: "deployments", build: buildDeploymentsRegistrations, risk: deploymentsDerivedRisk };
}
