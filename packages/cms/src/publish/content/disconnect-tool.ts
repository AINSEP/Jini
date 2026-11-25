import { buildDomainRegistrations, indexCatalogById, ToolInputError, type AgentToolDefinition, type DerivedRiskByToolId, type ToolContributor, type ToolRegistration } from "@jini-ai/core";
import type { Clock } from "@jini-ai/core/primitives";
import { adaptLegacyAuthorize, requireToolPermission } from "../../core/tools/index.js";
import { disconnectAndForgetDestination, type GrantReverseResult } from "./connect-destination.js";
import type { PublishContentPeerRepoPort } from "./peer-registry.js";
import { toolMetadata } from "./tool-metadata.js";

/** Only the ports the admin disconnect handler uses; no HTTP handshake or secret decryption. */
export interface PublishContentDisconnectDeps {
  readonly workspaceId: string;
  readonly authorize: Parameters<typeof requireToolPermission>[0]["authorize"];
  readonly clock: Clock;
  readonly idGen: { newId(): string };
  readonly publishContentPeerRepo: PublishContentPeerRepoPort;
  /** Test seam. Absent in production, where the repo's own deploy config is read. */
  readonly findPublishCandidate?: () => Promise<string | null>;
}

/**
 * The host values the disconnect tool needs and the package must not import. Every field is
 * REQUIRED. `D` is the host's deps bag, handed through untouched.
 */
export interface PublishContentDisconnectHost<D extends PublishContentDisconnectDeps> {
  /** The catalog-module path recorded in the tool's registration metadata. */
  readonly catalogModule: string;
  /** Reverses the local grant; called only by the compensated disconnect. */
  reverseGrant(required: { deps: D }, optional?: Record<string, never>): Promise<GrantReverseResult>;
  /** The refusal for a local-settings write failure: the host's error class test and its copy. */
  readonly settingsWriteFailure: { isInstance(required: { error: unknown }, optional?: Record<string, never>): boolean; readonly message: string };
}

export const catalog: readonly AgentToolDefinition[] = [{
  name: "publish_content_disconnect",
  description: "Disconnects this computer from its connected live publish destination, forgetting the connected peer and reversing its local deploy-config grant together. Call to stop publishing to that site; reconnect with publish_content_connect to undo. Returns {connected:false, site:null, candidateUrl, message, nextStep}; nextStep describes a deploy still needed for the grant change. Does not delete remote content or saved credential peers, revoke the live site's immediate deny list, or publish content. A settings write failure is refused with recovery guidance.",
  sideEffects: "mutates-durable-state",
  authorization: { permission: "publish_content.apply" },
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
}];
export const derivedRisk: DerivedRiskByToolId = new Map([
  // disconnectAndForgetDestination -> peer delete/compensating restore + the host's grant reversal (config write).
  ["publish_content_disconnect", "mutates-durable-state"],
]);

/**
 * Builds the `publish_content_disconnect` registration and contributor bound to a host's grant
 * reversal and refusal copy.
 * @returns `buildRegistrations` (one reversible mutation; disconnected calls remain successful) and
 * `contributePublishContentDisconnectTools` (a distinct domain so status/connect tools remain registered).
 * @complexity O(1) wiring; the handler is O(n) in saved peers plus one config write.
 */
export function createPublishContentDisconnectTools<D extends PublishContentDisconnectDeps>({ host }: { host: PublishContentDisconnectHost<D> }, _optional = {}) {
  /**
   * Wires the same compensated disconnect used by the admin destination route.
   * @param deps - Workspace, authorization, connected-peer and local grant ports.
   * @returns One reversible mutation; disconnected calls remain successful.
   * @throws ToolInputError when local settings cannot be saved; unexpected port faults propagate.
   * @complexity O(1) wiring; handler O(n) in saved peers plus one config write.
   */
  function buildRegistrations(deps: D): ToolRegistration[] {
    return buildDomainRegistrations({ metadata: toolMetadata, domain: "publish-content-disconnect", catalogModule: host.catalogModule, catalog: indexCatalogById({ catalog: catalog }), derivedRisk,
      handlers: { publish_content_disconnect: async ctx => {
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "publish_content.apply" });
        try {
          const removed = await disconnectAndForgetDestination({
            deps: { repo: deps.publishContentPeerRepo, clock: deps.clock, idGen: deps.idGen, reverseGrant: () => host.reverseGrant({ deps }) },
            input: { workspaceId: deps.workspaceId },
          });
          return { connected: false, site: null, candidateUrl: removed.site?.baseUrl ?? await (deps.findPublishCandidate ?? (async () => null))(),
            message: removed.site ? `This computer no longer publishes to ${removed.site.label}.` : "This computer was not publishing anywhere.",
            nextStep: removed.changed ? removed.target?.nextStep ?? null : null };
        } catch (error) {
          if (host.settingsWriteFailure.isInstance({ error })) throw new ToolInputError({ message: host.settingsWriteFailure.message });
          throw error;
        }
      } },
    });
  }

  /** Contributes a distinct domain so status/connect tools remain registered. */
  function contributePublishContentDisconnectTools(): ToolContributor<D, unknown> {
    return { domain: "publish-content-disconnect", build: buildRegistrations, risk: derivedRisk };
  }

  return { buildRegistrations, contributePublishContentDisconnectTools };
}
