# Preserved source rationale

All source comments are retained verbatim below, including historical why comments for deferred presentation choices. Current behavior and source mapping are in PORT.md.

## Live host roles — Roles.hooks.tsx

```text
/**
 * @file The `/admin/roles` tab system's non-JSX logic, plus the two tab glyphs.
 *
 * Everything derived lives here rather than in `Roles.tsx`: the tab-id list, its `?tab=` guard, the
 * tab descriptors, and the navigation callback (standing rule — a component's derived logic belongs
 * in a sibling `*.hooks.ts(x)`, not in the `.tsx`). `.tsx` rather than `.ts` because
 * {@link resolveRolesTabs} returns `TabBarTab[]` whose `icon` is a `ReactNode`, the same reason
 * `Sites.hooks.tsx` carries the `x`.
 *
 * ## Why two tabs, and why this screen wants them
 *
 * The screen holds two independent object types, each with its own list, its own create form, and
 * its own row actions: **Roles** (what you assign to a person) and **Policies** (what a role is
 * allowed to do, plus the individual permission strings written onto each one).
 *
 * Tabs were not a foregone conclusion here, so the case against was checked first: roles and
 * policies are conceptually linked, and hiding one behind a tab costs any cross-referencing between
 * them. That cost turned out to be zero — the roles table's columns are Name, Type and More, and it
 * shows no policy information at all, so there is nothing on either screen that the other's
 * presence helps you read. Nothing is lost by separating them.
 *
 * What is gained is real. The Policies section is much the heavier of the two: every row can expand
 * an inline permission editor that lists the policy's current permissions, adds one, and removes
 * one. Stacked below the roles table, that pushed the screen's most-used control — the roles list —
 * into competition with a section that grows unboundedly as policies accumulate, and put an
 * arbitrary amount of scrolling between the two. Two peers side by side in a tab strip is the
 * honest shape of a screen that is doing two things.
 *
 * Both labels ("Roles", "Policies") are the EXISTING section headings' i18n keys, already
 * translated in every locale `roles-i18n.ts` carries — this conversion adds no new copy strings at
 * all. The role/policy -> user grant assignment still lives on `Users.tsx`, unchanged and not
 * duplicated here.
 */
/** Shared attributes for a decorative line icon — the same 24px/1.5-stroke/round-join set
 *  `deployment-visuals.tsx` and `Seo.hooks.tsx` use, so every tab row in this admin reads as one
 *  family. Local rather than imported across a feature boundary (`features/deployment/index.ts` is
 *  that feature's public surface and does not export it, and this app ships no shared icon module —
 *  `App.tsx`'s sidebar glyphs and `SettingsUi.tsx`'s tab icons are inline SVG for the same reason).
 *  `aria-hidden`, because each sits directly beside the text label that already says the same
 *  thing. */
/** Roles — a person, i.e. the thing a role is assigned TO. */
/** Policies — a shield over a document, i.e. a written rule about what is permitted. */
/** The two tab ids, in render order. `roles` is first and is the fallback — it is the list an
 *  operator arrives for, and a policy is only meaningful once a role exists to carry it. */
/** Falls back to the Roles list for an absent or unrecognized `?tab=` value, through the same
 *  shared guard `Deployment.tsx`/`Sites.tsx`/`Database.tsx`/`Themes.tsx` use — a stale bookmark or
 *  a typo must open a real tab, never a blank panel. */
/**
 * The two tabs in the shape `TabBar` takes.
 *
 * Takes a bound {@link Translate} rather than a raw locale because that is what `useWiredRoles()`
 * already hands this screen (`roles-i18n.ts`'s `t` arrives pre-bound, unlike the SEO screen's
 * two-argument form) — threading a locale here instead would mean this screen carried both
 * conventions at once.
 *
 * Neither tab takes a `count`. `TabBar` supports one, and it was considered: the roles and policies
 * lists both have a length to show. It is left off because the count would be the length of a list
 * that is one click away and fully visible when you get there, so it earns nothing but density —
 * unlike `Sites.tsx`'s own count, which summarizes a grid you may have to scroll.
 *
 * @complexity O(1) — a fixed two-element array.
 */
/** `replace: true` so moving between the two tabs does not grow the back stack one entry per click
 *  — the same call `Deployment.tsx`/`Sites.tsx`/`Themes.tsx` make for their own `?tab=`. A
 *  module-level function, not an inline arrow, so `TabBar`'s `onChange` takes it directly. */
```

