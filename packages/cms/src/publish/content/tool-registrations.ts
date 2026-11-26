import { buildDomainRegistrations, indexCatalogById, requireInputRecord, adaptLegacyAuthorize, requireToolPermission, ToolInputError, type AgentToolDefinition, type ToolExecutionContext, type ToolHandler, type ToolRegistration, type ToolContributor, type HumanConfirmer, type ToolExecutionOptions } from "@jini-ai/core";
import { plan as gatewayPlan, confirm as gatewayConfirm, execute as gatewayExecute, ForbiddenError, PlanStaleError, type GatewayDeps } from "@jini-ai/core/gated-mutations";
import { nowIso } from "@jini-ai/core/primitives";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { loadActiveBundle } from "../transfer/bundle-staging.js";
import { publishContentDerivedRisk, plainSentence, acceptedPullReport, pullCounts, pullTitle, requiredPullBundleId, pullOverwriteKeys } from "./tool-helpers.js";
import { toolMetadata } from "./tool-metadata.js";
import { buildPublishContentImportHooks, PublishContentBundleNotFoundError, type BuildPublishContentImportHooksInput } from "./gated-hooks.js";
import { executePublishContentImport, RestorePointUnavailableError } from "./execute-import.js";
import { getPublishContentRunStatus, type PublishContentRunRepoPort } from "./run-repo.js";
import { entityKey, type PublishContentReport } from "./plan-rows.js";
import type { PublishContentPullDeps, StagedPeerPull } from "./pull.js";
import { PublishContentPeerNotFoundError, PublishContentPeerCredentialMissingError, PublishContentPeerSecretStoreUnconfiguredError } from "./peers.js";
import { PublishContentPeerTransportError } from "./peer-transport.js";
import { connectDestination, disconnectDestination, PublishTrustConnectError, type ConnectDeps } from "../trust/connect.js";
import { PublishTrustHandshakeError } from "../trust/handshake-client.js";
import type { PublishTrustProvisioningPort } from "../trust/provisioning.js";
import { PUBLISH_CONTENT_PUBLISH_TOOL_ID, PUBLISH_CONTENT_CONNECT_TOOL_ID, PUBLISH_CONTENT_PLAN_PULL_TOOL_ID, PUBLISH_CONTENT_EXECUTE_PULL_TOOL_ID, PUBLISH_CONTENT_STATUS_TOOL_ID, PUBLISH_BACKSTOP_GAPS_TOOL_ID } from "./agent-tools.js";
import { connectAndRecordDestination } from "./connect-destination.js";
import { normalizePeerBaseUrl } from "./peer-url.js";
import { hasForbiddenRawUrlCharacter } from "@jini-ai/core/contracts/server/verified-origin";
import { selectConnectedDestination, type PublishContentPeerRecord, type PublishContentPeerRepoPort } from "./peer-registry.js";
import { PUBLISH_CONTENT_APPLY_PERMISSION, PUBLISH_CONTENT_READ_PERMISSION } from "./permissions.js";
import { describePublishReadiness, siteLabelFor, type PublishReadiness, type PublishReadinessCopy } from "./publish-readiness.js";
import type { BeforeSaveHookPort } from "../../posts/post-before-save.js";
import type { OutboxPort } from "@jini-ai/core/contracts/events";
import type { PublishContentDeps, PublishContentContributor } from "./type-registry.js";

// `ToolInputError` specifically — the marker `@jini-ai/daemon`'s `ToolExecutor` reads to classify a
// rejection 400 rather than redacting it into a message-stripped 500. Same import, same reason, as
// `features/site-evidence/tool-registrations.ts`.

