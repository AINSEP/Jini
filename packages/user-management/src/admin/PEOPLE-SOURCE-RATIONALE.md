# Users, members and auth source rationale

All source comments, including historical rationale and tests, retained in source order.
Host identity words are normalized to `host` to keep the package neutral.

## live-host/users/Users.tsx

```text
/**
 * @file Admin "Users" screen (SPEC-006 §3 human grant-writing transitions + 0.6.0 CRUD-completion
 * amendment) — markup only.
 *
 * State and API calls live in `hooks/use-users.hooks.ts`; the row-menu logic and the
 * server-error-message overrides live in `rules.ts`. What stays here is what actually renders: the
 * form, the table, and the two dialogs.
 *
 * Mirrors `features/integrations/Integrations.tsx`'s fetch/loading/error/form/table shape.
 * Lists operator users, creates new ones (`CREATE_USER`), and grants roles/
 * policies to an existing user (`ASSIGN_ROLE`/`ATTACH_POLICY`) via an
 * inline expandable "Manage" row. Role/policy *creation* is out of
 * this screen's UI (no `CREATE_ROLE`/`CREATE_POLICY` form here) — the API
 * client exposes `api.createRole`/`api.createPolicy` for the Roles &
 * Permissions screen to reuse.
 *
 * 0.6.0: the same expandable row also carries `UPDATE_USER` (email),
 * `RESET_USER_PASSWORD`, and a quick `DISABLE_PRINCIPAL`/`ENABLE_PRINCIPAL` toggle.
 *
 * Row actions (audit follow-up): all three of the above — Disable/Enable, Manage (opens the
 * expandable row), Reset password — now live behind a single three-dot `RowMenu`, matching
 * `Posts.tsx`/`Pages.tsx`'s row-action shape rather than a row of separate buttons.
 *
 * Delete-user plan v2 (2026-09-24): a fourth "Delete" item joins the menu, shown only when the
 * signed-in caller may manage the user Trash (owner or the built-in `admin` role — OWNER DECISION
 * 2026-09-24, `use-users.hooks.ts`'s `canManageUserTrash`). It moves the target to the Trash
 * (disabled, sessions revoked, restorable there for 60 days) rather than hard-deleting it — see
 * `UserDeleteDialog`'s own doc comment.
 *
 * Complexity-ceiling pass (2026-08-06): `Users` and its row-map closure both scored over the
 * ceiling (19/16 and 11/11 respectively). Split into four top-level, individually-testable
 * functions below — `NewUserForm`, `UsersTable`/`UserRow`, `UserDisableDialog`/`UserDeleteDialog`,
 * `UserResetPasswordDialog` — following `Taxonomy.tsx`'s existing convention of sibling top-level
 * function components in the same file rather than nested closures (a nested `const` inside
 * `Users` would not have moved any branching out of `Users`' own scope). `Users` itself is now a
 * thin composition of those, none of them exported, so no test does anything `Users.tsx`
 * didn't already support — see `__tests__/Users.unit.test.tsx`/`Users.crud.unit.test.tsx` for the
 * full-render tests these were extracted underneath (unchanged), plus new
 * `__tests__/users-components.unit.test.tsx` for direct component-level tests of each piece.
 *
 * Reset-password confirm + reveal (typo-catching pass): `UserResetPasswordDialog` gained a second
 * field ("Confirm new password") and an independent show/hide toggle per field, both driven by the
 * new `hooks/use-reset-password-fields.hooks.ts` (confirm-field state and both reveal flags are
 * purely local/ephemeral — never sent to the server, so they don't belong in `use-users.hooks.ts`'s
 * screen-wide `UsersController`). The confirm-vs-server-error display conflict is resolved by giving
 * the two states one shared slot with a fixed precedence — a live mismatch always wins over a stale
 * `passwordError` from a previous attempt — rather than trying to show both at once or inventing a
 * second error line; see `UserResetPasswordDialog`'s own body for the exact ternary. `RevealablePasswordField`
 * is the shared field+toggle shape both new inputs use, following this file's own `GrantSelect`
 * precedent for a shape used twice.
 */
/**
   * Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   * for `useCustomSelect`. Defaulted to the wired hook, so production callers (`panels.tsx`) pass
   * nothing and behave exactly as before.
   */
/** Password-banner plan (2026-09-24), Slice 3: set by `panels.tsx` when the route is
   *  `/users/change-password` (the dashboard nag's deep link). Forwarded to `useUsersHook` as-is —
   *  `Users` itself has no opinion on what it means, see `use-users.hooks.ts` for the behavior. */
/** The "New user" form — extracted from `Users` verbatim; own scope for `formError`/`saving`. */
/* `autoComplete="new-password"`, NOT `"off"` — Chrome deliberately ignores `off` on
            credential-shaped fields (a long-standing intentional decision, not a bug). Without
            this, this form's `type="email"` input right above reads to Chrome as a login pair, and
            Chrome offered to fill the logged-in ADMIN's own saved email/password into a form meant
            to create a DIFFERENT user. `new-password` is the value Chrome/Safari/Firefox actually
            honor for "this is an account-creation field, not a saved login" — matching this repo's
            own corrected precedent on `security/AccessTokensTab.tsx`'s token field (commit
            `fc64f2d9`, superseding an earlier `autoComplete="off"` attempt that did not work).
            Known trade-off, not fixed here: Chrome may now offer to GENERATE a password on this
            field — a suggestion popup, not a silently wrong value. */
/** The subset of `AdminRole`/`AdminPolicy` a grant `<select>` actually renders. Named rather than
 *  taking the full records, so the shared control below cannot come to depend on anything a role has
 *  and a policy does not. */
/** One "pick something, then grant it to this user" control. Both grants on the Manage panel are
 *  this same shape, which is what lets them share {@link GrantSelect} instead of being two
 *  near-identical blocks whose props had to be threaded separately. */
/** The id currently selected in the `<select>`, or `""` for the placeholder row. */
/**
 * Everything the expanded "Manage" panel needs, as one object.
 *
 * Replaces the fifteen loose state/setter/callback props this panel used to take and `UserRow` used
 * to relay through an `Omit<UserManagePanelProps, "principalId">` rest spread. The grouping is by
 * interaction, not by convenience: the email editor and the two grants are three independent
 * controls that happen to share one error line and one in-flight flag, and saying so in the type is
 * what lets a test build a Manage panel without also standing up a row, a table, and a page.
 */
/** The one error line the whole panel shares — any of the three writes can set it. */
/** Shared by both grants: the panel issues one grant at a time. */
/** Distinct handle base for this grant — `UserManagePanel` renders this component twice (role,
   *  policy), so a fixed name would collide (only one Manage panel is ever open at a time, but a
   *  hardcoded handle in a shared component still means two call sites publish the SAME handle —
   *  the exact trap this workstream's shared-component convention exists to avoid). */
/** The select-plus-button both grants render. */
/** Injectable seam for the confirm-field + reveal-toggle state. Defaults to the real
   *  {@link useResetPasswordFields}. */
/** Resolves `useFields` to the real hook when no override is passed, because ESLint's
 *  cyclomatic-complexity rule counts a default parameter value evaluated inside a function's OWN
 *  body as one of that function's own branches; a call out to a separately-scoped resolver does
 *  not. */
/** The reset-password dialog — extracted from `Users` verbatim, since extended with the confirm
 *  field and both reveal toggles (see this file's header). */
/** Blocks the reset entirely when the two fields disagree — a mismatch never reaches
   *  `confirmResetPassword`/the server. The inline message below is driven by the same `mismatch`
   *  value, so it is already visible by the time a blocked click can happen; there is nothing
   *  further to surface here. */
// NOT "users-reset-password-confirm" — that string is already the dialog's own
// ConfirmDialog Confirm button handle (`agentHandle="users-reset-password"` above,
// `-confirm` sub-handle). Two elements answering to the same handle is a
// page-authoring bug the page driver refuses to resolve (see
// `dom-page-driver.ts`'s `ambiguousHandleError`), so this field gets its own name.
/* One shared slot, fixed precedence: a live mismatch always wins over a stale
                `passwordError` left over from a previous failed attempt, so the two can never be
                shown — or appear to conflict — at the same time. Once the fields agree again, the
                stale server error (if any) reappears until the next submit or Cancel clears it. */
/** The page title plus the "New user"/"Cancel" toggle button — extracted from `Users` verbatim so
 *  its two `formOpen` ternaries (class, label) count against this function, not `Users`'. */
/* Owner ask (2026-09-24): there's no "forgot password" self-service flow yet, so a
              locked-out user relies on an admin resetting their password from this page (see
              `UserRow`'s `RowMenu` — Reset password lives there, not as a standalone header
              button, which is why this sits on the page title instead of "next to" that action).
              Reset behavior itself is unchanged. Reuses the shared `InfoTip` — already this app's
              "ⓘ opens an explanation, keyboard-/focus-reachable, Escape closes without losing
              focus" convention (see `ThemePagesTab.tsx`'s locked-row usage) — rather than a new
              bespoke popover. */
/* Same toggle button throughout — reads "New user" (the page's one primary action) when
            closed, "Cancel" (a dismiss, not a create) once the form is open, so the tone follows
            the label instead of a second button competing with the form's own "Create user". */
/** The Disable/Enable-toggle error banner and the reset-password success notice — extracted from
 *  `Users` verbatim. `Users` was still cyc 10 (over the tightened <=9/<=9 bar) with these two
 *  independent ternaries inline; moving them out is the same "extract to a top-level function"
 *  rule the rest of this pass follows. */
```

