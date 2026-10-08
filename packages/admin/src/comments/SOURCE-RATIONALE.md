# Comments source rationale

Historical source comments, retained for provenance. Current owners and contracts are in PORT.md.

## Comments.tsx

```ts
/**
 * @file Comments admin screen (ADR-031, SPEC-033/035 backend; SPEC-036 this frontend) — markup
 * only.
 *
 * State and API calls live in `hooks/use-comments.hooks.ts` (permissions),
 * `hooks/use-comment-queue.hooks.ts` (`QueueSection`), and `hooks/use-comment-settings.hooks.ts`
 * (`SettingsSection`). The row-menu logic, error-message overrides, and the settings patch
 * builder/validator live in `rules.ts`. `QueueSection`/`SettingsSection` are now exported (2026-08-14,
 * previously module-private) and carry their own DI-seam prop (`useCommentQueueHook`/
 * `useCommentSettingsHook`), matching `Comments`'s own `useCommentsHook` — each has its own direct
 * test (`QueueSection.unit.test.tsx`, `SettingsSection.unit.test.tsx`) satisfying the reason the
 * earlier "only the exported, tested screen gets a seam" rule gave for skipping them (no standalone
 * test existed), rather than overriding that rule's conclusion without addressing its premise.
 *
 * Closes the gap the SPEC-036 sweep found: the moderation-queue/moderate/settings backend
 * routes were built and audit-clean but nothing in `apps/admin/` called any of them, so the
 * Comments nav entry fell through to the static `Placeholder`.
 *
 * Two sections in one file (`QueueSection` + `SettingsSection`), combined by the exported
 * `Comments()` — mirrors `Database.tsx`'s established multi-section-single-file shape rather than
 * splitting into `CommentsSettings.tsx` (REQ-08 explicitly leaves that choice to the implementer).
 * `QueueSection`'s status-filter + keyset-cursor "Load more" pattern mirrors `Database.tsx`'s
 * `TimelineSection` (the real cursor-pagination precedent in this admin app — `Redirects.tsx`
 * itself has no pagination today, see REQ-03's implementation note in the handoff).
 *
 * Permission-based affordance hiding (AC-10) mirrors `Settings.tsx`'s `api.me()` ->
 * `effectivePermissions` -> `has(permission)` derivation; this is UX only, the real authz
 * boundary stays server-side (Article VI, `Settings.tsx`'s own header note applies here too).
 */
/** The status-filter `<select>` — pure presentation, no state of its own. */
/** The moderation-queue table's "More" column — a `RowMenu` built from `commentRowMenuItems`, or
 *  an em dash when the operator's permissions leave no items, plus this row's own error (if the
 *  last action against it failed). Top-level rather than an inline `cell` closure so it has its
 *  own directly-testable scope, per `commentRowMenuItems`'s own risk ranking. */
/** Builds the `DataTable` column descriptors. A plain function rather than a closure declared
 *  inside `QueueTable`'s body — it doesn't need to be a hook-scoped closure, only the values
 *  already threaded through its parameters. */
/** The populated-queue view: the table plus its "Load more" pager. Only rendered once
 *  `QueueItemsView` has already ruled out the loading/empty states. */
  // Rows page in over "Load more", so handles are derived fresh each render from whichever rows
  // are currently on screen — same per-row-id lookup `Database.tsx`'s `TimelineBody` uses, needed
  // because `DataTable`'s `cell` callback only receives the row, not its index.
/** Dispatches between the three queue-body states (loading / empty / populated) as a flat
 *  if-chain instead of a nested ternary — the nesting was the cognitive-complexity cost in the
 *  original inline JSX, not the branch count itself. */
/** The Purge confirm dialog. Stays mounted unconditionally (driven by `open`) — see
 *  `useCommentQueue`'s `pendingPurge` doc comment for why. */
/** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. Defaulted to the real hook, so production callers (the exported
   *  `Comments` below) pass nothing and behave exactly as before. */
/** Exported (2026-08-14, previously module-private) so `QueueSection.unit.test.tsx` can drive its
 *  own DI seam directly — the same reason `AiAssistant.tsx`'s `AdminExecutionMode` is exported. */
/** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. Defaulted to the real hook, so production callers (the exported
   *  `Comments` below) pass nothing and behave exactly as before. */
/**
 * Resolves the injected hook prop to the real wired hook when a caller passes none. Pulled into its
 * own function, the same `??`-avoidance idiom `MenuEditor.tsx`'s `orEmpty`/`CollectionEntryEditor
 * .tsx`'s `resolveCollectionEntryEditorHook` use: `SettingsSection` was already sitting at the 9/9
 * complexity ceiling, and ESLint's cyclomatic-complexity rule counts a default value or `??` inside
 * a function's OWN body as one of that function's own branches — a call out to a separately-scoped
 * resolver does not.
 */
/** Exported (2026-08-14, previously module-private) so `SettingsSection.unit.test.tsx` can drive
 *  its own DI seam directly — see `QueueSection`'s identical doc comment above. */
/**
   * Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   * for `useCustomSelect`. Defaulted to the real hook, so production callers (`panels.tsx`) pass
   * nothing and behave exactly as before.
   */
```