export interface PublishContentToolDeps extends PublishContentPullDeps {
  authorize: NonNullable<PublishContentDeps<Record<string, unknown>>["authorize"]>;
  catalog: readonly AgentToolDefinition[];
  readinessCopy: PublishReadinessCopy;
  listPublishContentContributors(): readonly Pick<PublishContentContributor<Record<string, unknown>>, "entityType">[];
  buildPublishContentCatalog: BuildPublishContentImportHooksInput<Record<string, unknown>>["catalog"]["build"];
  planHashOf: BuildPublishContentImportHooksInput<Record<string, unknown>>["planHashOf"];
  resolveActorClassIdentity: BuildPublishContentImportHooksInput<Record<string, unknown>>["resolveActorClassIdentity"];
  gatedMutations: { gatewayDeps: GatewayDeps };
  publishContentPeerRepo: PublishContentPeerRepoPort;
  publishContentRunRepo: PublishContentRunRepoPort;
  publishContentBaselineRepo: BuildPublishContentImportHooksInput<Record<string, unknown>>["baselineRepo"];
  publishContentApplyPort: BuildPublishContentImportHooksInput<Record<string, unknown>>["applyPort"];
  publishContentSeedHash?: BuildPublishContentImportHooksInput<Record<string, unknown>>["getSeedHash"];
  restorePointsRepo: BuildPublishContentImportHooksInput<Record<string, unknown>>["restorePointsRepo"];
  dbOps: BuildPublishContentImportHooksInput<Record<string, unknown>>["dbOps"] & { getCapabilities(): Promise<{ restorePoint: { costClass: "cheap" | "expensive" | "unavailable" } }> };
  blobStore: PublishContentPullDeps["blobStore"] & BuildPublishContentImportHooksInput<Record<string, unknown>>["blobStore"];
  makePublishContentDeps?: () => PublishContentDeps<Record<string, unknown>>;
  publishContentPorts?: Partial<Record<string, unknown>>;
  pluginBeforeSaveHook: BeforeSaveHookPort | undefined;
  outbox: OutboxPort | undefined;
  siteAssistantSecretKeyring: ConnectDeps["keyring"];
  publishTrustProtocol: ConnectDeps["protocol"];
  publishTrustProvisioning?: PublishTrustProvisioningPort;
  findPublishCandidate?: () => Promise<string | null>;
  pullAndStageFromPeer(required: { deps: PublishContentToolDeps; input: { peerId: string; principalId: string } }, optional?: Record<string, never>): Promise<StagedPeerPull>;
  publishContentFromTool(required: { deps: PublishContentToolDeps; principalId: string }, input: Record<string, unknown>): Promise<unknown>;
  refuseUnexpectedKeys(input: Record<string, unknown>, allowed: readonly string[]): void;
  isPluginHookFailedError(error: unknown): boolean;
  toModelFacingPluginHookError(required: { err: unknown }): unknown;
  humanConfirmedToolHandler<TPrepared>(surfaces: AssistantSurfaceDeps, spec: {
    flag: string;
    prepare(required: { ctx: ToolExecutionContext }, optional: ToolExecutionOptions): Promise<TPrepared>;
    dialog(prepared: TPrepared): HumanConfirmSpec;
    run(required: { ctx: ToolExecutionContext; prepared: TPrepared; confirmer: HumanConfirmer }, optional: ToolExecutionOptions): Promise<unknown>;
  }): ToolHandler;
}

/**
 * @file Wires readiness, connection, autonomous publishing and live-content pulls into the assistant catalog.
 * Pulls share the HTTP import hooks and the taxonomy tool's human confirmation transport.
 *
 * The catalog and the per-tool reasoning live in `agent-tools.ts`. This file is the wiring: the
 * permission each tool checks and the ports each handler reaches through.
 *
 * ## Autonomous publishing through the shared dialog path
 *
 * Owner decision 2026-10-05: the assistant must publish on its own. The 2026-09-24 removal avoided
 * a second safety implementation and an MCP-UI confirmation surface. The restored tool has no
 * card: shared feature-side push planning and re-plan checks feed the SAME destination gateway
 * as the Publish dialog. Explicit overwrite input replaces the human tick for this tool only;
 * HTTP overwrite requests keep their existing session gate. The dialog remains available.
 *
 * ## Why the provisioning port is injected
 *
 * The assistant's deps bag is a `RouteDeps` projection and carries no provisioning port. A feature
 * may not import `server/**` (`.dependency-cruiser.mjs`'s `feature-no-server-or-framework-imports`)
 * nor another feature's host settings, so the assembled port arrives as `publishTrustProvisioning`,
 * bound once in `server/runtime/composition/tool-catalog-manifest.ts` against the same committed
 * root the HTTP route uses. That is what stops the two drifting on path or format.
 */


