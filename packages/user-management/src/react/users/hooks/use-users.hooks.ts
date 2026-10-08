import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";

import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../../models.js";
import { interpolate, type Translate } from "@jini-ai/ui/panel-kit";
import { useFetchMutation, useFetchQuery } from "@jini-ai/ui/panel-kit";
import { useAsyncAction } from "@jini-ai/ui/panel-kit";
import { describeApiError, KEYS, isOwnerAccount, userAccountCapabilities, type UserAccountCapabilities } from "../rules.js";
import type { UsersPort } from "../../ports.js";

/**
 * @file Everything the Users screen does, so `Users.tsx` is only markup.
 *
 * Extracted verbatim — same state, same declaration order, same effect bodies, same error strings.
 * This is the highest-state screen in the app (25 `useState` calls): users/roles/policies load, the
 * "New user" form, the per-row expandable "Manage" panel (role/policy grants, email edit), the
 * Disable confirm dialog, and the reset-password dialog all live here so `Users.tsx` can stay a pure
 * render of whatever this hook returns.
 *
 * `describeApiError` (this screen's server-error-code overrides) moved to `rules.ts` alongside the
 * row-menu builder, since both compute a value rather than performing an effect; this hook imports
 * it back for its own async handlers.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts` and `posts/hooks/use-posts.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/users` needs it.
 *
 * `onCreate` and `confirmResetPassword` — each a single action with its OWN dedicated saving/error
 * pair — now run through `hooks/use-async-action.hooks.ts`'s `useAsyncAction`, replacing their own
 * `setXSaving(true)/setXError(null)/try/catch/finally` boilerplate with one `run()` call each; the
 * public `UsersController` shape (`saving`/`formError`, `passwordSaving`/`passwordError`/
 * `setPasswordError`) is unchanged. `grantSaving`/`grantError` (shared by three different handlers
 * for one "Manage" panel error slot) and `toggleSavingId`/`toggleError` (`toggleSavingId` is the
 * BUSY ROW'S id, not a boolean) stay hand-rolled — see `useAsyncAction`'s own header for why forcing
 * either shape onto that primitive would change behavior rather than just deduplicate it.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import): this hook already called
 * `useAdminLocale()` for its own error-string translations, so exposing that SAME already-resolved
 * `locale` as a bound `t` (plus the raw value, still needed for `rules.ts`'s `userRowMenuItems`,
 * which takes `locale` directly) on the return value adds no new fetch — `Users.tsx` used to call
 * `useAdminLocale()` a second time and rebuild its own `translateUsers(locale, key)` closure,
 * entirely redundant with the resolution this hook was already doing internally.
 *
 * `lib/fetch-query` migration (2026-08-12): the combined users+roles+policies read is one
 * `useFetchQuery` keyed on `KEYS.list`; every write below routes its actual API call through a
 * `useFetchMutation` that `invalidates: [KEYS.list]` instead of the `action`/handler body calling
 * `reload()` by hand — except `resetPasswordMutation`, which never called `reload()` either (a
 * password reset doesn't change anything the users table shows). `useAsyncAction` (`createUser`/
 * `resetPassword` below) keeps owning the busy/error UI state exactly as before — this migration
 * only changes what runs INSIDE its `action` callback, not the primitive itself, which is shared
 * with other screens and has no fetch-query concern of its own. `grantSaving`/`grantError`/
 * `toggleSavingId`/`toggleError` stay hand-rolled for the same reason `use-roles.hooks.ts`'s
 * `rowSavingId`/`rowError` do: each is shared across MULTIPLE independent mutations, and a single
 * mutation's own `status`/`error` has no way to carry "which row/action this particular call was
 * for". `emailSaving` is the one exception — it already tracked exactly one mutation 1:1 before this
 * migration, so it now derives from `updateEmailMutation.status` directly.
 *
 * `useX(dependencies)` / `useWiredX()` conversion (2026-08-14): every `api.xxx()` call below is now
 * `port.xxx()` — see `users-port.hooks.ts` for the interface and `users-dependencies.hooks.ts` for
 * the real binding, the only file left that imports `lib/api` as a value for this feature. `port` is
 * captured once from `deps` and read directly inside the `useFetchQuery`/`useFetchMutation` closures
 * below, which is safe without the ref-and-dep-array discipline `apps/admin/INFO.md`'s "Two traps"
 * section describes for a hand-rolled `useEffect`: TanStack's `useQuery`/`useMutation` (this file's
 * actual I/O primitive, via `lib/fetch-query`) take a fresh `queryFn`/`mutationFn` closure every
 * render by design and do not require referential stability to avoid a refetch loop, unlike a raw
 * `useEffect([port])`. There is no dependency array in this file for `port` to be listed in wrongly.
 */

