import { TokenExpiredError, TokenAlreadyRedeemedError } from "@jini-ai/core/gated-mutations";
import { ToolInputError, type ToolHandler } from "@jini-ai/core";
import { nowIso } from "@jini-ai/core/primitives";
import { adaptLegacyAuthorize } from "@jini-ai/core/tool-permissions";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { PlanStaleError, ForbiddenError, type GatewayDeps } from "@jini-ai/core/gated-mutations";
import type { GatedMutationHooks } from "@jini-ai/core/gated-mutations";

import type { StaticPublishToolDeps } from "../publish-tool-deps.js";
import type { StaticPublishConfig, PublishCredentialSource } from "@jini-ai/devops/deploy/site/static-publish/types";
import { inspectStaticPublish, type StaticPublishInspection } from "./inspection.js";
import { getPublishRunSnapshot, startPublishRun, type PublishRunSnapshot } from "./publish-run.js";
import { domainPublishRows } from "@jini-ai/devops/deploy/site/static-publish/domain-publish-rows";
import type { PublishHistoryStore } from "./publish-history.js";

interface DomainPublishDetails extends StaticPublishInspection {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly config: StaticPublishConfig;
  readonly projectName: string;
}

/** CMS wiring only: the existing gateway owns authorization/token/hash/single-use semantics;
 * the existing human exchange owns consent. Nothing in a model request can create this capability.
 * No new approval store, domain ledger, journal or automatic rollback is introduced. */
export function domainPublishTool(required: {
  deps: StaticPublishToolDeps;
  surfaces: AssistantSurfaceDeps;
  credentialSource: PublishCredentialSource;
  historyStore: PublishHistoryStore;
  config: StaticPublishConfig;
  projectName: string;
  credentialId?: string;
  onSettled?: () => void;
}, _options = {}): ToolHandler {
  const { deps, surfaces, config, projectName } = required;
  const gateway = deps.gatedMutations?.gatewayDeps;
  if (!gateway) throw new ToolInputError({ message: 'DOMAIN_APPROVAL_UNAVAILABLE: The shared mutation gateway is not configured. Contact the installation owner; no domain changes were made.' });
  return deps.approvalToolHandler({
    surfaces,
    prepare: async ({ ctx }, _options = {}) => {
      const hooks = makeHooks({ ...required, gateway, actorId: ctx.principal.id, signal: ctx.signal, requestId: ctx.executionId });
      const planned = await deps.gatewayPlan({ deps: gateway, principalId: ctx.principal.id, principalKind: 'agent', hooks });
      const details = planned.details as DomainPublishDetails;
      return { hooks, planned, details };
    },
    describe: ({ prepared: { details } }, _options = {}) => {
      if (!details.inspection) throw new Error('Domain publish plan has no inspection');
      return {
        toolId: 'deployment_execute_static_publish', errorCode: 'DOMAIN_PUBLISH', title: 'Publish and change these domain bindings?',
        details: domainPublishRows({ inspection: details.inspection, projectName, target: config.target }),
        warning: 'The listed records, bindings and whole overlapping routes will be changed. This can interrupt the existing site and other hosts covered by wildcard routes. Mail, TXT and CAA stay unchanged. There is no automatic rollback. Cancel to keep everything as it is.',
        danger: true, confirmLabel: 'Publish and apply these changes',
      };
    },
    run: async ({ ctx, prepared: { hooks, planned }, confirmer }, _options = {}) => {
      const consent = await deps.checkToolPublishConsent({ deps, principalId: ctx.principal.id });
      if (consent) {
        void deps.tracker?.capture({ name: 'site_publish_blocked', userId: ctx.principal.id }, { properties: { target: config.target, reasonClass: 'consent', source: 'assistant' } });
        return { published: false, cancelled: false, ...consent };
      }
      const token = await deps.gatewayConfirm({ deps: gateway, principalId: confirmer.id, principalKind: confirmer.kind, hooks, planId: planned.planId, planHash: planned.planHash });
      const result = await executeDomainPublish({ deps, gateway, principalId: ctx.principal.id, hooks, confirmationToken: token.confirmationToken });
      return { accepted: true, published: false, jobId: result.jobId, status: result.status, progress: result.progress,
        message: 'Publish started after domain approval. Call deployment_get_static_publish_status with this jobId in 5 seconds for progress and the final result. Do not publish again while it is running.' };
    },
  }, { flag: 'published' });
}

