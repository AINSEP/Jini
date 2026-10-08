import type { AdminIdentityUser } from "../models.js";
import type { Translate, QueryKey } from "@jini-ai/ui/panel-kit";
import { describeIdentityError } from "../errors.js";
import type { RowMenuItem } from "@jini-ai/admin/react";

/**
 * @file Pure logic for the `users` feature — everything that computes a value rather than
 * rendering one. Follows the `posts/rules.ts` convention: no React import, no hooks, directly
 * testable.
 *
 * Moved here from `Users.tsx`: the screen's own `describeApiError` override (a branch per server
 * error `code`), the row-menu item builder (a branch on `user.status` plus the confirm-vs-immediate
 * split for Disable/Enable), and the role/policy grant label formatter (a branch on whether the
 * user holds any grants of that kind). All three were previously closures or free functions inside
 * the component, reachable only by rendering the full screen.
 *
 * `KEYS` (fetch-query migration, 2026-08-12): one identity for the combined users+roles+policies
 * read — matches the pre-migration `reload()`, which always refetched all three together.
 */
export const KEYS = {
  list: ["users-roles-policies"] as QueryKey,
};

/** Server error `code` -> a plain-language prefix, for every code on this screen whose message is
 *  a fixed string. Keyed by the same closed set of `ApiError` codes the old if-chain checked, in a
 *  flat lookup rather than sequential branches — this is what actually lowered the function's
 *  cognitive score (11 -> under the ceiling): the codes are a closed set of *literal string* keys,
 *  not a discriminated union, so there is no TypeScript exhaustiveness to lose by using a table
 *  (contrast `translateRunAgentPayload`'s `switch`, which stays a `switch` for exactly that reason).
 *  Values are the English source strings — `t()`'s own keys — not yet localized; `describeApiError`
 *  below is what translates them. */
const STATIC_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  GRANT_EXCEEDS_ISSUER: "You cannot grant a permission you do not hold.",
  FORBIDDEN: "You do not have permission to do that.",
  RESOURCE_CONFLICT: "That username is already in use.",
  OWNER_REQUIRED: "The workspace must keep at least one active owner.",
  // Delete-user plan v2 (2026-09-24), Slice 3/decision 7 — the DELETE route's own 409s.
  SELF_DELETE: "You cannot delete your own account.",
  USER_IN_TRASH: "This user is in the Trash; restore them first.",
  USERNAME_IN_TRASH: "A user with this username is in the Trash; restore or delete them permanently first.",
};

/** Server error `code` -> a plain-language prefix (SPEC-006 errors.spec.md §2), layered on the
 *  shared default (`lib/api.ts`'s `describeApiError`) — this screen's `RESOURCE_CONFLICT` means
 *  "username already in use", a different meaning than `Roles.tsx`'s "still referenced" or
 *  `Workspace.tsx`'s "slug already taken" for the same code (audit cross-cutting finding #2 —
 *  deliberately not unified into one table). `VALIDATION_ERROR` stays a dedicated branch rather than
 *  joining the table above: its message comes from the error itself (`e.message`), not a fixed
 *  string, so it isn't a value a plain lookup can hold.
 *
 *  `locale` (C4 fix, 2026-09-20): every branch here used to return its English literal directly,
 *  leaking English into every non-`en` locale regardless of the caller's own translated fallback —
 *  the fallback was already threaded through `t()` at each call site, but these overrides were not.
 *  Each literal is now also a key into `users-i18n.ts`'s `USERS_DICT`. */
export function describeUsersError({ error, fallback, translate }: { error: unknown; fallback: string; translate: Translate },
  _optional: Record<string, never> = {}): string {
  return describeIdentityError({ error, fallback, translate }, { messages: STATIC_ERROR_MESSAGES });
}
export { describeUsersError as describeApiError };

/** The callbacks a row menu needs. Passed in rather than imported, so this module stays free of
 *  state, and so a test can assert exactly which one a given row wires up (same convention as
 *  `posts/rules.ts`'s `PostRowMenuHandlers`). */
export interface UserRowMenuHandlers {
  /** Asked only when `user.status === "active"` — opens the confirm dialog rather than acting. */
  onRequestDisable: (user: AdminIdentityUser) => void;
  /** Asked only when `user.status !== "active"` — fires immediately, no confirm (Enable was never
   *  confirm-gated). */
  onEnable: (user: AdminIdentityUser) => void;
  onManage: (user: AdminIdentityUser) => void;
  onResetPassword: (user: AdminIdentityUser) => void;
  /** Delete-user plan v2 (2026-09-24) — always opens the confirm dialog, never fires immediately:
   *  unlike Enable, "Delete" moves the user to the Trash, a destructive-looking action even though
   *  it is recoverable there for 60 days. Only asked for when `userRowMenuItems`'s own `canDelete`
   *  is true — see that function's doc comment. */
  onRequestDelete: (user: AdminIdentityUser) => void;
}

export interface UserAccountCapabilities {
  canDelete: boolean; canDisable: boolean; canEnable: boolean; canResetPassword: boolean;
}

/** Courtesy mirror of the server target rule. Unknown identity/roles fail closed. */
export function userAccountCapabilities(required: {
  user: AdminIdentityUser;
  callerPrincipalId: string | null;
  callerIsOwner: boolean;
  canManageUserTrash: boolean;
  roles: ReadonlyMap<string, { name: string; isBuiltin: boolean }>;
}, _optional: Record<string, never> = {}): UserAccountCapabilities {
  const { user, callerPrincipalId, callerIsOwner, canManageUserTrash, roles } = required;
  const known = callerPrincipalId !== null;
  const protectedAccount = user.isProtectedAccount ?? (user.roleIds.some(id => {
    const role = roles.get(id);
    return !role || (role.isBuiltin && (role.name === "admin" || role.name === "owner"));
  }));
  const mayAct = known && (callerIsOwner || !protectedAccount);
  const destructive = mayAct && callerPrincipalId !== user.principalId;
  return { canDelete: destructive && canManageUserTrash, canDisable: destructive,
    canEnable: mayAct, canResetPassword: mayAct };
}