/** The injected committed-config port, or a plain refusal when the host never bound one.
 *  @complexity O(1). */
export function requirePublishTrustProvisioning({ deps }: { deps: Pick<PublishContentToolDeps, "publishTrustProvisioning"> }, _optional = {}): PublishTrustProvisioningPort {
  if (deps.publishTrustProvisioning === undefined) throw new Error("Publishing settings are not set up on this computer yet.");
  return deps.publishTrustProvisioning;
}

/** The live site this computer publishes to, if there is exactly one obvious answer.
 *
 *  A row with no stored secret is one this computer CONNECTED to; a row with one was configured by
 *  hand. The connected row wins when both exist, because it is the one the zero-setup flow made and
 *  the one a person will have meant.
 *  @complexity O(n) in the workspace's destination count. */
function chooseDestination(rows: readonly PublishContentPeerRecord[]): PublishContentPeerRecord | null {
  const connected = selectConnectedDestination({ rows });
  if (connected) return connected;
  return rows.length === 1 ? (rows[0] as PublishContentPeerRecord) : null;
}

/** Reads this install's publish readiness — the shared first step of both handlers.
 *  @complexity O(n) in the workspace's destination count. */
async function readReadiness({ deps, findCandidate }: { deps: PublishContentToolDeps; findCandidate: () => Promise<string | null> }, _optional = {}): Promise<{ readiness: PublishReadiness; rows: readonly PublishContentPeerRecord[] }> {
  const rows = await deps.publishContentPeerRepo.listByWorkspace({ workspaceId: deps.workspaceId });
  const connected = selectConnectedDestination({ rows });
  const readiness = describePublishReadiness({
    connectedSiteLabel: connected ? connected.label : null,
    otherSiteLabels: rows.filter((row) => row.sealed !== null).map((row) => row.label),
    // Only consulted when nothing is connected, so the file read is skipped in the common case.
    candidateUrl: connected || rows.length > 0 ? null : await findCandidate(),
    publishableTypeCount: deps.listPublishContentContributors().length,
    copy: deps.readinessCopy,
  });
  return { readiness, rows };
}

type PublishContentToolRoute = { routeDeps: PublishContentToolDeps };

async function connectPublishContentTool(
  required: PublishContentToolRoute & { ctx: ToolExecutionContext; findCandidate: () => Promise<string | null> },
  _optional = {},
): Promise<unknown> {
  const { routeDeps, ctx, findCandidate } = required;
  const input = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: PUBLISH_CONTENT_APPLY_PERMISSION });

  const raw = await connectSiteUrl({ input, findCandidate });
  if (raw === null) {
    // The never-deployed install. An ordinary empty state, reported as a result rather than
    // thrown, so the model can relay the sentence instead of a failure.
    return {
      connected: false,
      message: "There is no live site to publish to yet.",
      nextStep: "Put this site online once, then come back and connect this computer to it.",
    };
  }

  const normalized = normalizePeerBaseUrl({ raw, hasForbiddenRawUrlCharacter });
  if ("error" in normalized) {
    return { connected: false, message: "That does not look like a website address.", nextStep: null };
  }

  // What this computer may publish is its OWN registered types, never a list anyone chooses.
  // An empty grant can do nothing, so an install with nothing publishable is refused here
  // rather than connected into something that would silently publish nothing.
  const entityTypes = routeDeps.listPublishContentContributors().map((contributor) => contributor.entityType);
  if (entityTypes.length === 0) {
    return {
      connected: false,
      message: "There is nothing on this site that can be copied to a live site yet.",
      nextStep: "Add something to this site first, then come back.",
    };
  }
  return connectWithTrust({ routeDeps, baseUrl: normalized.baseUrl, entityTypes });
}