## Live host roles — Roles.tsx

```text
/**
 * @file "Roles & Permissions" screen (SPEC-006 + 0.6.0 CRUD-completion amendment) — the
 * `/admin/roles` route. Markup only.
 *
 * State and API calls live in `hooks/use-roles.hooks.ts`; the row-menu logic and the
 * `RESOURCE_CONFLICT`-etc. error copy live in `rules.ts`.
 *
 * Lists roles and policies, creates new ones (`CREATE_ROLE`/`CREATE_POLICY`), and (0.6.0) renames
 * (`UPDATE_ROLE`/`UPDATE_POLICY`), deletes (`DELETE_ROLE`/`DELETE_POLICY`), and — for policies —
 * writes a permission onto a custom policy (`WRITE_POLICY_PERMISSION`, closing the gap this
 * screen's own prior header comment flagged: "granting individual permission strings to a custom
 * policy has no admin route yet"). Every mutating action here is a plain button/inline form, no
 * dedicated edit mode — matches this screen's existing utilitarian style. Role/policy -> user grant
 * assignment stays on `Users.tsx`'s "Manage" row, not duplicated here. Built-in rows never show
 * rename/delete controls (the backend refuses them anyway, INV-06 — hiding the control avoids a
 * guaranteed-failing click).
 *
 * Scope note (RESOLVED 2026-08-24, was OQ-10): removing a single permission from a policy used to
 * have no transition, so the only way to shrink a policy's permission set was delete (only when
 * unused) + recreate — a dead end for a referenced policy, which INV-09 refuses to delete.
 * `REMOVE_POLICY_PERMISSION` closes that. The same inline panel that adds a permission now also
 * lists the policy's current ones and offers each a Remove; listing them at all is new too, since
 * `AdminPolicy` carries no permissions field and nothing previously exposed a row id. (2026-09-20,
 * C1): each Remove now asks first, via a shell `ConfirmDialog`, before the write goes through.
 *
 * Complexity-ceiling pass (2026-08-06): `Roles` and its policy-row map closure both scored over
 * the ceiling (18/10 and 13/13 — one over-sized "Policies" table section reported as two separate
 * numbers, per the brief for this pass). Split into `RolesSection`, `PoliciesSection`/`PolicyRow`,
 * and the two delete dialogs, same top-level-function convention `Users.tsx`/`Taxonomy.tsx` use —
 * a nested closure would not have moved any branching out of `Roles`' own scope, only a sibling
 * function does.
 *
 * ## Tabs (2026-09-06)
 *
 * The two sections are now two `?tab=` tabs on the shared `components/TabBar`, the same primitive
 * `Deployment.tsx`, `Sites.tsx`, `Themes.tsx`, `Security.tsx`, `SourceControl.tsx` and
 * `Database.tsx` already use — the tab shell was ALREADY extracted, so this screen reuses it
 * rather than becoming another implementation. Why two tabs, and the case AGAINST them that was
 * checked first, are in `Roles.hooks.tsx`'s header. Both labels reuse the existing section
 * headings' i18n keys, so the conversion adds no new copy strings.
 *
 * `RolesSection` and `PoliciesSection` are untouched; `RolesTab`/`PoliciesTab` below are thin
 * wrappers holding the prop assembly that used to sit inline in `Roles`'s JSX. Three things stay
 * on the SHELL rather than moving into a panel, each for a stated reason: the page header, the
 * `rowError` banner (set by both sections — `useWiredRoles` keeps one `rowSavingId`/`rowError`
 * pair for roles and policies alike), and both delete dialogs (a confirm dialog is an overlay over
 * the whole page, and its pending state is shell state).
 */
/** The `?tab=` query value from `panels.tsx`'s `roles` route (`URLSearchParams.get` returns
   *  `null` when the param is absent). Guarded by `resolveRolesTabId`, so a stale link or a typo
   *  opens the Roles list rather than a blank panel. */
/** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. Defaulted to the wired hook, so production callers (`panels.tsx`) pass
   *  nothing and behave exactly as before. */
/** Everything the two tab panels read, which is simply what `useWiredRoles()` returns — the same
 *  `ReturnType<typeof ...>` shape `Sites.tsx`'s own `sitesTabPanel` takes, rather than a
 *  hand-maintained mirror of a thirty-field controller that would drift the first time the hook
 *  grows a field. */
/**
 * The create-a-role form, as one thing the section can be handed.
 *
 * Replaces the five loose `roleName`/`setRoleName`/`roleSaving`/`roleError`/`onCreateRole` props the
 * section used to take. They were never independent — every one of them is meaningless without the
 * other four — so naming the group is what lets a caller (or a test) supply a form rather than
 * assemble one out of parts.
 */
/** A role row's own affordances: rename in place, or ask for deletion. Grouped for the same reason
 *  as {@link RoleCreateFormController} — `editingId` and `draftName` describe one interaction. */
/** Which role is mid-rename, or `null`. */
/** Which row has a write in flight — drives the per-row Saving… label, not a page-wide spinner. */
/** "Roles" heading, create-role form, and the roles `DataTable`.
 *  `DataTable`'s own `cell` callbacks are already separately-scoped closures under ESLint (each
 *  gets its own report), so this split is about the create-form's own branches, not the table.
 *
 *  Exported so a test can render it against hand-built controllers — the seam only counts as one if
 *  something other than `Roles` can drive it. */
// Role ids are stable and unique, so they disambiguate one row's menu from another's — same
// reasoning as every other list on this workstream. Built-in rows render no `RowMenu` at all (see
// the "actions" cell's own guard below), but a handle is still computed for every role so index
// alignment with `roles` never drifts.
/* Kept in the DOM, hidden from view. Once this section sits behind a tab whose label is
          already the word "Roles", a visible `<h2>Roles</h2>` directly beneath it is pure visual
          repetition — but simply deleting it is not the fix, because `role="tab"` buttons do not
          appear in a screen reader's heading list, so the panel would be left with `H1` and nothing
          else (the regression `deployment/HistoryTab.tsx`'s own comment records measuring live).
          `.visually-hidden` keeps the structure for assistive tech and drops the duplicate from the
          page — the same utility `TabBar.tsx` itself uses for its dot label. `Seo.tsx`'s
          "Per-entry SEO" heading stays VISIBLE by the same rule: it is not a verbatim repeat of its
          tab ("Pages & posts"), so it still tells a sighted reader something. */
```

