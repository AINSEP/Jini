import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import type { ChangeSetRecord } from "@jini-ai/core/contracts/events";

import {
  ChangeSetInvalidStatusError, ChangeSetNotFoundError, RevertConflictError, RevertForbiddenError, RevertNotPossibleError,
  revertChangeSet, type RevertChangeSetDeps,
} from "../../../core/commands/revert.js";
import type { RevertRegistry } from "../../../core/commands/appliers.js";
import { authorizeChangeSet, changeSetIdParam, type ChangeSetRoutePrincipal } from "./shared.js";

/** The deps this route reads: the service's own collaborators (all required here, the host decides
 *  explicitly), the registry it reverts through, and the host's change-set header DTO. */
export interface ChangeSetRevertRouteDeps extends Required<Pick<RevertChangeSetDeps, "changeSets" | "clock" | "idGen" | "outbox">> {
  workspaceId: string;
  /** The SAME registry the host's agent revert tool uses — one shared instance, so a human revert and an
   *  agent revert can never disagree on what a change set's inverse is. */
  revertRegistry: RevertRegistry;
  toChangeSetHeader: (required: { changeSet: ChangeSetRecord }) => object;
}

/** One `catch` rung: which thrown error maps to which status/code, plus the structured `details` it carries. */
interface RevertErrorMapping {
  readonly matches: (required: { err: unknown }) => boolean;
  readonly status: number;
  readonly code: string;
  readonly details?: (required: { err: unknown }) => unknown;
}

/**
 * This route's thrown error types onto the admin error envelope, in the order the hand-written ladder
 * checked them. `RevertForbiddenError` is before `RevertConflictError` only by file convention (matching
 * the post-update route's 403-checks-first ordering): the two classes are unrelated, so ordering has no
 * `instanceof` hazard here.
 */
const REVERT_ERRORS: readonly RevertErrorMapping[] = [
  { matches: ({ err }) => err instanceof ChangeSetNotFoundError, status: 404, code: "CHANGE_SET_NOT_FOUND" },
  { matches: ({ err }) => err instanceof ChangeSetInvalidStatusError, status: 409, code: "CHANGE_SET_INVALID_STATUS" },
  { matches: ({ err }) => err instanceof RevertForbiddenError, status: 403, code: "REVERT_FORBIDDEN", details: ({ err }) => ({ reason: (err as RevertForbiddenError).reasonCode }) },
  {
    matches: ({ err }) => err instanceof RevertConflictError, status: 409, code: "REVERT_CONFLICT",
    details: ({ err }) => ({ currentVersion: (err as RevertConflictError).currentVersion, currentActorId: (err as RevertConflictError).currentActorId }),
  },
  { matches: ({ err }) => err instanceof RevertNotPossibleError, status: 422, code: "REVERT_NOT_POSSIBLE" },
];

/**
 * Refuses with the first matching rung's status and the error's own message (the revert details are not a
 * permission/reason pair, so the refusal is built directly); anything unmapped is rethrown unchanged so the
 * host's error port answers it as an unexpected (redacted) failure.
 * @complexity O(n) in the fixed five-rung table.
 */
function rejectRevertError({ err }: { err: unknown }, _optional: Record<string, never> = {}): never {
  const mapping = REVERT_ERRORS.find((candidate) => candidate.matches({ err }));
  if (!mapping) throw err;
  const error = (err as Error).message;
  const body = mapping.details ? { error, code: mapping.code, details: mapping.details({ err }) } : { error, code: mapping.code };
  throw new RouteRefusalError({ status: mapping.status, body });
}

/** The authenticated principal; a mount without one is a wiring bug, so it fails closed (before authorizing, as the host did). */
function revertPrincipal({ context }: { context: ChangeSetRoutePrincipal | undefined }, _optional: Record<string, never> = {}): ChangeSetRoutePrincipal {
  if (!context) throw new Error("change-sets admin route has no authenticated principal");
  return context;
}

/**
 * POST revert an applied change set (SPEC-001 REQ-07/08/10).
 *
 * Gated by the existing `changeset.revert` permission, checked directly via `authorize()` —
 * `revertChangeSet` is a standalone `core/commands` function called directly by this route, not
 * routed through `executeCommand` (that gateway wraps forward mutations, not reverts), so this
 * uses the same in-route pattern as `members/disable.ts` rather than the gateway pair.
 *
 * Task 14b (2026-09-18): accepts an optional `force: true` body field, which is itself the
 * "operator explicitly clicked through a warning" signal — the same shape
 * `@jini-ai/db/recovery/recovery-orchestrator`'s `disclosureAcknowledged` uses (a single
 * strictly-`=== true` boolean the caller must deliberately set), not the full
 * `gated-mutations` plan -> confirm -> execute token ceremony, which is a separate, heavier
 * primitive this route has no other reason to adopt. `force` is forwarded to `revertChangeSet`
 * alongside `principal.kind` so the agent-cannot-force rule is enforced once, in `core/commands`,
 * not re-implemented at this layer.
 */
export const changeSetRevertRoute = defineJsonRoute<{ changeSetId: string; force: boolean }, { changeSet: object }, ChangeSetRevertRouteDeps, ChangeSetRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/change-sets/:changeSetId/revert",
  // The body is optional; only a literal `true` forces (anything else, including the string "true", does not).
  parse: (raw) => ok({ value: { changeSetId: changeSetIdParam(raw.params), force: (raw.body as { force?: unknown } | null | undefined)?.force === true } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = revertPrincipal({ context });
    await authorizeChangeSet({ authorize, permission: "changeset.revert" }, { entityId: input.changeSetId });
    try {
      const reverted = await revertChangeSet({
        deps: { changeSets: deps.changeSets, registry: deps.revertRegistry, clock: deps.clock, idGen: deps.idGen, outbox: deps.outbox },
        input: { workspaceId: deps.workspaceId, changeSetId: input.changeSetId, force: input.force, principalKind: principal.kind },
      });
      return ok({ value: { changeSet: deps.toChangeSetHeader({ changeSet: reverted }) } });
    } catch (err) {
      return rejectRevertError({ err });
    }
  },
});
