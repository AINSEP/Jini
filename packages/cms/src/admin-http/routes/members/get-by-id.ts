import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { toAdminMemberResponse, type AdminMemberEnvelope, type AdminMemberSource } from "../../http/members.js";
import { authorizeMemberManage, memberIdParam, rejectMemberError, type MemberErrorClassifier, type MemberErrorStatuses, type MemberReadPort, type MemberRoutePrincipal } from "./shared.js";

/** The deps this route reads: the workspace it serves, the one member lookup and the host's error classifier. */
export interface MemberGetRouteDeps {
  workspaceId: string;
  memberRepo: Pick<MemberReadPort, "findById">;
  classifyMemberError: MemberErrorClassifier;
}

/** Only a miss was ever mapped; any other failure went to the host's 500. */
const MEMBER_GET_ERRORS: MemberErrorStatuses = { "not-found": 404 };

/**
 * GET a single member by id.
 *
 * No dedicated `getAdminMemberById` business-logic function exists in the members library
 * (see `list.ts`'s file note) — this route calls `MemberRepoPort.findById` directly and answers
 * a miss as the library's own not-found message, mirroring the not-found translation
 * `getAdminPostById` performs internally for posts.
 *
 * ADR-PIPE-013 §1 (FEAT-013 Phase 1): previously ran behind session auth only
 * — no per-action `authorize()` call, unlike `disable.ts`. Closes that live
 * authorization gap by requiring `member.manage`, copying `disable.ts`'s
 * exact call shape (workspace-id 404 check first, then authorize, with
 * `entityId: memberId`).
 */
export const memberGetRoute = defineJsonRoute<{ memberId: string }, AdminMemberEnvelope, MemberGetRouteDeps, MemberRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/members/:memberId",
  parse: (raw) => ok({ value: { memberId: memberIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMemberManage({ authorize }, { entityId: input.memberId });
    let member: AdminMemberSource | null;
    try {
      member = await deps.memberRepo.findById({ workspaceId: deps.workspaceId, id: input.memberId });
    } catch (err) {
      // A repository may report the miss by throwing the library's not-found instead of returning null;
      // both answer the same 404 (the hand-written route caught its own throw of that error).
      return rejectMemberError({ err, classify: deps.classifyMemberError, statuses: MEMBER_GET_ERRORS });
    }
    if (!member) rejectRoute({ status: 404, error: `member '${input.memberId}' was not found` });
    return ok({ value: { member: toAdminMemberResponse(member) } });
  },
});
