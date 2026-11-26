export { buildPublishHostCredentialHandler } from './publish-tool-credential.js';
import { deployTargetsLoader, requireStaticPublishTarget, mapPublishOutcomeToToolResult, previewStaticPublish, executeStaticPublish } from './publish-tool-execution.js';
import { getStaticPublishCapabilities } from './publish-tool-capabilities.js';
import { readCredentialHints } from './publish-tool-credential.js';
import { ToolInputError, buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration, type ToolContributor } from '@jini-ai/core';
import { adaptLegacyAuthorize } from '@jini-ai/core/tool-permissions';
import type { StaticPublishToolDeps } from './publish-tool-deps.js';
import type { AssistantSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import { toolMetadata } from '@jini-ai/core/tool-metadata/deployments';
import { publishJobRecoveryMessage } from '../index.js';
import { composePublishCredentialSource } from './static-publish/credentials.js';
import { getPublishJobSnapshot } from './static-publish/publish-run.js';

const DEPLOYMENTS_READ_PERMISSION = "deployments.read";
const SITE_PUBLISH_ENTITY = "site-publish";

/** `deployment_preview_static_publish`'s input — the same target-discriminated shape
 *  `publish-site.ts`'s trigger route body uses, with optional `projectName` for authenticated provider inspection. A preview never runs a real
 *  publish. Reused (spread) by
 *  {@link EXECUTE_STATIC_PUBLISH_SCHEMA} below, which adds the one field a real publish needs. */
const PREVIEW_STATIC_PUBLISH_SCHEMA = {
  type: "object",
  // Each host's own config fields (its `configFields` in deployment_get_static_publish_capabilities),
  // as top-level strings. The handler refuses any key the chosen host does not declare.
  additionalProperties: { type: "string" },
  required: ["target"],
  properties: {
    projectName: { type: "string", title: "Project name", description: "Use the same project label at preview and execute. Required for authenticated provider resource/domain inspection." },
    credentialId: { type: "string", title: "Saved connection", description: "Optional saved connection chosen by the person; preview and execute use this exact connection." },
    target: {
      type: "string",
      title: "Hosting provider",
      description:
        "Which host to publish to: one of the providerId values deployment_get_static_publish_capabilities lists. Pass that host's configFields as top-level string fields next to target (for example { target, <fieldName>: '<value>' }); a field the host does not declare is refused. The base path is computed from the host and the config, never passed in.",
    },
  },
} as const;

/** `deployment_execute_static_publish`'s input — {@link PREVIEW_STATIC_PUBLISH_SCHEMA}'s fields plus
 *  `projectName`, the one field a real publish needs that a preview does not. Carries only an optional saved connection ID, never a
 *  token or usable credential — see this file's header for why that is structural, not just
 *  undocumented. */
export const EXECUTE_STATIC_PUBLISH_SCHEMA = {
  type: "object",
  additionalProperties: PREVIEW_STATIC_PUBLISH_SCHEMA.additionalProperties,
  required: ["target", "projectName"],
  properties: {
    ...PREVIEW_STATIC_PUBLISH_SCHEMA.properties,
    projectName: {
      type: "string",
      title: "Project name",
      description: "Human-facing label for this publish run: the host uses it as the commit message or the project-name seed. 1-200 characters.",
    },
  },
} as const;

/**
 * This wiring layer's OWN risk classification, independent of the catalog's `sideEffects`
 * declaration (`@jini-ai/cms/core`'s `assertToolIsWirable` cross-checks the two and refuses to wire
 * on disagreement).
 */
export const staticPublishDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> resolves credential presence (`PublishCredentialSource.isConfigured`, read-only) and validates
  // config shape (`validateStaticPublishConfig`, pure). Authenticated provider inspection may
  // resolve server-side for GETs only; no provisioning, uploads or export run.
  ["deployment_preview_static_publish", "none"],
  ["deployment_get_static_publish_status", "none"],
  // -> `listPublishCredentials` (a pure DB read, never decrypts — `publish-credentials/store.ts`'s own
  // doc) plus `PublishCredentialSource.isConfigured` per provider (same non-decrypting contract the
  // preview tool relies on). No write, no decrypt, no network call.
  ["deployment_get_static_publish_capabilities", "none"],
  // -> on confirm, calls `publishStaticSite`: a real `exportSite` pass plus a real provider API call
  // (the selected host plugin's deploy target) using a write-scoped credential — genuinely mutates
  // external durable state. See this file's header for the full risk story.
  ["deployment_execute_static_publish", "mutates-durable-state"],
  // -> on submit, calls `createPublishCredential`/`updatePublishCredential` — a real encrypted write to
  // `vendor_credential_sets`.
  // No secret ever transits the model (see this file's header/the catalog entry's own comment); the
  // write itself is still a genuine external-account-scoped mutation, same category (not merely "some
  // risk classification") as the publish tool above.

  // -> the host plugin module's pure `hostingSetup` over the caller's non-secret fields (never a saved
  // credential). No write, no network call, no decrypt.
  ["deployment_generate_bucket_hosting_setup", "none"],
]);