## rules.ts

```ts
/**
 * @file Pure logic for the `comments` feature — everything that computes a value rather than
 * rendering one. Follows the `posts/rules.ts` convention: no React import, no hooks, directly
 * testable.
 *
 * Moved here from `Comments.tsx`: `RowActionState`/`emptyRowState` and `describeModerationError`/
 * `truncate` (already module-scope free functions in the original, just not exported), the
 * moderation-queue row-menu item builder (a permission-and-status branch per action), and the
 * Comments-settings patch builder plus its validation (REQ-08/09/10).
 *
 * `KEYS` (fetch-query migration, 2026-08-12): three independent resources this feature's three
 * hooks each own — the operator's own effective permissions, the moderation queue (one cache
 * identity PER status filter, `queue(status)`), and the settings form. `queueRoot` is the
 * INVALIDATION target for a moderation action succeeding, not a read key of its own: a moderate/
 * purge action always moves a comment to a DIFFERENT status than the one currently filtered, so the
 * pre-migration `reloadFirstPage()` only ever refreshed the CURRENT filter's page — leaving a
 * previously-visited OTHER status tab's cache stale (missing the comment) until the operator
 * happened to force a reload. Invalidating the shared `["comments","queue"]` prefix instead
 * refreshes every status tab's cache at once (matching by prefix — see `@jini-ai/ui/fetch-query`'s
 * `QueryKey` doc), closing that gap; see `use-comment-queue.hooks.ts`'s own doc comment.
 */
/** The moderation queue's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s
 *  `TAXONOMY_RESOURCE` for why this is a plain colocated constant rather than a shared registry.
 *  Agent-writable via `comments_approve_comment`/`comments_mark_comment_spam`/
 *  `comments_trash_comment`/`comments_restore_comment` (`apps/website/src/features/comments/
 *  agent-tools.ts`), all of which move a comment between statuses this queue lists.
 *
 *  There is deliberately NO sibling `COMMENTS_SETTINGS_RESOURCE`: `use-comment-settings.hooks.ts`'s
 *  own header records a real, already-fixed lost-update bug (TM-TOVU-2026-08-12-A) whose fix is a
 *  ONE-SHOT seed guard that refuses to re-seed `settings` from any later successful load, including
 *  this bus's own out-of-band notification. Wiring that hook to the bus would either do nothing
 *  (the guard blocks it) or, if the guard were bypassed instead, reintroduce the exact silent
 *  revert the guard exists to prevent — so `comments_update_settings` stays unwired to this bus on
 *  purpose. See that hook's own file header for the full incident record. */
/** Per-row moderation-action state (Approve/Spam/Trash/Restore/Purge share one `busy` flag — only
 *  one action per row at a time). */
/** REQ-07: a 409 (stale `expectedVersion`) gets its own message instead of the generic fallback,
 * using the route's own `{error, currentVersion}` body when present. */
/** The callbacks a row menu needs. Passed in rather than imported, so this module stays free of
 *  state (same convention as `posts/rules.ts`'s `PostRowMenuHandlers`). */
/** Opens the confirm dialog; only offered under the trash filter for an already-trashed
   *  comment, and only with `comments.delete.force`. */
/** Permissions resolved once per {@link commentRowMenuItems} call and threaded into each
 *  candidate-item builder below, so each builder stays a single-condition pure function. */
/** REQ-06: purge only ever surfaces from the trash filter view (`currentFilterStatus === "trash"`),
 *  not merely a trashed comment reached under a different filter. Genuinely destructive (its own
 *  confirm copy: "cannot be undone") — `destructive: true`, unlike the reversible actions above. */
/** At-rest row actions for `RowMenu` — every condition here is copied verbatim from the inline
 *  buttons this replaces, so a permission/status combination that used to hide a button still
 *  omits the matching menu item rather than rendering a guaranteed-failing click. Each candidate
 *  item is its own single-condition pure function above; this just resolves permissions once and
 *  filters out the misses.
 *
 * @complexity Time/space: O(1) — at most five entries, no iteration; three `hasPermission` checks.
 */
/** A blank or non-numeric raw value means "no opinion" — the field is left out of the patch
 *  rather than coerced to `0`/`NaN`. Shared by every numeric settings field except
 *  `closeAfterDays`, whose blank case means something else (see {@link parseCloseAfterDays}). */
/** REQ-10: blank means "never closes" -> `null` on the wire; the UI never sends the backend's own
 *  `-1` sentinel, only `null` or a positive number. A non-numeric raw value is "no opinion"
 *  (`undefined`), same as the other numeric fields. */
/** REQ-08/09/10: builds a partial patch containing only the fields the operator actually changed
 * (the backend's `setCommentsSettings` is a partial-patch contract — REQ-08 asks the client to
 * mirror that instead of always sending the full object, as `Seo.tsx`'s form does). Each field's
 * diff logic is a standalone pure helper above so it can be tested (and reasoned about) on its
 * own; this function is just the merge. */
/** REQ-09: client-side validates `spamAutoRejectScore` before the network call — mirrors the
 * backend's own `validateCommentsSettingsPatch` bound (`src/comments/settings.ts`). Returns the
 * error message to show, or `null` when the patch is valid. Split out of `save`'s body (originally
 * an inline `if`) because it is the one piece of that flow that computes a value rather than
 * performing an effect. */
/**
 * `useCommentSettings`'s error banner, extracted out of that hook (`refactor/fetch-query`
 * complexity pass, 2026-08-12 — same reason `redirects/rules.ts`'s `visibleRedirectsError` was
 * extracted). Precedence, highest first: a client-side validation failure (the operator hasn't even
 * submitted a valid patch yet — a stale write/list error underneath it would be a confusing second
 * message), then the save write's own failure, then — only before `settings` has ever loaded — the
 * list-read failure, matching every other migrated feature's "a later background failure must not
 * blank an already-rendered screen" guard.
 *
 * @complexity Time/space: O(1) — four fixed checks, no iteration.
 */
```