## live-host/users/__tests__/Users.autofill.unit.test.tsx

```text
/**
 * @file Regression coverage for the owner-reported bug: the "New user" form's `type="password"`
 * input (`NewUserForm`, `Users.tsx`) carried no `autoComplete` attribute. Combined with the
 * `type="email"` input right above it inside a real `<form>`, the pair reads to Chrome as a LOGIN
 * form shape, and Chrome offered to autofill the logged-in ADMIN's own saved email/password into a
 * form meant to create a DIFFERENT user account.
 *
 * Fix follows the corrected precedent this repo already established for the identical bug on
 * `security/AccessTokensTab.tsx`'s token field (`fc64f2d9`, superseding `dcc23788`'s
 * `autoComplete="off"` attempt): Chrome has deliberately ignored `autocomplete="off"` on
 * credential-shaped fields since ~2014, precisely to stop sites from blocking password managers.
 * `autoComplete="new-password"` is the value Chrome (and Safari/Firefox) actually honor as "this is
 * an account-creation field, not a saved login" — per WHATWG's own autofill spec, pairing it on the
 * password field is what reclassifies the WHOLE form as signup rather than login, which is also why
 * only the password input needs the attribute (same reasoning `fc64f2d9`'s commit message documents:
 * fixing the password field alone was enough to stop the surrounding fields' autofill too).
 *
 * KNOWN TRADE-OFF, not fixed here: Chrome may now offer to GENERATE a password on this field — a
 * suggestion popup rather than a silent wrong value, the better failure mode per `fc64f2d9`.
 *
 * NOT PROVEN, and cannot be, by this test: Chrome autofill never fires in jsdom/Playwright (no saved
 * credential store exists there). This only asserts the rendered `autocomplete` attribute — the same
 * disclosed limitation `AccessTokensTab.unit.test.tsx` already carries for its own version of this
 * bug. Only the owner's real browser, which already showed the bug once, can confirm it stops.
 */
// Same locale-request carve-out `Users.unit.test.tsx` uses — `useAdminLocale()` would otherwise
// consume one of this file's strictly-ordered `mockResolvedValueOnce` slots.
// `useUsers` now also calls `port.me()` unconditionally on mount (password-banner plan,
// 2026-09-24 Slice 3 deep-link half) — same carve-out as `Users.unit.test.tsx`.
/** Owner report 2026-09-27: Chrome filled a saved password into the Reset password dialog's
 *  "New password" field (`RevealablePasswordField`), leaving "Confirm" empty and showing "Passwords
 *  do not match." The field had no `autoComplete`. It toggles to `type="text"` when revealed, so the
 *  attribute must hold in both states. */
```

## live-host/users/__tests__/Users.crud.unit.test.tsx

```text
/**
 * @file `Users` — covers the create-user form, the loading/error/empty states, and the expanded
 * "Manage" panel's assign-role/attach-policy/save-email flows. `Users.unit.test.tsx` already pins
 * the `RowMenu` rollout (Manage/Disable/Enable/Reset password); this file targets the rest of the
 * screen, which was still 39.4% covered (rank #10 by risk) after that pass.
 *
 * `Users` has no injectable hook seam used here, so every `render(<Users />)` below needs a
 * `FetchQueryProvider` ancestor (2026-08-12, `lib/fetch-query` migration).
 */
// `Users` now also calls `useAdminLocale()` (real `fetch`, not this screen's own concern), which
// would otherwise consume one of this file's strictly-ordered `mockResolvedValueOnce` slots and
// shift every later assertion by one call. Routed to a fixed default-locale response outside
// `fetchMock`'s own call queue, so `fetchMock.mock.calls` still holds exactly this screen's own
// requests, in the order each test already expects.
// `useUsers` now also calls `port.me()` unconditionally on mount (password-banner plan,
// 2026-09-24 Slice 3 deep-link half) — see `Users.unit.test.tsx`'s identical interceptor for why
// this is routed outside `fetchMock`'s own strictly-ordered queue, and why `.endsWith`, not
// `.includes`, so it can't also swallow `/auth/me/password-status`.
// never resolves
// POST create
// reload
// Was `/email/i` — now ambiguous: the page header's new reset-password `InfoTip` (2026-09-24)
// has an accessible name that also contains "email", so the fuzzy regex matches both. The
// create form's own field label ("Email (optional)", `NewUserForm`) is exact and unambiguous.
// The form closes on success — it's no longer in the DOM.
// create POST never resolves
// POST assign role
// reload
// Scoped to the summary `<tr>`, not the whole table — the expanded Manage panel is a sibling
// `<tr>` in the same `<table>` and its own "Assign role" select also has an "Editor" option.
// POST attach policy
// reload
// PATCH email
// reload
```

## live-host/users/__tests__/Users.unit.test.tsx

```text
/**
 * @file `Users` — pins the `RowMenu` rollout (task: roll `RowMenu` out to `Users.tsx`/
 * `Members.tsx`). Corrected spec (superseding an earlier "Manage stays a visible button" hybrid
 * design): the three-dot `RowMenu` holds Disable/Enable, Manage, and Reset password, matching
 * `Posts.tsx`/`Pages.tsx`'s row-action shape — no separate button survives in that column. There
 * is no Delete item: no server-side route deletes a user principal.
 *
 * Disable keeps its existing confirm-gate, now via the shared `ConfirmDialog` (a `RowMenu` item
 * has no in-place two-click affordance the old `ConfirmButton` used) instead of losing the
 * protection outright. Reset password moves out of the expanded "Manage" panel entirely, into its
 * own dialog with an embedded password field. "Manage" keeps a static label rather than
 * alternating with "Close" — see `Users.tsx`'s `rowMenuItems` doc comment for why.
 *
 * `ConfirmDialog` stays mounted unconditionally and toggles its own `open` attribute (its own doc
 * comment) — its `<h2>` title text is therefore always in the DOM regardless of open/closed state,
 * so "is the dialog showing" has to be asserted via the `<dialog open>` attribute, not text
 * presence. Same pattern `PostEditor.unit.test.tsx` already uses for its own delete `ConfirmDialog`.
 * Follows the RTL harness `MenuEditor.unit.test.tsx`/`Comments.unit.test.tsx` established for this
 * package's `RowMenu` screens.
 *
 * `Users` has no injectable hook seam used here (`useUsersHook` defaults to the wired `useWiredUsers`,
 * which itself composes `useUsers` with the real `UsersPort` — 2026-08-14 conversion), so every
 * `render(<Users />)` below needs a `FetchQueryProvider` ancestor (2026-08-12, `lib/fetch-query`
 * migration).
 */
/** Finds the `<dialog>` whose own heading matches `titleRe` — there are two `ConfirmDialog`s
 *  mounted on this screen (Disable, Reset password), both always in the DOM. */
// `Users` now also calls `useAdminLocale()` (real `fetch`, not this screen's own concern), which
// would otherwise consume one of this file's strictly-ordered `mockResolvedValueOnce` slots and
// shift every later assertion by one call. Routed to a fixed default-locale response outside
// `fetchMock`'s own call queue, so `fetchMock.mock.calls` still holds exactly this screen's own
// requests, in the order each test already expects.
// `useUsers` now also calls `port.me()` unconditionally on mount (password-banner plan,
// 2026-09-24 Slice 3 deep-link half — see `use-users.hooks.ts`'s `ownPrincipalId` doc comment
// for why it's unconditional, not gated on `openOwnPasswordReset`). Same routing-outside-the-
// queue treatment as the locale interceptor above. The id deliberately does not match any user
// seeded in this file, so every reset-password test below keeps getting the per-username notice
// it already asserts on, not the self-reset "sign in again" one — `.endsWith`, not `.includes`,
// so this cannot also swallow `/auth/me/password-status` (a different route, unused here).
// Scoped to the panel itself — the reset-password `ConfirmDialog` stays mounted elsewhere in
// the DOM regardless of open state (its own doc comment), so its "Reset password" confirm
// button would otherwise be found unscoped even though it isn't part of this panel.
// Reset password no longer lives in this panel — it moved into the RowMenu.
// The menu item's label never becomes "Close" (it would only ever describe a state the
// operator can't see, since the menu itself is gone the instant it's selected) — reopening
// the menu still shows "Manage", and selecting it again still closes the panel.
// Same handler, either direction: clicking it again closes the panel it opened.
// initial load
// POST disable
// reload
// The dialog's own "Disable" confirm button, not the RowMenu item of the same name.
// initial load
// POST enable
// reload
// No dialog opened for Enable — the "Disable" dialog stays mounted-but-closed, same as before
// this interaction even started.
// initial load
// POST reset-password (void response)
// Reopening starts from a clean slate — proves newPassword/passwordError were actually
// cleared by onCancel, not merely hidden behind the closed dialog.
// Blocked client-side: the dialog stays open and no request was ever sent — the mismatch
// never reaches `confirmResetPassword`/the network at all.
// POST reset-password, once the fields agree
// Fix the typo — mismatch message goes away and the confirm button now actually submits.
// Now introduce a live mismatch on top of the stale server error — only one message shows,
// and it's the live one, not both stacked or fighting for the same line.
/** Each password field's own `.field` wrapper — scoping into it, rather than trusting DOM order
     *  between two same-labeled "Show password" buttons, is what actually proves a toggle affects
     *  only ITS OWN field. */
// The confirm field's own toggle is unaffected — still hidden, still labeled "Show password".
// Hiding the new-password field again doesn't touch the confirm field.
/**
 * The controller seam introduced by the F05 coupling fix (audit `TM-20260810-01`). `UserManagePanel`
 * used to take fifteen loose state/setter/callback props, and `UserRow` relayed them through an
 * `Omit<UserManagePanelProps, "principalId">` rest spread — so nothing could render the panel
 * without reconstructing that whole bag. These assertions drive it from one hand-built controller.
 */
// The built-in marker comes from the option's own flag, not from a full `AdminPolicy` record —
// the shared `GrantSelect` only ever sees `GrantOption`.
// Both grants are blocked by the shared flag...
// ...while the email control has its own, and is still pressable.
```