export function isOwnerAccount(required: { user: AdminIdentityUser; roles: ReadonlyMap<string, { name: string; isBuiltin: boolean }> },
  _optional: Record<string, never> = {}): boolean {
  return required.user.isOwner ?? required.user.roleIds.some(id => {
    const role = required.roles.get(id);
    return role?.isBuiltin === true && role.name === "owner";
  });
}

/**
 * `RowMenu` items for one user row — matches `Posts.tsx`/`Pages.tsx`'s three-dot menu shape:
 * Disable/Enable, Manage, Reset password, and — delete-user plan v2 (2026-09-24) — Delete, appended
 * only when `canDelete` is true. The server gate (owner or the built-in `admin` role,
 * `delete-user-service.ts`'s `callerMayManageUserTrash`) is the real boundary; `canDelete` is this
 * row's own affordance-hiding mirror of it, computed once per render from `/auth/me` by
 * `use-users.hooks.ts` — see that hook's `canManageUserTrash` state for where it comes from.
 *
 * Disable/Enable share a single "toggle" item (label follows status, same shape as
 * `Redirects.tsx`'s own toggle item) — Disable confirms via the modal below; Enable fires
 * immediately, matching this screen's existing behavior (Enable was never confirm-gated). The
 * `toggleSaving` guard reproduces the original inline check (`if (toggleSavingId) return`) against
 * whatever row action is currently in flight, read fresh at click time.
 *
 * "Manage" always reads "Manage", never "Close": the item still toggles the expanded panel
 * (`onManage` — closing it again by selecting "Manage" a second time still works exactly as it did
 * as a standalone button), but a `RowMenu` item disappears the instant it is selected, so a label
 * that flips to "Close" is never actually visible mid-interaction — it would only ever describe a
 * state the operator cannot see while the menu that shows it is open. A static label sidesteps that
 * without losing any capability.
 *
 * "Delete" always opens the confirm dialog (`onRequestDelete`), matching Disable's shape rather than
 * Enable's immediate-fire one — see `UserRowMenuHandlers.onRequestDelete`'s own doc comment.
 *
 * @complexity Time/space: O(1) — at most four entries, no iteration.
 */
export function userRowMenuItems({ user, toggleSaving, handlers, translate, canDelete, capabilities = canDelete }: {
  user: AdminIdentityUser; toggleSaving: boolean; handlers: UserRowMenuHandlers; translate: Translate;
  canDelete: boolean; capabilities?: boolean | UserAccountCapabilities | undefined;
}, _optional: Record<string, never> = {}): RowMenuItem[] {
  const items: RowMenuItem[] = [
    {
      key: "toggle",
      label: user.status === "active" ? translate("Disable") : translate("Enable"),
      tone: user.status === "active" ? "warning" : "default",
      onSelect: () => {
        if (toggleSaving) return;
        if (user.status === "active") {
          handlers.onRequestDisable(user);
        } else {
          handlers.onEnable(user);
        }
      },
    },
    {
      key: "manage",
      label: translate("Manage"),
      onSelect: () => handlers.onManage(user),
    },
    {
      key: "reset-password",
      label: translate("Reset password"),
      tone: "warning",
      onSelect: () => handlers.onResetPassword(user),
    },
  ];
  const permissions = typeof capabilities === "boolean"
    ? { canDelete: capabilities, canDisable: true, canEnable: true, canResetPassword: true }
    : capabilities;
  if (permissions.canDelete) {
    items.push({
      key: "delete",
      label: translate("Delete"),
      tone: "danger",
      onSelect: () => handlers.onRequestDelete(user),
    });
  }
  return items.filter(item => item.key === "toggle"
    ? (user.status === "active" ? permissions.canDisable : permissions.canEnable)
    : item.key !== "reset-password" || permissions.canResetPassword);
}

/**
 * The role or policy names a user holds, for the "Roles"/"Policies" table cells — `null` when the
 * user holds none, which the caller renders as the `muted-cell` "none" fallback (a plain ternary on
 * this already-computed value, per this feature's extraction rule).
 *
 * A grant id with no matching entry in `byId` (a role/policy deleted out from under a still-held
 * grant) falls back to rendering the raw id rather than dropping it silently — the operator sees
 * something is wrong instead of an undercount with no explanation.
 *
 * @complexity Time: O(n) in the number of granted ids; space: O(n) for the joined string.
 */
export function grantOptionLabel(required: { option: { name: string; isBuiltin: boolean }; translate: (key: string) => string },
  _optional: Record<string, never> = {}): string {
  return required.option.isBuiltin && required.option.name === "owner" ? required.translate("Owner") : required.option.name;
}

export function formatGrantLabel({ ids, byId, translate = (key: string) => key }: {
  ids: readonly string[]; byId: ReadonlyMap<string, { name: string; isBuiltin?: boolean }>;
  translate?: Translate | undefined;
}, _optional: Record<string, never> = {}): string | null {
  if (ids.length === 0) return null;
  return ids.map(id => {
    const role = byId.get(id);
    return role?.isBuiltin && role.name === "owner" ? translate("Owner") : role?.name ?? id;
  }).join(", ");
}