## hooks/comment-queue-dependencies.hooks.ts

```ts
/**
 * @file The only place `use-comment-queue.hooks.ts` reaches `lib/api` — see `comment-queue-
 * port.hooks.ts` for why the split exists.
 */
/** The live implementation, as a module-level singleton. */
/** Seed state for {@link createFakeCommentQueuePort}. */
/** When set, `listCommentsQueue()` rejects with this instead of resolving — for load-failure
   *  tests. */
/** When set, `moderateComment()` rejects with this instead of resolving — for
   *  moderation-failure tests. */
/** When set, `purgeComment()` rejects with this instead of resolving — for purge-failure
   *  tests. */
/**
 * An in-memory {@link CommentQueuePort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`). `listCommentsQueue` always returns the full seeded
 * page regardless of `status`/`cursor` — this hook's own paging/filter logic lives in the CALLER
 * (its `status` state, its cursor bookkeeping), not in the port, so the fake does not need to
 * simulate server-side filtering to prove the hook wires those params through correctly (see the
 * `records the requested status/cursor` test below, which asserts on the port's own call log
 * instead).
 */
/** Every `listCommentsQueue` call's options, in call order — lets a test assert the hook passed
   *  through the right status/cursor without the fake needing to filter anything itself. */
/** Every `moderateComment` call's input, in call order. */
/** Every `purgeComment` call's input, in call order. */
```

## hooks/comment-queue-port.hooks.ts

```ts
/**
 * @file What `use-comment-queue.hooks.ts` needs from the outside world, as an interface rather than
 * a direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md`.
 */