/** Records the destination and its grant; a handshake or write failure becomes a plain result the model can relay. */
async function connectWithTrust(
  required: PublishContentToolRoute & { baseUrl: string; entityTypes: string[] },
  _optional = {},
): Promise<unknown> {
  const { routeDeps, baseUrl, entityTypes } = required;
  const provisioning = requirePublishTrustProvisioning({ deps: routeDeps });
  try {
    const trustDeps = {
      httpClient: routeDeps.publishContentPeerHttpClient,
      protocol: routeDeps.publishTrustProtocol,
      keyring: routeDeps.siteAssistantSecretKeyring,
      provisioning,
      clock: routeDeps.clock,
      nowIso,
      workspaceId: routeDeps.workspaceId,
    };
    const { site, grant } = await connectAndRecordDestination(
      {
        deps: {
          repo: routeDeps.publishContentPeerRepo,
          clock: routeDeps.clock,
          idGen: routeDeps.idGen,
          connectGrant: (connectInput, _options: Record<string, never> = {}) => connectDestination({ deps: trustDeps, input: connectInput }),
          reverseGrant: () => disconnectDestination({ deps: trustDeps }),
        },
        input: { workspaceId: routeDeps.workspaceId, baseUrl: baseUrl, entityTypes }
      }
    );

    return {
      connected: true,
      message: `This computer publishes to ${site.label}.`,
      nextStep: plainSentence({ text: grant.nextStep, fallback: "Put this site online once more for the change to take effect." }),
    };
  } catch (err) {
    if (err instanceof PublishTrustHandshakeError) {
      return {
        connected: false,
        message: plainSentence({ text: err.message, fallback: `${siteLabelFor({ baseUrl: baseUrl })} could not be reached, or it is not a site this can publish to.` }),
        nextStep: "Check the address and that the site is online, then try connecting again.",
      };
    }
    if (err instanceof PublishTrustConnectError) {
      return {
        connected: false,
        message: "This site's publishing settings could not be saved on this computer.",
        nextStep: "Check that this project's files can be written to, then try connecting again.",
      };
    }
    throw err;
  }
}

    async function planPublishContentPull(routeDeps: PublishContentToolDeps, ctx: Parameters<ToolHandler>[0]) {
  return pullToolBoundary({ deps: routeDeps, run: async () => {
      const input = requireInputRecord({ input: ctx.input });
      routeDeps.refuseUnexpectedKeys(input, ["peerId"]);
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: PUBLISH_CONTENT_APPLY_PERMISSION });
      const peerId = await selectPullPeer({ deps: routeDeps, supplied: input.peerId });
      const staged = await routeDeps.pullAndStageFromPeer({ deps: routeDeps, input: { peerId, principalId: ctx.principal.id } });
      const planned = await gatewayPlan({ deps: routeDeps.gatedMutations.gatewayDeps, principalId: ctx.principal.id, principalKind: "agent", hooks: pullHooks({ deps: routeDeps, bundleId: staged.bundleId, actorId: ctx.principal.id }) });
      const report = acceptedPullReport({ report: planned.details as PublishContentReport });
      // The bundle table has no source-label column. An existing audit row retains this display
      // metadata across tool calls/restarts; no cached plan is trusted at execute time.
      await routeDeps.publishContentRunRepo.save({ record: {
        id: staged.bundleId, workspaceId: routeDeps.workspaceId, direction: "import", phase: "planned",
        peerPrincipalId: ctx.principal.id, peerLabel: staged.peerLabel, actorId: ctx.principal.id,
        restorePointId: null, changeSetIdsJson: null, startedAt: nowIso({ clock: routeDeps.clock }), finishedAt: null,
        reportJson: JSON.stringify(report), itemsJson: null,
      } });
      return { bundleId: staged.bundleId, expiresAt: staged.expiresAt, peerLabel: staged.peerLabel,
        counts: pullCounts({ report }), conflicts: report.rows.filter(row => row.canOverwrite).slice(0, 50).map(row => ({
          entityKey: entityKey({ entityType: row.entityType, entityId: row.entityId }), title: pullTitle({ row }), reason: row.reason,
        })), blobsUnavailable: staged.blobsUnavailable, blobsDeferred: staged.blobsDeferred };
    } });
}

    function createExecutePullHandler(routeDeps: PublishContentToolDeps, surfaces: AssistantSurfaceDeps): ToolHandler {
  return routeDeps.humanConfirmedToolHandler(surfaces, {
      flag: "executed",
      prepare: ({ ctx }) => pullToolBoundary({ deps: routeDeps, run: async () => {
        const input = requireInputRecord({ input: ctx.input });
        routeDeps.refuseUnexpectedKeys(input, ["bundleId", "overwriteEntityKeys"]);
        const bundleId = requiredPullBundleId({ value: input.bundleId });
        const overwriteKeys = pullOverwriteKeys({ value: input.overwriteEntityKeys });
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: PUBLISH_CONTENT_APPLY_PERMISSION });
        const bundle = await loadActiveBundle({ repo: routeDeps.publishContentBundleRepo, workspaceId: routeDeps.workspaceId, id: bundleId, now: nowIso({ clock: routeDeps.clock }) });
        if (!bundle) throw new ToolInputError({ message: "This pull plan was not found or has expired. Run publish_content_plan_pull again." });
        if (bundle.sourcePrincipalId !== ctx.principal.id) throw new ToolInputError({ message: "This pull was planned by a different caller. Run publish_content_plan_pull for this conversation." });
        const audit = await routeDeps.publishContentRunRepo.findById({ workspaceId: routeDeps.workspaceId, id: bundleId });
        if (!audit || audit.phase !== "planned" || audit.actorId !== ctx.principal.id) throw new ToolInputError({ message: "This pull plan was not found or has expired. Run publish_content_plan_pull again." });
        const hooks = pullHooks({ deps: routeDeps, bundleId, actorId: ctx.principal.id }, { forcedEntityKeys: overwriteKeys });
        const planned = await gatewayPlan({ deps: routeDeps.gatedMutations.gatewayDeps, principalId: ctx.principal.id, principalKind: "agent", hooks });
        const report = acceptedPullReport({ report: planned.details as PublishContentReport });
        const knownKeys = new Set(report.rows.map(row => entityKey({ entityType: row.entityType, entityId: row.entityId })));
        for (const key of overwriteKeys) if (!knownKeys.has(key)) throw new ToolInputError({ message: `'${key}' is not in this pull plan. Use entity keys returned by publish_content_plan_pull.` });
        return { hooks, planned, report, peerLabel: audit.peerLabel ?? "Live site" };
      } }),
      dialog: ({ report, peerLabel }) => ({
        toolId: PUBLISH_CONTENT_EXECUTE_PULL_TOOL_ID, errorCode: "PUBLISH_CONTENT", title: "Pull live content to this computer?",
        description: `Copy content from ${peerLabel} into this local site.`,
        details: [
          { label: "Live site", value: peerLabel },
          ...Object.entries(pullCounts({ report })).map(([key, count]) => ({ label: key.charAt(0).toUpperCase() + key.slice(1), value: String(count) })),
          ...report.rows.filter(row => row.outcome === "applied" || row.outcome === "forced").map(row => ({ label: "Overwrite local item", value: pullTitle({ row }) })),
          ...report.rows.flatMap(row => row.retires !== null && row.writes ? [{ label: "Move to Trash", value: row.retires.entityLabel ?? row.retires.entityId }] : []),
        ],
        warning: "The listed local items will be overwritten. A restore point is captured before applying changes.",
        danger: true, confirmLabel: "Apply pull",
      }),
      run: ({ ctx, prepared: { hooks, planned }, confirmer }) => pullToolBoundary({ deps: routeDeps, run: async () => {
        const token = await gatewayConfirm({ deps: routeDeps.gatedMutations.gatewayDeps, principalId: confirmer.id, principalKind: confirmer.kind, hooks, planId: planned.planId, planHash: planned.planHash, signal: ctx.signal });
        // As on /import/execute, check restore capability outside the shared gateway; it still
        // re-authorizes, checks the human-bound token and re-derives the plan before any write.
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: PUBLISH_CONTENT_APPLY_PERMISSION });
        const capabilities = await routeDeps.dbOps.getCapabilities();
        const applied = await executePublishContentImport({ workspaceId: routeDeps.workspaceId, costClass: capabilities.restorePoint.costClass,
          gatewayExecute: () => gatewayExecute({ deps: routeDeps.gatedMutations.gatewayDeps, principalId: ctx.principal.id, principalKind: "agent", hooks, confirmationToken: token.confirmationToken, signal: ctx.signal }),
        });
        const status = await getPublishContentRunStatus<PublishContentReport>({ repo: routeDeps.publishContentRunRepo, input: { workspaceId: routeDeps.workspaceId, runId: applied.runId } });
        if (!status?.report) throw new ToolInputError({ message: "The pull ran, but its report could not be loaded. Check import history before retrying." });
        // Use the persisted APPLY report, including any optimistic-concurrency downgrades.
        return { executed: true, counts: pullCounts({ report: status.report }), entities: status.report.rows.map(row => ({ entityKey: entityKey({ entityType: row.entityType, entityId: row.entityId }), title: pullTitle({ row }), outcome: row.outcome, reason: row.reason })) };
      } }),
    });
}



