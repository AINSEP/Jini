# Redirects source rationale

Historical comments retained verbatim from the extraction inputs. Active ownership is mapped in PORT.md.
References to Tovu hook/localization paths describe the source before extraction; the surviving owners
are redirects controllers/React hooks, the core API, and the host localization/publication seams.

## Redirects.tsx

```text
/**
 * @file Redirects admin screen (SPEC-009 ui.spec.md) — the `/admin/redirects` route.
 * Single-screen list + inline create form + per-row disable/enable + tombstone.
 *
 * SPEC-037 REQ-03/REQ-04: `HitCountCell` wires the previously-unused `api.getRedirectHits` as a
 * lazy per-row fetch (button-triggered, not fired for every row on mount — avoids an N+1 burst on
 * a large list), and `ImportRedirectsForm` wires the new `api.importRedirects` bulk-import
 * affordance, surfacing the route's own `207` per-item created/failed breakdown.
 *
 * ## Pilot for `lib/fetch-query`
 *
 * First screen migrated off the admin's `useState`-triple convention
 * (`data`/`loading`/`error` + a hand-written `load()`), which the other 37
 * fetching files still use. Picked as the pilot because it exercises the whole
 * interface in one small file: a list read, three writes that each used to
 * call `load()` by hand, a gesture-gated lazy read, and an import that
 * refreshes the list.
 *
 * Two things genuinely change beyond line count. Writes now name what they
 * invalidate instead of calling a loader the component happens to own — so a
 * second mounted view of the same key refreshes too, where `load()` only ever
 * refreshed this one. And a background refresh no longer throws the table
 * away: `status` stays `'success'` while `isFetching` is true, so the old
 * `if (!redirects) return <Loading/>` full-screen flash after every write is
 * gone.
 *
 * ## Markup only
 *
 * All state, effects, and `api.*` calls now live in `hooks/use-redirects.hooks.ts`,
 * `hooks/use-hit-count-cell.hooks.ts`, and `hooks/use-import-redirects-form.hooks.ts` — one hook
 * per component in this file. Pure logic (cache keys, payload shaping, the row-menu builder, the
 * import textarea's parse check) lives in `rules.ts`. What stays here is what actually renders.
 *
 * `locale`/`t` are resolved once in `Redirects` via `useRedirectsHook()` (which calls
 * `useAdminLocale()` internally — see `use-redirects.hooks.ts`'s own file header) and threaded down
 * as props — see `Database.tsx`'s file header for why (the hook's `loadLanguage()` isn't
 * memoized). `HitCountCell`/`ImportRedirectsForm` each have their own hook file, so per the
 * standing i18n rule they receive `t` (and, for `ImportRedirectsForm`, `locale`) THROUGH that
 * hook's own parameters rather than importing `redirects-i18n`/`useAdminLocale` directly — but
 * deliberately do NOT resolve `useAdminLocale()` independently inside their own `useWiredX`
 * (unlike every other converted screen in this sweep): `HitCountCell` renders once per table row,
 * so N independent resolutions would mean N concurrent settings fetches for one page load. See
 * `use-hit-count-cell.hooks.ts`'s file header for the full reasoning.
 * `rules.ts`'s row-menu labels stay English — see `redirects-i18n.tsx`'s file header.
 */

/** Bound translator, threaded down from `Redirects`'s own hook rather than resolved here — see
   *  this file's header. */

/** This row's own distinct handle base — same reasoning as `Users.tsx`'s `UserRowProps.agentBase`.
   *  Optional (identity-omitted default) since this component is exported and unit-tested directly
   *  without one. */

/** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */

/** Lazy hit-count cell (REQ-03) — fetches on first click rather than on mount, so a list of many
 *  rows never fires a synchronous burst of `/hits` requests. A rule with zero recorded hits still
 *  renders `0` (not blank), matching `hits.ts`'s own "still 200s with hitCount: 0" contract. */

// A rule with zero recorded hits still renders `0` (not blank), matching

// `hits.ts`'s own "still 200s with hitCount: 0" contract — so this branches

// on the request having completed, never on the count's truthiness.
```