```

## hooks/comment-settings-dependencies.hooks.ts

```ts
/**
 * @file The only place `use-comment-settings.hooks.ts` reaches `lib/api` — see `comment-settings-
 * port.hooks.ts` for why the split exists.
 */
/** The live implementation, as a module-level singleton. */
/** Seed state for {@link createFakeCommentSettingsPort}. */
/** When set, `getCommentsSettings()` rejects with this instead of resolving — for
   *  load-failure tests. */
/** When set, `putCommentsSettings()` rejects with this instead of resolving — for
   *  save-failure tests. */
/**
 * An in-memory {@link CommentSettingsPort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`). `putCommentsSettings` merges into and returns the
 * fake's own store, matching the real route's read-your-writes shape.
 */
/** The fake's current stored settings. */
```

## hooks/comment-settings-port.hooks.ts

```ts
/**
 * @file What `use-comment-settings.hooks.ts` needs from the outside world, as an interface rather
 * than a direct `lib/api` import. Follows the `useX(dependencies)` / `useWiredX()` pair documented
 * in `development/docs/architecture/wired-hooks-convention.md`.
 */
```

## hooks/comments-dependencies.hooks.ts

```ts
/**
 * @file The only place `use-comments.hooks.ts` reaches `lib/api` — see `comments-port.hooks.ts` for
 * why the split exists.
 */
/** The live implementation, as a module-level singleton — matches `redirects-dependencies
 *  .hooks.ts`'s `defaultRedirectsPort`. */
/** Seed state for {@link createFakeCommentsPort}. */
/** When set, `me()` rejects with this instead of resolving — for load-failure tests. */
/**
 * An in-memory {@link CommentsPort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`).
 */
```

## hooks/comments-port.hooks.ts

```ts
/**
 * @file What `use-comments.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) — see `development/docs/architecture/wired-hooks-
 * convention.md` for the full shape. `comments-dependencies.hooks.ts` binds the real `api` client;
 * nothing else under `features/comments/hooks/use-comments.hooks.ts` imports `lib/api`.
 */
/** Narrowed to the one field this hook reads — the real `api.me()` also returns `user`, which
   *  this hook never uses. Matches `page-editor-port.hooks.ts`'s own narrowing precedent. */
