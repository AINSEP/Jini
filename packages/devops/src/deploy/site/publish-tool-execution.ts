import { EXECUTE_STATIC_PUBLISH_SCHEMA } from './publish-agent-tools.js';
import { ToolInputError, requireInputRecord, requireString, type ToolHandler, type SurfaceEmission } from '@jini-ai/core';
import { adaptLegacyAuthorize } from '@jini-ai/core/tool-permissions';
import { nowIso as clockNowIso } from '@jini-ai/core/primitives';
import type { StaticPublishToolDeps } from './publish-tool-deps.js';
import type { AssistantSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import type { SurfaceExchange } from '@jini-ai/core/surface-exchanges';
import type { UIResource, UIResourceUri } from '@jini-ai/core/contracts/site/protocol-mcp-ui';
import type { DeployTargetDescriptor, DeployTargetRegistry, LoadedDeployTarget } from './deploy-targets/types.js';
import { toolMetadata } from '@jini-ai/core/tool-metadata/deployments';
import { getPublishRunSnapshot, getPublishJobSnapshot, startPublishRun } from './static-publish/publish-run.js';
import { planStaticPublish, readStaticPublishConfig, unknownTargetMessage } from './static-publish/adapter.js';
import { inspectStaticPublish } from './static-publish/inspection.js';
import { domainPublishTool } from './static-publish/domain-publish-tool.js';
import type { PublishHistoryStore } from './static-publish/publish-history.js';
import type { PublishCredentialSource, StaticPublishConfig, StaticPublishOutcome, StaticPublishTargetId } from './static-publish/types.js';

const DEPLOYMENTS_READ_PERMISSION = "deployments.read";
const SITE_PUBLISH_ENTITY = "site-publish";

/** {@link StaticPublishToolDeps.loadDeployTargets}, bound by composition to installed plugins or trusted source. */
export function deployTargetsLoader(deps: StaticPublishToolDeps): ({ workspaceId }: { workspaceId: string }, optional?: Record<string, never>) => Promise<DeployTargetRegistry> {
  return deps.loadDeployTargets;
}

/**
 * Reads a tool input into a publish config for `target` (already looked up in `registry`) and plans
 * it (`planStaticPublish`, the same call `publishStaticSite` makes). A blank optional field means "not
 * set", matching the old per-target builders.
 *
 * @throws {ToolInputError} A declared field is not a string.
 * @complexity O(f) declared fields.
 */
function planToolPublish(
  { registry, raw, target }: {
    registry: DeployTargetRegistry;
    raw: Record<string, unknown>;
    target: LoadedDeployTarget;
  },
  _options = {},
): { readonly config: StaticPublishConfig; readonly plan: ReturnType<typeof planStaticPublish>; readonly detailRows: DetailRow[] } {
  requireOnlyDeclaredFields(raw, target.descriptor);
  const read = readStaticPublishConfig({ target, raw, options: { blankAsAbsent: true } });
  if (!read.ok) throw new ToolInputError({ message: read.message });
  return { config: read.config, plan: planStaticPublish({ registry, config: read.config }), detailRows: configDetailRows(read.config, target) };
}

/** The publish request's own keys; every other input key must be one of the host's config fields. */
const PUBLISH_REQUEST_KEYS: ReadonlySet<string> = new Set(["target", "projectName", "credentialId"]);

/** Only the explicit, non-secret connection choice crosses into the publish input. */
function toolCredentialChoice({ raw }: { raw: Readonly<Record<string, unknown>> }, _options = {}): { credentialId?: string } {
  if (raw.credentialId === undefined) return {};
  if (typeof raw.credentialId !== "string" || !raw.credentialId.trim()) throw new ToolInputError({ message: "credentialId must be a non-empty string naming the person's selected connection. Choose it again before previewing or executing." });
  return { credentialId: raw.credentialId };
}

/** Refuses an input key the chosen host does not declare, so nothing (a token included) reaches a
 *  publish except the host's own config fields. The schemas allow any string key because the fields
 *  come from the host's descriptor.
 *  @throws {ToolInputError} naming the first undeclared key and the fields the host takes.
 *  @complexity O(k·f) input keys by declared fields. */
function requireOnlyDeclaredFields(raw: Record<string, unknown>, descriptor: DeployTargetDescriptor): void {
  const declared = descriptor.configFields.map((field) => field.name);
  const unknown = Object.keys(raw).find((key) => !PUBLISH_REQUEST_KEYS.has(key) && !declared.includes(key));
  if (unknown === undefined) return;
  const takes = declared.length > 0 ? `It takes: ${declared.join(", ")}.` : "It takes no config fields.";
  throw new ToolInputError({ message: `'${unknown}' is not a field of ${descriptor.id}. ${takes}` });
}

/** One labelled row on a publish confirmation/outcome card. */
type DetailRow = { label: string; value: string };

/** The card rows for a publish: the target module's own `summarize` when it has one, otherwise one
 *  row per declared config field the publish carries, in declaration order and under its declared
 *  label. Which fields exist is the plugin's business, so nothing here names a host.
 *  @complexity O(f) declared fields. */
function configDetailRows(config: StaticPublishConfig, target: LoadedDeployTarget): DetailRow[] {
  if (target.module.summarize !== undefined) return target.module.summarize(config).map(({ label, value }) => ({ label, value }));
  return target.descriptor.configFields.flatMap((field) => {
    const value = config[field.name];
    return typeof value === "string" ? [{ label: field.label, value }] : [];
  });
}

const EXECUTE_STATIC_PUBLISH_TOOL_ID = "deployment_execute_static_publish";

/** The `ui://` URI for one publish-confirmation instance. Keyed by the exchange id (unique per raised
 *  dialog) rather than by an entity+version the way `deleteConfirmationUri`
 *  (`post deletion confirmation`) keys its own — a publish has no existing row/version to
 *  key against, so the exchange id is what keeps two dialogs raised for the same target from
 *  colliding on one URI. */
function publishConfirmationUri({ exchangeId, uriHost }: { uriHost: string; exchangeId: string }, _options = {}): UIResourceUri {
  return `ui://${uriHost}/deployment-execute-static-publish/${exchangeId}` as UIResourceUri;
}

/**
 * Renders the RESULT of a confirmed publish — what a human sees replacing the confirmation dialog
 * they just answered, once `askThenReport`'s `handle` callback has actually run `publishStaticSite`
 * (or refused to, e.g. `already-running`). See `Jini packages/daemon/src/surface-exchanges.ts`'s `askThenReport` doc
 * for the mechanism this depends on: sent under the SAME `uri` the confirmation used
 * (`publishConfirmationUri(exchangeId)`, deliberately reused rather than a fresh one), which is what
 * makes `McpUiSurfaceCard` (`@jini-ai/chat`) replace the dialog in place instead of opening a second
 * card, and what makes `McpUiHost` remount the frame cleanly (its `sessionKey` is
 * `` `${uri}:${documentText}` ``, and this document's text always differs from the confirmation's).
 *
 * `state`/`message`/`url` map straight onto Jini's `SurfaceOutcomeSpec` (`@jini-ai/ui/mcp-ui/surfaces`'s
 * `outcome.ts`) — this function's own job is only deciding the publish-specific title/details/labels,
 * the same division of labor `buildPublishConfirmationResource` above already has with
 * `buildConfirmationSurface`.
 *
 * @param spec.url - Present for `'success'` and `'partial'` only — renders one "Open site"/"Open when
 *   ready" button wired to the bridge's existing `openLink`, no new bridge plumbing. Omitted for
 *   `'failure'`: there is nothing live to open.
 * @complexity O(1) — fixed-size field reads, no iteration.
 */
function buildPublishOutcomeResource(spec: {
  deps: StaticPublishToolDeps;
  exchangeId: string;
  config: StaticPublishConfig;
  detailRows: readonly DetailRow[];
  projectName: string;
  state: "success" | "partial" | "failure";
  message: string;
  url?: string;
}): UIResource {
  const { deps, exchangeId, config, detailRows, projectName, state, message, url } = spec;
  const unsuccessfulTitle = state === "partial" ? "Uploaded, not live yet" : "Publish failed";
  const title = state === "success" ? "Published" : unsuccessfulTitle;
  return deps.buildOutcomeSurface({
    uri: publishConfirmationUri({ exchangeId, uriHost: deps.uriHost }),
    title,
    details: [
      { label: "Target", value: config.target },
      { label: "Project name", value: projectName },
      ...detailRows,
    ],
    state,
    message,
    ...(url !== undefined ? { openLinkUrl: url, openLinkLabel: state === "partial" ? "Open when ready" : "Open site" } : {}),
    app: deps.publishOutcomeApp,
    preferredFrameSize: ["100%", "360px"],
  });
}



/** Shared `target` lookup for `deployment_preview_static_publish` and
 *  `deployment_execute_static_publish`: the input's `target` must be a host this workspace's deploy
 *  registry has loaded.
 *  @throws {ToolInputError} `raw.target` is missing, or no loaded plugin provides it.
 *  @complexity O(1) — one registry lookup. */
export function requireStaticPublishTarget(raw: Record<string, unknown>, registry: DeployTargetRegistry): LoadedDeployTarget {
  const targetId = requireString({ input: raw, key: "target" });
  const target = registry.get(targetId);
  if (target === undefined) throw new ToolInputError({ message: unknownTargetMessage({ registry, targetId }) });
  return target;
}

/** `deployment_preview_static_publish`'s result shape — extracted purely to keep that handler's
 *  own body a flat sequence of steps. */
function buildStaticPublishPreviewResult(
  { target, validationError, basePath, credential }: {
    target: StaticPublishTargetId;
    validationError: string | null;
    basePath: string | undefined;
    credential: { readonly configured: boolean; readonly reason?: string };
  },
  _options = {},
) {
  return {
    target,
    valid: validationError === null,
    ...(validationError !== null ? { validationError } : {}),
    basePath: basePath ?? null,
    credentialsConfigured: credential.configured,
    ...(!credential.configured ? { credentialGuidance: credential.reason } : {}),
  };
}

/**
 * Maps `publishStaticSite`'s own `StaticPublishOutcome` (via {@link handlePublishConfirmationAnswer}'s
 * `runPublishAndAwait` call) to `deployment_execute_static_publish`'s agent-facing result plus the
 * `outcome` emission that corrects the confirmation dialog with the truth (see
 * {@link handlePublishConfirmationAnswer}'s own header for why that emission exists at all).
 *
 * "Uploaded, but not yet reachable" (spec `custom-publish-provider-contract.md` §3a) — a `"partial"`
 * outcome's files DID upload (so `published: true`, never a hard failure), but the site is not
 * confirmed live yet (so `reachable: false`, never a plain success either). Structurally a distinct
 * branch from both — see `static-publish/types.ts`'s `StaticPublishOutcome` header for why
 * `outcome.ok` itself is `true | false | "partial"`, not merely a boolean.
 *
 * Every branch of `publishStaticSite`'s own failure contract (`static-publish/types.ts`'s
 * `StaticPublishOutcome` doc, `adapter.ts`'s own `catch`) is already an actionable, credential-free
 * message: `NO_CREDENTIALS_CONFIGURED` names the provider via the resolved credential source's own
 * reason text, a credential missing a host-required field (e.g. an account id) names the exact
 * missing field (the target's own `DeployError`), and `PROVIDER_ERROR` is `err.message` only — never a
 * raw response body, never a credential. Passed straight through rather than re-wrapped, and straight
 * into the outcome surface too — the same actionable text a human would need either way.
 */
export function mapPublishOutcomeToToolResult(
  { deps, outcome, exchange, config, detailRows, projectName }: {
    deps: StaticPublishToolDeps;
    outcome: StaticPublishOutcome;
    exchange: Pick<SurfaceExchange, "id">;
    config: StaticPublishConfig;
    detailRows: readonly DetailRow[];
    projectName: string;
  },
  _options = {},
): { result: unknown; outcome: SurfaceEmission } {
  if (!outcome.ok) {
    return {
      result: { published: false, cancelled: false, code: outcome.code, message: outcome.message, ...(outcome.credentialSetup ? { credentialSetup: outcome.credentialSetup } : {}) },
      outcome: {
        channel: "mcp-ui",
        payload: { resource: buildPublishOutcomeResource({ deps, exchangeId: exchange.id, config, detailRows, projectName, state: "failure", message: outcome.message }) },
      },
    };
  }
  const published = publishedOutcomeFields({ outcome });
  if (outcome.ok === "partial") {
    return {
      result: { ...published, reachable: false, message: outcome.message },
      outcome: {
        channel: "mcp-ui",
        payload: {
          resource: buildPublishOutcomeResource({ deps, exchangeId: exchange.id, config, detailRows, projectName, state: "partial", message: [outcome.message, outcome.consentWarning].filter(Boolean).join(" "), url: outcome.url }),
        },
      },
    };
  }
  return {
    result: { ...published, reachable: true },
    outcome: {
      channel: "mcp-ui",
      payload: {
        resource: buildPublishOutcomeResource({ deps,
          exchangeId: exchange.id, config, detailRows, projectName, state: "success",
          message: [`Published live at ${outcome.url}.`, outcome.consentWarning].filter(Boolean).join(" "),
          url: outcome.url,
        }),
      },
    },
  };
}

function publishedOutcomeFields({ outcome }: { outcome: Exclude<StaticPublishOutcome, { ok: false }> }) {
  const published = {
    published: true, target: outcome.targetId, url: outcome.url, status: outcome.status,
    ...(outcome.providerMetadata ? { providerMetadata: outcome.providerMetadata } : {}),
    ...(outcome.deploymentId !== undefined ? { deploymentId: outcome.deploymentId } : {}),
    ...(outcome.basePath !== undefined ? { basePath: outcome.basePath } : {}),
    ...(outcome.consentWarning ? { consentWarning: outcome.consentWarning } : {}),
  };
  return published;
}

/** All blocked assistant publishes report the same event and product source. */
function trackBlockedToolPublish({ deps, principalId, target, reasonClass }: { deps: StaticPublishToolDeps; principalId: string; target: string; reasonClass: "config" | "consent" | "busy" }, _options = {}): void {
  void deps.tracker?.capture({ name: "site_publish_blocked", userId: principalId }, { properties: { target, reasonClass, source: "assistant" } });
}

export async function previewStaticPublish({ deps, credentialSource, ctx }: { deps: StaticPublishToolDeps; credentialSource: PublishCredentialSource; ctx: Parameters<ToolHandler>[0] }) {
      const raw = requireInputRecord({ input: ctx.input });
      const registry = await deployTargetsLoader(deps)({ workspaceId: deps.workspaceId });
      const loaded = requireStaticPublishTarget(raw, registry);
      const target = loaded.descriptor.id;

      await deps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: DEPLOYMENTS_READ_PERMISSION }, { entityType: SITE_PUBLISH_ENTITY });

      const { config, plan } = planToolPublish({ registry, raw, target: loaded });
      const validationError = plan.ok ? null : plan.message;
      const basePath = plan.ok ? plan.basePath : undefined;
      // Local readiness stays non-decrypting. A provider inspection below is an explicit
      // authenticated read; its server-side credential never enters this tool result.
      const credential = await credentialSource.isConfigured({ workspaceId: deps.workspaceId, target, ...toolCredentialChoice({ raw }) });

      const inspected = plan.ok && credential.configured ? await inspectStaticPublish({
        deps: { ...deps.staticPublishPorts, credentialSource, loadDeployTargets: deps.loadDeployTargets, tracker: deps.tracker, observability: deps.observability, hostKit: deps.hostKit, formDestination: deps.formDestination },
        input: { workspaceId: deps.workspaceId, config, projectName: typeof raw.projectName === "string" ? raw.projectName : "",
          ...toolCredentialChoice({ raw }) },
      }) : {};
      return { ...buildStaticPublishPreviewResult({ target, validationError, basePath, credential }),
        ...(inspected.inspection ? { providerInspection: inspected.inspection } : {}) };
}