## Live host roles — hooks/roles-dependencies.hooks.ts

```text
/**
 * @file The only place `use-roles.hooks.ts` reaches `lib/api` — see `roles-port.hooks.ts` for why
 * the split exists.
 */
/** The live implementation, as a module-level singleton. */
/** Seed state for {@link createFakeRolesPort}. */
/** When set, `createRole()` rejects with this instead of resolving. */
/** When set, `updateRole()` rejects with this instead of resolving. */
/** When set, `deleteRole()` rejects with this instead of resolving. */
/** When set, `createPolicy()` rejects with this instead of resolving. */
/** When set, `updatePolicy()` rejects with this instead of resolving. */
/** When set, `deletePolicy()` rejects with this instead of resolving. */
/** When set, `writePolicyPermission()` rejects with this instead of resolving. */
/** When set, `listPolicyPermissions()` rejects with this instead of resolving. */
/** When set, `removePolicyPermission()` rejects with this instead of resolving. */
/** Permission rows the fake starts with, so a test can open a policy that already HAS
   *  permissions without writing them one call at a time. */
/**
 * An in-memory {@link RolesPort} for tests — "every port gets a fake" (see `assistant-chats-
 * dependencies.hooks.ts`). Mirrors `posts-list-dependencies.hooks.ts`'s `createFakePostsListPort`:
 * mutations write through to the same backing arrays the list methods read, so a test can assert a
 * write's outcome by reading the exposed `roles`/`policies` arrays back, with no `fetch` stub.
 */
/** Every role currently in the fake's store, in list order. */
/** Every policy currently in the fake's store, in list order. */
/** Every policy-permission row currently in the fake's store (OQ-10), so a removal test can read
   *  the outcome back the same way `roles`/`policies` already allow. */
```

