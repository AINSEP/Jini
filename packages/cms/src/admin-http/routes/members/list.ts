import { ToolInputError } from "@jini-ai/core";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import { encodeListCursor } from "@jini-ai/core/list-page";

import { toAdminMemberResponse, type AdminMemberListResponse } from "../../http/members.js";
import { authorizeMemberManage, type MemberReadPort, type MemberRoutePrincipal } from "./shared.js";

/** The deps this route reads: the workspace it serves and the one paginated member read. */
export interface MemberListRouteDeps {
  workspaceId: string;
  memberRepo: Pick<MemberReadPort, "list">;
}

/** The page request the query carries: an optional positive `limit` and the cursor (null = page one). */
export interface MemberListInput { limit?: number; cursor: string | null }

/** Reads the `?limit=`/`?cursor=` pair (refactor pattern list-cursor). An invalid or missing `limit`
 *  falls through to the repo's own page size (`undefined`, not an error), as before. `?afterId=` is
 *  the older form of the cursor, kept so existing API clients do not break: the page starts after
 *  that id's position. A cursor this list did not issue is refused by the repo (400), never read as
 *  page one. @complexity O(1). */
function parseMembersListQuery(query: Record<string, unknown>): MemberListInput {
  const limit = readPositiveLimit({ raw: query.limit });
  const cursor = readNonEmptyQueryString({ raw: query.cursor }) ?? null;
  const afterId = readNonEmptyQueryString({ raw: query.afterId });
  return { ...(limit === undefined ? {} : { limit }), cursor: cursor ?? (afterId === undefined ? null : encodeListCursor({ position: [afterId] })) };
}

function readPositiveLimit({ raw }: { raw: unknown }, _options = {}): number | undefined {
  const limit = typeof raw === "string" ? Number(raw) : undefined;
  return limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : undefined;
}

function readNonEmptyQueryString({ raw }: { raw: unknown }, _options = {}): string | undefined {
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

/**
 * GET members — list a workspace's members for the admin UI (all statuses,
 * `pending`/`active`/`disabled` included; mirrors `listAdminPosts`'s "admin
 * sees everything" behavior in the admin posts list route).
 *
 * No dedicated `listAdminMembers` business-logic function exists in the members library
 * (that library exports `MembersWriteService` mutations only, no read-side wrappers) — this route
 * calls `MemberRepoPort.list` directly. That port is keyset-paginated and bounded (100 per page),
 * so the `limit`/`cursor` pair is passed through and the response keeps `members` and adds
 * `nextCursor` (null on the last page) rather than re-implementing a cap here.
 *
 * ADR-PIPE-013 §1 (FEAT-013 Phase 1): previously ran behind session auth only
 * — no per-action `authorize()` call, unlike `disable.ts`. Closes that live
 * authorization gap by requiring `member.manage`, copying `disable.ts`'s
 * exact call shape (workspace-id 404 check first, then authorize).
 */
export const memberListRoute = defineJsonRoute<MemberListInput, AdminMemberListResponse, MemberListRouteDeps, MemberRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/members",
  parse: (raw) => ok({ value: parseMembersListQuery(raw.query) }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMemberManage({ authorize });
    try {
      const page = await deps.memberRepo.list({ workspaceId: deps.workspaceId }, input);
      return ok({ value: { members: page.items.map(toAdminMemberResponse), nextCursor: page.nextCursor } });
    } catch (error) {
      // A cursor the list did not issue: the repo refuses it with the shared input error, a client mistake (400), not a 500.
      if (error instanceof ToolInputError) rejectRoute({ status: 400, error: error.message, code: "VALIDATION_ERROR" });
      throw error;
    }
  },
});