```

## hooks/use-comment-queue.hooks.ts

```ts
/**
 * @file `QueueSection`'s moderation-queue state — status filter, keyset-cursor paging, per-row
 * moderation state, and the Purge confirm dialog. Extracted verbatim from `Comments.tsx`.
 * `QueueSection` is defined and exported from `Comments.tsx` (see that file's own header for why it
 * lives there rather than its own file), and carries its own DI-seam prop (`useCommentQueueHook`,
 * 2026-08-14) plus a direct test (`QueueSection.unit.test.tsx`) — see `use-comments.hooks.ts`'s
 * header for why the earlier "no seam for these sections" rule no longer applies.
 *
 * Does not take `permissions` — the only thing that used it (the row-menu item builder) moved to
 * `rules.ts`'s `commentRowMenuItems`, called directly by the view, which already has `permissions`
 * in scope as `QueueSection`'s own prop. This hook has no use for it.
 *
 * `port`/`locale` are injected — see `comment-queue-port.hooks.ts` — rather than reaching
 * `lib/api`/`useAdminLocale()` directly, so a test can describe load/moderate/purge outcomes
 * against `createFakeCommentQueuePort` instead of stubbing global `fetch`. `useWiredCommentQueue`
 * below is the pair `Comments.tsx`'s `QueueSection` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): page 1 for the current `status` filter is one
 * `useFetchQuery` keyed on `KEYS.queue(status)` — a query cannot commit a response belonging to a
 * prior key, so switching filters mid-flight can no longer land a stale status's page on screen.
 * Subsequent "Load more" pages are NOT folded into that query, for the identical reason
 * `forms/hooks/use-form-submissions.hooks.ts` keeps its own cursor-appended pages local (see that
 * file's own doc comment: `@jini-ai/ui/fetch-query`'s `QueryKey` doc binds one hook to one FIXED
 * key, and a cursor-appended page list is exactly the shape that doc's Skip precedent warns
 * against faking) — `pageSettlement` (`useSettlementGeneration`, same primitive and shape as
 * `use-form-submissions.hooks.ts`'s own `pageSettlement`) guards that local accumulation against
 * the same class of race the base query gets for free: a `loadMore` in flight when `status`
 * changes, or when a content-refresh refetches page 1, must not append its page once it resolves —
 * see `resetMorePages` below, which mints a fresh generation on every reset so an older in-flight
 * page fetch is superseded. A synchronous `loadingMoreRef` lock, checked before minting a
 * generation, covers a same-tick double `loadMore` (2026-09-20, `plan-content2.md` S3).
 *
 * Per-row moderation state (`rowState`, `pendingPurge`) stays local `useState`, per this
 * migration's own dispatch brief: `comments` has per-row action state, and a single shared
 * mutation object cannot carry "which row" on its own. `onModerate`/`onPurge` therefore call
 * `port.moderateComment`/`port.purgeComment` directly (not through `useFetchMutation`) and use
 * `useInvalidate()` to refresh the queue on success — see `reloadAfterAction`'s own comment for why
 * that invalidates `KEYS.queueRoot` (every status) rather than just the current filter.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass — see that hook's own header):
 * a moderation action from the assistant (an operator asks it to approve/spam/trash/restore a
 * comment) now invalidates `KEYS.queueRoot` the same way this hook's own `reloadAfterAction` does,
 * instead of leaving the queue showing a comment in its pre-write status until a manual reload. No
 * draft to protect here — every row's own edit state (`rowState`) is per-action busy/error tracking,
 * not typed text a background refresh could clobber, unlike `use-comment-settings.hooks.ts`'s
 * uncontrolled form (deliberately NOT given this same subscription — see that hook's own header).
 */
/** `null` until the first page for the current status settles. */
/** Per-row moderation state, falling back to the empty state for a row with no action taken
   *  yet. */
