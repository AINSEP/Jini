import { useEffect, useRef, useState } from "react";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../../models.js";
import type { UsersPort } from "../../ports.js";
import { KEYS, isOwnerAccount, userAccountCapabilities, type UserAccountCapabilities } from "../rules.js";
import type { UsersDependencies } from "./use-users.hooks.js";
import type { createUsersErrorDescriber } from "./use-users-state.hooks.js";
import { useFetchQuery as useFetchQueryDefault } from "../../kit.js";
import { useChangeUsername as useChangeUsernameDefault } from "./use-change-username.hooks.js";

/**
 * Roles and policies for the grant controls, or `null` when the server refuses them with 403 (the
 * caller lacks `role.manage`). Any other failure still rejects, so a real outage keeps surfacing as
 * the screen's load error.
 *
 * @complexity O(1) requests (two, concurrent).
 */
async function loadGrantOptions(port: UsersPort): Promise<{ roles: AdminRole[]; policies: AdminPolicy[] } | null> {
  try {
    const [r, p] = await Promise.all([port.listRoles({}), port.listPolicies({})]);
    return { roles: r.roles, policies: p.policies };
  } catch (e) {
    if (e && typeof e === "object" && "status" in e && e.status === 403) return null;
    throw e;
  }
}

type UsersListData = { users: AdminIdentityUser[]; grantOptions: { roles: AdminRole[]; policies: AdminPolicy[] } | null };

/**
 * The combined read split into the controller's list fields: all `null` (and `canGrant` false)
 * until the read settles, then `[]` roles/policies with `canGrant` false when `loadGrantOptions`
 * reported a 403. Pure so `useUsers` stays a flat wiring list.
 */
function selectUsersList({ data }: { data: UsersListData | undefined }) {
  if (!data) return { users: null, roles: null, policies: null, canGrant: false };
  const grantOptions = data.grantOptions;
  return { users: data.users, roles: grantOptions?.roles ?? [], policies: grantOptions?.policies ?? [], canGrant: grantOptions != null };
}

/**
 * The signed-in caller as the row-level permission checks see it: their own roster row (`null`
 * while `me()` or the roster is unsettled, or when the caller is not in it), whether that row is an
 * owner, and the role lookup both checks share. Computed once per render rather than once per row.
 *
 * @complexity O(users + roles) per render.
 */
function selectCaller({ users, roles, ownPrincipalId }: {
  users: AdminIdentityUser[] | null; roles: AdminRole[] | null; ownPrincipalId: string | null;
}) {
  const roleMap = new Map((roles ?? []).map(role => [role.id, role]));
  const ownProfile = users?.find(user => user.principalId === ownPrincipalId) ?? null;
  return { roleMap, ownProfile, callerIsOwner: ownProfile !== null && isOwnerAccount({ user: ownProfile, roles: roleMap }) };
}

export function useUsersRoster({ port, translate, queryScope, describeError }: UsersDependencies & { describeError: ReturnType<typeof createUsersErrorDescriber> }, { useFetchQuery = useFetchQueryDefault }: { useFetchQuery?: typeof useFetchQueryDefault } = {}) {
  // `portRef` (password-banner plan, 2026-09-24 Slice 3 deep-link half): captured once at mount and
  // never written again, same discipline and same reasoning as `use-assistant-chats.hooks.ts`'s own
  // `portRef` — the one-shot `me()` effect below must not spin if a caller builds a fresh port object
  // per render (the host admin guidance's "Two traps" section). Every OTHER `port.xxx()` call in this
  // file stays a direct closure read, unaffected — this ref exists only for the raw `useEffect` below,
  // which is not a `useFetchQuery`/`useFetchMutation` closure and so does not get that discipline for
  // free.
  const portRef = useRef(port);

  const list = useFetchQuery({
    key: [queryScope, ...KEYS.list],
    fetch: async () => {
      const [u, grantOptions] = await Promise.all([port.listUsers({}), loadGrantOptions(port)]);
      return { users: u.users, grantOptions };
    },
  });
  const { users, roles, policies, canGrant } = selectUsersList({ data: list.data });
  const error = list.error ? describeError(list.error, translate("failed to load users")) : null;

  return { portRef, users, roles, policies, canGrant, error };
}