export interface UsersController {
  /** `null` until the initial load settles — the caller renders a loading state. Loaded together
   *  with `roles`/`policies` via `Promise.all`, so all three settle on the same render. */
  users: AdminIdentityUser[] | null;
  /** `[]` (with `canGrant` false) when the caller may not read roles/policies — see {@link canGrant}. */
  roles: AdminRole[] | null;
  policies: AdminPolicy[] | null;
  /**
   * Whether the caller may read (and so grant) roles and policies. The roster route admits
   * `user.manage` OR `member.manage`, but `/roles` and `/policies` require `role.manage`; a 403 from
   * those two hides the grant controls instead of failing the whole screen, so the roster the
   * operator CAN read still shows.
   */
  canGrant: boolean;
  error: string | null;

  /** Whether the "New user" form is expanded. */
  formOpen: boolean;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
  username: string;
  setUsername: Dispatch<SetStateAction<string>>;
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  saving: boolean;
  formError: string | null;
  onCreate: (e: FormEvent) => Promise<void>;

  /** The row whose "Manage" panel is expanded — `null` when every row is collapsed. */
  expandedId: string | null;
  toggleExpanded: (user: AdminIdentityUser) => void;
  pendingRoleId: string;
  setPendingRoleId: Dispatch<SetStateAction<string>>;
  pendingPolicyId: string;
  setPendingPolicyId: Dispatch<SetStateAction<string>>;
  grantSaving: boolean;
  grantError: string | null;
  onAssignRole: (required: { principalId: string }) => Promise<void>;
  onAttachPolicy: (required: { principalId: string }) => Promise<void>;

  /** The "Manage" panel's own email field — seeded from `user.email` when the panel opens. */
  editEmail: string;
  setEditEmail: Dispatch<SetStateAction<string>>;
  emailSaving: boolean;
  onSaveEmail: (required: { principalId: string }) => Promise<void>;

  /** In-flight Disable/Enable request, keyed by `principalId` — one at a time. */
  toggleSavingId: string | null;
  toggleError: string | null;
  notice: string | null;

  /** The user a `RowMenu` "Disable" selection is asking to confirm; `null` when the dialog is
   *  shut. `ConfirmDialog` stays mounted unconditionally in the view (see its own doc comment on
   *  why); this is what drives its `open` prop. */
  confirmingDisable: AdminIdentityUser | null;
  setConfirmingDisable: Dispatch<SetStateAction<AdminIdentityUser | null>>;
  /** Opens the Disable confirm dialog for `user` — the `RowMenu` "Disable" item's `onSelect` when
   *  the user is currently active (Enable, by contrast, fires immediately via `onToggleStatus`). */
  requestDisable: (user: AdminIdentityUser) => void;
  confirmDisable: () => Promise<void>;
  onToggleStatus: (user: AdminIdentityUser) => Promise<void>;

