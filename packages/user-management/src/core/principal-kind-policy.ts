import type { PrincipalKind } from "./types.js";

/**
 * @file Which principal kinds may exercise operator permissions at all.
 *
 * Purpose:
 * The one place that decides whether a principal's KIND lets it use the operator RBAC axis
 * (`authorize()`'s permissions). Today the answer is: every kind except `member`. A `member` is a
 * public-site sign-up — a host's front-end account, governed by that host's own entitlement axis
 * (tiers, gated content), never by operator RBAC. OWNER DECISION 2026-10-04 (host decision F3144): site
 * members must not be able to use admin features, at least for now.
 *
 * Why a function and not a check at each call site:
 * `authorize()` calls this before it reads any grant, so a member principal is denied every
 * permission even if a grant row reaches it (a hand-edited database, a future grant path that forgets
 * the `kind='user'` target check in `grant-service.ts`). Owner-counting guards call it too, so a
 * member can never count as the workspace's remaining owner. Allowing members some admin capability
 * later is a change to this one function — `permission` is passed so such a decision can open a
 * specific capability rather than all of them.
 */

/**
 * Whether a principal of `kind` may exercise `permission` through operator RBAC at all. Returning
 * `true` only means the kind is not barred; the principal still needs a matching grant.
 *
 * @complexity O(1).
 */
export function principalKindMayExercisePermission(
  required: { kind: PrincipalKind; permission: string },
  _optional: Record<string, never> = {}
): boolean {
  return required.kind !== "member";
}