/** The comment a `RowMenu` "Purge" selection is asking to confirm; `null` when the dialog is
   *  closed. `ConfirmDialog` stays mounted unconditionally in the view (see its own doc comment on
   *  why); this is what drives its `open` prop. */

  // Out-of-band writes — a moderation action from an assistant run (`comments_approve_comment` et
  // al., `apps/website/src/features/comments/agent-tools.ts`) — invalidate every status's cache the
  // same way `reloadAfterAction` below does for an operator's own action. Stable identity (not an
  // inline arrow) so `useContentRefreshSubscription`'s own effect does not unsubscribe/resubscribe
  // on every render — see `use-media.hooks.ts`'s identical `invalidateList` note.
  // The comment a `RowMenu` "Purge" selection is asking to confirm — `null` when the dialog is
  // closed. `ConfirmDialog` stays mounted unconditionally below (see its own doc comment on why);
  // this is what drives its `open` prop. Row actions moved into `RowMenu` below (MSG-03 rollout);
  // Purge is the one that needed a real confirm step, so it's the one that gained this state — the
  // others (Approve/Spam/Trash/Restore) were never gated by anything and still aren't.

  // The "latest call wins" guard for accumulated pages — see the file header. `loadingMoreRef` is
  // the synchronous half (blocks a same-tick double `loadMore`); `pageSettlement` is the async half
  // (a superseded fetch's response must not land once a reset or a status switch has moved on).

  // Supersedes any in-flight "Load more" fetch and clears the accumulated pages/cursor/error back
  // to "just the first page" — called wherever the previous code did a bare `setMorePages([])`, so
  // there is one reset path instead of several ad hoc ones. Does NOT touch `rowState`: that belongs
  // to the status effect below, which still resets it directly (unrelated to page accumulation).

  // Resets the accumulated pages/row state that belonged to the PREVIOUS filter, and supersedes
  // any of that filter's `loadMore` still in flight — including releasing its `loadingMore` lock,
  // which the old `statusAtCall !== statusRef.current` finally-check never did (a `loadMore`
  // in flight when `status` changed left `loadingMore` stuck true forever, since neither its
  // success nor its error branch's guard matched once the filter moved on).

  // A refetched first page (e.g. a content-refresh landing an assistant's moderation action) must
  // drop the "more" pages it used to leave stale — they are always a continuation of the CURRENT
  // first page, not whichever first page was on screen when they were fetched. `resetMorePages()`
  // also supersedes any `loadMore` already in flight when the refetch lands, so its page can't
  // append afterward.
      // A superseded call's lock was already released by `resetMorePages`; only the still-current
      // call releases it here.
/** Reflects a moderation action's effect (REQ-05's "refetching the row's queue page on
   * success") — but invalidates `KEYS.queueRoot`, every status's cached page, not just the current
   * filter's. See `rules.ts`'s `KEYS` doc for why: an action always moves the comment to a
   * DIFFERENT status than the one currently filtered, so a previously-visited OTHER status tab's
   * cache would otherwise stay stale (missing the comment) until the operator happened to force a
   * reload — a gap the pre-migration `reloadFirstPage()` had too, just invisibly, since nothing
   * cached a prior visit to reveal it. Also drops the current filter's accumulated "more" pages,
   * which belonged to the pre-action list. */

  // Synchronous per-row duplicate-submit guard, shared by `onModerate`/`onPurge` below — a ref, not
  // `rowState`'s own `busy` flag, because a real double-click can fire two calls for the SAME
  // comment in the same synchronous tick, before React has re-rendered with `busy: true`.
  // `RowMenu`'s items carry no `disabled` state at all (`QueueActionsCell` builds every item
  // unconditionally, busy or not — this hook is the only gate), so two selections on one row — even
  // two DIFFERENT actions, e.g. Approve then Spam — could otherwise both pass the old state-based
  // check and both reach the port. Checked-then-set synchronously, so a second same-tick call always
  // observes the first's write; `rowState.busy` (state) still exists to let the UI show a busy row.
/** Confirmation now gates via a `ConfirmDialog` modal, reached through `RowMenu`'s "Purge" item
   *  (`setPendingPurge` below), rather than `window.confirm` — same upgrade `Posts.tsx`/`Pages.tsx`
   *  already made for their own Delete. Copy is the exact previous sentence, unchanged: states the
   *  consequence ("permanently delete") and explicitly "this cannot be undone" because, unlike
   *  Trash (a status this same menu can restore from), a purge genuinely has no way back. Dialog
   *  always closes on settle (success or failure) — a failure surfaces via this row's own existing
   *  `rs.error` mechanism, same place every other moderation action's failure already shows up. */
    // Same synchronous guard as `onModerate` above — shares `busyRowIdsRef` with it since both
    // patch the same row's `rowState` entry.