async function startApprovedStaticPublish({ deps, approvedCtx, target, credentialSource, config, projectName, raw, historyStore, onSettled }: {
  deps: StaticPublishToolDeps; approvedCtx: Parameters<ToolHandler>[0]; target: StaticPublishTargetId;
  credentialSource: PublishCredentialSource; config: StaticPublishConfig; projectName: string; raw: Record<string, unknown>;
  historyStore: PublishHistoryStore; onSettled: () => void;
}) {
          await deps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: approvedCtx.principal.id, permission: "deployments.publish" }, { entityType: SITE_PUBLISH_ENTITY });
          const currentConsent = await deps.checkToolPublishConsent({ deps, principalId: approvedCtx.principal.id });
          if (currentConsent) {
            trackBlockedToolPublish({ deps, principalId: approvedCtx.principal.id, target, reasonClass: "consent" });
            return { published: false, cancelled: false, ...currentConsent };
          }
          if (approvedCtx.signal.aborted) return { published: false, cancelled: false, reason: "abandoned" };
          const active = getPublishRunSnapshot(deps.staticPublishPorts);
          if (active.status === "running") {
            trackBlockedToolPublish({ deps, principalId: approvedCtx.principal.id, target, reasonClass: "busy" });
            if (active.jobId === undefined) throw new Error("Running static publish has no job ID");
            return { published: false, cancelled: false, code: "ALREADY_RUNNING", jobId: getPublishJobSnapshot({ deps: deps.staticPublishPorts, workspaceId: deps.workspaceId, jobId: active.jobId })?.jobId, message: "A publish is already running. Call deployment_get_static_publish_status with this jobId (or {} for the latest job on this site). Do not start another publish." };
          }
          const job = startPublishRun({
            deps: { ...deps.staticPublishPorts, credentialSource, loadDeployTargets: deployTargetsLoader(deps), buildTarget: deps.buildTarget, tracker: deps.tracker, observability: deps.observability, hostKit: deps.hostKit, formDestination: deps.formDestination, publicPageSecurityHeaders: deps.publicPageSecurityHeaders, pluginExportHosts: deps.pluginExportHosts },
            input: { requestId: approvedCtx.executionId, productEvent: { userId: approvedCtx.principal.id, source: "assistant" }, workspaceId: deps.workspaceId, publishOutputRootDir: deps.publishOutputRootDir, idGen: deps.idGen, exportSiteBound: deps.exportSiteBound, config, projectName,
              ...toolCredentialChoice({ raw }) },
            clock: { nowIso: () => clockNowIso({ clock: deps.clock }) },
            historyStore,
          }, { triggeredBy: "agent_tool", onSettled });
          return { published: false, accepted: true, jobId: job.jobId, status: job.status, progress: job.progress,
            message: "Publish started in the background. Call deployment_get_static_publish_status with this jobId in 5 seconds for progress and the final result. Do not publish again while it is running." };
}

    /** Validates and starts the existing background publish path after approval. The job owns
     * its lifetime; the initiating delegated call can finish or be cancelled independently. */
