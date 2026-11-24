import type { RowMenuItem } from "../react/components/RowMenu/RowMenu.js";

import type { AdminPolicy, AdminRole } from "@jini-ai/core/contracts/site/user-management-react";
import type { QueryKey } from "@jini-ai/core/fetch";
import { t } from "./roles-i18n.js";

/**
 * @file Pure logic for the `roles` feature — everything that computes a value rather than
 * rendering one.
 *
 * Follows the `rules.ts` convention `features/posts/rules.ts` establishes: the slice's decisions
 * live in one importable, directly testable module with no React in it. `describeApiError` and the
 * two row-menu builders were previously module-level helpers/closures inside `Roles.tsx`; they
 * compute a value (an error string, a menu array) rather than render one, so per that convention
 * they move here rather than stay "presentation".
 *
 * The row-menu builders take their callbacks as an explicit handlers object rather than closing
 * over component state, mirroring `postRowMenuItems`' `PostRowMenuHandlers` — this module has no
 * component to close over, and passing handlers explicitly is also what lets a test assert exactly
 * which callback a given row wires up.
 *
 * `KEYS` (fetch-query migration, 2026-08-12): one identity for the combined roles+policies read —
 * matches the pre-migration `reload()`, which always refetched both together and had no route for
 * refreshing just one. Every write (create/rename/delete role or policy) invalidates this same key.
 */
export const KEYS = {
  list: ["roles-and-policies"] as QueryKey,
};

/** The host admin HTTP client's half of {@link describeApiError}: its error class (recognized
 *  through `isApiError`, since an `instanceof` check needs the host's own class) and its shared
 *  default describer. The host binds both; this package never imports the host's client. */
export interface RolesApiErrorPort {
  isApiError(e: unknown): e is { code?: string | undefined; message: string };
  describeDefault(args: { e: unknown; fallback: string }): string;
}

/** Same flat-lookup shape as `users/rules.ts`'s `describeApiError` (see its comment for why a
 *  table doesn't lose exhaustiveness here) — a closed set of literal `code` strings, not a
 *  discriminated union. Values are English source strings — `t()`'s own keys — not yet localized;
 *  `describeApiError` below is what translates them. */
const STATIC_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  FORBIDDEN: "You do not have permission to do that.",
  RESOURCE_CONFLICT: "It is still in use — remove that assignment/attachment first.",
  PERMISSION_UNKNOWN: "That permission is not recognized.",
  GRANT_EXCEEDS_ISSUER: "You cannot grant a permission you do not hold.",
};

/** Overrides layered on the shared default (`lib/api.ts`'s `describeApiError`) — this screen's
 *  `RESOURCE_CONFLICT` means "still referenced by an assignment/attachment", a different meaning
 *  than `Workspace.tsx`'s "slug already taken" or `Users.tsx`'s "username already in use" for the
 *  same code (audit cross-cutting finding #2 — deliberately not unified into one table).
 *  `VALIDATION_ERROR` stays its own branch — its message comes from `e.message`, not a fixed
 *  string a lookup table can hold.
 *
 *  `locale` (C4 fix, 2026-09-20): every branch here used to return its English literal directly,
 *  leaking English into every non-`en` locale — see `users/rules.ts`'s identical fix for the full
 *  reasoning. Each literal is now also a key into `roles-i18n.ts`'s `ROLES_DICT`.
 *
 * @complexity Time/space: O(1) — a fixed set of code checks, no iteration.
 */
export function describeApiError(
  { e, fallback, locale, errors }: { e: unknown; fallback: string; locale: string; errors: RolesApiErrorPort },
  _optional: Record<string, never> = {},
): string {
  if (errors.isApiError(e)) {
    if (e.code === "VALIDATION_ERROR") return e.message || t({ locale: locale, key: "Please correct the highlighted fields." });
    const staticMessage = e.code ? STATIC_ERROR_MESSAGES[e.code] : undefined;
    if (staticMessage) return t({ locale: locale, key: staticMessage });
  }
  return errors.describeDefault({ e, fallback });
}

/** The callbacks a role row menu needs. Passed in rather than imported so this module stays free
 *  of state and navigation, and so a test can assert exactly which one a given row wires up. */
export interface RoleRowMenuHandlers {
  onRename: (role: AdminRole) => void;
  onDelete: (role: AdminRole) => void;
}

/** At-rest row actions for a role (built-in rows and an actively-editing row never reach these —
 *  see `Roles.tsx`'s table JSX, which renders `—` or the Save/Cancel pair for those instead).
 *
 * @complexity Time/space: O(1) — exactly two entries, no iteration.
 */
export function roleMenuItems({ role, handlers, locale }: { role: AdminRole; handlers: RoleRowMenuHandlers; locale: string }, _optional: Record<string, never> = {}): RowMenuItem[] {
  return [
    { key: "rename", label: t({ locale: locale, key: "Rename" }), onSelect: () => handlers.onRename(role) },
    { key: "delete", label: t({ locale: locale, key: "Delete" }), destructive: true, onSelect: () => handlers.onDelete(role) },
  ];
}

/** The callbacks a policy row menu needs, plus the id of whichever policy currently has its
 *  "Add permission" form open — needed to compute the toggle item's label. Passed in rather than
 *  read from state so this module stays free of state and navigation. */
export interface PolicyRowMenuHandlers {
  onRename: (policy: AdminPolicy) => void;
  onTogglePermissionForm: (required: { policyId: string }, optional?: Record<string, never>) => void;
  onDelete: (policy: AdminPolicy) => void;
}

/** Same shape as {@link roleMenuItems}, plus the "Add permission"/"Close" toggle — its label still
 *  flips based on `permissionPolicyId` exactly as the inline button it replaced did; only where
 *  that toggle now lives (a `RowMenu` item instead of a bare button) changed.
 *
 * @complexity Time/space: O(1) — exactly three entries, no iteration.
 */
export function policyMenuItems(
  { policy, permissionPolicyId, handlers, locale }: {
    policy: AdminPolicy;
    permissionPolicyId: string | null;
    handlers: PolicyRowMenuHandlers;
    locale: string;
  },
  _optional: Record<string, never> = {},
): RowMenuItem[] {
  return [
    { key: "rename", label: t({ locale: locale, key: "Rename" }), onSelect: () => handlers.onRename(policy) },
    {
      key: "permission",
      label: permissionPolicyId === policy.id ? t({ locale: locale, key: "Close" }) : t({ locale: locale, key: "Add permission" }),
      onSelect: () => handlers.onTogglePermissionForm({ policyId: policy.id }),
    },
    { key: "delete", label: t({ locale: locale, key: "Delete" }), destructive: true, onSelect: () => handlers.onDelete(policy) },
  ];
}
