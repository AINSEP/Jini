/**
 * @file Who may see, restore and permanently remove which kind of trashed thing.
 *
 * The Trash is the only surface in the product that lists several unrelated domains side by side,
 * so a single `trash.read`/`trash.manage` pair would be a way around every one of them at once: a
 * principal trusted only to moderate comments would read the titles of every deleted post, and
 * could permanently destroy them. Instead **every row is gated by the permission that row's own
 * kind already required to be deleted**, resolved per row, in one place that both the agent tools
 * and the admin HTTP routes read — the two surfaces cannot drift apart because there is only one
 * lookup.
 *
 * Two sources feed that lookup, per `ADS-memory/.local-artifacts/handoffs/2026-09-21-t8f-trash-more-plan.md`
 * §1/§4:
 *  - {@link TRASH_PERMISSION_BY_ENTITY_TYPE} — the bespoke kinds (post/comment/media/redirect), whose
 *    adapters predate `TRASHABLE` and are not expected to move into it soon (§2's "stay on raw SQL
 *    for now"). A fixed, hand-maintained map is the right shape for a fixed, small set.
 *  - `TRASHABLE` itself (`registry.ts`) — every kind registered there already carries its own
 *    `permission` field, so a phase-2 kind (`form` today; `menu`/`term`/`taxonomy`/`form_submission`/
 *    `widget` later) needs no second entry here. `trashPermissionFor` is the merge point.
 */
import type { TrashEntityType, TrashItem, TrashRegistry } from "@jini-ai/cms/trash";

/** The entry gate on the Trash surface itself. Every row is then filtered again, per kind. */
export const TRASH_READ_PERMISSION = "content.read";

/**
 * The BESPOKE kinds' gate: **the same permission that kind's own delete path required.**
 *
 * `content_post_delete` and `posts/delete.ts` gate on `content.write` (this codebase grants no
 * `content.delete` anywhere); comments moderation on `comments.moderate`; `media/trash.ts` on
 * `media.delete`; `redirects_tombstone` on `admin.redirects.manage`; users on the literal `"*"`
 * (delete-user plan v2 decision 1) — `user.manage` is not enough on its own, since `role.manage`
 * can grant it to a non-owner custom role, and `"*"` is not a catalog permission any such role can
 * ever hold (`Jini` `permissions.ts:638`).
 *
 * A kind absent from BOTH this map and `TRASHABLE` is neither listable nor restorable nor
 * purgeable. That is the conservative default on purpose: a phase-2 domain has to opt in
 * deliberately, rather than inheriting whatever the Trash happened to grant.
 */


/**
 * The permission a kind needs, or `null` when the Trash does not own that kind.
 *
 * Checks the bespoke map first, then `TRASHABLE` — a kind cannot be registered in both, but if it
 * ever were, the bespoke, hand-reviewed entry should win. Exists so a caller that is going to check
 * the permission ANYWAY (through its own evaluator) can resolve the name without a second
 * authorization round-trip — the single-evaluator rule.
 *
 * @complexity O(1).
 */
export function trashPermissionFor({ entityType, deps }: { entityType: TrashEntityType; deps: { registry: TrashRegistry; permissionByEntityType: ReadonlyMap<TrashEntityType, string> } }, _optional: Record<string, never> = {}): string | null {
  return deps.permissionByEntityType.get(entityType) ?? deps.registry.get(entityType)?.permission ?? null;
}

/** The non-throwing authorization seam both surfaces already hold. */
export type TrashAuthorizeFn = (params: {
  principalId: string;
  permission: string;
  workspaceId: string;
  entityType?: string;
  entityId?: string;
}) => Promise<{ allowed: boolean; reason: string }>;

/**
 * Decides whether `principalId` may act on one kind of trashed thing.
 *
 * @returns the permission that was checked and the decision. The permission is returned so a
 *          denial can name it — a 403 saying only "forbidden" tells an operator nothing about
 *          which of five roles they are missing.
 * @complexity O(1) beyond the injected `authorize` call.
 */
export async function mayActOnEntityType(
  deps: { authorize: TrashAuthorizeFn; workspaceId: string; registry: TrashRegistry; permissionByEntityType: ReadonlyMap<TrashEntityType, string> },
  required: { principalId: string; entityType: TrashEntityType; entityId?: string }
): Promise<{ permission: string | null; allowed: boolean; reason: string }> {
  const permission = trashPermissionFor({ entityType: required.entityType, deps });
  if (!permission) {
    return { permission: null, allowed: false, reason: `'${required.entityType}' is not a kind the Trash owns` };
  }
  const decision = await deps.authorize({
    principalId: required.principalId,
    permission,
    workspaceId: deps.workspaceId,
    entityType: required.entityType,
    entityId: required.entityId,
  });
  return { permission, allowed: decision.allowed, reason: decision.reason };
}

/**
 * Drops the rows `principalId` may not act on.
 *
 * Filters AFTER the page is fetched rather than narrowing the query's `entityTypes`, so a page can
 * come back short. That is the honest shape: `nextCursor` still points at the next row in the real
 * keyset, whereas shrinking the query would make the cursor skip rows the caller IS allowed to see
 * if their permissions changed mid-scan.
 *
 * @complexity O(n) rows and at most one `authorize` call per DISTINCT kind on the page (five).
 */
export async function filterVisibleTrashItems(
  deps: { authorize: TrashAuthorizeFn; workspaceId: string; registry: TrashRegistry; permissionByEntityType: ReadonlyMap<TrashEntityType, string> },
  required: { principalId: string; items: readonly TrashItem[] }
): Promise<TrashItem[]> {
  const decidedByType = new Map<TrashEntityType, boolean>();
  const visible: TrashItem[] = [];
  for (const item of required.items) {
    let allowed = decidedByType.get(item.entityType);
    if (allowed === undefined) {
      allowed = (await mayActOnEntityType(deps, { principalId: required.principalId, entityType: item.entityType })).allowed;
      decidedByType.set(item.entityType, allowed);
    }
    if (allowed) visible.push(item);
  }
  return visible;
}

/**
 * Whole days from `now` until `until`, floored at 0.
 *
 * Floored rather than allowed to go negative because both surfaces already exclude expired rows: a
 * negative number could only come from clock skew, and "-3 days left" reads as a bug rather than as
 * "this is overdue".
 *
 * @complexity O(1).
 */
export function trashDaysRemaining({ now, until }: { now: string; until: string }, _optional = {}): number {
  const ms = new Date(until).getTime() - new Date(now).getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}