/**
 * Wires publish/readiness/connection tools using explicit ports; pulls retain human-bound surfaces.
 * Pull planning stores an expiring bundle; execution reaches the import gateway only after a click.
 * @returns Catalog registrations with independently derived write risk.
 * @example buildPublishContentRegistrations(deps, { surfaceExchanges });
 * @complexity O(t) for t catalog entries; handler I/O runs only when invoked.
 */
export function buildPublishContentRegistrations(
  { routeDeps, surfaces }: { routeDeps: PublishContentToolDeps; surfaces: AssistantSurfaceDeps },
  _optional = {}
): ToolRegistration[] {
  const CATALOG_BY_ID = indexCatalogById({ catalog: routeDeps.catalog });
  const findCandidate = routeDeps.findPublishCandidate ?? (async () => null);

  const handlers: Record<string, ToolHandler> = {
    [PUBLISH_CONTENT_PUBLISH_TOOL_ID]: ctx => pullToolBoundary({ deps: routeDeps, run: async () => {
      const input = requireInputRecord({ input: ctx.input ?? {} });
      routeDeps.refuseUnexpectedKeys(input, ["peerId", "types", "items", "excludeItems", "overwrite"]);
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }),
        workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: PUBLISH_CONTENT_APPLY_PERMISSION });
      ctx.signal.throwIfAborted();
      return routeDeps.publishContentFromTool({ deps: routeDeps, principalId: ctx.principal.id }, input);
    } }),
    [PUBLISH_BACKSTOP_GAPS_TOOL_ID]: async (ctx) => {
      routeDeps.refuseUnexpectedKeys(requireInputRecord({ input: ctx.input ?? {} }), []);
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }),
        workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: "publish_content.read" });
      const audit = routeDeps.makePublishContentDeps?.().backstop?.audit;
      return { gaps: audit && await audit.ready() ? await audit.gaps({ workspaceId: routeDeps.workspaceId }) : [] };
    },
    [PUBLISH_CONTENT_PLAN_PULL_TOOL_ID]: (ctx) => planPublishContentPull(routeDeps, ctx),
    [PUBLISH_CONTENT_EXECUTE_PULL_TOOL_ID]: createExecutePullHandler(routeDeps, surfaces),
    [PUBLISH_CONTENT_STATUS_TOOL_ID]: async (ctx) => {
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: PUBLISH_CONTENT_READ_PERMISSION });
      const { readiness } = await readReadiness({ deps: routeDeps, findCandidate });
      return readiness;
    },

    [PUBLISH_CONTENT_CONNECT_TOOL_ID]: (ctx) => connectPublishContentTool({ routeDeps, ctx, findCandidate }),
  };

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "publish-content",
    catalogModule: "features/publish-content/agent-tools.ts",
    catalog: CATALOG_BY_ID as ReadonlyMap<string, AgentToolDefinition>,
    handlers,
    derivedRisk: publishContentDerivedRisk,
  });
}


