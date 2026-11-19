import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { AdminIdentityUser, AdminPolicy, AdminRole } from "../../models.js";
import type { UsersPort } from "../../ports.js";
import type { Translate } from "@jini-ai/core/text";
import type { UserAccountCapabilities } from "../rules.js";
import type { useChangeUsername } from "./use-change-username.hooks.js";
import { useUsersState as useUsersStateDefault } from "./use-users-state.hooks.js";
import { useUsersPasswordLink as useUsersPasswordLinkDefault, useUsersResetMutation as useUsersResetMutationDefault } from "./use-users-password.hooks.js";
import { createUsersOpenResetAction, createUsersConfirmResetAction } from "./use-users-password.hooks.js";
import { createUsersCreateAction, createUsersPanelActions, createUsersGrantActions } from "./users-grant-actions.js";
import { useUsersDeletion as useUsersDeletionDefault } from "./use-users-status.hooks.js";
import { createUsersToggleAction, createUsersDisableActions } from "./use-users-status.hooks.js";
import { createUsersController } from "./users-controller.js";

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
 * below, which is safe without the ref-and-dep-array discipline the host admin guidance's "Two traps"
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
  ownProfile?: AdminIdentityUser | null;
  canRenameUser?: ((user: AdminIdentityUser) => boolean) | undefined;
  canRenameOwnProfile?: boolean | undefined;
  openOwnRename?: (() => void) | undefined;
  renameUserHandler?: ((required: { user: AdminIdentityUser }) => ((user: AdminIdentityUser) => void) | undefined) | undefined;
  changeUsername?: ReturnType<typeof useChangeUsername> | undefined;
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
 * Everything the Users screen does — full state, effects, and every server write, as one hook so
 * `Users.tsx` stays a pure render of whatever this returns. See this file's header for the
 * `useFetchQuery`/`useFetchMutation` migration and the `port` injection it now also carries.
 *
 * @param deps - Injected collaborators; production callers get these from {@link useWiredUsers}.
 * @returns The full `UsersController` the view renders from — see that interface for every field.
 */
export function useUsers({ port, translate, queryScope }: UsersDependencies, {
  openOwnPasswordReset = false, onOwnPasswordResetClosed, passwordResetNotice,
  useUsersState = useUsersStateDefault, useUsersPasswordLink = useUsersPasswordLinkDefault, useUsersResetMutation = useUsersResetMutationDefault, useUsersDeletion = useUsersDeletionDefault,
}: UsersOptions & { useUsersState?: typeof useUsersStateDefault; useUsersPasswordLink?: typeof useUsersPasswordLinkDefault; useUsersResetMutation?: typeof useUsersResetMutationDefault; useUsersDeletion?: typeof useUsersDeletionDefault } = {}): UsersController {
  const state = useUsersState({ port, translate, queryScope });
  const openResetPassword = createUsersOpenResetAction({ state });
  useUsersPasswordLink(state, { openOwnPasswordReset, onOwnPasswordResetClosed, openResetPassword });
  const resetPasswordMutation = useUsersResetMutation({ port });
  const onCreate = createUsersCreateAction({ state });
  const panelActions = createUsersPanelActions({ state });
  const grantActions = createUsersGrantActions({ state });
  const confirmResetPassword = createUsersConfirmResetAction({ state, resetPasswordMutation }, { passwordResetNotice });
  const onToggleStatus = createUsersToggleAction({ state });
  const disableActions = createUsersDisableActions({ state, onToggleStatus });
  const deletion = useUsersDeletion({ state });
  return createUsersController({ state, actions: {
    onCreate, ...panelActions, ...grantActions, openResetPassword, confirmResetPassword,
    onToggleStatus, ...disableActions, ...deletion,
  } });
}