## live-host/users/__tests__/rules.unit.test.ts

```text
/**
 * @file Pure-logic coverage for `features/users/rules.ts` — the screen's `describeApiError`
 * override table, the three-item `RowMenu` builder (`Users` was rank #10 by risk, 39.4% covered),
 * and the role/policy grant-label formatter.
 */
// C4 — the four static overrides plus the VALIDATION_ERROR fallback leaked English regardless of
// locale. Table-driven per static code, in `es`.
// C4 — dictionary-parity spot check for just the 5 keys this pass added, so pre-existing
// dictionary drift elsewhere in `USERS_DICT` does not fail this file (same scoping `roles-
// i18n.unit.test.ts` uses for C1's keys).
```

## live-host/users/__tests__/use-reset-password-fields.unit.test.tsx

```text
/**
 * @file `useResetPasswordFields` — the confirm-field + reveal-toggle state extracted out of
 * `Users.tsx`'s `UserResetPasswordDialog`. Harness: a hand-built input object, no `fetch`/`FetchQueryProvider`
 * needed since this hook does no I/O.
 */
```

## live-host/users/__tests__/use-users.unit.test.tsx

```text
/**
 * @file First dedicated hook-level test file for `useUsers` (0% before this pass — the highest-
 * state screen in the app, 25 `useState` calls, was previously exercised only indirectly through
 * `Users.unit.test.tsx`/`Users.crud.unit.test.tsx`'s full-component renders). Written as a
 * CHARACTERIZATION suite against CURRENT behavior — documents what the code DOES — so it proves
 * equivalence across the `useAsyncAction` adoption this pass also makes for `onCreate` and
 * `confirmResetPassword`, the same discipline `MediaPickerDialog.unit.test.tsx` used.
 *
 * Follows `use-roles.unit.test.ts`'s exact harness: mock global `fetch`, not the `api` module —
 * asserting the actual request shape (and the EXACT string `describeApiError` produces) is part of
 * the point, since that translation moved verbatim off `Users.tsx` in the original extraction.
 *
 * Scope note: `grantSaving`/`grantError` (shared by `onAssignRole`/`onAttachPolicy`/`onSaveEmail`)
 * and `toggleSavingId`/`toggleError` (shared by `onToggleStatus`/`confirmDisable`, keyed by
 * principalId rather than a plain boolean) are covered here as-is — they are NOT migrated onto
 * `useAsyncAction` in this pass; see that hook's own file header and the refactor report for why.
 *
 * `wrapper` (2026-08-12, `lib/fetch-query` migration): the combined users+roles+policies read and
 * every write now go through `useFetchQuery`/`useFetchMutation`, which throw without a
 * `QueryClientProvider` ancestor.
 *
 * `useWiredUsers` (2026-08-14, `useX(dependencies)` / `useWiredX()` conversion): every call below
 * that used to render bare `useUsers()` now renders `useWiredUsers()` instead — same real `fetch`
 * harness, same assertions, only the entry point renamed now that `useUsers` takes an injected
 * `UsersDependencies` argument. Matches `use-posts.unit.test.ts`/`use-redirects.hooks.unit.test.tsx`'s
 * identical split: this file's bulk stays a `fetch`-stubbed `useWiredUsers` suite, and a new
 * "injected port" group at the bottom composes `useUsers` directly against `createFakeUsersPort`
 * with no `fetch` stub at all.
 */
// `useUsers` now also calls `useAdminLocale()` (real `fetch`, not this hook's own concern),
// which would otherwise consume one of this file's strictly-ordered `mockResolvedValueOnce`
// slots and shift every later assertion by one call. Routed to a fixed default-locale response
// outside `fetchMock`'s own call queue — same interceptor pattern `Members.unit.test.tsx` uses.
// The auth read is independent of the users/roles/policies request queue.
// `waitFor`, not a bare synchronous read (2026-08-12, `lib/fetch-query` migration): the
// reload triggered by `invalidates: [KEYS.list]` is a separate, un-awaited background
// refetch, so the mutation's own promise resolving does not guarantee it has landed yet.
// `waitFor`: the reload triggered by `invalidates: [KEYS.list]` is a separate, un-awaited
// background refetch — see this file's identical note above.
// The stale error from the earlier onAssignRole failure is gone — same shared slot, cleared by
// the next action's own attempt, not scoped per-action.
```

## live-host/users/__tests__/users-agent-drive.unit.test.tsx

```text
/**
 * @file Regression test for this batch's agent-control tagging on `Users.tsx` — same shape as
 * `forms/__tests__/forms-agent-drive.unit.test.tsx`, driving the real `executePageCapability` and
 * the real `createDomPageDriver`, not `userEvent`.
 *
 * Uses `Users`' own `useUsersHook` injection seam (a real, supported prop the component already
 * takes — `Users.unit.test.tsx` just happens not to use it, preferring a full `fetch` mock) so
 * these tests need no server. `UserManagePanel` is separately exported and driven directly, the
 * same seam `Users.unit.test.tsx`'s own "controller seam" tests already exercise.
 *
 * Properties covered:
 *
 * 1. `page.fill` on the new-user form's username/email fields reaches React state.
 * 2. Two users get distinct `users-row-<id>-manage` handles, and `page.click`-ing one calls
 *    `toggleExpanded` with THAT user, not the other — proving the per-row handle resolves to the
 *    correct row's own control, not merely that a handle with the right shape exists somewhere.
 * 3. `UserManagePanel`'s shared `GrantSelect` gives the role and policy grants distinct handles
 *    despite being the exact same component rendered twice — `page.select_option` +`page.click` on
 *    the role handle calls `roleGrant.submit`, never `policyGrant.submit`.
 */
// `pendingId: "r-1"` up front, not left for `page.select_option` to produce: `setPendingId` is
// a spy here, not real `useState` — calling it records the call but does not change the static
// `pendingId` prop this render already has, and `grant.submit`'s button is disabled while
// `pendingId` is empty. `page.select_option`'s own resolution is still checked below via the
// `setPendingId` call it makes; only the button's enabled state needs a pre-selected value.
// Credentials are human-only; drive their React handlers with ordinary input.
// me() must settle before opening the menu.
```

## live-host/users/__tests__/users-reset-password-info.unit.test.tsx

```text
/**
 * @file Owner ask (2026-09-24): an info icon on the Users page explains that there is no
 * "forgot password" self-service flow yet, and that an admin resets a locked-out user's password
 * from this page. Reset-password behavior itself is unchanged — this only covers the new info
 * affordance. Reuses the shared `InfoTip` (`components/InfoTip.tsx`) — already the app's
 * established "ⓘ opens an explanation, keyboard- and focus-reachable, Escape closes without losing
 * focus" pattern (see `ThemePagesTab.tsx`'s locked-row usage) — rather than a bespoke popover.
 *
 * `Users` has no injectable hook seam for its own page header, so this renders the full screen with
 * a mocked `fetch`, same interceptor shape `Users.unit.test.tsx` already uses for the locale and
 * `/auth/me` calls this screen fires unconditionally on mount.
 */