/**
 * Contributes the publishing tools to the assistant's catalog — called once by
 * `server/runtime/composition/tool-catalog-manifest.ts`'s `installFirstPartyToolContributors()`.
 * @param options.buildPublishContentDeps - The HTTP importer's content-port projection, injected
 *   by server composition so this feature needs no server import. Explicit test ports also work.
 * @returns The existing publish-content domain, including its pull tools and risk map.
 * @example contributePublishContentTools({ buildPublishContentDeps: toPublishContentDeps });
 * @complexity O(1); registrations are built lazily by the contributor's build callback.
 */
export function contributePublishContentTools<TDeps extends PublishContentToolDeps = PublishContentToolDeps>(options: {
  buildPublishContentDeps?: (deps: TDeps) => PublishContentDeps<Record<string, unknown>>;
} = {}): ToolContributor<TDeps, AssistantSurfaceDeps> {
  return { domain: "publish-content", risk: publishContentDerivedRisk, build: (deps, surfaces) => {
    const buildDeps = options.buildPublishContentDeps;
    return buildPublishContentRegistrations({ routeDeps: buildDeps ? { ...deps, makePublishContentDeps: () => buildDeps(deps) } : deps, surfaces });
  } };
}

/** A blank address uses the discovered site; other supplied types are input errors. */
async function connectSiteUrl(
  { input, findCandidate }: { input: Record<string, unknown>; findCandidate: () => Promise<string | null> },
  _options: Record<string, never> = {}
): Promise<string | null> {
  const supplied = input.siteUrl;
  if (supplied !== undefined && typeof supplied !== "string") {
    throw new ToolInputError({ message: "'siteUrl' must be a website address as a string when provided" });
  }
  return typeof supplied === "string" && supplied.trim() !== "" ? supplied : await findCandidate();
}