/**
 * Binds the real `/api/.../comments/queue` client and the resolved `useAdminLocale()` value — see
 * `comment-queue-dependencies.hooks.ts`. The zero-argument-deps half of the `useX(dependencies)` /
 * `useWiredX()` pair, so `Comments.tsx`'s `QueueSection` composes this and a test composes
 * {@link useCommentQueue} with `createFakeCommentQueuePort`.
 */
```

## hooks/use-comment-settings.hooks.ts

```ts
/**
 * @file `SettingsSection`'s load/edit/save lifecycle for the Comments workspace settings form.
 * Extracted verbatim from `Comments.tsx`. `SettingsSection` is defined and exported from
 * `Comments.tsx` (see that file's own header for why it lives there rather than its own file), and
 * carries its own DI-seam prop (`useCommentSettingsHook`, 2026-08-14) plus a direct test
 * (`SettingsSection.unit.test.tsx`) — see `use-comments.hooks.ts`'s header for why the earlier "no
 * seam for these sections" rule no longer applies.
 *
 * Takes `canConfigure` as an argument, same as the original component prop — the read is `enabled:
 * canConfigure` (AC-10: the GET route itself is `comments.configure`-gated, so a principal without
 * that grant can't even read settings).
 *
 * `port`/`locale` are injected — see `comment-settings-port.hooks.ts` — rather than reaching
 * `lib/api`/`useAdminLocale()` directly, so a test can describe load/save outcomes against
 * `createFakeCommentSettingsPort` instead of stubbing global `fetch`. `useWiredCommentSettings`
 * below is the pair `Comments.tsx`'s `SettingsSection` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the read is `useFetchQuery({ key: KEYS.settings,
 * enabled: canConfigure, ... })`; `save` is one `useFetchMutation` that `invalidates: [KEYS.
 * settings]`. `settings` itself stays local `useState`, seeded from `list.data` on load and set
 * directly from `save`'s own response on success — mirrors `use-collection-entry-editor.hooks.ts`'s
 * `save()` (see that file's header): a caller reading `settings` right after `await save(...)`
 * resolves must see the new value immediately, and `invalidateQueries` is deliberately NOT awaited
 * inside `useFetchMutation` (`@jini-ai/ui/fetch-query`'s own comment), so the invalidated query's
 * background refetch is not guaranteed to have landed by then.
 *
 * `seededRef` below is a mandatory ONE-SHOT seed guard (round-2 fix for TM-TOVU-2026-08-12-A: a
 * concurrent two-operator lost update, confirmed against source and against a JSDOM probe). An
 * earlier revision of this comment argued no guard was needed because the form is uncontrolled
 * (`defaultChecked`/`defaultValue`, read via `FormData` on submit) — reasoning that a re-seed
 * "cannot clobber an in-progress edit the way a controlled draft could". That is true of the
 * visible DOM and irrelevant to the actual hazard: `settings` is not just render state, it is
 * `buildSettingsPatch`'s diff BASELINE (`save`, below, calls `buildSettingsPatch({ form, current:
 * settings })`). Changing `defaultValue`/`defaultChecked` on an ALREADY-MOUNTED uncontrolled input
 * does NOT change the input's current value — so when a background refetch re-seeds `settings`
 * (routine here: `saveMutation`'s own `invalidates: [KEYS.settings]` triggers exactly this on
 * every save, including saves made by OTHER operators against the same resource), the baseline
 * moves while the DOM does not. A later save then diffs the operator's still-unchanged, still-
 * visible field against a baseline that quietly moved out from under it, includes that stale value
 * in the patch, and silently reverts whatever another operator just committed — no error, no
 * warning. `seededRef` seeds `settings` once from the first successful load and never advances it
 * again on its own; `save`'s own `setSettings(updated)` below is unaffected by this guard — that
 * is this operator's own just-committed write coming back from the server, which correctly
 * advances the baseline to match what they just sent. The accepted trade (owner-approved,
 * 2026-08-12): this operator's view goes stale until they reload rather than silently reverting a
 * concurrent write; controlled draft state and server-side compare-and-swap were both considered
 * and deliberately deferred.
 */