// The icon is the first focusable element on the page (page-header-text precedes
// page-actions in DOM order), so one Tab from a fresh render reaches it — same style
// `InfoTip.unit.test.tsx` itself uses rather than calling `.focus()` directly.
```

## live-host/users/hooks/use-reset-password-fields.hooks.ts

```text
/**
 * @file The reset-password dialog's own confirm-field and reveal-toggle state — client-side only,
 * never sent to the server (`use-users.hooks.ts`'s `resetPasswordMutation` still posts only
 * `principalId`/`password`). Split out of `Users.tsx` because this is one dialog's own ephemeral UI
 * concern, not part of the screen-wide `UsersController` `use-users.hooks.ts` already owns, so it
 * gets its own small hook rather than growing that one further. No `-port.hooks.ts`/
 * `-dependencies.hooks.ts` pair — this hook does no I/O of its own.
 */
/** Which user the dialog is open for — `null` when closed. Only `principalId` is read (see
   *  `useResetPasswordFields`'s own doc comment for why). */
/** The dialog's own "New password" value, owned by `use-users.hooks.ts` — passed in so this hook
   *  can derive `mismatch` without `UserResetPasswordDialog` having to compare the two fields itself. */
/** The typed confirmation value. Never read by anything outside this dialog — it exists only to
   *  be compared against `newPassword`, and is discarded (never becomes part of the request body). */
/** True whenever `newPassword` and `confirmPassword` differ, including while `confirmPassword` is
   *  still empty. `UserResetPasswordDialog` uses this to block the confirm action and to choose
   *  which message occupies its single error slot. */
/**
 * Owns the "Confirm new password" field and both fields' independent reveal toggles.
 *
 * Resets `confirmPassword` and both reveal flags to their defaults on every open transition —
 * keyed on `resetPasswordFor?.principalId` rather than the `user` object's own identity, so a
 * reopen of the SAME user (e.g. Cancel, then "Reset password" again from the row menu) still
 * resets even if the `users` list query happens to hand back the same object reference. This is
 * also why closing the dialog (`principalId` going back to `null`) resets these fields too: there
 * is no user-visible difference between "reset on close" and "reset on open" for a dialog that is
 * unmounted-in-effect (`ConfirmDialog` stays in the DOM but hidden) between the two.
 *
 * @param input - `resetPasswordFor` (open/closed + which user) and the sibling `newPassword` value.
 * @returns The confirm field's value/setter, the derived `mismatch` flag, and both reveal toggles.
 * @complexity Time/space: O(1) — fixed number of state cells, no iteration.
 */
```

## live-host/users/hooks/use-users.hooks.ts

```text
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
/** `null` until the initial load settles — the caller renders a loading state. Loaded together
   *  with `roles`/`policies` via `Promise.all`, so all three settle on the same render. */
/** Whether the "New user" form is expanded. */
/** The row whose "Manage" panel is expanded — `null` when every row is collapsed. */
/** The "Manage" panel's own email field — seeded from `user.email` when the panel opens. */
/** In-flight Disable/Enable request, keyed by `principalId` — one at a time. */
/** The user a `RowMenu` "Disable" selection is asking to confirm; `null` when the dialog is
   *  shut. `ConfirmDialog` stays mounted unconditionally in the view (see its own doc comment on
   *  why); this is what drives its `open` prop. */
/** Opens the Disable confirm dialog for `user` — the `RowMenu` "Disable" item's `onSelect` when
   *  the user is currently active (Enable, by contrast, fires immediately via `onToggleStatus`). */
/** The user a `RowMenu` "Reset password" selection is asking about; `null` when the dialog is
   *  shut. Kept open on failure (unlike the Disable dialog, which closes either way) so a failed
   *  attempt doesn't discard the password the operator just typed. */
/** Delete-user plan v2 (2026-09-24), Slice 4: whether the SIGNED-IN caller may trash users at all
   *  — from `port.me()`'s `canManageUserTrash`, resolved by the same one-shot effect that already
   *  fetches `ownPrincipalId`. `false` until that call settles (or forever if it fails), the same
   *  "unknown defaults to no affordance" convention `ownPrincipalId`'s doc comment describes. Drives
   *  `rules.ts`'s `userRowMenuItems` `canDelete` param — see that function's own doc comment for why
   *  the real boundary is server-side, not this flag. */
/** The user a `RowMenu` "Delete" selection is asking to confirm; `null` when the dialog is shut.
   *  Mirrors `confirmingDisable` exactly (own state, own request/confirm pair) rather than sharing
   *  it — Delete and Disable are two independent confirms an operator could otherwise not tell apart
   *  if they shared one slot. */
/** Opens the Delete confirm dialog for `user` — the `RowMenu` "Delete" item's `onSelect`. Never
   *  fires immediately (see `rules.ts`'s `UserRowMenuHandlers.onRequestDelete` doc comment). */
/** In flight while the delete mutation is pending — drives the confirm dialog's `pending` prop,
   *  same role `toggleSavingId` plays for the Disable dialog. */
/** Bound translator — `key` already resolved against the caller's locale, so `Users.tsx` never
   *  imports `useAdminLocale`/`users-i18n` itself. See this file's header. */
/** Raw resolved locale — `rules.ts`'s `userRowMenuItems` takes `locale` directly rather than a
   *  bound translator. See this file's header. */
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
// Same generation check as the success branch above (C8, plan-access.md §8, N3): a stale
// failure must not paint onto a DIFFERENT user's panel the operator has since opened.
// Guarded the same way — a stale call's `finally` must not clear a NEWER call's own saving
// flag. `toggleExpanded` resets `grantSaving` itself when it bumps the generation, so a panel
// switch still leaves the new panel un-stuck even though this skip means THIS call no longer
// clears it.
/** What `useUsers` needs injected from outside — see this file's header for the conversion note.
 *
 *  `openOwnPasswordReset`/`navigate` (password-banner plan, 2026-09-24 Slice 3): the dashboard nag's
 *  "Change password" link deep-links to `/admin/users/change-password`, which `panels.tsx` turns
 *  into this flag. Both are optional so every existing `useUsers({ port })` call (this file's own
 *  tests, `Users.tsx`'s default) keeps working unchanged — the deep link is additive behavior, not a
 *  new required collaborator. */
/** When true, auto-opens the reset-password dialog on the caller's own row once it is known —
   *  see the one-shot effect in {@link useUsers} for why this needs both the flag AND the user list
   *  AND `me()` to have settled before it can act. */
/** DI seam for `@/lib/router`'s `navigate`, same convention `use-post-editor.hooks.ts`'s `navigate`
   *  dependency uses — real impl wired only in {@link useWiredUsers}. */
/**
 * Everything the Users screen does — full state, effects, and every server write, as one hook so
 * `Users.tsx` stays a pure render of whatever this returns. See this file's header for the
 * `useFetchQuery`/`useFetchMutation` migration and the `port` injection it now also carries.
 *
 * @param deps - Injected collaborators; production callers get these from {@link useWiredUsers}.
 * @returns The full `UsersController` the view renders from — see that interface for every field.
 */
// `portRef` (password-banner plan, 2026-09-24 Slice 3 deep-link half): captured once at mount and
// never written again, same discipline and same reasoning as `use-assistant-chats.hooks.ts`'s own
// `portRef` — the one-shot `me()` effect below must not spin if a caller builds a fresh port object
// per render (`apps/admin/INFO.md`'s "Two traps" section). Every OTHER `port.xxx()` call in this
// file stays a direct closure read, unaffected — this ref exists only for the raw `useEffect` below,
// which is not a `useFetchQuery`/`useFetchMutation` closure and so does not get that discipline for
// free.
// Bumped once per `toggleExpanded` call, regardless of which panel — `runGrantMutation` (a
// top-level function, outside this closure's re-render cycle) reads this to tell whether the
// operator switched panels AT ALL while its own grant was in flight. See that function's own doc
// comment for why this counts switches rather than comparing against `expandedId`'s value.
// Disable now confirms via a `RowMenu` item -> `ConfirmDialog` modal (replacing the in-place
// two-click `ConfirmButton`, which has no menu-item equivalent — same migration Posts.tsx/
// Redirects.tsx already made). `null` when the dialog is closed.
// Reset password moved out of the expanded "Manage" panel into its own `RowMenu` item, which
// opens this dialog (it needs a text field, so it's a `ConfirmDialog` with an input in the body,
// not a plain confirm). Kept open on failure (unlike the delete-style dialogs above, which close
// either way) so a failed attempt doesn't discard the password the operator just typed.
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
// `canManageUserTrash` (delete-user plan v2, Slice 4): resolved by this SAME one-shot `me()` call
// rather than a second request — see `UsersController.canManageUserTrash`'s own doc comment.
// Best-effort, see `ownPrincipalId`'s own doc comment above — a failure just means the
// deep link can't auto-open and self-resets fall back to the per-username notice.
// `canManageUserTrash` stays `false`, the same "unknown means no affordance" default.
/** Guards the one-shot deep-link auto-open effect below so it fires at most once per mount, even
   *  as `users`/`ownPrincipalId` keep changing identity across the renders it's waiting on (list
   *  reloads, `me()` settling). Separate from {@link openedViaDeepLinkRef}, which tracks a DIFFERENT
   *  question ("should closing the dialog navigate away") over the dialog's own open/close lifetime
   *  — this one is "has the auto-open already been attempted", which must stay true forever once it
   *  fires, including after the dialog this effect opened has since been closed. */
