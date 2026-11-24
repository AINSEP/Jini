import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { JsonValue } from "@jini-ai/core/primitives";

import type { OwnerGrantBody, OwnerGrantPolicy } from "./assistant-owner-grant.js";

/**
 * @file Owner/site-scoped CLI permissions (the "full CLI" subagents grant) through the existing
 * authenticated, audited owner-grant ceremony. The master writes all defaults; explicit per-agent
 * choices survive until the master is changed. The host binds the capability catalogue, the agent
 * list, its stored-layer reader/patcher, its effective-permission resolver, the read projection and
 * edit policy (environment- and hosting-dependent), and the tool-access lowering.
 */

export const ASSISTANT_SUBAGENTS_PATH = "/api/admin/v1/workspaces/:workspaceId/system/assistant-full-cli";

/** The stored grant: the master switch and one boolean per capability. */
export interface AssistantCliGrant { enabled: boolean; capabilities: Record<string, boolean> }

/** The deps this grant reads (host-bound). Methods so a host may bind narrower grant types. */
export interface AssistantSubagentsRouteDeps {
  grant: { namespace: string; key: string; writeReason: string; uneditableError: string };
  capabilityKeys: readonly string[];
  agentIds: readonly string[];
  /** The owner's effective permissions; a read failure throws. */
  readPermissions(): Promise<AssistantCliGrant>;
  normalize(input: { enabled: boolean; capabilities?: Partial<Record<string, boolean>> }): AssistantCliGrant;
  projectRead(input: { settings: AssistantCliGrant; isOwner: boolean }): object;
  canEdit(input: { isOwner: boolean }): boolean;
  readLayer(): Promise<{ raw: unknown; revisionSeq: number }>;
  patchLayer(input: { raw: unknown; defaults: AssistantCliGrant; agentId?: string; capabilities?: Partial<Record<string, boolean>> }): JsonValue;
  /** One agent's effective grant for the owner (no environment overrides). */
  resolveAgentPermissions(input: { settings: AssistantCliGrant; agentId: string }): { enabled: boolean; capabilities: Record<string, boolean> };
  lowerToolAccess(input: { agentIds: string[] }): Promise<unknown>;
}

const AGENT_ID = /^[a-z][a-z0-9-]{0,63}$/;

/** Unknown capability keys and non-boolean values are refused, not dropped.
 * @complexity O(c) in the override count. */
function parseCliGrant({ deps, body }: { deps: AssistantSubagentsRouteDeps; body: OwnerGrantBody }, _optional = {}): AssistantCliGrant {
  const overrides = body.capabilities;
  const malformed = overrides !== undefined && (!overrides || typeof overrides !== "object" || Array.isArray(overrides));
  const unknownCapability = !malformed && overrides !== undefined && Object.entries(overrides as object).some(([key, value]) => !deps.capabilityKeys.includes(key) || typeof value !== "boolean");
  if (malformed || unknownCapability) {
    rejectRoute({ status: 400, code: "VALIDATION_ERROR", error: "Unknown capability or non-boolean value." });
  }
  return deps.normalize({ enabled: body.enabled as boolean,
    ...(overrides ? { capabilities: overrides as Partial<Record<string, boolean>> } : {}) });
}

/** A per-agent write patches that agent over the previous master; a master write patches defaults.
 * @complexity O(1) plus one layer read. */
async function prepareCliWrite({ deps, body, settings, previous }: { deps: AssistantSubagentsRouteDeps; body: OwnerGrantBody; settings: AssistantCliGrant; previous: AssistantCliGrant }, _optional = {}) {
  if (body.agentId !== undefined && (typeof body.agentId !== "string" || !AGENT_ID.test(body.agentId))) {
    rejectRoute({ status: 400, code: "VALIDATION_ERROR", error: "Choose a valid agent." });
  }
  const layer = await deps.readLayer();
  if (body.expectedRevisionSeq !== undefined && body.expectedRevisionSeq !== layer.revisionSeq) {
    rejectRoute({ status: 409, code: "REVISION_CONFLICT", error: "Agent permissions changed. Read them again before saving." });
  }
  return { value: deps.patchLayer({ raw: layer.raw, defaults: typeof body.agentId === "string" ? previous : settings,
    ...(typeof body.agentId === "string" ? { agentId: body.agentId, capabilities: body.capabilities as Partial<Record<string, boolean>> } : {}) }), revisionSeq: layer.revisionSeq };
}

/** Re-read, then lower live tool access for every agent that lost its master or a capability.
 * @complexity O(a·c) over agents and capabilities. */
async function lowerRevokedAgents({ deps, previous }: { deps: AssistantSubagentsRouteDeps; previous: AssistantCliGrant }, _optional = {}) {
  const next = await deps.readPermissions();
  const agentIds = deps.agentIds.filter((agentId) => {
    const before = deps.resolveAgentPermissions({ settings: previous, agentId });
    const after = deps.resolveAgentPermissions({ settings: next, agentId });
    return (before.enabled && !after.enabled) || deps.capabilityKeys.some((key) => before.capabilities[key] && !after.capabilities[key]);
  });
  if (agentIds.length) await deps.lowerToolAccess({ agentIds });
  return next;
}

/** The full-CLI grant policy (no acknowledgment, the owner's user scope).
 * @complexity O(1) construction. */
export function assistantSubagentsGrant(deps: AssistantSubagentsRouteDeps, _optional: Record<string, never> = {}): OwnerGrantPolicy<AssistantCliGrant> {
  return {
    ...deps.grant,
    validationError: "enabled and capability values must be booleans.",
    requireAcknowledgment: false, scope: "user",
    read: () => deps.readPermissions(),
    canEdit: (input) => deps.canEdit(input),
    projectRead: (input) => deps.projectRead(input),
    parse: ({ body }, _parseOptional = {}) => parseCliGrant({ deps, body }),
    prepareWrite: ({ body, settings, previous }) => prepareCliWrite({ deps, body, settings, previous }),
    afterWrite: ({ previous }) => lowerRevokedAgents({ deps, previous }),
    value: ({ settings }, _valueOptional = {}) => ({ enabled: settings.enabled, capabilities: { ...settings.capabilities } }),
  };
}