## Live host roles — hooks/roles-port.hooks.ts

```text
/**
 * @file What `use-roles.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair `apps/admin/
 * INFO.md`'s "Hooks" section documents (canonical example: `features/pages/hooks/theme-pages-
 * port.hooks.ts`).
 *
 * One shared port for the whole screen, matching `users-port.hooks.ts`'s identical reasoning
 * (`Roles` is one hook backing one screen; `features/seo/hooks/seo-port.hooks.ts`'s 8-method
 * `SeoPort` is the closest existing precedent for keeping a port this size as one flat interface
 * rather than splitting by concern, e.g. "roles" vs. "policies" — a split this codebase has no
 * existing precedent for anywhere, and which would not reduce what a full-hook or full-render test
 * has to fake, since every render loads both `listRoles` and `listPolicies` together regardless of
 * which mutation is under test).
 */
/** OQ-10 — the two calls that make a policy's permission set editable rather than append-only.
   *  `listPolicyPermissions` is what yields the `id` `removePolicyPermission` needs; no other admin
   *  call exposes one. */
```

## Live host roles — hooks/use-roles.hooks.ts

```text
/**
 * @file Everything the "Roles & Permissions" screen does, so `Roles.tsx` is only markup.
 *
 * Extracted verbatim — same state, same declaration order, same effect, same error strings. This
 * screen has no unit test today (`README.md`'s own note: "treat a change here as unverified until
 * you have driven it in a browser"), and it is the file this extraction pass exists for: a hook is
 * reachable from `renderHook` with no table, no `RowMenu`, and no `ConfirmDialog`.
 *
 * The doc comments below moved WITH the functions they describe, verbatim — several are decision
 * records (why delete now gates via `ConfirmDialog` instead of the two-click `ConfirmButton`) and a
 * comment separated from its code stops being read.
 *
 * `describeApiError` moved to `../rules` (it computes a value — an error string — rather than
 * rendering one); every handler below that used to call the module-level `describeApiError` now
 * calls the imported one instead, unchanged in every other respect.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts` and `features/posts/hooks/use-posts.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/roles` needs it.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import): this hook already called
 * `useAdminLocale()` for its own error-string translations, so exposing that SAME already-resolved
 * `locale` as a bound `t` (plus the raw value, still needed for `rules.ts`'s `roleMenuItems`/
 * `policyMenuItems` and `roles-i18n.tsx`'s several part-builder helpers, all of which take `locale`
 * directly) on the return value adds no new fetch — `Roles.tsx` used to call `useAdminLocale()` a
 * second time and rebuild its own `translateRoles(locale, key)` closure, entirely redundant with
 * the resolution this hook was already doing internally.
 *
 * `lib/fetch-query` migration (2026-08-12): the combined roles+policies read is one `useFetchQuery`
 * keyed on `KEYS.list`; every write invalidates it instead of calling `reload()` by hand (see
 * `rules.ts`'s `KEYS` doc) — except `onWritePermission`, which never called `reload()` either, so it
 * stays a plain `useFetchMutation` with no `invalidates`.
 *
 * `rowSavingId`/`rowError` deliberately stay plain `useState`, NOT derived from any mutation's own
 * `status`/`error`: five independent writes (rename role, delete role, rename policy, delete policy,
 * write permission) share this ONE "which row is busy" id and one error slot, and a mutation object's
 * `status` has no way to carry "which row this particular call was for" the way a manually-set id
 * does. `createRoleMutation`/`createPolicyMutation` are the ones-per-mutation exception below — each
 * backs exactly one form, so `roleSaving`/`policySaving`/`roleError`/`policyError` derive from them
 * directly, same shape as every other migrated create form in this sweep.
 *
 * `useX(dependencies)` / `useWiredX()` conversion (2026-08-14): every `api.xxx()` call below is now
 * `port.xxx()` — see `roles-port.hooks.ts` for the interface and `roles-dependencies.hooks.ts` for
 * the real binding, the only file left that imports `lib/api` as a value for this feature. Same
 * "no ref/dep-array needed" note as `use-users.hooks.ts`'s identical section: every write here goes
 * through `useFetchMutation` (via `lib/fetch-query`), which takes a fresh `mutationFn` closure every
 * render by design — there is no `useEffect([port])` in this file for `port` to be listed in wrongly.
 */
/** The permission row a Roles-screen "Remove" click is asking to confirm before it becomes a
 *  durable write — see {@link RolesController.pendingPermissionRemove}'s doc comment. */
/** In-flight row action (rename, delete, or write-permission) — one at a time. */
/** OQ-10 — the open policy's CURRENT permission rows, so the form can show what is already
   *  granted and offer each one a Remove. Empty whenever no form is open. Loaded on open (and
   *  re-loaded after a write or a removal) rather than with the policy list, because
   *  `listPolicies` does not carry permissions and only one policy's form is open at a time. */
/** Which permission row has its removal in flight — drives that row's own busy label, not a
   *  page-wide spinner (same reasoning as `rowSavingId`). */
/** The permission row a Remove click is asking to confirm — `null` when the dialog is closed.
   *  Same "ConfirmDialog stays mounted, this drives its `open` prop" shape as `pendingRoleDelete`/
   *  `pendingPolicyDelete` above. Removing a permission from a policy that is currently attached to
   *  someone changes their live authority immediately, and there is no undo route open to anyone
   *  but an owner — see this file's header note on OQ-10/C1 for the lockout analysis that ruled a
   *  server-side guard unnecessary here (INV-06 + INV-08 already prevent a workspace lockout); this
   *  dialog exists for the one risk that IS reachable, a one-click self-demotion. */
/** The role a `RowMenu` "Delete" selection is asking to confirm — `null` when the dialog is
   *  closed. `ConfirmDialog` stays mounted unconditionally below (see its own doc comment on why);
   *  this is what drives its `open` prop. Separate state per table since a role and a policy delete
   *  are independent operations with their own copy, not because anything shares data between them. */
/** Bound translator — `key` already resolved against the caller's locale, so `Roles.tsx` never
   *  imports `useAdminLocale`/`roles-i18n` itself. See this file's header. */
/** Raw resolved locale — `rules.ts`'s row-menu builders and `roles-i18n.tsx`'s part-builder
   *  helpers take `locale` directly rather than a bound translator. See this file's header. */
/** The shape `onDeleteRole`/`onDeletePolicy` both repeat: guard on nothing pending, set the shared
 *  `rowSavingId`/`rowError` pair keyed by the row's own id (deliberately not a fit for
 *  `useAsyncAction` — see that file's own header on why a busy-row-id, not a boolean, is a
 *  different shape), delete, and always clear both the saving flag and the pending selection in
 *  `finally` regardless of outcome. `reload()` is gone — `deleteMutation` itself `invalidates:
 *  [KEYS.list]` — this helper's job now is purely the shared busy-id/error bookkeeping. The
 *  "whole-hook" complexity view (brief §2) counts both ~10-line blocks against `useRoles` even
 *  though each is individually small under ESLint's own per-function view — `onDeletePolicy` had no
 *  test at all before the extraction pass that introduced this helper; characterisation tests were
 *  added first (`use-roles.unit.test.ts`) so this extraction has coverage to prove it behavior-
 *  preserving against.
 *
 *  `setRowSavingId`'s `finally` reset (2026-09-05 fix, same bug class as `use-sites.hooks.ts`'s
 *  `activate`/`use-themes.hooks.ts`'s `activate`/`download`/`use-theme-explore.hooks.ts`'s rename)
 *  is a functional update keyed on THIS call's own `id`, not a blind `setRowSavingId(null)`: nothing
 *  gated a second delete (on a DIFFERENT row) from starting before this one settles, so an
 *  unconditional reset would clear the busy indicator out from under a still-in-flight newer
 *  delete. `clearPending` is the caller's own responsibility to guard the same way (see
 *  `onDeleteRole`/`onDeletePolicy` below) since only the caller knows which pending-selection state
 *  it owns. */
/** What `useRoles` needs injected from outside — see this file's header for the conversion note. */
/**
 * Everything the "Roles & Permissions" screen does — full state, effects, and every server write, as
 * one hook so `Roles.tsx` stays a pure render of whatever this returns. See this file's header for
 * the `useFetchQuery`/`useFetchMutation` migration and the `port` injection it now also carries.
 *
 * @param deps - Injected collaborators; production callers get these from {@link useWiredRoles}.
 * @returns The full `RolesController` the view renders from — see that interface for every field.
 */
// Monotonic per-call id (same shape as `use-theme-explore.hooks.ts`'s `renameSettlement` /
// `use-themes.hooks.ts`'s `activateSettlement`/`downloadSettlement`, though this ref is NOT itself
// extracted into `useSettlementGeneration` — see that hook's own doc for why): `togglePermissionForm`
// (opening a different policy) and `onWritePermission`/`onRemovePermission` (their own trailing
// refresh) all funnel into `loadPermissions` with no guard against a SECOND call — for a DIFFERENT
// policy — starting before the first settles, and network completion order does not have to match
// start order. Minted synchronously at the top of `loadPermissions` so two loads started back to
// back always mint in the order they started even though both are async — a stale settlement
// (checked before every state write below, not just the success path, since an out-of-order
// FAILURE would otherwise resurrect a stale error over a newer load's real outcome — `rowError` is
// one shared field across every action in this hook) is dropped instead of overwriting whichever
// policy's rows the operator is actually looking at now.
// C2 (N1 fix) — which policy's panel is actually open right now, so `onWritePermission`'s and
// `onRemovePermission`'s trailing `loadPermissions(policyId)` can tell "the operator switched to a
// DIFFERENT policy's panel while my write was in flight" apart from "still on the same panel".
// `permissionsGenerationRef` cannot express this: the trailing refresh mints the NEWEST generation
// by construction (it starts after the write that preceded it), so it always wins even when the
// panel has moved on — that was the actual bug (see the trailing-refresh call sites below). A ref
// holding the CURRENTLY open policy id is an equality check ("is the panel still on policy X"),
// not an ordering check ("was this the latest call") — same "activeEntityRef" idiom as
// `use-widget-instance-editor`'s `activeEntityRef` and `use-term-detail-panel`'s
// `activeTermIdRef`. Written only by `togglePermissionForm`.
// The row a `RowMenu` "Delete" selection is asking to confirm — `null` when the dialog is
// closed. `ConfirmDialog` stays mounted unconditionally below (see its own doc comment on why);
// this is what drives its `open` prop. Separate state per table since a role and a policy delete
// are independent operations with their own copy, not because anything shares data between them.
// No `invalidates` — matches the pre-migration `onWritePermission`, which never called `reload()`
// either.
// Also no `invalidates`: removing a permission changes nothing `KEYS.list` caches (the policy
// list carries no permissions), so the refresh that matters is `loadPermissions` below.
// already surfaced through createRoleMutation.error -> roleError below
// already surfaced through createPolicyMutation.error -> policyError below
/** `setEditingRoleId`/`setRowSavingId`'s settle-time writes (2026-09-05 fix, same bug class as
   *  `use-sites.hooks.ts`'s `activate`/`use-themes.hooks.ts`'s `activate`/`download`/
   *  `use-theme-explore.hooks.ts`'s rename) are functional updates keyed on THIS call's own
   *  `roleId`, not a blind `setEditingRoleId(null)`/`setRowSavingId(null)`: nothing gates a second
   *  `onSaveRole` (for a DIFFERENT role) from starting before this one settles — the operator can
   *  freely click "Edit" on another row at any time, no modal blocks it — so an unconditional reset
   *  would close a DIFFERENT, still-open and unsaved row's inline edit UI out from under the
   *  operator the moment this stale call finally settles. */
/** Confirmation now gates via a `ConfirmDialog` modal, reached through `RowMenu`'s "Delete" item
   *  (`setPendingRoleDelete` below) — this row action moved off the in-place two-click
   *  `ConfirmButton` control (MSG-03 rollout) because a `RowMenu` item fires once and the menu
   *  closes immediately (`selectItem` in `RowMenu.tsx`), so there is no "stay open for a second
   *  confirm click" state for `ConfirmButton` to hold; `ConfirmDialog` is the mechanism that
   *  survives the menu closing, same as `Posts.tsx`/`Pages.tsx`'s own Delete.
   *
   *  `clearPending` (2026-09-05 fix, same reasoning as `onSaveRole`'s comment above) only clears
   *  `pendingRoleDelete` when it still names THIS call's own `role` — otherwise a stale delete
   *  settling after the operator has already opened a DIFFERENT row's delete confirmation would
   *  silently dismiss that dialog with no decision made. */
/** Same settle-time guard as `onSaveRole` above, keyed on `policyId` instead of `roleId` — see
   *  that function's comment for why. */
/** Same `ConfirmDialog`-via-`RowMenu` swap as `onDeleteRole` above, plus the same `clearPending`
   *  settle-time guard — see that function's comments for both. */
/** Refresh the open form's permission list. Failures land in `rowError` like every other row
   *  action rather than throwing — a list that cannot load must not take the form down with it. */
// Superseded by a newer load started after this one — that later call owns
// `permissionRows` now, and applying this stale result would let whichever policy's load
// happens to settle LAST win regardless of which panel is actually open. See
// `permissionsGenerationRef`'s doc comment above.
// No side effects inside the `setPermissionPolicyId` updater (2026-09-20 fix, C2/N1): React 18
// Strict Mode double-invokes a functional `setState` updater in dev, so the old shape (this
// function's body used to live inside that updater) fired `loadPermissions` twice per open. The
// updater is now a pure `current === policyId` read; every side effect (the ref write, the row
// clear, the load) runs once, in the function body, after the updater has been called.
// Clear first either way, so a re-open never flashes the previous policy's permissions.
// Refresh only while the panel is still on THIS policy (C2/N1 fix) — see
// `permissionPolicyIdRef`'s doc comment above. `loadPermissions`'s generation guard orders
// same-policy loads against each other; it does not protect against a newer call for a
// DIFFERENT policy, and this trailing call always mints the newest generation by
// construction, so it used to win even after the operator moved to another policy's panel.
// Keyed functional update (same fix class as `runRowDelete`'s `setRowSavingId` above):
// nothing gates starting a removal on a SECOND row while this one is still in flight, so an
// unconditional reset would clear a still-in-flight newer removal's own busy indicator.
/** C1 — the Remove button no longer calls {@link onRemovePermission} directly; it stages the
   *  target row here and a shell `ConfirmDialog` calls this to actually remove it. Clears the
   *  pending selection in `finally` regardless of outcome (a failure surfaces through `rowError`,
   *  same as every other row action), keyed on the row's own id so a stale confirm settling after
   *  the operator has already opened a DIFFERENT row's confirmation does not dismiss it — same
   *  guard shape as `onDeleteRole`/`onDeletePolicy`'s `clearPending`. */
/** 2026-09-05 fix, same bug class as `onSaveRole`/`onDeleteRole` above: nothing gates opening a
   *  DIFFERENT policy's permission form (`togglePermissionForm`) while a write for the previously
   *  open one is still in flight. `permissionInput`/`resourceTypeInput` are cleared on success
   *  unconditionally — captured here as `generationAtStart` (`permissionsGenerationRef`, bumped by
   *  every `loadPermissions` call, i.e. every panel open) before the write starts, so a stale
   *  write's success can tell "the operator is still on the policy this write was for" apart from
   *  "they've since switched panels and typed a NEW, unrelated value" and skip clearing in the
   *  latter case — otherwise it would erase whatever the operator typed for the policy they
   *  actually have open now. `rowSavingId`'s reset (matching `onSaveRole`'s identical fix) is a
   *  functional update keyed on this call's own `policyId` for the same reason. */
// The row the write just created has to appear in the list, or its Remove button would not
// exist until the form was closed and re-opened. Refresh only while the panel is still on
// THIS policy (C2/N1 fix, same guard and reasoning as `onRemovePermission` above) — this
// trailing call always mints the newest generation, so `loadPermissions`'s OWN generation
// guard cannot tell "superseded by a different policy's open" apart from "just the latest
// load for this one"; only `permissionPolicyIdRef`'s equality check can.
/**
 * Binds the real `/api/.../roles` and `/policies` clients — see `roles-dependencies.hooks.ts`. The
 * zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `Roles.tsx` composes this
 * and a test composes {@link useRoles} with `createFakeRolesPort`.
 *
 * @returns The same `RolesController` {@link useRoles} returns, wired to the live API client.
 */
```

## Live host roles — index.ts

```text
/**
 * @file Public surface of the `roles` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder. That indirection is the
 * point of the feature boundary: everything below can be split, renamed, or grown a `hooks/`
 * directory without the router noticing. Adding a file to this feature is not an API change unless
 * it is exported from this line.
 */
```

## Live host roles — roles-i18n.ts

```text
/**
 * @file Spanish translation for the Roles & Permissions screen (`Roles.tsx`) — this feature's own
 * dictionary, not the shared `lib/admin-nav-i18n.ts` one, so parallel translation passes over
 * other admin sections can't collide on the same file. Same two-step fallback every other `t()`
 * in this app uses: translated value, else the English source string itself.
 */
// rules.ts's describeApiError overrides (C4) — untranslated until this pass.
// rules.ts's roleMenuItems/policyMenuItems row-menu labels — outside the original `.tsx`-only
// pass's scope, closed here since this dictionary already owns the rest of this screen's
// vocabulary. "Add permission" composes this file's own established "Add"/"Permission" entries
// above rather than a fresh phrase.
// Hook-level notice/error strings (use-roles.hooks.ts) — these never got translated during the
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
/**
 * The page description's prefix/link-label/suffix around the `<a href="/admin/users">` mid-sentence
 * link — split out from `ES` rather than looked up key-by-key, because Spanish puts "pantalla de"
 * (screen) BEFORE the link text while English puts "screen" after it. Concatenating three
 * independently-translated fragments in a fixed English word order would read backwards in Spanish,
 * so this owns the whole sentence shape per locale instead.
 */
/** The role-delete confirm body's prefix/suffix around the role's own (untranslated) name — same
 *  "own the whole sentence per locale" reasoning as {@link rolesDescriptionParts}: Spanish's leading
 *  "¿" has no English equivalent to concatenate onto. */
/** Same as {@link roleDeleteBodyParts}, for the policy-delete confirm body. */
/** Same "own the whole sentence per locale" shape as {@link roleDeleteBodyParts}/
 *  {@link policyDeleteBodyParts} (C1) — the permission string sits between the quotes, and the
 *  sentence continues past the closing quote to name the consequence ("Anyone with this policy
 *  loses it."), which a fixed English word order concatenated onto a translated prefix would not
 *  reliably place for every locale. */
```

## Live host roles — rules.ts

```text
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
/** Same flat-lookup shape as `users/rules.ts`'s `describeApiError` (see its comment for why a
 *  table doesn't lose exhaustiveness here) — a closed set of literal `code` strings, not a
 *  discriminated union. Values are English source strings — `t()`'s own keys — not yet localized;
 *  `describeApiError` below is what translates them. */
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
/** The callbacks a role row menu needs. Passed in rather than imported so this module stays free
 *  of state and navigation, and so a test can assert exactly which one a given row wires up. */
/** At-rest row actions for a role (built-in rows and an actively-editing row never reach these —
 *  see `Roles.tsx`'s table JSX, which renders `—` or the Save/Cancel pair for those instead).
 *
 * @complexity Time/space: O(1) — exactly two entries, no iteration.
 */
/** The callbacks a policy row menu needs, plus the id of whichever policy currently has its
 *  "Add permission" form open — needed to compute the toggle item's label. Passed in rather than
 *  read from state so this module stays free of state and navigation. */
/** Same shape as {@link roleMenuItems}, plus the "Add permission"/"Close" toggle — its label still
 *  flips based on `permissionPolicyId` exactly as the inline button it replaced did; only where
 *  that toggle now lives (a `RowMenu` item instead of a bare button) changed.
 *
 * @complexity Time/space: O(1) — exactly three entries, no iteration.
 */
```