/** Set true exactly when this effect opens the dialog, cleared by the close-effect below the first
   *  time it observes `resetPasswordFor` go back to `null`. Read there to decide whether to navigate
   *  — an operator resetting a DIFFERENT row's password from the ordinary row menu, or cancelling a
   *  normal reset, must not also get shoved to `/users`. */
// No `invalidates` — matches the pre-migration `confirmResetPassword`, which never called
// `reload()` either (a password reset changes nothing the users table shows).
// A still-in-flight grant for the panel being LEFT can no longer clear this itself
// (`runGrantMutation`'s `finally` now skips a stale call's own generation) — reset it here so
// the newly opened panel never inherits a stuck "saving" indicator from the old one.
// `onSaveEmail` was left out of the `runGrantMutation` fold above on purpose: it tracks its OWN
// `emailSaving` flag rather than the shared `grantSaving` `onAssignRole`/`onAttachPolicy` use, so
// routing it through the same helper would mean passing a no-op in place of `setGrantSaving` —
// extraction for the sake of a shared call site, not a shared shape. Left hand-rolled; `emailSaving`
// now derives from `updateEmailMutation.status` since (unlike `grantSaving`) it was already this
// one mutation's own dedicated flag.
/** Opens the reset-password dialog for `user` — the `RowMenu` item's `onSelect`. Guards against
   *  opening a second one while a toggle or a previous reset is still in flight, same discipline
   *  Redirects.tsx uses for its own `RowMenu` items (no per-item `disabled` on `RowMenu` itself). */
// Dialog stays open on failure (unlike the Disable/Delete-style dialogs elsewhere in this app,
// which close either way) — closing would discard the password the operator just typed for no
// reason; there's nothing sensitive left on screen once they retry or cancel. `resetPasswordFor`/
// `newPassword` are therefore only cleared in the success path below, never as a `finally`.
// A self-reset (own row, deep-linked or from the ordinary row menu — see `ownPrincipalId`'s
// own doc comment) gets the "sign in again" notice instead of the per-username one: the reset
// just revoked the CALLER'S OWN session, so the next request 401s and `App.hooks.tsx` sends
// them to the login screen — the generic notice naming a DIFFERENT user would be misleading
// here, since it's actually their own sign-in that just ended.
/** `setToggleSavingId`'s `finally` reset (2026-09-05 fix, same bug class as
   *  `use-roles.hooks.ts`'s `onSaveRole`/`runRowDelete`) is a functional update keyed on THIS call's
   *  own `principalId`: Enable fires with no confirmation gate, so two calls — on different users —
   *  can genuinely overlap, and an unconditional reset would clear the busy indicator (which
   *  `openResetPassword` below reads to refuse opening while a toggle is in flight) out from under a
   *  still-in-flight, unrelated toggle. */
/** Opens the Disable confirm dialog for `user` — the `RowMenu` "Disable" item's `onSelect` when
   *  the user is currently active. Was an inline closure inside the old `rowMenuItems`; named here
   *  now that the item builder itself moved to `rules.ts` and needs a callback to hand it. */
/** Confirms the Disable that `RowMenu`'s "Disable" item asked about. Closes the dialog either
   *  way (matching Posts.tsx/Redirects.tsx's own Disable/Delete `ConfirmDialog` convention) — a
   *  failure surfaces via `toggleError` above the table, not by leaving the modal open.
   *
   *  2026-09-05 fix, same bug class as `use-roles.hooks.ts`'s `runRowDelete`: `setConfirmingDisable`
   *  is exposed directly on the controller, so nothing at the hook level stops the operator opening
   *  a DIFFERENT user's Disable confirmation while this one's toggle is still in flight. The close
   *  below only clears it when it still names the SAME user this call started for — otherwise a
   *  stale toggle's settlement would silently dismiss a newer, still-undecided confirmation. */
// Delete-user plan v2 (2026-09-24), Slice 4 — mirrors Disable's request/confirm pair above with
// its OWN state (see `confirmingDelete`'s own doc comment for why not shared). `deleteUserMutation`
// invalidates `KEYS.list` like every other write on this screen; the route already filters a newly
// trashed principal out of `listUsers()`, so the row disappears on the next render with no extra
// client-side bookkeeping.
/** Confirms the Delete that `RowMenu`'s "Delete" item asked about. Closes the dialog either way
   *  (matching `confirmDisable`'s and Posts.tsx/Redirects.tsx's own Delete `ConfirmDialog`
   *  convention) — a failure surfaces via `toggleError` above the table, not by leaving the modal
   *  open. Same stale-call guard as `confirmDisable`: only clears `confirmingDelete` when it still
   *  names the SAME user this call started for. */
/**
 * Binds the real `/api/.../users`, `/roles`, and `/policies` clients — see
 * `users-dependencies.hooks.ts`. The zero-argument (or options-only) half of the
 * `useX(dependencies)` / `useWiredX()` pair, so `Users.tsx` composes this and a test composes
 * {@link useUsers} with `createFakeUsersPort`.
 *
 * @param options - `openOwnPasswordReset`, threaded from `panels.tsx`'s `/users/change-password`
 *   route (password-banner plan, 2026-09-24 Slice 3). Omitted for every other caller of the Users
 *   panel, same as before this slice.
 * @returns The same `UsersController` {@link useUsers} returns, wired to the live API client and
 *   the real `@/lib/router` navigate.
 */
```

## live-host/users/hooks/users-dependencies.hooks.ts

```text
/**
 * @file The only place `use-users.hooks.ts` reaches `lib/api` — see `users-port.hooks.ts` for why
 * the split exists.
 */
/** The live implementation, as a module-level singleton. */
// `canManageUserTrash` defaults to `false` against an older server build that predates the field
// (delete-user plan v2) — same "absent means not yet supported" convention `effectivePermissions`
// already uses elsewhere on this same response.
/** Seed state for {@link createFakeUsersPort}. */
/** What `me()` resolves to — the id of the signed-in caller's own row for the deep-link tests
   *  (password-banner plan, Slice 3). Defaults to the first seeded user's id, or a fixed fake id
   *  when no users were seeded, so a test that doesn't care about `me()` never has to pass this. */
/** What `me()`'s `canManageUserTrash` resolves to (delete-user plan v2, Slice 4). Defaults to
   *  `true` — most existing tests render the Delete item as available and were written before this
   *  flag existed; a test that specifically covers the "caller may not delete" case sets this to
   *  `false`. */
/** When set, `createUser()` rejects with this instead of resolving. */
/** When set, `updateUser()` rejects with this instead of resolving. */
/** When set, `disableUser()`/`enableUser()` reject with this instead of resolving. */
/** When set, `resetUserPassword()` rejects with this instead of resolving. */
/** When set, `assignRole()` rejects with this instead of resolving. */
/** When set, `attachPolicy()` rejects with this instead of resolving. */
/** When set, `deleteUser()` rejects with this instead of resolving. */
/**
 * An in-memory {@link UsersPort} for tests — "every port gets a fake" (see `assistant-chats-
 * dependencies.hooks.ts`). Mutations write through to the same backing arrays `listUsers`/
 * `listRoles`/`listPolicies` read, mirroring `posts-list-dependencies.hooks.ts`'s
 * `createFakePostsListPort` — a test can assert the outcome of a write by reading the exposed
 * `users` array back, with no `fetch` stub anywhere in the chain.
 */
/** Every user currently in the fake's store, in list order. */
```

## live-host/users/hooks/users-port.hooks.ts

```text
/**
 * @file What `use-users.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair `apps/admin/
 * INFO.md`'s "Hooks" section documents (canonical example: `features/pages/hooks/theme-pages-
 * port.hooks.ts`).
 *
 * One shared port for the whole screen, not split by concern (e.g. "account" vs. "grants"): `Users`
 * is a single hook backing a single screen, every method below is used by exactly one code path in
 * `use-users.hooks.ts`, and splitting would not shrink what any one test has to fake — a full-render
 * or full-hook test always loads `listUsers`/`listRoles`/`listPolicies` together regardless of which
 * mutation it exercises. Ten methods sits at, not past, the "roughly 8-10, then split" boundary
 * (`AI-Dev-Shop/skills/frontend-react-orcbash/SKILL.md`); `features/seo/hooks/seo-port.hooks.ts`'s
 * `SeoPort` (8 methods in one interface, shared by three separate hooks) is this codebase's existing
 * precedent for keeping one flat interface at this size — no port in this codebase is split by
 * concern today, so doing it here first would add a shape with no other example to match.
 */
/** Password-banner plan (2026-09-24), Slice 3 deep-link half: the SIGNED-IN caller's own id, so
   *  `use-users.hooks.ts` can find their row and open the reset-password dialog on it without the
   *  operator having to pick themselves out of the table. Same shape as `api.me()`'s `user` field,
   *  narrowed to the one field this screen actually needs.
   *
   *  `canManageUserTrash` (delete-user plan v2, 2026-09-24, Slice 4): whether THIS caller may
   *  trash/restore/purge users at all (owner or the built-in `admin` role — the OWNER DECISION
   *  2026-09-24 gate `/auth/me` computes server-side via `callerMayManageUserTrash`, the exact
   *  function the DELETE route itself is gated on). Drives whether the row-menu Delete item renders
   *  — affordance-hiding only, never the real boundary; see `lib/permissions.ts`'s header. */
