import type { TrashAuthorizeFn } from "@jini-ai/core/contracts/site/cms-trash";
import type { TrashEntityType, TrashItem } from "./ports.js";
import type { TrashRegistry } from "./registry-types.js";

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
export function trashPermissionFor({ entityType, registry, permissions }: { entityType: TrashEntityType; registry: TrashRegistry; permissions: ReadonlyMap<string, string> }, _optional: Record<string, never> = {}): string | null {
  return permissions.get(entityType) ?? registry.get(entityType)?.permission ?? null;
}

/**
 * Decides whether `principalId` may act on one kind of trashed thing.
 *
 * @returns the permission that was checked and the decision. The permission is returned so a
 *          denial can name it — a 403 saying only "forbidden" tells an operator nothing about
 *          which of five roles they are missing.
 * @complexity O(1) beyond the injected `authorize` call.
 */
export async function mayActOnEntityType(
  required: { deps: { authorize: TrashAuthorizeFn; workspaceId: string; registry: TrashRegistry; permissions: ReadonlyMap<string, string> }; principalId: string; entityType: TrashEntityType; entityId?: string | undefined },
  _optional: Record<string, never> = {}
): Promise<{ permission: string | null; allowed: boolean; reason: string }> {
  const { deps } = required;
  const permission = trashPermissionFor({ entityType: required.entityType, registry: deps.registry, permissions: deps.permissions });
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
  required: { deps: { authorize: TrashAuthorizeFn; workspaceId: string; registry: TrashRegistry; permissions: ReadonlyMap<string, string> }; principalId: string; items: readonly TrashItem[] },
  _optional: Record<string, never> = {}
): Promise<TrashItem[]> {
  const decidedByType = new Map<TrashEntityType, boolean>();
  const visible: TrashItem[] = [];
  for (const item of required.items) {
    let allowed = decidedByType.get(item.entityType);
    if (allowed === undefined) {
      allowed = (await mayActOnEntityType({ deps: required.deps, principalId: required.principalId, entityType: item.entityType })).allowed;
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