/** Preserve typed gateway refusals through the tool transport's caller-safe error channel. */
async function executeDomainPublish(required: {
  deps: StaticPublishToolDeps; gateway: GatewayDeps; principalId: string; hooks: GatedMutationHooks<DomainPublishDetails, PublishRunSnapshot>; confirmationToken: string;
}, _options = {}): Promise<PublishRunSnapshot> {
  try { return await required.deps.gatewayExecute({ deps: required.gateway, principalId: required.principalId, principalKind: 'agent', hooks: required.hooks, confirmationToken: required.confirmationToken }); }
  catch (error) {
    if (error instanceof PlanStaleError) throw new ToolInputError({ message: 'DOMAIN_PLAN_STALE: Infrastructure or the connection changed after review. Preview and confirm the current state; no publish or domain changes were started.' });
    if (error instanceof TokenExpiredError) throw new ToolInputError({ message: 'DOMAIN_APPROVAL_EXPIRED: The domain approval expired. Preview and confirm again.' });
    if (error instanceof TokenAlreadyRedeemedError) throw new ToolInputError({ message: 'DOMAIN_APPROVAL_ALREADY_USED: This approval was already used. Inspect the last publish and preview again.' });
    if (error instanceof ForbiddenError) throw new ToolInputError({ message: 'DOMAIN_APPROVAL_FORBIDDEN: Permission or the approving person changed. Ask the installation owner to restore access, then preview again.' });
    throw error;
  }
}

function makeHooks(required: {
  deps: StaticPublishToolDeps; gateway: GatewayDeps; surfaces: AssistantSurfaceDeps;
  credentialSource: PublishCredentialSource; historyStore: PublishHistoryStore;
  config: StaticPublishConfig; projectName: string; credentialId?: string; onSettled?: () => void; actorId: string; signal: AbortSignal; requestId: string;
}, _options = {}): GatedMutationHooks<DomainPublishDetails, PublishRunSnapshot> {
  const { deps, credentialSource, historyStore, config, projectName, actorId, signal } = required;
  const expiresAt = Date.parse(nowIso({ clock: deps.clock })) + 600_000;
  return {
    domain: 'deployment.static-publish-domain', scopeId: deps.workspaceId, readPermission: 'deployments.read', mutatePermission: 'deployments.publish',
    resolveActorClassIdentity: deps.resolveActorClassIdentity,
    computePlan: async () => {
      const inspected = await inspectStaticPublish({ deps: { ...deps.staticPublishPorts, credentialSource, loadDeployTargets: deps.loadDeployTargets, tracker: deps.tracker, observability: deps.observability, hostKit: deps.hostKit, formDestination: deps.formDestination },
        input: { workspaceId: deps.workspaceId, config, projectName, ...(required.credentialId ? { credentialId: required.credentialId } : {}) } });
      if (inspected.inspection?.domains?.inventoryStatus !== 'complete') throw new ToolInputError({ message: `DOMAIN_INVENTORY_UNKNOWN: ${inspected.inspection?.domains?.message ?? 'Complete authenticated domain inspection is required. Preview again.'}` });
      const details = { ...inspected, workspaceId: deps.workspaceId, actorId, config, projectName };
      return { details, planHash: inspectionPlanHash({ details, deps }) };
    },
    executeMutation: async ({ details }) => {
      signal.throwIfAborted();
      if (getPublishRunSnapshot(deps.staticPublishPorts).status === 'running') throw new ToolInputError({ message: 'ALREADY_RUNNING: A publish is running. Wait for it to finish, then preview again.' });
      const domainPlan = details.inspection?.domains;
      if (!domainPlan) throw new Error('Domain publish plan has no domain inspection');
      if (!details.credentialBinding) throw new Error('Domain publish plan has no credential binding');
      return startPublishRun({ deps: { ...deps.staticPublishPorts, credentialSource, loadDeployTargets: deps.loadDeployTargets, tracker: deps.tracker, observability: deps.observability, hostKit: deps.hostKit, formDestination: deps.formDestination, publicPageSecurityHeaders: deps.publicPageSecurityHeaders, pluginExportHosts: deps.pluginExportHosts }, input: {
        requestId: required.requestId, productEvent: { userId: actorId, source: "assistant" }, workspaceId: deps.workspaceId, publishOutputRootDir: deps.publishOutputRootDir, idGen: deps.idGen, exportSiteBound: deps.exportSiteBound,
        config, projectName, ...(details.credentialId ? { credentialId: details.credentialId } : {}),
        domainApproval: { plan: domainPlan, credentialBinding: details.credentialBinding, authorize: async ({ fingerprint }) => {
          // The approved background job outlives the initiating call. Recheck permission and
          // approval expiry here; cancelling that call after enqueue does not revoke this job.
          await deps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: actorId, permission: 'deployments.publish' });
          return fingerprint === domainPlan.fingerprint && Date.parse(nowIso({ clock: deps.clock })) <= expiresAt;
        } },
      }, clock: { nowIso: () => nowIso({ clock: deps.clock }) }, historyStore }, { triggeredBy: "agent_tool", ...(required.onSettled ? { onSettled: required.onSettled } : {}) });
    },
  };
}

/** The plugin fingerprint binds exact inventory and operations canonically. Preserve that contract:
 * response ordering alone must not invalidate a human's consent at the shared gateway. */
function inspectionPlanHash({ details, deps }: { deps: StaticPublishToolDeps; details: DomainPublishDetails }, _options = {}): string {
  const inspected = details.inspection;
  if (!inspected?.domains) throw new Error('Domain publish plan has no domain inspection');
  return deps.planHashOf({ details: { ...details, inspection: { resourceName: inspected.resourceName, targetId: inspected.targetId,
    hostingChanges: inspected.hostingChanges, domainFingerprint: inspected.domains.fingerprint } } });
}
