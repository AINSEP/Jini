import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { toAdminMemberResponse, type AdminMemberEnvelope, type AdminMemberSource } from "../../http/members.js";
import { authorizeMemberManage, memberIdParam, rejectMemberError, type MemberErrorClassifier, type MemberErrorStatuses, type MemberRoutePrincipal } from "./shared.js";

/**
 * Disables one member and revokes its live sessions. Injected because the write service is the
 * host's members library: it throws the library's not-found for a missing member and, defensively,
 * its validation error. Idempotent: disabling an already-disabled member returns it unchanged.
 */
export type MemberDisableFn = (required: { workspaceId: string; memberId: string }) => Promise<{ member: AdminMemberSource }>;

/** The deps this route reads. */
export interface MemberDisableRouteDeps {
  workspaceId: string;
  disableMember: MemberDisableFn;
  classifyMemberError: MemberErrorClassifier;
  /** The host's product copy for a disable that lost the member compare-and-set (C058), answered verbatim. */
  versionConflictMessage: string;
}

/** The ladder the hand-written route had: a miss and the (currently dead, defensive) validation error. A conflict is
 *  answered separately, with the host's reload copy rather than the library's message (C058). */
const MEMBER_DISABLE_ERRORS: MemberErrorStatuses = { "not-found": 404, validation: 400 };

/**
 * POST disable a member (ADR-021 §5): retain it in the roster while revoking access.
 * Owner 2026-10-24 adds a separate DELETE-to-Trash route; neither route hard-deletes. Idempotent at the
 * write-service layer: disabling an already-disabled member returns 200 with
 * the unchanged record rather than erroring.
 *
 * SPEC-006 REQ-05 wiring proof (second route, alongside posts create/update):
 * this route does not flow through the SPEC-001 command gateway (no
 * change-set is recorded for a member disable — a pre-existing gap unrelated
 * to this spec, see the Programmer handoff), so `authorize()` is called
 * directly rather than via `executeCommand`'s `deps.authorize` hook.
 */
export const memberDisableRoute = defineJsonRoute<{ memberId: string }, AdminMemberEnvelope, MemberDisableRouteDeps, MemberRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/members/:memberId/disable",
  parse: (raw) => ok({ value: { memberId: memberIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMemberManage({ authorize }, { entityId: input.memberId });
    try {
      const result = await deps.disableMember({ workspaceId: deps.workspaceId, memberId: input.memberId });
      return ok({ value: { member: toAdminMemberResponse(result.member) } });
    } catch (err) {
      // C058: a disable that lost the member compare-and-set to a concurrent writer is a `409 VERSION_CONFLICT`
      // carrying the admin's reload copy, not an opaque 500; the code lets any caller classify it like the
      // other editors' stale saves.
      if (deps.classifyMemberError({ err }) === "conflict") rejectRoute({ status: 409, code: "VERSION_CONFLICT", error: deps.versionConflictMessage });
      return rejectMemberError({ err, classify: deps.classifyMemberError, statuses: MEMBER_DISABLE_ERRORS });
    }
  },
});