  /** The user a `RowMenu` "Reset password" selection is asking about; `null` when the dialog is
   *  shut. Kept open on failure (unlike the Disable dialog, which closes either way) so a failed
   *  attempt doesn't discard the password the operator just typed. */
  resetPasswordFor: AdminIdentityUser | null;
  setResetPasswordFor: Dispatch<SetStateAction<AdminIdentityUser | null>>;
  newPassword: string;
  setNewPassword: Dispatch<SetStateAction<string>>;
  passwordSaving: boolean;
  passwordError: string | null;
  setPasswordError: Dispatch<SetStateAction<string | null>>;
  openResetPassword: (user: AdminIdentityUser) => void;
  confirmResetPassword: () => Promise<void>;

  /** Delete-user plan v2 (2026-09-24), Slice 4: whether the SIGNED-IN caller may trash users at all
   *  — from `port.me()`'s `canManageUserTrash`, resolved by the same one-shot effect that already
   *  fetches `ownPrincipalId`. `false` until that call settles (or forever if it fails), the same
   *  "unknown defaults to no affordance" convention `ownPrincipalId`'s doc comment describes. Drives
   *  `rules.ts`'s `userRowMenuItems` `canDelete` param — see that function's own doc comment for why
   *  the real boundary is server-side, not this flag. */
  canManageUserTrash: boolean;
  rowCapabilities: (user: AdminIdentityUser) => UserAccountCapabilities;
  /** The user a `RowMenu` "Delete" selection is asking to confirm; `null` when the dialog is shut.
   *  Mirrors `confirmingDisable` exactly (own state, own request/confirm pair) rather than sharing
   *  it — Delete and Disable are two independent confirms an operator could otherwise not tell apart
   *  if they shared one slot. */
  confirmingDelete: AdminIdentityUser | null;
  setConfirmingDelete: Dispatch<SetStateAction<AdminIdentityUser | null>>;
  /** Opens the Delete confirm dialog for `user` — the `RowMenu` "Delete" item's `onSelect`. Never
   *  fires immediately (see `rules.ts`'s `UserRowMenuHandlers.onRequestDelete` doc comment). */
  requestDelete: (user: AdminIdentityUser) => void;
  /** In flight while the delete mutation is pending — drives the confirm dialog's `pending` prop,
   *  same role `toggleSavingId` plays for the Disable dialog. */
  deleteSaving: boolean;
  confirmDelete: () => Promise<void>;

  /** Bound translator — `key` already resolved against the caller's locale, so `Users.tsx` never
   *  imports `useAdminLocale`/`users-i18n` itself. See this file's header. */
  t: (key: string) => string;
  /** Host-bound translation also resolves row menus without a package locale dependency. */
  translate: Translate;
}

/** The shape `onAssignRole`/`onAttachPolicy` both repeat: set the shared `grantSaving`/`grantError`
 *  pair, run one mutation, do a success-only side effect, and clear saving in a `finally` — the
 *  "whole-hook" complexity view (brief §2) rolls every closure inside a hook into one score, so two
 *  near-identical blocks count against `useUsers` even though `grantError`/`grantSaving` are
 *  deliberately NOT a fit for `useAsyncAction` (see that file's own header: shared across three
 *  handlers on purpose, not one action's own slot — `onSaveEmail` is the third, kept separate below
 *  since it tracks its OWN `emailSaving`). Reproducing the shared-state shape as a local top-level
 *  helper — rather than importing the generic primitive — collapses the two call sites without
 *  forcing that mismatch onto them. `mutate` itself `invalidates: [KEYS.list]`, replacing the
 *  pre-migration `reload()` call this helper used to make explicitly.
 *
 *  `onSuccess` (2026-09-05 fix, same bug class as `use-roles.hooks.ts`'s `onSaveRole`/
 *  `onWritePermission`): nothing gates opening a DIFFERENT user's Manage panel
 *  (`toggleExpanded`) while a grant for the previously expanded one is still in flight, and
 *  `onSuccess` clears `pendingRoleId`/`pendingPolicyId` — a shared field, not keyed by principal.
 *  `toggleGenerationRef` (bumped once per `toggleExpanded` call, regardless of which panel — see
 *  that function) lets a stale grant tell whether the operator switched panels at ALL while it was
 *  in flight, independent of which principal is currently expanded: comparing against the panel's
 *  OWN identity would wrongly refuse a grant issued before any panel was ever expanded (a
 *  legitimate, already-certified call shape), where `expandedId` never gets set to begin with.
 *  `onSuccess` is skipped only when a switch actually happened since this call started — otherwise
 *  a stale grant's success would erase a NEW, unrelated selection the operator has since made for
 *  the panel they actually have open now. */