export async function executeStaticPublish({ deps, surfaces, credentialSource, historyStore, inputCtx, optional }: { deps: StaticPublishToolDeps; surfaces: AssistantSurfaceDeps; credentialSource: PublishCredentialSource; historyStore: PublishHistoryStore; inputCtx: Parameters<ToolHandler>[0]; optional: NonNullable<Parameters<ToolHandler>[1]> }) {
      // Keep the same detached proposal/actor snapshot the former policy wrapper supplied before
      // any asynchronous registry or permission read; later cards and effects use only this call.
      const ctx = { ...inputCtx, input: structuredClone(inputCtx.input), principal: { ...inputCtx.principal }, run: { ...inputCtx.run } };
      const raw = requireInputRecord({ input: ctx.input });
      const registry = await deployTargetsLoader(deps)({ workspaceId: deps.workspaceId });
      const loaded = requireStaticPublishTarget(raw, registry);
      const target = loaded.descriptor.id;
      const projectName = requireString({ input: raw, key: "projectName" });

      await deps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "deployments.publish" }, { entityType: SITE_PUBLISH_ENTITY });

      const { config, plan } = planToolPublish({ registry, raw, target: loaded });
      if (!plan.ok) {
        trackBlockedToolPublish({ deps, principalId: ctx.principal.id, target, reasonClass: "config" });
        throw new ToolInputError({ message: `deployment_execute_static_publish: ${plan.message}` });
      }
      const consent = await deps.checkToolPublishConsent({ deps, principalId: ctx.principal.id });
      if (consent) {
        trackBlockedToolPublish({ deps, principalId: ctx.principal.id, target, reasonClass: "consent" });
        return { published: false, cancelled: false, ...consent };
      }

      const onSettled = () => {
        const settled = getPublishJobSnapshot({ deps: deps.staticPublishPorts, workspaceId: deps.workspaceId, requestId: ctx.executionId });
        if (settled?.result && optional.emitSurface) {
          const mapped = mapPublishOutcomeToToolResult({ deps, outcome: settled.result, exchange: { id: settled.jobId }, config, detailRows: [], projectName: "" });
          void optional.emitSurface(mapped.outcome).catch(() => deps.staticPublishPorts.warn("[static-publish] result card could not be delivered; read deployment_get_static_publish_status for the result"));
        }
      };
      if (config.customDomain && loaded.module.preview) {
        return domainPublishTool({ deps, surfaces, credentialSource, historyStore, config, projectName, onSettled,
          ...toolCredentialChoice({ raw }) })(ctx, optional);
      }

      // Never decrypts (same `isConfigured()` contract the preview/capabilities handlers use above).
      // Refuse unavailable credentials before starting an export.
      const readiness = await credentialSource.isConfigured({ workspaceId: deps.workspaceId, target, ...toolCredentialChoice({ raw }) });
      if (!readiness.configured) {
        trackBlockedToolPublish({ deps, principalId: ctx.principal.id, target, reasonClass: "config" });
        return {
          published: false,
          cancelled: false,
          reason: "no-credential",
          credentialSetup: deps.issueCredentialSetup({ setupToolId: "credential_save", prefill: { kind: "publish-host", target } }, {}),
          message: `No publish credential is configured for '${target}'. Call credential_save with kind publish-host to open its secure card, then retry once. The admin's Static Site tab is an alternative. (${readiness.reason})`,
        };
      }

      if (ctx.signal.aborted) return { published: false, cancelled: false, reason: "abandoned" };

      // This domain owns one approval: the detailed domain plan above, or the ordinary publish
      // card below. A second registration wrapper would ask twice for a domain publication.
      return deps.approvalToolHandler({
        surfaces,
        prepare: async () => deps.toolApprovalConfirmation({ descriptor: { id: 'deployment_execute_static_publish', metadata: toolMetadata.deployment_execute_static_publish, inputSchema: EXECUTE_STATIC_PUBLISH_SCHEMA },
          input: raw, locale: await deps.resolveOperatorLocale({ deps, workspaceId: deps.workspaceId, principalId: ctx.principal.id }) }),
        describe: ({ prepared }, _options = {}) => ({ ...prepared, toolId: 'deployment_execute_static_publish' }),
        run: async ({ ctx: approvedCtx }, _options = {}) =>
          startApprovedStaticPublish({ deps, approvedCtx, target, credentialSource, config, projectName, raw, historyStore, onSettled }),
      }, { flag: 'published' })(ctx, optional);
}