## hooks/redirects-port.hooks.ts

```text
/**
 * @file What this feature's three hooks (`use-redirects`, `use-hit-count-cell`,
 * `use-import-redirects-form`) need from the outside world, as an interface rather than a direct
 * `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace): this file declares, `redirects-dependencies.hooks.ts`
 * binds the real `api` client, and nothing else under `features/redirects` imports `lib/api` for
 * these six routes. One shared port rather than one per hook — all three hooks read the same
 * `/redirects` resource and a test double for one is a test double for the resource, not for a
 * single screen.
 *
 * `describeApiError` (used by `use-import-redirects-form.hooks.ts`) is deliberately NOT part of this
 * port: it is a pure error-message rule with no I/O, and per the pattern a hook imports rules
 * directly rather than having them injected — see `assistant-chats-port.hooks.ts`'s own "what is
 * deliberately NOT in this port" section for the identical reasoning about `persistableMessages`.
 */
```

## hooks/redirects-dependencies.hooks.ts

```text
/**
 * @file The only place under `features/redirects` that reaches `lib/api` — see
 * `redirects-port.hooks.ts` for why the split exists.
 */

/** The live implementation, as a module-level singleton — matches `assistant-chats-dependencies
 *  .hooks.ts`'s `defaultAssistantChatsPort`. Each method wraps its `api` counterpart explicitly
 *  rather than pointing at it directly, so a route's default-parameter shape (`createRedirect`'s
 *  `options = {}`, `updateRedirect`'s `options = {}`) stays `lib/api.ts`'s to own. */

/** Seed state for {@link createFakeRedirectsPort}. */

/**
 * An in-memory {@link RedirectsPort} for tests — the fake that lets a test describe "the list has
 * these two rules" or "importing this batch fails item 2" directly, instead of hand-building
 * `Response` objects and stubbing global `fetch`. Shipped alongside the real binding per the
 * pattern's "every port gets a fake" rule (see `assistant-chats-dependencies.hooks.ts`).
 */

/** Every rule currently in the fake's store, in list order. */
```

## hooks/use-redirects.hooks.ts

```text
/**
 * @file Everything the Redirects LIST screen does, so `Redirects.tsx` is only markup.
 *
 * First screen migrated off the admin's `useState`-triple convention onto `@jini-ai/ui/fetch-query` (see
 * the original file-header comment, now on `Redirects.tsx`, for the pilot rationale) — extracted
 * here verbatim: same three independent mutations, same delete-confirm state, same error
 * precedence. `HitCountCell` and `ImportRedirectsForm` are separate components with their own
 * hooks (`use-hit-count-cell.hooks.ts`, `use-import-redirects-form.hooks.ts`) since each is
 * independently testable without rendering the list screen around it.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/redirects` needs it.
 *
 * `port` is injected — see `redirects-port.hooks.ts` — rather than importing `lib/api` directly, so
 * a test can describe list/write outcomes against `createFakeRedirectsPort` instead of stubbing
 * global `fetch`. `useWiredRedirects` below is the zero-argument pair `Redirects.tsx` actually
 * mounts.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import): `Redirects.tsx` was the ORIGINAL
 * reference implementation of the port/dependencies half of this convention (`2ea11f4`) but had not
 * yet had the i18n half applied — it still called `useAdminLocale()` and imported `redirects-i18n`'s
 * `t` directly. Both are now injected here. `locale` is threaded ALONGSIDE `t` (not just `t` alone,
 * unlike `use-analytics.hooks.ts`) because `Redirects.tsx` passes raw `locale` into
 * `redirectRowMenuItems` (`rules.ts`) and `actionsForRedirectLabel`/`deleteRedirectBody`
 * (`redirects-i18n.tsx`), all three of which take `(locale, ...)` directly — same reasoning as
 * `use-integrations.hooks.ts`'s identical `t`+`locale` case.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass — see that hook's own header):
 * re-invalidates `KEYS.list` on an out-of-band content-refresh notification, the same one-line
 * adoption `use-media.hooks.ts` uses. This list has no editable draft of its own (the create form is
 * a one-shot `FormData` submit, not a live diff baseline the way `use-comment-settings.hooks.ts`'s
 * uncontrolled form is), so a background invalidate here carries none of that hook's lost-update
 * risk.
 */