async function runGrantMutation(
  generationAtStart: number,
  toggleGenerationRef: { current: number },
  mutate: () => Promise<unknown>,
  onSuccess: () => void,
  setGrantSaving: Dispatch<SetStateAction<boolean>>,
  setGrantError: Dispatch<SetStateAction<string | null>>,
  describeError: (e: unknown) => string,
): Promise<void> {
  setGrantSaving(true);
  setGrantError(null);
  try {
    await mutate();
    if (toggleGenerationRef.current === generationAtStart) onSuccess();
  } catch (e) {
    // Same generation check as the success branch above (C8, plan-access.md §8, N3): a stale
    // failure must not paint onto a DIFFERENT user's panel the operator has since opened.
    if (toggleGenerationRef.current === generationAtStart) setGrantError(describeError(e));
  } finally {
    // Guarded the same way — a stale call's `finally` must not clear a NEWER call's own saving
    // flag. `toggleExpanded` resets `grantSaving` itself when it bumps the generation, so a panel
    // switch still leaves the new panel un-stuck even though this skip means THIS call no longer
    // clears it.
    if (toggleGenerationRef.current === generationAtStart) setGrantSaving(false);
  }
}

/** What `useUsers` needs injected from outside — see this file's header for the conversion note.
 *
 *  `openOwnPasswordReset`/`navigate` (password-banner plan, 2026-09-24 Slice 3): the dashboard nag's
 *  "Change password" link deep-links to `/admin/users/change-password`, which `panels.tsx` turns
 *  into this flag. Both are optional so every existing `useUsers({ port })` call (this file's own
 *  tests, `Users.tsx`'s default) keeps working unchanged — the deep link is additive behavior, not a
 *  new required collaborator. */
export interface UsersDependencies { port: UsersPort; translate: Translate; queryScope: string }
export interface UsersOptions {
  openOwnPasswordReset?: boolean | undefined;
  onOwnPasswordResetClosed?: (() => void) | undefined;
  /** Host formatting keeps dynamic username templates in the host's dictionary. */
  passwordResetNotice?: ((required: { username: string }) => string) | undefined;
}

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

/**
 * Everything the Users screen does — full state, effects, and every server write, as one hook so
 * `Users.tsx` stays a pure render of whatever this returns. See this file's header for the
 * `useFetchQuery`/`useFetchMutation` migration and the `port` injection it now also carries.
 *
 * @param deps - Injected collaborators; production callers get these from {@link useWiredUsers}.
 * @returns The full `UsersController` the view renders from — see that interface for every field.
 */