export function useUsersCallerState({ portRef }: { portRef: ReturnType<typeof useUsersRoster>["portRef"] }, _optional: Record<string, never> = {}) {
  /** The signed-in caller's own principal id (password-banner plan, 2026-09-24 Slice 3), from
   *  `port.me()`. `null` until that call settles, or forever if it fails — both are treated as
   *  "unknown", which the deep-link effect below and `confirmResetPassword`'s notice branch both
   *  already handle as "not a self-reset".
   *
   *  Fetched unconditionally (not gated on `openOwnPasswordReset`) — a deliberate choice, not an
   *  oversight: it makes the "sign in again" notice below correct for ANY self-reset, including an
   *  admin resetting their OWN row from the ordinary row-menu (no deep link involved), not just the
   *  one opened via `/users/change-password`. One extra `me()` call per screen load is cheaper than
   *  threading two different notice code paths for what is, to the operator, the same event. */
  const [ownPrincipalId, setOwnPrincipalId] = useState<string | null>(null);
  const [effectivePermissions, setEffectivePermissions] = useState<string[]>([]);
  // `canManageUserTrash` (delete-user plan v2, Slice 4): resolved by this SAME one-shot `me()` call
  // rather than a second request — see `UsersController.canManageUserTrash`'s own doc comment.
  const [canManageUserTrash, setCanManageUserTrash] = useState(false);
  useEffect(() => {
    let cancelled = false;
    portRef.current
      .me({})
      .then((res) => {
        if (!cancelled) {
          setOwnPrincipalId(res.user.id);
          setEffectivePermissions(res.effectivePermissions ?? []);
          setCanManageUserTrash(res.canManageUserTrash);
        }
      })
      .catch(() => {
        // Best-effort, see `ownPrincipalId`'s own doc comment above — a failure just means the
        // deep link can't auto-open and self-resets fall back to the per-username notice.
        // `canManageUserTrash` stays `false`, the same "unknown means no affordance" default.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ownPrincipalId, effectivePermissions, canManageUserTrash };
}

export function createUsersCapabilities({ users, roles, ownPrincipalId, effectivePermissions, canManageUserTrash }: ReturnType<typeof useUsersRoster> & ReturnType<typeof useUsersCallerState>) {
  const { roleMap, ownProfile, callerIsOwner } = selectCaller({ users, roles, ownPrincipalId });
  function rowCapabilities(user: AdminIdentityUser): UserAccountCapabilities {
    return userAccountCapabilities({ user, callerPrincipalId: ownPrincipalId, callerIsOwner, canManageUserTrash, roles: roleMap });
  }

  function canRenameUser(user: AdminIdentityUser): boolean {
    if (user.canRename === false) return false;
    if (!ownPrincipalId || (!effectivePermissions.includes("*") && !effectivePermissions.includes("user.manage"))) return false;
    // Server-supplied owner flags remain authoritative when role.manage is unavailable.
    const targetIsOwner = user.isOwner ?? (user.roleIds.some(id => !roleMap.has(id)) || isOwnerAccount({ user, roles: roleMap }));
    return !targetIsOwner || callerIsOwner;
  }
  return { ownProfile, rowCapabilities, canRenameUser };
}

export function useUsersRename({ port, queryScope, translate, canRenameUser, ownProfile }: UsersDependencies & ReturnType<typeof createUsersCapabilities>, { useChangeUsername = useChangeUsernameDefault }: { useChangeUsername?: typeof useChangeUsernameDefault } = {}) {
  const changeUsername = useChangeUsername({ port, queryScope, translate, canRename: canRenameUser });
  const canRenameOwnProfile = ownProfile !== null && canRenameUser(ownProfile);
  /** Profile and row actions enter the same guarded dialog; the view only renders affordances. */
  function openOwnRename() {
    if (ownProfile) changeUsername.open({ user: ownProfile });
  }
  function renameUserHandler({ user }: { user: AdminIdentityUser }, _options: Record<string, never> = {}) {
    return canRenameUser(user) ? (target: AdminIdentityUser) => changeUsername.open({ user: target }) : undefined;
  }

  return { changeUsername, canRenameOwnProfile, openOwnRename, renameUserHandler };
}