/** Delete-user plan v2 (2026-09-24), Slice 4: moves `principalId` to the Trash (204, no body) —
   *  see `api.ts`'s `deleteUser` for why this is the same endpoint the v1 plan already reserved. */
```

## live-host/users/index.ts

```text
/**
 * @file Public surface of the `users` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder. That indirection is the
 * point of the feature boundary: everything below can be split, renamed, or grown a `hooks/`
 * directory without the router noticing. Adding a file to this feature is not an API change unless
 * it is exported from this line.
 */
```

## live-host/users/rules.ts

```text
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
/** Server error `code` -> a plain-language prefix, for every code on this screen whose message is
 *  a fixed string. Keyed by the same closed set of `ApiError` codes the old if-chain checked, in a
 *  flat lookup rather than sequential branches — this is what actually lowered the function's
 *  cognitive score (11 -> under the ceiling): the codes are a closed set of *literal string* keys,
 *  not a discriminated union, so there is no TypeScript exhaustiveness to lose by using a table
 *  (contrast `translateRunAgentPayload`'s `switch`, which stays a `switch` for exactly that reason).
 *  Values are the English source strings — `t()`'s own keys — not yet localized; `describeApiError`
 *  below is what translates them. */
// Delete-user plan v2 (2026-09-24), Slice 3/decision 7 — the DELETE route's own 409s.
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
/** The callbacks a row menu needs. Passed in rather than imported, so this module stays free of
 *  state, and so a test can assert exactly which one a given row wires up (same convention as
 *  `posts/rules.ts`'s `PostRowMenuHandlers`). */
/** Asked only when `user.status === "active"` — opens the confirm dialog rather than acting. */
/** Asked only when `user.status !== "active"` — fires immediately, no confirm (Enable was never
   *  confirm-gated). */
/** Delete-user plan v2 (2026-09-24) — always opens the confirm dialog, never fires immediately:
   *  unlike Enable, "Delete" moves the user to the Trash, a destructive-looking action even though
   *  it is recoverable there for 60 days. Only asked for when `userRowMenuItems`'s own `canDelete`
   *  is true — see that function's doc comment. */
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
```

## live-host/users/users-i18n.ts

```text
/**
 * @file Spanish translation for the Users screen (`Users.tsx`) — this feature's own dictionary,
 * not the shared `lib/admin-nav-i18n.ts` one, so parallel translation passes over other admin
 * sections can't collide on the same file. Same two-step fallback every other `t()` in this app
 * uses: translated value, else the English source string itself.
 */
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's userRowMenuItems row-menu labels — outside the original `.tsx`-only pass's scope.
// Hook-level notice/error strings (use-users.hooks.ts) — these never got translated during the
// JSX-only pass since they live in `.hooks.ts` files.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
/** The page-header info tip (owner ask, 2026-09-24): explains there's no "forgot password"
 *  self-service flow yet, and that the owner/an admin resets a locked-out user's password from
 *  this page. Its own small dictionary, same shape as {@link PASSWORD_FIELD_TRANSLATIONS} above,
 *  rather than editing all 21 locale blocks in {@link USERS_TRANSLATIONS}. */
/** The reset-password success toast — embeds the user's own (untranslated) `username`
 *  mid-sentence, so it can't be a flat `ES` entry the way `roles-i18n.ts`'s
 *  `roleDeleteBodyParts` etc. handle the same shape. */
```

## live-host/members/Members.tsx

```text
/**
 * @file Admin "Members" screen (ADR-030, ADR-PIPE-013 Decision §7) — markup only.
 *
 * State and API calls live in `hooks/use-members.hooks.ts`; the row-menu logic, per-row action
 * state shape, and the server-error-message override live in `rules.ts`. What stays here is what
 * actually renders: the table and the confirm dialog.
 *
 * Mirrors `features/posts/Posts.tsx`'s fetch/loading/error/table shape. Adds the
 * three row-level actions this remediation wires up (T039): disable, resend
 * sign-in link, and a click-to-expand detail panel — all calling the 3
 * already-existing, already-unused `apps/admin/src/lib/api.ts` client methods
 * (`disableMember`, `requestMemberMagicLink`, `getMember`). No new backend
 * contract needed. Pagination is explicitly deferred (ADR-PIPE-013 Decision
 * §7) — not part of this screen yet.
 *
 * Per-row in-flight state disables only the clicked control (not the whole
 * table), and errors surface via the existing `notice error` convention
 * (inline per row for actions; a full-width banner for the initial load).
 * Stays a single flat file, matching every other admin section's convention.
 */
/**
   * Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   * for `useCustomSelect`. Defaulted to the real hook, so production callers (`panels.tsx`) pass
   * nothing and behave exactly as before.
   */
/** The expanded row's detail panel — one of "loading" / "error" / the fetched fields / nothing
 *  yet, extracted out of `MemberRow` so its three-way branch isn't counted in `MemberRow`'s own
 *  scope. Same "the panel, not the row, was the actual size" split `Users.tsx`'s
 *  `UserRow` -> `UserManagePanel` and `Roles.tsx`'s `PolicyRow` -> `PolicyRowActions` already use. */
/** This row's own distinct handle base — computed once, across every rendered row, by `Members`
   *  (via `buildAgentListHandles`); see `Users.tsx`'s `UserRowProps.agentBase` for why a
   *  per-instance uniqueness search does not work here. */
/** One member's row plus its optional expanded detail row — extracted from `Members`'s
 *  `.map()` body verbatim, same convention `Users.tsx`'s `UserRow`/`Roles.tsx`'s `PolicyRow` use.
 *  `key` lives on the `<MemberRow>` element at the call site. */
```

## live-host/members/__tests__/Members.unit.test.tsx

```text
/**
 * @file `Members` — pins the `RowMenu` rollout (task: roll `RowMenu` out to `Users.tsx`/
 * `Members.tsx`). Unlike `Users.tsx` (a hybrid, since its "Manage" toggles a panel rather than
 * performing an action), Members has no such carve-out — both row actions (Disable, Resend
 * sign-in link) move fully into the menu. "Disable" is omitted from the menu once a member is
 * already disabled (`RowMenu` has no per-item `disabled` — Posts.tsx's own precedent is to omit
 * an inapplicable action rather than render it as a no-op).
 *
 * `ConfirmDialog` stays mounted unconditionally and toggles its own `open` attribute (its own doc
 * comment) — its `<h2>` title text is therefore always in the DOM regardless of open/closed
 * state, so "is the dialog showing" is asserted via the `<dialog open>` attribute, same pattern
 * `PostEditor.unit.test.tsx` uses for its own delete `ConfirmDialog`. Follows the RTL harness
 * `MenuEditor.unit.test.tsx`/`Comments.unit.test.tsx` established for this package's `RowMenu`
 * screens.
 */
/** Finds the `<dialog>` whose own heading matches `titleRe`. */
// `Members` now also calls `useAdminLocale()` (real `fetch`, not this screen's own concern), which
// would otherwise consume one of this file's strictly-ordered `mockResolvedValueOnce` slots and
// shift every later assertion by one call. Routed to a fixed default-locale response outside
// `fetchMock`'s own call queue, so `fetchMock.mock.calls` still holds exactly this screen's own
// requests, in the order each test already expects.
```

## live-host/members/__tests__/members-dependencies.unit.test.ts

```text
/**
 * @file Coverage for `members-dependencies.hooks.ts` (3/12 funcs, 0% branch) —
 * `defaultMembersPort`'s four live `api.*` binds, and `createFakeMembersPort`'s stateful
 * in-memory implementation (list/get/disable/request-magic-link), including its own `findOrThrow`
 * not-found branch — the likely source of the reported 0% branch coverage, since nothing before
 * this file exercised a lookup miss.
 */
```

## live-host/members/__tests__/rules.unit.test.ts

```text
/**
 * @file Pure-logic coverage for `features/members/rules.ts`'s `describeApiError` override — new
 * for C4 (plan-access.md §4). The screen's row-menu builder and `emptyRowState` already had no
 * dedicated test file; this covers `describeApiError`'s FORBIDDEN override in both English and a
 * translated locale, matching `users/__tests__/rules.unit.test.ts` and `roles/__tests__/
 * rules.unit.test.ts`'s identical shape for the same bug class.
 */
// C4 — the FORBIDDEN override leaked English regardless of locale.
// C4 — dictionary-parity spot check for the 1 key this pass added.
```

## live-host/members/__tests__/use-members.hooks.unit.test.ts

```text
/**
 * @file `useMembers`'s own `t`/`locale` fields (2026-08-11, standing i18n rule — see this hook's
 * own file header for the full rationale). No dedicated hook-level test existed for `useMembers`
 * before this change — `Members.unit.test.tsx` already covers the load/row-action behavior
 * end-to-end through the real component; this file adds only what the i18n move itself needs proof
 * of, that `t`/`locale` reflect the hook's own resolved locale rather than a hardcoded English
 * pass-through.
 */