async function suppliedPullPeer(
  { deps, supplied }: { deps: PublishContentToolDeps; supplied: unknown },
  _options: Record<string, never> = {}
): Promise<string> {
  if (typeof supplied !== "string" || supplied.trim() === "") throw new ToolInputError({ message: "'peerId' must be a non-empty string when provided." });
  const saved = await deps.publishContentPeerRepo.findById({ workspaceId: deps.workspaceId, id: supplied });
  if (!saved) throw new ToolInputError({ message: `The saved destination '${supplied}' was not found. Choose a saved peerId or connect the live site again.` });
  return saved.id;
}

/** Choose only saved peers; ambiguity is reported rather than guessed. O(p) in saved peers. */
async function selectPullPeer({ deps, supplied }: { deps: PublishContentToolDeps; supplied: unknown }, _optional = {}): Promise<string> {
  if (supplied !== undefined) return suppliedPullPeer({ deps, supplied });
  const rows = await deps.publishContentPeerRepo.listByWorkspace({ workspaceId: deps.workspaceId });
  if (rows.length === 0) throw new ToolInputError({ message: "No live destination is connected. Connect this computer with publish_content_connect, then plan the pull again." });
  const connectedRows = rows.filter(row => row.sealed === null);
  if (connectedRows.length <= 1) {
    const connected = selectConnectedDestination({ rows });
    if (connected) return connected.id;
    if (rows.length === 1) {
      const only = rows[0];
      if (only === undefined) throw new Error("Pull destination inventory has no sole row");
      return only.id;
    }
  }
  const choices = rows.map(row => `${row.id} (${row.label})`).join(", ");
  throw new ToolInputError({ message: `Several destinations are saved. Choose a peerId: ${choices}.` });
}