/** `null` until the initial load settles, or permanently when `canConfigure` is `false`. */
  // AC-10: the GET route itself is `comments.configure`-gated (get-settings.ts), so a principal
  // without that grant can't even read settings today — `enabled: canConfigure` skips the doomed
  // fetch (see `@jini-ai/ui/fetch-query`'s `FetchQueryOptions.enabled` doc) rather than surfacing a
  // 403 error banner for a screen this principal was never going to be able to use.
  // One-shot seed guard — see this file's own header for why re-seeding on every load (not just
  // the first) is the actual lost-update bug, not a redundant precaution.

  // Seeds local `settings` from the FIRST successful load only — see this file's own header for
  // why a later re-seed (from a background refetch invalidated by anyone's save, not just this
  // operator's own) must not move this baseline again on its own.

    // REQ-09: client-side validate spamAutoRejectScore before the network call — mirrors the
    // backend's own `validateCommentsSettingsPatch` bound (`src/comments/settings.ts`).
      // already surfaced through saveMutation.error -> error below
/**
 * Binds the real `/api/.../comments/settings` client and the resolved `useAdminLocale()` value —
 * see `comment-settings-dependencies.hooks.ts`. The zero-argument-deps half of the
 * `useX(dependencies)` / `useWiredX()` pair, so `Comments.tsx`'s `SettingsSection` composes this
 * and a test composes {@link useCommentSettings} with `createFakeCommentSettingsPort`.
 */
```

## hooks/use-comments.hooks.ts

```ts
/**
 * @file The top-level `Comments()` component's own state: loading the operator's effective
 * permissions, which gate whether `QueueSection`/`SettingsSection` render at all.
 *
 * `QueueSection` and `SettingsSection` live inside `Comments.tsx` (its own file header explains why:
 * mirrors `Database.tsx`'s multi-section-single-file shape). Each gets its own hook file
 * (`use-comment-queue.hooks.ts`, `use-comment-settings.hooks.ts`) because each owns independent
 * state. Both are now exported and carry their own DI-seam prop (2026-08-14) — the earlier rule
 * withholding a seam from them named "neither is tested standalone today" as the reason, not a
 * principled objection to seaming a sub-component; once each got a direct test
 * (`QueueSection.unit.test.tsx`, `SettingsSection.unit.test.tsx`), that reason no longer applied.
 *
 * `port`/`locale` are injected — see `comments-port.hooks.ts` — rather than importing `lib/api`/
 * calling `useAdminLocale()` directly, so a test can describe the permissions load against
 * `createFakeCommentsPort` instead of stubbing global `fetch`. `useWiredComments` below is the
 * zero-argument pair `Comments.tsx` actually mounts.
 *
 * `locale` (standing i18n rule, 2026-08-11 — a component with a hook gets its locale-derived UI
 * copy FROM that hook, not its own `useAdminLocale()` call) is exposed raw, not as a bound `t`:
 * `comments-i18n.ts`'s own `t(locale, key)`/`lib/admin-nav-i18n`'s `translateAdminNavLabel(locale,
 * key)` are pure functions that already take `locale` as an explicit argument — `Comments.tsx` and
 * its `QueueSection`/`SettingsSection` sub-components call those directly throughout (never
 * rebuilding a dictionary lookup inline), so there is no bound closure to inject here, only the
 * raw string those calls need. Same "pure, no-I/O rule stays a direct import" carve-out
 * `pageRowMenuItems` gets in `use-pages.hooks.ts`.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the permissions load is one `useFetchQuery` keyed on
 * `KEYS.permissions`.
 */
/** `null` until the initial load settles — the caller renders a loading state. */
/** The raw resolved locale — see this file's own header for why `Comments.tsx` gets this instead
   *  of a bound `t`. */
/**
 * Binds the real `/api/.../auth/me` client and the resolved `useAdminLocale()` value — see
 * `comments-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `Comments.tsx`
 * composes this and a test composes {@link useComments} with `createFakeCommentsPort`.
 */
```