/** Routes the locale settings fetch to a fixed response and rejects the members list — this file
 *  has nothing to say about the list's own outcome, and a real pending promise would just make
 *  `waitFor` below wait longer for no assertion benefit. */
// No "t falls back to the English source string for the default locale" test here: MEMBERS_DICT
// has no "en" entries, so `t("Members")` returns "Members" on a dictionary miss regardless of
// wiring — and since that condition is already true before the fetch resolves, a `waitFor` gated
// on it exits immediately, so a follow-up `locale` assertion isn't reliably proven to run after
// the fetch settles either (DEFAULT_LOCALE is also "en", so it can pass on the pre-fetch value by
// coincidence). The test below is the real proof: both `t` and `locale` are pinned to values only
// the resolved 'es' fetch can produce.
/**
 * `useMembers` still calls `useAdminLocale()` internally (unlike `usePosts`'s injected `navigate`,
 * `MembersDependencies` carries only `port` — see this hook's own file header), so even the
 * injected-port path below needs `fetch` stubbed for the locale settings read; the member list
 * itself never touches it.
 */
// The assistant's `members_disable` call landing server-side — the screen has no other way to
// know it happened.
// Two assistant writes land back to back, each publishing its own content-refresh
// notification — two overlapping `listMembers()` calls with no ordering guarantee on responses.
// The SECOND (more recent) request settles first, with the newer list.
// The FIRST (now-stale) request finally settles. It must not resurrect the older list.
/**
 * C7 (plan-access.md §8, N2, terra review triage 2026-09-20): `onToggleDetail`'s `catch`/`finally`
 * settle `detailError`/`detailLoadingId` with no key — expanding row A (slow, then failing), then
 * row B, lets A's `finally` blank B's "Loading detail…" indicator and lets A's failure paint onto
 * B's now-open panel (`Members.tsx` renders `detailError` unkeyed too). Same bug shape as C2
 * (`use-roles.hooks.ts`'s `loadPermissions` callers).
 */
// B's load is left pending — this finding is about A's LATE settle, not B's own outcome.
// Fails today: A's unconditional catch/finally paint onto B's open panel — detailError gets
// A's message, and detailLoadingId is blanked to null instead of staying B.id.
// a3-review-6 (2026-09-21): collapsing must clear `expandedIdRef` too. Dropping that one line left
// every members test green, yet the row could then never be reopened: the third click read the
// stale ref as "already open" and collapsed again.
// a3-review-6 (2026-09-21): the row-id key cannot tell two loads of the SAME row apart. Open A,
// close it, and open it again before the first load settles: when that first load fails, its
// error lands on A's panel and its `finally` clears the spinner while the second load is still
// running. `MemberDetailPanel` checks `detailError` before `detail`, so the stale error keeps
// hiding the detail even after the second load succeeds.
// Moving to an ALREADY-loaded row starts no new load, so only the `expandedIdRef` check (not the
// load generation) keeps a late failure off that row's panel.
```

## live-host/members/hooks/members-dependencies.hooks.ts

```text
/**
 * @file The only place under `features/members` that reaches `lib/api` — see
 * `members-port.hooks.ts` for why the split exists.
 */
/** The live implementation, as a module-level singleton — matches `redirects-dependencies
 *  .hooks.ts`'s `defaultRedirectsPort`. */
/** Seed state for {@link createFakeMembersPort}. */
/**
 * An in-memory {@link MembersPort} for tests — the fake that lets a test describe "the list has
 * these two members" directly, instead of hand-building `Response` objects and stubbing global
 * `fetch`. Shipped alongside the real binding per the pattern's "every port gets a fake" rule.
 */
/** Every member currently in the fake's store, in list order. */
/** Emails a magic link was requested for, in call order — lets a test assert on the request
   *  without caring what `requestMemberMagicLink`'s fulfilled response looks like. */
```

## live-host/members/hooks/members-port.hooks.ts

```text
/**
 * @file What `use-members.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair documented on
 * `assistant-chats-port.hooks.ts` (the canonical reference in this workspace) and the shape
 * `redirects-port.hooks.ts` uses for a single-hook feature.
 *
 * `describeApiError` is deliberately NOT part of this port — a pure error-message rule with no
 * I/O, imported directly per the pattern's own carve-out (see `redirects-port.hooks.ts`'s
 * identical note).
 */
```

## live-host/members/hooks/use-members.hooks.ts

```text
/**
 * @file Everything the Members screen does, so `Members.tsx` is only markup.
 *
 * Extracted verbatim — same state, same declaration order, same effect bodies, same error strings.
 * `RowActionState`/`emptyRowState`/`describeApiError` moved to `rules.ts` (they were already
 * module-scope free functions in the original, just private and untested); this hook imports them
 * back for `stateFor` and its own async handlers.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts` and `posts/hooks/use-posts.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/members` needs it.
 *
 * `deps.port` is injected (see `members-port.hooks.ts`) rather than reaching for `lib/api`'s `api`
 * directly — the same `useX(dependencies)` / `useWiredX()` split `redirects`/`widgets`/`plugins` use.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import): this hook already called
 * `useAdminLocale()` for its own error-string translations, so exposing that SAME already-resolved
 * `locale` as a bound `t` (plus the raw value, still needed for `rules.ts`'s `memberRowMenuItems`,
 * which takes `locale` directly) on the return value adds no new fetch — `Members.tsx` used to call
 * `useAdminLocale()` a second time and rebuild its own `translateMembers(locale, key)` closure,
 * entirely redundant with the resolution this hook was already doing internally.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass — see that hook's own header):
 * `load` is pulled into a `useCallback` so it can also be handed to that hook, which re-runs it
 * whenever `members_disable` (`apps/website/src/features/members/agent-tools.ts`) changes a
 * member's status from an assistant run this screen otherwise has no way to learn about. No draft
 * to protect — every row's own edit state is per-action busy/error tracking, not typed text.
 */
/** `null` until the initial load settles — the caller renders a loading state. */
/** Per-row action state (Disable/Resend in-flight, error, notice), falling back to the empty
   *  state for a row with no action taken yet. */
/** The row whose detail panel is expanded — `null` when every row is collapsed. */
/** Detail already fetched for an expanded row, keyed by member id — a cache so re-expanding a
   *  row already visited this session doesn't re-fetch. */
/** The member a `RowMenu` "Disable" selection is asking to confirm; `null` when the dialog is
   *  shut. `ConfirmDialog` stays mounted unconditionally in the view (see its own doc comment on
   *  why); this is what drives its `open` prop. */
/** Bound translator — `key` already resolved against the caller's locale, so `Members.tsx` never
   *  imports `useAdminLocale`/`members-i18n` itself. See this file's header. */
/** Raw resolved locale — `rules.ts`'s `memberRowMenuItems` takes `locale` directly rather than a
   *  bound translator. See this file's header. */
// Disable now confirms via a `RowMenu` item -> `ConfirmDialog` modal (replacing the in-place
// two-click `ConfirmButton`, which has no menu-item equivalent — same migration Posts.tsx/
// Redirects.tsx/Users.tsx already made). `null` when the dialog is closed.
// Which row's detail panel is actually open (C7, plan-access.md §8, N2) — a ref, not just
// `expandedId` state, because `onToggleDetail`'s `catch`/`finally` read it after an `await`, where
// a state read would see the closure's stale value. Set by `onToggleDetail` alone. Without this,
// expanding row A (slow, then failing), then row B, lets A's `finally` blank B's loading indicator
// and lets A's failure paint onto B's now-open panel — the same "entity-scoped panel, unkeyed
// settle" shape `use-roles.hooks.ts`'s `permissionPolicyIdRef` fixes for `loadPermissions`.
// Latest-wins for `onToggleDetail`'s detail loads, a separate instance from `settlement` (which
// tracks `load()`'s list reads).
// Claim this call's generation BEFORE the request starts — see `useSettlementGeneration`'s own
// doc for why a synchronous ref bump, not `useState`, is what makes two overlapping calls each
// see the other's claim. Needed now that a content refresh can fire more than once per run
// (mid-run tool progress, see `AssistantDock.hooks.tsx`), so two overlapping `load()` calls have
// no ordering guarantee on their responses.
// `port`/`locale`/`settlement` are added — see `use-page-editor.hooks.ts`'s identical note:
// function-scoped values ESLint's exhaustive-deps rule can see, referentially stable in
// production, so this changes nothing about when this callback's identity changes.
// eslint-disable-next-line react-hooks/exhaustive-deps
/** Confirms the Disable that `RowMenu`'s "Disable" item asked about. Closes the dialog either
   *  way (matching Posts.tsx/Redirects.tsx/Users.tsx's own Disable/Delete `ConfirmDialog`
   *  convention) — a failure surfaces via the row's own `rs.error`, not by leaving the modal open. */
