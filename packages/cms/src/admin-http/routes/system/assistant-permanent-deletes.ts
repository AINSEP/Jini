import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { OwnerGrantBody, OwnerGrantPolicy } from "./assistant-owner-grant.js";

/**
 * @file The site owner's permanent-delete grant for the assistant, on the shared acknowledged and
 * audited owner-grant ceremony (`assistant-owner-grant.ts`). The host binds the storage coordinates,
 * its owner-only copy, the supported tool ids and the policy reader.
 */

export const ASSISTANT_PERMANENT_DELETES_PATH = "/api/admin/v1/workspaces/:workspaceId/system/assistant-permanent-deletes";

/** The stored grant: the master switch and the tools it allows. */
export interface PermanentDeletesGrant { enabled: boolean; allowedToolIds: string[] }

/** The deps this grant reads (host-bound). */
export interface AssistantPermanentDeletesRouteDeps {
  grant: { namespace: string; key: string; writeReason: string };
  /** Every supported permanent-delete tool id; anything else is refused. */
  permanentDeleteToolIds: readonly string[];
  readPolicy(): Promise<PermanentDeletesGrant>;
}

const BODY_KEYS = ["enabled", "allowedToolIds", "riskAcknowledged"];

/** Reject the complete selection before any receipt or value write; never silently discard bad ids.
 * @complexity O(k·n) for k requested ids over n supported tools (both small and bounded). */
function parsePermanentDeletesGrant({ body, toolIds }: { body: OwnerGrantBody; toolIds: readonly string[] }, _optional = {}): PermanentDeletesGrant {
  const allowedToolIds = body.allowedToolIds;
  const validKeys = !Object.keys(body).some((key) => !BODY_KEYS.includes(key));
  const validIds = Array.isArray(allowedToolIds) && allowedToolIds.length <= toolIds.length
    && !allowedToolIds.some((id) => !toolIds.includes(id));
  if (!validKeys || !validIds || new Set(allowedToolIds).size !== allowedToolIds.length) {
    rejectRoute({ status: 400, code: "VALIDATION_ERROR", error: `allowedToolIds must contain unique ids from the ${toolIds.length} supported permanent delete tools. Unknown and forbidden ids are rejected.` });
  }
  return { enabled: body.enabled as boolean, allowedToolIds: [...allowedToolIds] as string[] };
}

/** The permanent-delete grant policy (acknowledged enable, workspace scope).
 * @complexity O(1) construction. */
export function assistantPermanentDeletesGrant(deps: AssistantPermanentDeletesRouteDeps, _optional: Record<string, never> = {}): OwnerGrantPolicy<PermanentDeletesGrant> {
  return {
    ...deps.grant,
    validationError: "enabled must be a boolean; enabling permanent deletes requires riskAcknowledged: true.",
    read: () => deps.readPolicy(),
    parse: ({ body }, _parseOptional = {}) => parsePermanentDeletesGrant({ body, toolIds: deps.permanentDeleteToolIds }),
    value: ({ settings }, _valueOptional = {}) => ({ enabled: settings.enabled, allowedToolIds: settings.allowedToolIds }),
  };
}