/** Mirrors `useFetchQuery`'s own `status` — the caller decides the full-screen loading/error
   *  guard from this plus `redirects`, same shape as `list.status` in the pre-extraction code. */

/** Raw list-read failure, for the full-screen guard (`listStatus === "error" && !redirects`). */

/** The banner error actually shown once a list has loaded — see `visibleRedirectsError`. */

/** The rule a `RowMenu` "Delete" selection is asking to confirm — `null` when the dialog is
   *  closed. `ConfirmDialog` stays mounted unconditionally in the view; this drives its `open`. */

/** Drives `ConfirmDialog`'s `pending` prop — true only while the confirmed delete itself is in
   *  flight, not for the other two writes. */

/** Fires the create mutation. Resolves `true` on success, `false` on a caught failure — never
   *  rejects. Kept on the controller because the existing hook tests call it directly; the form's
   *  own `onSubmit` uses {@link submitCreate} instead, which is what actually decides whether to
   *  reset the fields. */

/** `Redirects.tsx`'s form `onSubmit`, in full: captures the form synchronously (`currentTarget`
   *  is nulled after React finishes dispatching), then resets it ONLY once `createRedirect`
   *  resolves `true`. Moving the reset here (out of the `.tsx`) is what fixes the bug: the old
   *  inline handler called `e.currentTarget.reset()` unconditionally and synchronously, before the
   *  fire-and-forget mutation had any chance to settle, so a REJECTED create still wiped whatever
   *  the operator had just typed — right when they needed it to fix and resubmit. */

/** Bound translator — `key` already resolved against the caller's locale, so `Redirects.tsx`
   *  never imports `useAdminLocale`/`redirects-i18n` itself. See this file's header. */

/** Raw resolved locale — needed alongside `t` because `rules.ts`/`redirects-i18n.tsx` expose a
   *  few helpers that take `(locale, ...)` directly rather than a bound translator. See this file's
   *  header. */

// Stable identity (not an inline arrow) so `useContentRefreshSubscription`'s own effect does not

// unsubscribe/resubscribe on every render — see `use-media.hooks.ts`'s identical `invalidateList`

// note.

// Each write names the cache it affects rather than calling a loader; the

// list refetches because it is mounted under that key, not because this

// component remembered to ask it to.

// The rule a `RowMenu` "Delete" selection is asking to confirm — `null` when the dialog is

// closed. `ConfirmDialog` stays mounted unconditionally in the view (see its own doc comment on

// why); this is what drives its `open` prop. Row action moved off the in-place two-click

// `ConfirmButton` control (MSG-03 rollout) — see `Roles.tsx`'s `onDeleteRole` comment for why a

// `RowMenu` item needs `ConfirmDialog`, not `ConfirmButton`, to hold the confirm step.

// `.catch` BEFORE `.finally`, and both are load-bearing. `mutate()`'s own promise arrives with

// a rejection handler already attached (`@jini-ai/ui/fetch-query`'s `call` wrapper), which is what

// makes the bare `void mutate(...)` form used by `createRedirect`/`onToggleStatus` safe. But

// `.finally()` builds a NEW derived promise that re-throws the rejection, and handling the

// original does not retroactively handle a chain derived from it — so a failed delete raised a

// process-level `unhandledRejection`, in production as well as under the runner. Swallowing

