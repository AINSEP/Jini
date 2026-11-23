import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { TrashItem, TrashPort } from "../../../trash/index.js";
import { toAdminTrashResponse, type AdminTrashRow } from "../../http/trash.js";
import {
  DEFAULT_TRASH_PAGE_SIZE, MAX_TRASH_PAGE_SIZE, requireTrashEntry, trashActorId,
  type TrashEntryGateFn, type TrashRoutePrincipal,
} from "./shared.js";

/** The user listing this route reads, structurally: only the call it makes. */
export interface TrashUserLister {
  list(required: { workspaceId: string }): Promise<readonly { principalId: string; username: string }[]>;
}

/** Drops the rows the principal may not act on — the host's per-kind visibility policy. */
export type TrashVisibilityFilterFn = (required: { principalId: string; items: readonly TrashItem[] }) => Promise<readonly TrashItem[]>;

/**
 * Resolves the display subtype of the visible `post` rows by entity id (`page` or `post`), read by
 * the host from its own content store without parsing entity payloads. Rows it has no answer for
 * leave the additive `displayKind` field absent.
 */
export type TrashPostDisplayKindsFn = (required: { items: readonly TrashItem[] }) => Promise<ReadonlyMap<string, string>>;

/** The deps this route reads. */
export interface TrashListRouteDeps {
  workspaceId: string;
  authorizeEntry: TrashEntryGateFn;
  clock: { nowIso(): string };
  trash: Pick<TrashPort, "list">;
  filterVisible: TrashVisibilityFilterFn;
  userRepo: TrashUserLister;
  loadPostDisplayKinds: TrashPostDisplayKindsFn;
}

/** The parsed query. */
export interface TrashListInput { limit: number; entityTypes: string[] | undefined; cursor: string | null }

/** One page of rows; `displayKind` only on a post row whose subtype resolved. */
export interface AdminTrashListEnvelope { items: (AdminTrashRow & { displayKind?: string })[]; nextCursor: string | null }

/** @complexity O(n) in the filter's length. Unknown kinds are left in — the per-row filter drops them. */
function readEntityTypes({ raw }: { raw: unknown }, _optional: Record<string, never> = {}): string[] | undefined {
  const joined = Array.isArray(raw) ? raw.join(",") : "";
  const value = typeof raw === "string" ? raw : joined;
  const types = value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  return types.length > 0 ? types : undefined;
}

/** Clamped rather than rejected: a bad `limit` is not worth a 400 on a read. @complexity O(1). */
function readLimit({ raw }: { raw: unknown }, _optional: Record<string, never> = {}): number {
  const parsed = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TRASH_PAGE_SIZE;
  return Math.min(parsed, MAX_TRASH_PAGE_SIZE);
}

/** @complexity O(1). */
function readCursor({ raw }: { raw: unknown }, _optional: Record<string, never> = {}): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * One `userRepo.list` call per request, not one lookup per row — the admin Users screen already
 * reads this same unpaginated list, so a workspace's user count is already assumed small enough for
 * a single in-memory pass here too.
 *
 * @complexity O(u) in the workspace's user count, once per request regardless of page size.
 */
async function loadUsernamesByPrincipalId({ deps }: { deps: TrashListRouteDeps }, _optional: Record<string, never> = {}): Promise<ReadonlyMap<string, string>> {
  const users = await deps.userRepo.list({ workspaceId: deps.workspaceId });
  return new Map(users.map((user) => [user.principalId, user.username]));
}

/**
 * GET one page of the Trash.
 *
 * Display strings come from the trash index's own snapshot; no entity payload is parsed, which is
 * what keeps this endpoint working on rows whose payload is corrupt. Post subtype resolution reads
 * only the subtype for the same reason. Rows whose `purgeAfter` has passed are excluded by the repo
 * itself, so a site that sat closed past its retention window shows nothing expired on its first
 * render, sweeper or no sweeper.
 */
export const trashListRoute = defineJsonRoute<TrashListInput, AdminTrashListEnvelope, TrashListRouteDeps, TrashRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/trash",
  parse: (raw) => ok({ value: { limit: readLimit({ raw: raw.query.limit }), entityTypes: readEntityTypes({ raw: raw.query.entityTypes }), cursor: readCursor({ raw: raw.query.cursor }) } }),
  handle: async ({ input, deps, context }) => {
    const principalId = trashActorId({ context });
    await requireTrashEntry({ authorizeEntry: deps.authorizeEntry, principalId });
    const now = deps.clock.nowIso();
    // The `entityTypes` key is sent even when absent (`undefined` = no kind filter), exactly as the
    // hand-written route called the port; the cast only bridges `exactOptionalPropertyTypes`.
    const filter = { entityTypes: input.entityTypes, cursor: input.cursor } as Parameters<TrashPort["list"]>[1];
    const page = await deps.trash.list({ workspaceId: deps.workspaceId, now, limit: input.limit }, filter);
    // Per-kind, not per-surface: a principal who can only moderate comments must not read the
    // titles of deleted posts here any more than they can through the agent tool.
    const visible = await deps.filterVisible({ principalId, items: page.items });
    // Skip the query on an empty page (nothing visible to this principal, or the Trash truly is
    // empty) rather than paying for a lookup with no rows to resolve.
    const usernameByPrincipalId = visible.length > 0 ? await loadUsernamesByPrincipalId({ deps }) : new Map<string, string>();
    const postKindById = await deps.loadPostDisplayKinds({ items: visible });
    const items = visible.map((item) => {
      const displayKind = item.entityType === "post" ? postKindById.get(item.entityId) : undefined;
      return { ...toAdminTrashResponse({ item, now, usernameByPrincipalId }), ...(displayKind ? { displayKind } : {}) };
    });
    return ok({ value: { items, nextCursor: page.nextCursor } });
  },
});