/** Fresh hooks from the same factory /import/plan and /import/execute use. O(1) projection. */
function pullHooks({ deps, bundleId, actorId }: { deps: PublishContentToolDeps; bundleId: string; actorId: string }, { forcedEntityKeys }: { forcedEntityKeys?: ReadonlySet<string> } = {}) {
  const contentDeps = deps.makePublishContentDeps?.() ?? {
    workspaceId: deps.workspaceId, clock: deps.clock, idGen: deps.idGen,
    ports: { ...(deps.publishContentPorts ?? {}), hooks: { beforeSave: deps.pluginBeforeSaveHook } }, outbox: deps.outbox,
  };
  return buildPublishContentImportHooks({
    workspaceId: deps.workspaceId, bundleId, actorId,
    // Assistant tool path (P10-H2): every write this import applies is the agent's.
    actor: { id: actorId, kind: "agent" }, clock: deps.clock, idGen: deps.idGen,
    planHashOf: deps.planHashOf, resolveActorClassIdentity: deps.resolveActorClassIdentity, catalog: { build: deps.buildPublishContentCatalog },
    publishContentDeps: { ...contentDeps, authorize: deps.authorize }, bundleRepo: deps.publishContentBundleRepo,
    baselineRepo: deps.publishContentBaselineRepo, blobStore: deps.blobStore, dbOps: deps.dbOps,
    restorePointsRepo: deps.restorePointsRepo, applyPort: deps.publishContentApplyPort,
    getSeedHash: deps.publishContentSeedHash, forcedEntityKeys,
  });
}

/** Translate known refusals for the model; unknown failures retain the normal executor redaction. */
async function pullToolBoundary<T>({ run, deps }: { run: () => Promise<T>; deps: PublishContentToolDeps }, _optional = {}): Promise<T> {
  try { return await run(); } catch (error) {
    throw modelFacingPullError({ error, deps });
  }
}

function modelFacingPullError({ error, deps }: { error: unknown; deps: PublishContentToolDeps }, _options: Record<string, never> = {}): unknown {
  if (error instanceof PlanStaleError) return new ToolInputError({ message: "The local content changed after the dialog was shown. Run publish_content_execute_pull again to review a fresh plan." });
  if (error instanceof PublishContentBundleNotFoundError) return new ToolInputError({ message: "This pull plan was not found or has expired. Run publish_content_plan_pull again." });
  // The apply writes row by row, so the refusal names the item and says earlier items stay saved.
  if (deps.isPluginHookFailedError(error)) return deps.toModelFacingPluginHookError({ err: error });
  if (error instanceof RestorePointUnavailableError) return new ToolInputError({ message: "This computer cannot capture a restore point. Pulling content is refused until backups are available." });
  if (error instanceof PublishContentPeerNotFoundError) {
    return new ToolInputError({ message: "The saved destination was removed. Choose a saved peerId or connect the live site again." });
  }
  if (error instanceof Error && [ForbiddenError, PublishTrustHandshakeError, PublishContentPeerTransportError, PublishContentPeerCredentialMissingError, PublishContentPeerSecretStoreUnconfiguredError].some((ErrorType) => error instanceof ErrorType)) return new ToolInputError({ message: error.message });
  return error;
}