// Cross-site discovery used to offer another site's key for a missing host. That reveals private
// inventory to a site agent. Offer the owner picker instead; the model never receives its choices.
export function buildStaticPublishRegistrations(deps: StaticPublishToolDeps, surfaces: AssistantSurfaceDeps): ToolRegistration[] {
  const credentialSource =
    deps.credentialSource ??
    composePublishCredentialSource({
      workspaceId: deps.workspaceId,
      executionMode: deps.publishExecutionMode,
      env: deps.env,
      dbDeps: { ...deps.credentialSourceStorePorts, repo: deps.vendorCredentialSetRepo, sealer: deps.siteAssistantSecretSealer, loadDeployTargets: deployTargetsLoader(deps) },
    });
  const historyStore = deps.historyStore ?? deps.publishHistoryStore;

  const handlers: Record<string, ToolHandler> = {
    deployment_preview_static_publish: async (ctx) => previewStaticPublish({ deps, credentialSource, ctx }),

    deployment_get_static_publish_capabilities: async (ctx) => getStaticPublishCapabilities({ deps, credentialSource, historyStore, ctx }),

    /** Permission-checked job reads; no credentials or provider requests on the polling path. */
    deployment_get_static_publish_status: async (ctx) => {
      const raw = requireInputRecord({ input: ctx.input ?? {} });
      for (const key of Object.keys(raw)) if (key !== "jobId" && key !== "executionId") throw new ToolInputError({ message: `Unknown publish-status field '${key}'. Pass jobId or executionId, or {} for this site's latest publish.` });
      const jobId = raw.jobId === undefined ? undefined : requireString({ input: raw, key: "jobId" });
      const requestId = raw.executionId === undefined ? undefined : requireString({ input: raw, key: "executionId" });
      await deps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: DEPLOYMENTS_READ_PERMISSION }, { entityType: SITE_PUBLISH_ENTITY });
      const snapshot = getPublishJobSnapshot({ deps: deps.staticPublishPorts, workspaceId: deps.workspaceId, jobId, requestId });
      if (!snapshot) return { code: "PUBLISH_JOB_NOT_FOUND", message: "No retained publish job was found for this site. A restart clears job snapshots. Check the hosting dashboard before starting another publish." };
      const mapped = snapshot.result ? mapPublishOutcomeToToolResult({ deps, outcome: snapshot.result, exchange: { id: snapshot.jobId }, config: { target: snapshot.target }, detailRows: [], projectName: "" }) : undefined;
      return { ...snapshot, ...(mapped ? { result: mapped.result } : {}),
        message: publishJobRecoveryMessage({ job: snapshot, statusToolId: "deployment_get_static_publish_status" }) };
    },

    deployment_execute_static_publish: async (inputCtx, optional = {}) => executeStaticPublish({ deps, surfaces, credentialSource, historyStore, inputCtx, optional }),

    /**
     * The MCP-UI form-gated credential save for any host whose plugin declares a credential. Same
     * Opens an exchange, emits a form, then uses `askThenReport` to replace it with the real save
     * outcome: the model proposes structure for a human to fill in.
     *
     * The schema has no secret property, and a secret or undeclared field is refused before any form
     * is raised. The human's typed secret lands in `answer.params` server-side and is sealed by
     * `publish-credentials/store.ts`; it never enters a prompt or a completion, and the result never
     * echoes any field.
     */
    /**
     * Pure read — the host plugin module's own `hostingSetup` over the caller's non-secret credential
     * fields (never a saved credential). A host with no such steps is refused with the reason.
     */
    deployment_generate_bucket_hosting_setup: async (ctx) => {
      const raw = requireInputRecord({ input: ctx.input });
      const loaded = requireStaticPublishTarget(raw, await deployTargetsLoader(deps)({ workspaceId: deps.workspaceId }));
      const { descriptor, module } = loaded;
      if (module.hostingSetup === undefined) throw new ToolInputError({ message: `${descriptor.id} has no hosting-setup steps: publishing to it serves the site.` });
      const fields = readCredentialHints(raw, descriptor, deps);

      await deps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: DEPLOYMENTS_READ_PERMISSION }, { entityType: SITE_PUBLISH_ENTITY });

      try {
        return module.hostingSetup({ fields });
      } catch (err) {
        throw new ToolInputError({ message: err instanceof Error ? err.message : String(err) });
      }
    },
  };

  // No `unwiredToolIds`: this domain now wires its ENTIRE catalog, same tripwire discipline as
  // Posts/Pages/Forms/Entries/Widgets — a 4th catalog entry added without a handler fails the build.
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "static-publish",
    catalogModule: "@jini-ai/devops/deploy/site/publish-agent-tools",
    catalog: indexCatalogById({ catalog: deps.catalog }),
    handlers,
    derivedRisk: staticPublishDerivedRisk,
  });
}

/**
 * Contributes Static Publish's AI tools; called once by the composition root's
 * `installFirstPartyToolContributors()`, never as an import side effect.
 * See ./tool-registrations.ts for the shared deployments/credential dependency boundary.
 */
export function contributeStaticPublishTools(): ToolContributor<StaticPublishToolDeps, AssistantSurfaceDeps> {
  return { domain: "static-publish", build: buildStaticPublishRegistrations, risk: staticPublishDerivedRisk };
}