// Claimed before the `await`, so a later detail load (another row's, or this same row's after
// a close and reopen) supersedes this one. The row-id key alone cannot tell two loads of the
// SAME row apart.
// Only paint the failure onto the panel this load was actually for — a different row may
// already be open by the time this settles, or a newer load of this row may be running.
// A superseded load leaves the spinner to the load that superseded it.
/**
 * Binds the real `/api/.../members` client — see `members-dependencies.hooks.ts`.
 *
 * The zero-argument-dependencies half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `Members.tsx` composes this and a test composes {@link useMembers} with `createFakeMembersPort`.
 */
```

## live-host/members/index.ts

```text
/**
 * @file Public surface of the `members` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder. That indirection is the
 * point of the feature boundary: everything below can be split, renamed, or grown a `hooks/`
 * directory without the router noticing. Adding a file to this feature is not an API change unless
 * it is exported from this line.
 */
```

## live-host/members/members-i18n.ts

```text
/**
 * @file Spanish translation for the Members screen (`Members.tsx`) — this feature's own
 * dictionary, not the shared `lib/admin-nav-i18n.ts` one, so parallel translation passes over
 * other admin sections can't collide on the same file. Same two-step fallback every other `t()`
 * in this app uses: translated value, else the English source string itself.
 */
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's memberRowMenuItems row-menu label — outside the original `.tsx`-only pass's scope.
// Reuses this file's own "enlace de acceso" ("sign-in link") noun phrase from the page
// description above rather than inventing new wording.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
// rules.ts's describeApiError FORBIDDEN override (C4) — untranslated until this pass.
```

## live-host/members/rules.ts

```text
/**
 * @file Pure logic for the `members` feature — everything that computes a value rather than
 * rendering one. Follows the `posts/rules.ts` convention: no React import, no hooks, directly
 * testable.
 *
 * Moved here from `Members.tsx`: `RowActionState`/`emptyRowState` (already module-scope free
 * functions in the original, just not exported or testable), the screen's `describeApiError`
 * override (a `FORBIDDEN`-code branch), and the row-menu item builder (a branch on
 * `member.status !== "disabled"`).
 */
/** This screen's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s
 *  `TAXONOMY_RESOURCE` for why this is a plain colocated constant rather than a shared registry.
 *  Agent-writable via `members_disable` (`apps/website/src/features/members/agent-tools.ts`), which
 *  flips a member's status this list renders. `members_request_magic_link` mutates durable state too
 *  but changes nothing this screen displays, so it needs no separate justification here. */
/** Per-row in-flight/result state for the two row actions (Disable, Resend sign-in link). */
/** Overrides layered on the shared default (`lib/api.ts`'s `describeApiError`).
 *
 *  `locale` (C4 fix, 2026-09-20): the FORBIDDEN override used to return its English literal
 *  directly, leaking English into every non-`en` locale — see `users/rules.ts`'s identical fix for
 *  the full reasoning. The literal is now also a key into `members-i18n.ts`'s `MEMBERS_DICT`. */
/** The callbacks a row menu needs. Passed in rather than imported, so this module stays free of
 *  state (same convention as `posts/rules.ts`'s `PostRowMenuHandlers`). */
/** Opens the confirm dialog; only offered when `member.status !== "disabled"`. */
/** `RowMenu` items for one member row. "Disable" is omitted once the member is already disabled
 *  — `RowMenu` has no per-item `disabled`, and `Posts.tsx`'s own precedent (omitting "Disable"
 *  entirely for an already-draft row rather than showing it disabled) is to omit an inapplicable
 *  action rather than show it as a no-op.
 *
 * @complexity Time/space: O(1) — at most two entries, no iteration.
 */
```

## live-host/auth/Login.tsx

```text
/**
 * @file The Login screen — markup only.
 *
 * State and the submit handler live in `hooks/use-login.hooks.ts`. Nothing here computes a value
 * (no derivations, no branchy formatting), so this feature has no `rules.ts`.
 */
/**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` and
   * `@jini-ai/ui`'s `useCustomSelect` use. Defaulted to the real hook, so production callers pass
   * nothing and behave exactly as before.
   */
```

## live-host/auth/__tests__/Login.unit.test.tsx

```text
/**
 * @file `Login` — markup only. Every state is driven through the injectable `useLoginHook` prop
 * (see `Posts.tsx`'s own doc for the convention), never a fake `fetch`.
 */
// `async`, because `LoginController.submit` is `(e) => Promise<void>` and `preventDefault`
// returns `void` — the bare arrow does not satisfy the controller's type.
```

## live-host/auth/__tests__/auth-i18n.unit.test.ts

```text
// Author Checklist F4.3/F6.2: English-only Login tests miss a dropped locale dictionary.
// Real translation factory, literal expectations, no shared state or runtime effects.
```

## live-host/auth/__tests__/use-login.hooks.unit.test.ts

```text
/**
 * @file `useLogin` — the Login screen's submit lifecycle, extracted verbatim from `Login.tsx`.
 *
 * Converted (this sweep) from a stubbed-`fetch` harness to the injected-`LoginPort` seam — see
 * `login-port.hooks.ts` for why. `request()`'s own extraction of a server error message from a
 * response body, and its "rejection wasn't an `Error`" fallback text, are `lib/api.ts` concerns
 * with their own coverage (`lib/__tests__/api-describe-error.unit.test.ts`,
 * `api-request-unreachable.unit.test.ts`); this file only needs to prove `useLogin` reacts
 * correctly to whatever the port resolves or rejects with, not re-derive how `request()` produces
 * that value.
 */
```

## live-host/auth/auth-i18n.ts

```text
/** Login-screen copy.  Keep this separate from the app-shell dictionary: Login is rendered
 * before the shell and must not fall back to English for a signed-out operator. */
```

## live-host/auth/hooks/login-dependencies.hooks.ts

```text
/**
 * @file The only place under `features/auth` that reaches `lib/api` — see `login-port.hooks.ts`
 * for why the split exists.
 */
/** The live implementation, as a module-level singleton. */
/** Fallback fake user returned by {@link createFakeLoginPort} when the caller doesn't seed one —
 *  distinct from any real workspace user id so a test asserting on it can't accidentally pass
 *  against a coincidentally-matching real fixture. */
/** Seed state for {@link createFakeLoginPort}. */
/** User `login()` resolves with. Defaults to {@link FAKE_USER}. */
/** When set, `login()` rejects with this instead of resolving — for failed-credential tests. */
/**
 * An in-memory {@link LoginPort} for tests — "every port gets a fake" (see
 * `media-dependencies.hooks.ts`). Ignores the submitted credentials by design: this hook has no
 * server to check them against, so a fake describing "this login attempt succeeds/fails" is more
 * useful than one that re-implements credential matching.
 */
```

## live-host/auth/hooks/login-port.hooks.ts

```text
/**
 * @file What `use-login.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` (canonical spec) and
 * `redirects-port.hooks.ts` (canonical reference implementation): this file declares,
 * `login-dependencies.hooks.ts` binds the real `api` client, and nothing else under
 * `features/auth` imports `lib/api`.
 */
```

## live-host/auth/hooks/use-login.hooks.ts

```text
/**
 * @file Everything the Login screen does, so `Login.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same error string. Naming follows
 * `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because nothing
 * outside `features/auth` needs it.
 *
 * `deps.port` is injected (see `login-port.hooks.ts`) rather than reaching for `lib/api`'s `api`
 * directly, so a test can describe a login attempt against `createFakeLoginPort` instead of
 * stubbing global `fetch`. `useWiredLogin` below is the zero-dependency pair `Login.tsx` actually
 * mounts. `onLogin` moved from a bare positional argument into `props` (same `(props, deps)` shape
 * as `useFormEditor`/`useEditMediaPanel`) now that this hook takes a second, injected argument —
 * a lone trailing object could no longer be told apart from `deps` by position alone.
 */
/**
 * @param props `onLogin` — called with the authenticated user once `submit` resolves.
 * @param deps `port` — the injected login transport; see `login-port.hooks.ts`.
 * @returns The login screen's full controller — see {@link LoginController}.
 * @complexity Time/space: O(1) — one credential round trip per submit, no iteration.
 */
/**
 * Binds the real `/api/auth/login` client — see `login-dependencies.hooks.ts`.
 *
 * The zero-argument-dependencies half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `Login.tsx` composes this and a test composes {@link useLogin} with `createFakeLoginPort`.
 *
 * @param props `onLogin` — called with the authenticated user once `submit` resolves.
 * @returns The login screen's full controller — see {@link LoginController}.
 */
```

## live-host/auth/index.ts

```text
/**
 * @file Public surface of the `auth` feature.
 *
 * `panels.tsx` does not import this — `Login` renders before the admin shell mounts and has no
 * `AdminPanel` entry (no nav, not part of the panel registry). `App.tsx` imports from HERE instead.
 * Adding a file to this feature is not an API change unless it is exported from this line.
 */
```