// here loses nothing: the failure is already surfaced through `removeRule.error` -> `error`.

/**
   * Clears the OTHER writes' failures before starting one.
   *
   * The pre-migration code kept a single shared `error` and each handler opened
   * with `setError(null)`, so any new write wiped the previous one's message.
   * Three independent mutations do not inherit that: each keeps its own error
   * until reset, and `firstWriteError` returns creation order rather than recency —
   * so a failed Create would keep its banner on screen after a later, entirely
   * successful Disable, blaming an operation that worked. `mutate` already
   * clears the active mutation's own error, so only its siblings need this.
   */

// Never rejects — a caught failure resolves `false` instead, so `submitCreate` below can

// `.then()` it directly without its own try/catch. The failure is still surfaced through

// `createRule.error` -> `error`, exactly as before this method returned anything.

// Captured synchronously: React nulls `currentTarget` once it finishes dispatching this event,

// so a reference taken only after `createRedirect`'s `await` would already be `null`.

// `disabled={saving}` on the old inline buttons guarded against a second write firing while any

// of this screen's writes (create/toggle/delete) is in flight — `RowMenu`'s `items` has no

// per-item `disabled`, so that guard lives in each handler below instead. Functionally identical

// (no double-submission); the only loss is the greyed-out visual cue while `saving` is true, a

// presentation detail, not a dropped confirmation or destructive/warning classification.

/**
 * Binds the real `/api/.../redirects` client, and a `t` bound to the real resolved locale
 * (`useAdminLocale()`, called here and ONLY here — see this file's header) — see
 * `redirects-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `Redirects.tsx`
 * composes this and a test composes {@link useRedirects} with `createFakeRedirectsPort` and a fake
 * `t`/`locale`.
 */
```

## hooks/use-hit-count-cell.hooks.ts

```text
/**
 * @file The lazy per-row hit-count cell (SPEC-037 REQ-03), so `HitCountCell` in `Redirects.tsx` is
 * only markup.
 *
 * Extracted verbatim — same lazy-request gate, same query. `enabled` is what keeps this lazy: the
 * query is declared for every row but runs for none of them until the row's own "Load hits" button
 * is pressed, so a list of many rows never fires a synchronous burst of `/hits` requests.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/redirects` needs it.
 *
 * `port` is injected (see `redirects-port.hooks.ts`) — shared with `use-redirects.hooks.ts` and
 * `use-import-redirects-form.hooks.ts`, since all three read the same `/redirects` resource.
 *
 * `t` (2026-08-11, standing i18n rule): `HitCountCell` used to take `locale` as a prop from
 * `Redirects` and import `redirects-i18n`'s `t` directly — it now takes a bound `t` as a prop
 * instead. Deliberately NOT resolved via `useAdminLocale()` inside `useWiredHitCountCell` itself,
 * even though that's this file's usual `useWiredX` shape: `HitCountCell` renders ONCE PER TABLE
 * ROW, and `useAdminLocale()`'s underlying `loadLanguage()` is not memoized (see this same
 * screen's `use-redirects.hooks.ts` and `Database.tsx`'s own file header for the identical,
 * already-documented hazard) — N independent calls would mean N concurrent settings fetches for
 * one page load. `t` is instead resolved ONCE in `useWiredRedirects` and threaded down through
 * `Redirects.tsx` as a prop, same as `locale` always was here.
 */

/** `undefined` until the request resolves — a rule with zero recorded hits still resolves to
   *  `{ data: { hitCount: 0, ... } }`, matching `hits.ts`'s own "still 200s with hitCount: 0"
   *  contract, so the caller must branch on this being present, never on `hitCount`'s truthiness. */

/** Fires the lazy hits fetch by flipping the query's `enabled` gate. */

/** The same bound translator passed in — returned unchanged so a test asserting on
   *  `result.current.t` doesn't need to also hold onto the fake it passed in. See this file's
   *  header for why it arrives as a parameter rather than being resolved here. */

