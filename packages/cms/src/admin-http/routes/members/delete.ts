import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeMemberManage, memberActorId, memberIdParam, rejectMemberError, type MemberErrorClassifier, type MemberErrorStatuses, type MemberRoutePrincipal } from "./shared.js";

/**
 * Moves one member to the Trash. Injected because the trash pipeline is the host's: it owns the
 * generic Trash store, the credential revocation and the stale-write fence. It throws the library's
 * not-found for a missing (or already trashed) member, its conflict when the row changed mid-move
 * and its validation error when Trash is unavailable in the running host.
 */
export type MemberTrashFn = (required: {
  workspaceId: string;
  memberId: string;
  actor: { principalId: string };
}) => Promise<{ deleted: true }>;

/** The deps this route reads. */
export interface MemberDeleteRouteDeps {
  workspaceId: string;
  trashMember: MemberTrashFn;
  classifyMemberError: MemberErrorClassifier;
}

/** The ladder the hand-written route had: miss, stale row, Trash unavailable. */
const MEMBER_DELETE_ERRORS: MemberErrorStatuses = { "not-found": 404, conflict: 409, validation: 400 };

/**
 * DELETE moves a member to Trash. The shared adapter revokes sessions and links in the same
 * transaction; only the existing Trash flows may restore or permanently delete it.
 * Gated by `member.manage` for that member.
 * @complexity One permission check and the bound Trash operation.
 */
export const memberDeleteRoute = defineJsonRoute<{ memberId: string }, { deleted: true }, MemberDeleteRouteDeps, MemberRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/members/:memberId",
  parse: (raw) => ok({ value: { memberId: memberIdParam(raw.params) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principalId = memberActorId({ context });
    await authorizeMemberManage({ authorize }, { entityId: input.memberId });
    try {
      return ok({ value: await deps.trashMember({ workspaceId: deps.workspaceId, memberId: input.memberId, actor: { principalId } }) });
    } catch (err) {
      return rejectMemberError({ err, classify: deps.classifyMemberError, statuses: MEMBER_DELETE_ERRORS });
    }
  },
});