export function useUsers({ port, translate, queryScope }: UsersDependencies, {
  openOwnPasswordReset = false, onOwnPasswordResetClosed, passwordResetNotice,
}: UsersOptions = {}): UsersController {
  const boundT = translate;
  const describeError = (error: unknown, fallback: string) => describeApiError({ error, fallback, translate });

  // `portRef` (password-banner plan, 2026-09-24 Slice 3 deep-link half): captured once at mount and
  // never written again, same discipline and same reasoning as `use-assistant-chats.hooks.ts`'s own
  // `portRef` — the one-shot `me()` effect below must not spin if a caller builds a fresh port object
  // per render (`apps/admin/INFO.md`'s "Two traps" section). Every OTHER `port.xxx()` call in this
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
  const users = list.data?.users ?? null;
  const roles = list.data ? (list.data.grantOptions?.roles ?? []) : null;
  const policies = list.data ? (list.data.grantOptions?.policies ?? []) : null;
  const canGrant = list.data?.grantOptions != null;
  const error = list.error ? describeError(list.error, translate("failed to load users")) : null;

  const [formOpen, setFormOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const createUser = useAsyncAction();
  const createUserMutation = useFetchMutation({
    run: ({ input }: { input: { username: string; password: string; email: string | undefined } }) =>
      port.createUser({ username: input.username, password: input.password }, { email: input.email })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Bumped once per `toggleExpanded` call, regardless of which panel — `runGrantMutation` (a
  // top-level function, outside this closure's re-render cycle) reads this to tell whether the
  // operator switched panels AT ALL while its own grant was in flight. See that function's own doc
  // comment for why this counts switches rather than comparing against `expandedId`'s value.
  const toggleGenerationRef = useRef(0);
  const [pendingRoleId, setPendingRoleId] = useState("");
  const [pendingPolicyId, setPendingPolicyId] = useState("");
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const assignRoleMutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; roleId: string } }) => port.assignRole(input)
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const attachPolicyMutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; policyId: string } }) => port.attachPolicy(input)
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });

  const [editEmail, setEditEmail] = useState("");
  const updateEmailMutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; email: string } }) => port.updateUser({ principalId: input.principalId }, { email: input.email })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const [toggleSavingId, setToggleSavingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const toggleStatusMutation = useFetchMutation({
    run: ({ input: user }: { input: AdminIdentityUser }) => (user.status === "active" ? port.disableUser({ principalId: user.principalId }) : port.enableUser({ principalId: user.principalId }))
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });

  // Disable now confirms via a `RowMenu` item -> `ConfirmDialog` modal (replacing the in-place
  // two-click `ConfirmButton`, which has no menu-item equivalent — same migration Posts.tsx/
  // Redirects.tsx already made). `null` when the dialog is closed.
  const [confirmingDisable, setConfirmingDisable] = useState<AdminIdentityUser | null>(null);

  // Reset password moved out of the expanded "Manage" panel into its own `RowMenu` item, which
  // opens this dialog (it needs a text field, so it's a `ConfirmDialog` with an input in the body,
  // not a plain confirm). Kept open on failure (unlike the delete-style dialogs above, which close
  // either way) so a failed attempt doesn't discard the password the operator just typed.
  const [resetPasswordFor, setResetPasswordFor] = useState<AdminIdentityUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const resetPassword = useAsyncAction();

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

  /** Guards the one-shot deep-link auto-open effect below so it fires at most once per mount, even
   *  as `users`/`ownPrincipalId` keep changing identity across the renders it's waiting on (list
   *  reloads, `me()` settling). Separate from {@link openedViaDeepLinkRef}, which tracks a DIFFERENT
   *  question ("should closing the dialog navigate away") over the dialog's own open/close lifetime
   *  — this one is "has the auto-open already been attempted", which must stay true forever once it
   *  fires, including after the dialog this effect opened has since been closed. */
  function rowCapabilities(user: AdminIdentityUser): UserAccountCapabilities {
    const roleMap = new Map((roles ?? []).map(role => [role.id, role]));
    const ownRow = users?.find(row => row.principalId === ownPrincipalId);
    return userAccountCapabilities({ user, callerPrincipalId: ownPrincipalId,
      callerIsOwner: ownRow ? isOwnerAccount({ user: ownRow, roles: roleMap }) : false,
      canManageUserTrash, roles: roleMap });
  }

  const deepLinkAttemptedRef = useRef(false);
  /** Set true exactly when this effect opens the dialog, cleared by the close-effect below the first
   *  time it observes `resetPasswordFor` go back to `null`. Read there to decide whether to navigate
   *  — an operator resetting a DIFFERENT row's password from the ordinary row menu, or cancelling a
   *  normal reset, must not also get shoved to `/users`. */
  const openedViaDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!openOwnPasswordReset || deepLinkAttemptedRef.current) return;
    if (!users || ownPrincipalId === null) return;
    const ownRow = users.find((u) => u.principalId === ownPrincipalId);
    if (!ownRow) return;
    deepLinkAttemptedRef.current = true;
    openedViaDeepLinkRef.current = true;
    openResetPassword(ownRow);
  }, [openOwnPasswordReset, users, ownPrincipalId]);

  useEffect(() => {
    if (resetPasswordFor !== null || !openedViaDeepLinkRef.current) return;
    openedViaDeepLinkRef.current = false;
    onOwnPasswordResetClosed?.();
  }, [resetPasswordFor, onOwnPasswordResetClosed]);

  // No `invalidates` — matches the pre-migration `confirmResetPassword`, which never called
  // `reload()` either (a password reset changes nothing the users table shows).
  const resetPasswordMutation = useFetchMutation({
    run: ({ input }: { input: { principalId: string; password: string } }) => port.resetUserPassword(input),
  });

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await createUser.run({ action: async () => {
      await createUserMutation.mutate({ input: { username, password, email: email || undefined } });
      setUsername("");
      setEmail("");
      setPassword("");
      setFormOpen(false);
    }, describeError: (e) => describeError(e, translate("failed to create user")) });
  }

  function toggleExpanded(user: AdminIdentityUser) {
    setGrantError(null);
    // A still-in-flight grant for the panel being LEFT can no longer clear this itself
    // (`runGrantMutation`'s `finally` now skips a stale call's own generation) — reset it here so
    // the newly opened panel never inherits a stuck "saving" indicator from the old one.
    setGrantSaving(false);
    setPendingRoleId("");
    setPendingPolicyId("");
    setEditEmail(user.email ?? "");
    toggleGenerationRef.current += 1;
    setExpandedId((current) => (current === user.principalId ? null : user.principalId));
  }

  async function onAssignRole({ principalId }: { principalId: string }) {
    if (!pendingRoleId) return;
    await runGrantMutation(
      toggleGenerationRef.current,
      toggleGenerationRef,
      () => assignRoleMutation.mutate({ input: { principalId, roleId: pendingRoleId } }),
      () => setPendingRoleId(""),
      setGrantSaving,
      setGrantError,
      (e) => describeError(e, translate("failed to assign role")),
    );
  }

  async function onAttachPolicy({ principalId }: { principalId: string }) {
    if (!pendingPolicyId) return;
    await runGrantMutation(
      toggleGenerationRef.current,
      toggleGenerationRef,
      () => attachPolicyMutation.mutate({ input: { principalId, policyId: pendingPolicyId } }),
      () => setPendingPolicyId(""),
      setGrantSaving,
      setGrantError,
      (e) => describeError(e, translate("failed to attach policy")),
    );
  }

  // `onSaveEmail` was left out of the `runGrantMutation` fold above on purpose: it tracks its OWN
  // `emailSaving` flag rather than the shared `grantSaving` `onAssignRole`/`onAttachPolicy` use, so
  // routing it through the same helper would mean passing a no-op in place of `setGrantSaving` —
  // extraction for the sake of a shared call site, not a shared shape. Left hand-rolled; `emailSaving`
  // now derives from `updateEmailMutation.status` since (unlike `grantSaving`) it was already this
  // one mutation's own dedicated flag.
  async function onSaveEmail({ principalId }: { principalId: string }) {
    setGrantError(null);
    try {
      await updateEmailMutation.mutate({ input: { principalId, email: editEmail } });
    } catch (e) {
      setGrantError(describeError(e, translate("failed to update email")));
    }
  }
  const emailSaving = updateEmailMutation.status === "pending";

  /** Opens the reset-password dialog for `user` — the `RowMenu` item's `onSelect`. Guards against
   *  opening a second one while a toggle or a previous reset is still in flight, same discipline
   *  Redirects.tsx uses for its own `RowMenu` items (no per-item `disabled` on `RowMenu` itself). */
  function openResetPassword(user: AdminIdentityUser) {
    if (!rowCapabilities(user).canResetPassword) return;
    if (toggleSavingId || resetPassword.saving) return;
    resetPassword.setError(null);
    setNewPassword("");
    setResetPasswordFor(user);
  }

  async function confirmResetPassword() {
    if (!resetPasswordFor || !newPassword || !rowCapabilities(resetPasswordFor).canResetPassword) return;
    // Dialog stays open on failure (unlike the Disable/Delete-style dialogs elsewhere in this app,
    // which close either way) — closing would discard the password the operator just typed for no
    // reason; there's nothing sensitive left on screen once they retry or cancel. `resetPasswordFor`/
    // `newPassword` are therefore only cleared in the success path below, never as a `finally`.
    await resetPassword.run({ action: async () => {
      await resetPasswordMutation.mutate({ input: { principalId: resetPasswordFor.principalId, password: newPassword } });
      // A self-reset (own row, deep-linked or from the ordinary row menu — see `ownPrincipalId`'s
      // own doc comment) gets the "sign in again" notice instead of the per-username one: the reset
      // just revoked the CALLER'S OWN session, so the next request 401s and `App.hooks.tsx` sends
      // them to the login screen — the generic notice naming a DIFFERENT user would be misleading
      // here, since it's actually their own sign-in that just ended.
      setNotice(
        resetPasswordFor.principalId === ownPrincipalId
          ? translate("Password changed. Sign in again with your new password.")
          : passwordResetNotice?.({ username: resetPasswordFor.username }) ?? interpolate({
              template: translate('Password reset for "{username}" — every active session for this user was revoked.'),
              vars: { username: resetPasswordFor.username },
            }),
      );
      setResetPasswordFor(null);
      setNewPassword("");
    }, describeError: (e) => describeError(e, translate("failed to reset password")) });
  }

  /** `setToggleSavingId`'s `finally` reset (2026-09-05 fix, same bug class as
   *  `use-roles.hooks.ts`'s `onSaveRole`/`runRowDelete`) is a functional update keyed on THIS call's
   *  own `principalId`: Enable fires with no confirmation gate, so two calls — on different users —
   *  can genuinely overlap, and an unconditional reset would clear the busy indicator (which
   *  `openResetPassword` below reads to refuse opening while a toggle is in flight) out from under a
   *  still-in-flight, unrelated toggle. */
  async function onToggleStatus(user: AdminIdentityUser) {
    const capabilities = rowCapabilities(user);
    if (user.status === "active" ? !capabilities.canDisable : !capabilities.canEnable) return;
    setToggleSavingId(user.principalId);
    setToggleError(null);
    try {
      await toggleStatusMutation.mutate({ input: user });
    } catch (e) {
      setToggleError(describeError(e, translate("failed to change status")));
    } finally {
      setToggleSavingId((current) => (current === user.principalId ? null : current));
    }
  }

  /** Opens the Disable confirm dialog for `user` — the `RowMenu` "Disable" item's `onSelect` when
   *  the user is currently active. Was an inline closure inside the old `rowMenuItems`; named here
   *  now that the item builder itself moved to `rules.ts` and needs a callback to hand it. */
  function requestDisable(user: AdminIdentityUser) {
    if (!rowCapabilities(user).canDisable) return;
    setToggleError(null);
    setConfirmingDisable(user);
  }

  /** Confirms the Disable that `RowMenu`'s "Disable" item asked about. Closes the dialog either
   *  way (matching Posts.tsx/Redirects.tsx's own Disable/Delete `ConfirmDialog` convention) — a
   *  failure surfaces via `toggleError` above the table, not by leaving the modal open.
   *
   *  2026-09-05 fix, same bug class as `use-roles.hooks.ts`'s `runRowDelete`: `setConfirmingDisable`
   *  is exposed directly on the controller, so nothing at the hook level stops the operator opening
   *  a DIFFERENT user's Disable confirmation while this one's toggle is still in flight. The close
   *  below only clears it when it still names the SAME user this call started for — otherwise a
   *  stale toggle's settlement would silently dismiss a newer, still-undecided confirmation. */
  async function confirmDisable() {
    if (!confirmingDisable) return;
    const user = confirmingDisable;
    await onToggleStatus(user);
    setConfirmingDisable((current) => (current?.principalId === user.principalId ? null : current));
  }

  // Delete-user plan v2 (2026-09-24), Slice 4 — mirrors Disable's request/confirm pair above with
  // its OWN state (see `confirmingDelete`'s own doc comment for why not shared). `deleteUserMutation`
  // invalidates `KEYS.list` like every other write on this screen; the route already filters a newly
  // trashed principal out of `listUsers()`, so the row disappears on the next render with no extra
  // client-side bookkeeping.
  const deleteUserMutation = useFetchMutation({
    run: ({ input: principalId }: { input: string }) => port.deleteUser({ principalId })
  }, {
    invalidates: [[queryScope, ...KEYS.list]],
  });
  const [confirmingDelete, setConfirmingDelete] = useState<AdminIdentityUser | null>(null);

  function requestDelete(user: AdminIdentityUser) {
    if (!rowCapabilities(user).canDelete) return;
    setToggleError(null);
    setConfirmingDelete(user);
  }

  /** Confirms the Delete that `RowMenu`'s "Delete" item asked about. Closes the dialog either way
   *  (matching `confirmDisable`'s and Posts.tsx/Redirects.tsx's own Delete `ConfirmDialog`
   *  convention) — a failure surfaces via `toggleError` above the table, not by leaving the modal
   *  open. Same stale-call guard as `confirmDisable`: only clears `confirmingDelete` when it still
   *  names the SAME user this call started for. */
  async function confirmDelete() {
    if (!confirmingDelete || !rowCapabilities(confirmingDelete).canDelete) return;
    const user = confirmingDelete;
    try {
      await deleteUserMutation.mutate({ input: user.principalId });
    } catch (e) {
      setToggleError(describeError(e, translate("failed to delete user")));
    }
    setConfirmingDelete((current) => (current?.principalId === user.principalId ? null : current));
  }

  return {
    users,
    roles,
    policies,
    canGrant,
    error,

    formOpen,
    setFormOpen,
    username,
    setUsername,
    email,
    setEmail,
    password,
    setPassword,
    saving: createUser.saving,
    formError: createUser.error,
    onCreate,

    expandedId,
    toggleExpanded,
    pendingRoleId,
    setPendingRoleId,
    pendingPolicyId,
    setPendingPolicyId,
    grantSaving,
    grantError,
    onAssignRole,
    onAttachPolicy,

    editEmail,
    setEditEmail,
    emailSaving,
    onSaveEmail,

    toggleSavingId,
    toggleError,
    notice,

    confirmingDisable,
    setConfirmingDisable,
    requestDisable,
    confirmDisable,
    onToggleStatus,

    resetPasswordFor,
    setResetPasswordFor,
    newPassword,
    setNewPassword,
    passwordSaving: resetPassword.saving,
    passwordError: resetPassword.error,
    setPasswordError: resetPassword.setError,
    openResetPassword,
    confirmResetPassword,

    canManageUserTrash,
    rowCapabilities,
    confirmingDelete,
    setConfirmingDelete,
    requestDelete,
    deleteSaving: deleteUserMutation.status === "pending",
    confirmDelete,

    t: boundT,
    translate,
  };
}