// `enabled` is what keeps this lazy: the query is declared for every row but

// runs for none of them until its own button is pressed, preserving the

// no-N+1-burst property without a manual imperative fetch.

/** Binds the real client — see `redirects-dependencies.hooks.ts`. The zero-argument-PLUS-`t` half
 *  of the `useX(dependencies)` / `useWiredX()` pair; `Redirects.tsx`'s `HitCountCell` composes this
 *  with the `t` it received as its own prop. See this file's header for why `t` is a parameter here
 *  rather than resolved via `useAdminLocale()` internally, unlike every other `useWiredX` in this
 *  feature. */
```

## hooks/use-import-redirects-form.hooks.ts

```text
/**
 * @file The bulk-import affordance (SPEC-037 REQ-04), so `ImportRedirectsForm` in `Redirects.tsx`
 * is only markup.
 *
 * Extracted verbatim — same client-side shape check (now `parseImportPayload` in `rules.ts`), same
 * mutation, same error precedence (parse error before request error). The `207` per-item
 * created/failed breakdown is surfaced directly and never collapsed into a single pass/fail toast —
 * a partial-batch failure is the route's own designed behavior, not an edge case.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/redirects` needs it.
 *
 * `port` is injected (see `redirects-port.hooks.ts`); `describeApiError` stays a direct import — it
 * is a pure error-message rule with no I/O, so per the pattern it is not part of the port (see
 * `redirects-port.hooks.ts`'s own doc comment).
 *
 * `t`/`locale` (2026-08-11, standing i18n rule): `ImportRedirectsForm` used to take `locale` as a
 * prop from `Redirects` and import `redirects-i18n` directly — it now takes bound `t`/raw `locale`
 * as props instead. Raw `locale` is threaded ALONGSIDE `t` because
 * `importRulesLabel`/`importResultSummary`/`createdLabel`/`failedItemLabel` (`redirects-i18n.tsx`)
 * all take `(locale, ...)` directly. Deliberately NOT resolved via `useAdminLocale()` inside
 * `useWiredImportRedirectsForm` itself — see `use-hit-count-cell.hooks.ts`'s identical reasoning
 * (this screen already resolves `locale`/`t` exactly once, in `useWiredRedirects`, specifically to
 * avoid duplicate un-memoized `loadLanguage()` fetches; a second independent resolution here would
 * undercut that even though this component only renders once, not once per row).
 */

/** Parse/shape error takes precedence over a request error — see the implementation below. */

/** The same bound translator passed in — returned unchanged, same shape as
   *  `use-hit-count-cell.hooks.ts`'s identical field. See this file's header. */

/** The same raw locale passed in — returned unchanged; several `redirects-i18n.tsx` helpers take
   *  `(locale, ...)` directly rather than a bound translator. See this file's header. */

// Client-side validation only — the JSON never reached the server, so this

// is not a request failure and does not belong in the mutation's `error`.

// Typed as the route's own shape, but the value is operator-pasted JSON

// that has only been checked for "is an array" — see `parseImportPayload` in `rules.ts`. The

// server is the validator here and reports per-item failures in its `207`; duplicating that

// schema client-side would be a second source of truth for it.

// Replaces the `onImported` callback the parent used to thread down purely

// so this form could refresh a list it does not own.

// A partial batch (the route's `207`) RESOLVES — it is a result to render,

// not a failure — so only a transport/route error lands in `catch`, where

// the mutation's own `error` already holds the message.

/* surfaced via `importRules.error` below */

/** Binds the real client — see `redirects-dependencies.hooks.ts`. The zero-argument-PLUS-`t`/
 *  `locale` half of the `useX(dependencies)` / `useWiredX()` pair; `Redirects.tsx`'s
 *  `ImportRedirectsForm` composes this with the `t`/`locale` it received as its own props. See this
 *  file's header for why they're parameters here rather than resolved via `useAdminLocale()`
 *  internally. */
```

