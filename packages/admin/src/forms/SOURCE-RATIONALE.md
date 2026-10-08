# Source rationale

Historical comments retained verbatim from the authoritative source working tree.
Active comments in the moved implementation describe its current ports and ownership.

## FormEditor.tsx

```text
// The allowlist hint occupied 98px of a 389px dialog; clamp long hints while keeping
// all explanatory text available to browser find and assistive technology.
/**
 * @file Form editor screen (SPEC-010 ui.spec.md §2.2-2.5/§3.2-3.5) — the `/admin/forms/:formId` route.
 * Internally composed of `FormFieldsEditor`, `FormSubmissions`, `FormSubmissionDetail` (single
 * flat file per this admin app's convention — same escape hatch ADR-PIPE-007 pre-approved for
 * `Settings.tsx`). `formId === "new"` renders the create form; the slug field is editable only
 * in that case (behavior.spec.md §1.1).
 *
 * Layout pass (forms-audit): this screen was flagged as the worst-looking surface in the admin —
 * every button rendered as the identical filled-primary orange (Save and the access-affecting
 * Disable toggle were visually indistinguishable), the Fields/Submissions tabs had `role="tab"`
 * semantics but zero visual tab styling, label text ran straight into its input with no gap, the
 * fields table had no horizontal-scroll escape hatch for its many columns, and none of it adapted
 * below desktop width. This pass moves the screen onto the shared page primitives `styles.css`
 * introduced for the Posts/Media canary pass (`.page`/`.page-header`/`.card`/`.field*`/
 * `.table-scroll`) plus a small new partial (`styles/forms.css`) for the tab strip and the
 * checkbox+label row those primitives don't cover. Layout/hierarchy/semantics only — no change to
 * data flow, API calls, or the guard below.
 *
 * Per-field CSS classes + HTML attributes (this pass): the field table was already at its column
 * budget (six columns, fixed-percentage `<colgroup>`, see `FormFieldsEditor`'s own comment below),
 * so two more free-text properties could not become two more columns. Each row instead gets a
 * seventh, narrow "MORE" column holding a vertical three-dot (⋮) trigger that opens
 * `FieldAttributesDialog` — a real native Jini modal (`.settings-dialog`, the
 * `Collections.tsx` `EditFieldsDialog` idiom), not a side panel, since the AI chat dock already
 * occupies the right edge of this app. The trigger reuses `RowMenu`'s (`@jini-ai/admin/react`) own
 * glyph markup verbatim (three `<circle>`s at increasing `cy`, i.e. stacked vertically — confirmed
 * from that component's own source, not assumed) and its `.row-menu-trigger` class (`styles.css`)
 * rather than drawing a second glyph, and its "MORE" column header — but is a plain button, not a
 * `RowMenu` instance — `RowMenu` models a dropdown of several actions (open it, THEN pick one), and
 * this is a single action ("open the modal"), so routing it through a one-item dropdown would cost
 * an extra click for no benefit. `styles/form-field-attrs.css` (imported above) is this dialog's
 * own partial, same self-imported-by-the-component precedent as `styles/select.css`/`Select.tsx`.
 *
 * The security-relevant half of this lives server-side, not here: `forms.ts`'s
 * `validateFieldDescriptors` is the real gate on attribute NAMES (a closed allowlist —
 * `ATTRIBUTE_NAME_PATTERN`), enforced identically for this admin UI and for `agent-tools.ts`'s
 * agent-facing schema. This file's own `ATTRIBUTE_NAME_PATTERN` constant (now in `rules.ts`) is a
 * disclosed duplicate for a fast, pre-save error message only (same pattern `Collections.tsx`'s
 * `validateFieldName`/`KEY_GRAMMAR` already uses) — it is never the authoritative check.
 *
 * ## Markup only
 *
 * Every component's state now lives in its own `hooks/use-<thing>.hooks.ts`; pure logic (field-list
 * transforms, tab-index math, the attribute allowlist check) lives in `rules.ts`.
 */
// ---------------------------------------------------------------------------
// Field attributes modal (per-field CSS classes + HTML attributes)
// ---------------------------------------------------------------------------
/** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
/** Translator closure — see `FormEditor()`'s own `t`. */
  // One dialog is ever open at a time (`editingAttrsIndex` gates a single instance below), so this
  // needs no per-instance disambiguation — unlike the attribute rows inside it, which are a real
  // repeated list and do need `buildAgentListHandles`'s uniqueness search. Not `useMemo`d: `rows` is
  // one field's own CSS-class/HTML-attribute rows (a handful at most), cheap enough that memoizing
  // it was not judged worth the added indirection.
/* Clamped to two lines rather than shortened. Measured in a real browser at this dialog's
            461px content width: the full text is 5 lines / 98px and the dialog 389px tall;
            collapsed it is 2 lines / 39px and the dialog 330px — a 59px reduction, and the
            explainer no longer outweighs the two inputs below it. Kept whole rather than trimmed
            because the allowlist half is the part a first-time user actually needs, and cutting it
            would leave `onclick` rejections unexplained. Two lines is also the natural break: the
            collapsed view ends after the Tailwind example, on a complete sentence. The
            attribute-name `<datalist>` below already communicates the allowlist implicitly by only
            offering valid names, so this paragraph is reinforcement, not the sole channel. */
/** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
/** Translator closure — see `FormEditor()`'s own `t`. */
  // Field ids are the form's own field vocabulary and are unique once saved, but a freshly-added
  // row starts with an empty id (see `rules.ts`'s `blankField`) — `buildAgentListHandles`'s
  // position fallback covers that case the same way it covers any other unsluggable id. Not
  // `useMemo`d: one form's own field list is small and this is an O(n) pass, cheap enough that
  // memoizing it was not judged worth the added indirection.
/* Fixed proportional column widths (`forms.css`'s `table-layout: fixed`) rather than the
            browser's default content-driven auto layout — every cell here holds a live, unstyled-
            width `<input>`/`<select>`, so auto layout let six of them each claim their own
            intrinsic ~180px, pushing the table to ~925px wide at a 640px viewport (measured before
            this fix) with no visible cue that "Max length"/Remove were still reachable by scrolling
            `.table-scroll`. Percentages sized to what each column actually holds: ID/Label get the
            most room since they're the fields an operator actually reads, Required/Max length the
            least since a checkbox and a short number never need more.

            A seventh "MORE" column (this pass) holds the vertical-kebab trigger for
            `FieldAttributesDialog` — sized the same 8% as Req, since it holds nothing but one
            30px round icon button and never needs more. Taken entirely out of the Remove column's
            own share (26% -> 18%) rather than shrinking any of the five text/control columns, so
            ID/Label/Type/Req/Max length keep the exact widths the 640px fix already measured and
            fixed. */
/* "Required" is one unbreakable word — at this column's necessarily checkbox-sized
                width it has nowhere to wrap to and was visibly overflowing into "Max length"'s own
                header. "Req" reads fine sitting directly above the checkbox it labels; the row
                cell's own `aria-label` ("Field N required", unchanged below) still says the full
                word for anyone not reading the visual header at all. */
/* "More" — the exact literal string `FormsList.tsx`'s own `RowMenu` column header
                uses (confirmed by reading that file, not just the rendered DOM); `.list-table th`
                (`styles.css`) uppercases it visually to "MORE", same as every other header in this
                table (e.g. "Max length" above renders as "MAX LENGTH"). */
/* Reuses `RowMenu`'s (`@jini-ai/admin/react`) own kebab glyph and
                      `.row-menu-trigger` class (`styles.css`) rather than drawing a second kebab —
                      see this file's header comment for why this is a plain button (single action)
                      instead of a `RowMenu` instance (which models a dropdown of several). */
/** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
/** Translator closure — see `FormEditor()`'s own `t`. */
    // `form-submission-detail` (`styles/forms.css`) — the back button, table, and Delete button
    // were flush siblings with no gap between them (owner: "pad the buttons"), so the back
    // button sat right on top of the table and Delete sat right underneath it. Same
    // flex-column-plus-gap idiom `.field-group` already uses elsewhere for vertical rhythm,
    // rather than one-off margins on each button.
/** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
/** Translator closure — see `FormEditor()`'s own `t`. */
          // No `load()` call here anymore — `useFormSubmissionDetail`'s delete mutation now
          // `invalidates: [KEYS.submissionsList(formId)]` itself, so the list refreshes on its own.
          // This callback only owns the UI-navigation concern (back to the plain list).
  // Submission ids are stable and unique, so they're what disambiguates one row's "View" button
  // from another's — same reasoning as every other list on this workstream. Not `useMemo`d:
  // computed after the three early returns above, so a `useMemo` here would need hoisting above
  // them to keep hook order stable across renders — same constraint `Media.tsx` documents for its
  // own post-early-return computation. `submissions` grows only on an explicit "Load more" click
  // (`use-form-submissions.hooks.ts`'s cursor-append), so this O(n) pass tracks real data changes,
  // not incidental re-renders.
/** Which tab is active, derived from the route by `panels.tsx` (`/forms/:formId` -> `"fields"`,
   *  `/forms/:formId/submissions` -> `"submissions"`) — ADR-063. Ignored while `isNew`/tabs aren't
   *  shown. */
/** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
/** The name/slug fields, the field-definition table, and the status-toggle/save action row —
 * shared verbatim between the "new form" view (no tabs) and the
 * "existing form, Fields tab" view (see `FormEditor`'s own `fieldsBody` comment for why it's one
 * JSX value rather than two copies). Split into its own top-level component, not just a local
 * `const`, because a `const` assigned inside `FormEditor` still executes in that function's own
 * scope — every branch inside it would still count toward `FormEditor`'s own complexity score. */
/** Translator closure — see `FormEditor()`'s own `t`. */
/* `form-actions` is a spacing-only hook layered on top of the shared `.editor-actions`
          flex row. `.editor-actions` sets direction/gap/alignment but no top margin, and this row
          is not a `.field-group`, so the `.field-group + .field-group` rhythm that separates every
          other block on this screen skips it — leaving Disable/Save flush against the Recipients
          input. Fixed here rather than by adding a margin to `.editor-actions` itself, because that
          class is shared with the other editor screens and a global change would shift spacing on
          screens nobody has looked at yet. */
          // Reversible-but-access-affecting (turns off the live site's ability to accept
          // submissions through this form) — `.btn-warning`, not `.btn-danger`: nothing is
          // deleted, and the same control flips right back to "Enable". Re-enabling is the safe
          // direction, so it stays `.btn-secondary` rather than inheriting the warning look.
/** The page-header title/description text — split out because `FormEditor`'s isNew-dependent copy
 * (two ternaries, one with a `||` fallback) is otherwise indistinguishable, in the complexity
 * count, from the branches that actually decide what's on screen. */
/** The Fields/Submissions tab strip — renders only for an existing, loaded form (`showTabs`). */
/** Translator closure — see `FormEditor()`'s own `t`. */
/** Which card is showing below the tab strip: the fields form (always for `isNew`, or when the
 * Fields tab is active) or the submissions table. */
/** Translator closure — see `FormEditor()`'s own `t`. */
  // Previously this was the ONLY guard, and it only covers the pre-error case — once the load
  // failed and set `error`, `!error` here goes false and rendering fell through to the full,
  // empty, live-saveable editor below (audit blocker, exec summary #3: a bogus form id showed
  // "form definition 'X' was not found" AND a working Save button underneath it). This guard is
  // safe to add as a second, separate check rather than merging into the one above: it only fires
  // while `form` is still null, so a load failure has to happen before the form ever loaded —
  // once `form` is set, it stays set, so a LATER failure (e.g. a failed Save) never re-enters
  // this branch and never blanks a screen the operator is already editing (same "a later failure
  // must not erase what already rendered" principle as `Pages.tsx`/`Posts.tsx`'s `error && !data`
  // guard — see `CollectionEntryEditor.tsx`'s sequential loading → not-found guards for the
  // reference shape this now matches).
  // Shared between the "new form" (no tabs, always visible) and "existing form, Fields tab"
  // views — kept as one JSX value instead of two copies so the two paths can't drift.
/* `page-header-split` (the same modifier `PageEditorHeader`/`PostEditor` use on the shared
          `.page-header`, `styles.css`) — back link alone at the far left, title block centred.
          Forms has no Save/Delete group living in this header (that's inside the fields panel
          below), so the header's third rail just stays empty, same as the editors' post-move
          state. */
/* Plain `<a className="btn-secondary">`, not a `<button>` nested inside an `<a>`
              (invalid HTML, undefined activation behaviour) — same `a.btn-*` mechanism
              `Dashboard.tsx`'s "View site ↗" already uses. Arrow sits outside `t()`, matching
              `FormSubmissionDetail`'s own `&larr; {t("Back")}` below — the glyph is not part of
              the translated string, so no locale block needs to change.

              Visible label shortened to a plain "← Back" (owner, 2026-09-22 — every editor's back
              button reads the same short way now). The destination stays legible: `aria-label`
              carries the full "Back to forms" phrase for screen readers, and `agentHandle`'s own
              `label` (a stable, untranslated identifier — never live text, see `handle.ts`) already
              said "Back to the list of all forms" for agents, unchanged by this. */
```

## FormsList.tsx

```text
/**
 * @file Forms list screen (SPEC-010 ui.spec.md §2.1/§3.1) — the `/admin/forms` route.
 * Mirrors `Menus.tsx`/`Posts.tsx`'s fetch/loading/error/table convention. Layout now follows the
 * Posts/Media page-primitive pass (`.page`/`.page-header`/`.card`/`.table-scroll`/`.empty-state`,
 * see `styles.css`) instead of the bare `.editor-header` this screen used before — see
 * `FormEditor.tsx`'s file comment for the fuller rationale (both screens were audited together).
 *
 * Row actions: `Posts.tsx`/`Pages.tsx`'s `RowMenu` pattern, INCLUDING a Delete item (T7a,
 * 2026-09-21) — `api.ts`'s generic `trash` route (`POST /trash/items`, `type: "form"`) now covers
 * forms, so there is a server capability to wire. Reached through `RowMenu`'s "Delete" ->
 * `ConfirmDialog` ("Move to trash?") -> `useFormsList`'s `removeForm`, the same three-step gate
 * `Posts.tsx`/`Pages.tsx` already use for their own row deletes; see `use-forms-list.hooks.ts`'s own
 * doc for why a click alone can never delete. What ALSO exists (unchanged by this pass) is
 * `api.updateForm`'s `status` patch, the exact call `FormEditor.tsx`'s own Disable/Enable button
 * already makes — surfaced here too so an operator doesn't have to open the editor just to toggle
 * it. That action stays un-confirmed: `FormEditor.tsx` treats it as reversible either direction (no
 * confirm step there either), so this list doesn't invent a heavier gate the editor itself doesn't
 * have. `.btn-warning`'s tone applies only going active -> disabled, same asymmetry as
 * `FormEditor.tsx`'s "Re-enabling is the safe direction" comment.
 *
 * ## Markup only
 *
 * State, the load effect, and the `api.*` calls live in `hooks/use-forms-list.hooks.ts`. That hook
 * was written during the hooks extraction but never wired — this component kept a byte-identical
 * inline copy of the same logic, so the hook was dead code and this screen was never actually
 * markup-only. Wired here; the duplicate is gone. The two copies had NOT drifted, so this is a
 * pure de-duplication with no behaviour change.
 */
/**
   * Dependency injection seam for tests — see `RedirectsProps.useRedirectsHook` for the
   * convention. Defaulted to the real hook, so `panels.tsx` passes nothing.
   */
  // Form ids are stable and unique, so they disambiguate one row's edit link from another's —
  // same reasoning as every other list on this workstream. Each row's "Actions" menu (Edit/Disable/
  // Enable via `RowMenu`) shares this same per-row base (`${rowHandles[index]}-menu`) now that
  // `RowMenu` (`@jini-ai/admin/react`) accepts an `agentHandle` prop — before this session it
  // published none, so its trigger and dropdown items were invisible to `page.find_elements`
  // regardless of what this file did. The Disable/Enable action also stays reachable another way:
  // `FormEditor.tsx`'s own status toggle (`form-editor-status-toggle`) does the identical
  // `api.updateForm({ status })` call.
/* Plain `<a className="btn-primary">`, not a `<button>` nested inside an `<a>` (invalid
              HTML, undefined activation behaviour) — same `a.btn-*` mechanism `Dashboard.tsx`'s
              "View site ↗" already uses. */
            // One `<time>` per line (created, then updated — or one line when never edited). The
            // visible text is the bare short date; the event word lives in the hover title and the
            // screen-reader text only, since the header already names both events.
```

## hooks/form-submissions-dependencies.hooks.ts

```text
/**
 * @file The only place under `features/forms/hooks` that reaches `lib/api` for submission
 * routes — see `form-submissions-port.hooks.ts` for why the split exists.
 */
/** The live implementation, as a module-level singleton — matches `redirects-dependencies.hooks.ts`'s
 *  `defaultRedirectsPort`.
 *
 * Submission removal (T7a, 2026-09-21) routes through the generic `POST /trash/items`
 * (`type: "form_submission"`) endpoint, which moves the item to Trash. The feature's port keeps
 * its existing boundary; only the wire call changed. */
/** Seed state for {@link createFakeFormSubmissionsPort}. */
/**
 * An in-memory {@link FormSubmissionsPort} for tests — the fake that lets a test describe "this
 * form has these submissions" or "the delete fails" directly, instead of hand-building fetch
 * `Response`s. Shipped alongside the real binding per the pattern's "every port gets a fake" rule
 * (see `assistant-chats-dependencies.hooks.ts`).
 *
 * `listFormSubmissions` ignores `cursor`/`limit` and returns the full seeded list with
 * `nextCursor: null` — none of this feature's existing behavior tests a multi-page cursor walk, so
 * a fake pagination implementation would be untested surface, not a simplification.
 */
/** Every submission currently in the fake's store, in list order. */
```

## hooks/form-submissions-port.hooks.ts

```text
/**
 * @file What `useFormSubmissions` and `useFormSubmissionDetail` need from the outside world, as an
 * interface rather than a direct `lib/api` import.
 *
 * A separate port from `forms-port.hooks.ts` rather than folding in: submissions are a distinct
 * sub-resource (`AdminFormSubmission`, not `AdminFormDefinition`) with no method overlap with form
 * CRUD. Shared between these two hooks because both read/write the SAME submissions list for a
 * form — `useFormSubmissions` lists it, `useFormSubmissionDetail` deletes one row from it — the
 * same "genuinely matches" shape `redirects-port.hooks.ts` names for its own three hooks.
 */
```

## hooks/forms-dependencies.hooks.ts

```text
/**
 * @file The only place under `features/forms/hooks` that reaches `lib/api` for form-definition
 * CRUD — see `forms-port.hooks.ts` for why the split exists.
 */
/** The live implementation, as a module-level singleton — matches `redirects-dependencies.hooks.ts`'s
 *  `defaultRedirectsPort`. */
/** Seed state for {@link createFakeFormsPort}. */
/** What `getMailStatus` reports; defaults to `true` (a real mailer is configured). */
/**
 * An in-memory {@link FormsPort} for tests — the fake that lets a test describe "this form
 * exists" or "the save fails" directly, instead of hand-building fetch `Response`s. Shipped
 * alongside the real binding per the pattern's "every port gets a fake" rule (see
 * `assistant-chats-dependencies.hooks.ts`).
 */
/** Every form currently in the fake's store, in list order. */
      // Slug-or-id, mirroring the real GET route's own resolution (ui-fixes-backlog.md #8,
      // `get-by-id.ts`) — a test seeding by slug (the admin URL's new shape) needs this fake to
      // resolve it the same way the server does, not just the legacy id.
```

## hooks/forms-port.hooks.ts

```text
/**
 * @file What `useFormEditor` and `useFormsList` need from the outside world, as an interface
 * rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) and already applied to `features/redirects` and
 * `features/pages`: this file declares, `forms-dependencies.hooks.ts` binds the real `api` client,
 * and nothing else under `features/forms/hooks` imports `lib/api` for these four routes.
 *
 * One shared port rather than two overlapping ones — `useFormEditor` and `useFormsList` both read
 * and write the SAME `AdminFormDefinition` resource (both call `updateForm`: `useFormsList` for its
 * row status toggle, `useFormEditor` for both its save and its own status toggle), the same
 * "genuinely matches" case `redirects-port.hooks.ts` names for its own three hooks. Deliberately
 * NOT shared with `form-submissions-port.hooks.ts` — submissions are a different sub-resource with
 * no method overlap; see that port's own doc comment.
 */
/** Moves a form to the Trash via the generic `POST /trash/items` route (`type: "form"`) — see
   *  `api.ts`'s `trash` doc comment for why this is the shared route rather than a form-specific
   *  delete endpoint. `useFormsList`'s `removeForm` is the one caller. */
/** Whether the site can actually send email — `useFormEditor` greys out the notify settings
   *  when it cannot. */
```

## hooks/use-field-attributes-dialog.hooks.ts

```text
/**
 * @file `FieldAttributesDialog`'s own state and submit action (per-field CSS classes + HTML
 * attributes), so the dialog in `FormEditor.tsx` is only markup.
 *
 * Extracted verbatim — same state, same validation, same error strings. Draft-row editing and the
 * validate/shape step now live in `rules.ts` (`updateAttrRow`/`removeAttrRow`/`addAttrRow`,
 * `buildFieldAttributesPatch`).
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it. The former Escape helper was likewise feature-local
 * because only this dialog needed it; Jini now owns that shared modal behavior, so the helper
 * and its document subscription are superseded rather than promoted to another local owner.
 */
```

## hooks/use-form-editor.hooks.ts

```text
/**
 * @file Everything the FormEditor SCREEN does — load, save, status toggle, and the Fields/
 * Submissions tab strip's roving-tabindex focus management — so `FormEditor`'s exported component
 * in `FormEditor.tsx` is only markup.
 *
 * Extracted verbatim — same load effect, same save/status-toggle error strings, same "later failure
 * keeps the editor on screen" guard (the audit-blocker fix this screen's file header describes —
 * see `FormEditor.tsx`'s own header for the full rationale, which stays with the guard in the view
 * since it describes render behaviour, not this hook's state).
 *
 * `tab` (ADR-063, 2026-08-31): no longer local state — it is `props.tab`, derived from the route
 * (`/forms/:formId` vs `/forms/:formId/submissions`) by `panels.tsx`/`FormEditor.tsx`. Switching
 * tabs calls the injected `navigate` (real app router), the same idiom `Deployment.tsx`'s tab strip
 * uses, rather than a local `setTab` — Submissions has its own independent fetch, so a tab switch
 * is a genuine route change, not a display-layer filter over data already in hand.
 *
 * `tabRefs` moves here too, per Pattern 1 (every `useRef` moves with state/effects, not just
 * `useState`) — the view still attaches each button via its own `ref` callback (an unavoidably
 * DOM-side operation), but the ref array itself and the keydown-to-focus-change logic
 * (`onTabsKeyDown`) are behaviour, not markup.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 *
 * `port`/`navigate` are injected — see `forms-port.hooks.ts` (shared with `use-forms-list.hooks.ts`,
 * since both read/write the same `AdminFormDefinition` resource) — rather than reaching `lib/api`/
 * `lib/router` directly, so a test can describe load/save outcomes against `createFakeFormsPort`
 * instead of stubbing global `fetch`. `useWiredFormEditor` below is the zero-argument pair
 * `FormEditor.tsx` actually mounts.
 *
 * `t` (standing i18n rule — a component with a hook gets a BOUND `t` from that hook, not its own
 * `useAdminLocale()`/dictionary import, same shape `use-post-editor.hooks.ts` established for this
 * conversion): injected alongside `port`/`navigate` because `FormEditor.tsx` itself (the copy
 * around this hook's own state — tab labels, Save button, etc.) DOES need translated strings, even
 * though this hook's own error messages don't. Pre-bound to `(key: string) => string`.
 * `useAdminLocale()` and `FORMS_DICT` are called/read only inside {@link useWiredFormEditor}.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the load is one `useFetchQuery` keyed on
 * `KEYS.form(formId)` (disabled for `isNew`, matching the original `if (isNew) return;` early-out).
 * `form`/`name`/`slug`/`fields`/`notify` stay local `useState` — the operator edits `name`/`slug`/
 * `fields`; `notify` has no UI of its own (owner ask 2026-09-22 removed the notify checkbox/
 * recipients input — see this file's own `notify` state comment) and is only ever carried through
 * unchanged. All are seeded from `list.data` exactly once per `formId` via `seededFormIdRef`, the
 * same shape `collections/hooks/use-collection-entry-editor.hooks.ts`'s `seededIdentityRef`
 * establishes (see that file's header for the regression it guards against: a background refetch of
 * the SAME identity must not clobber in-progress edits). `handleSave`/`handleStatusToggle` set `form`
 * (and, for save, the rest of the seeded fields) directly from each MUTATION's own response, and
 * neither mutation invalidates this hook's OWN `KEYS.form(formId)` read (only the sibling
 * `KEYS.list`) — mirroring `save()`/`toggleLifecycle()` in that same collections hook, which
 * invalidate only the sibling `KEYS.entries(...)`, never their own `KEYS.entry(...)`, for the
 * identical reason: a response already in hand needs no redundant background refetch of itself. This
 * eliminates the load race an external audit flagged at this file's old line 117 (`useEffect(load,
 * [props.formId, port])` with no cancellation guard, so a formId change mid-flight could commit a
 * stale response): a keyed query cannot commit a response belonging to a prior key, by construction.
 */
/** `null` until the initial load settles (or always, for `isNew`) — the caller renders a loading
   *  state or the empty create form accordingly. */
/** Navigates to this form's Fields or Submissions route — real `navigate()`, not local state
   *  (ADR-063: Submissions has its own independent fetch, so a tab switch is a genuine route
   *  change, the same idiom `Deployment.tsx`'s tab strip uses). Pushes a history entry (no
   *  `replace`) so browser back/forward move naturally between the two routes, unlike the
   *  `?tab=` screens' `replace: true` view-filter switches. */
/** Already-persisted field ids on the loaded form — see `existingFieldIdsOf`. */
/** Tabs render only for an existing, loaded form — never for `isNew`, and never before `form`
   *  has loaded. */
/** Per-tab-button refs, indexed the same as `FORM_TABS` — attach via each button's own `ref`
   *  callback in the view. */
/** Roving-tabindex keydown handler for the tablist `<div>` — ArrowLeft/ArrowRight/Home/End move
   *  both the selected tab and DOM focus together. */
/** Bound translator — see this file's own header for why it arrives via the hook rather than
   *  `FormEditor.tsx` calling `useAdminLocale()`/`FORMS_DICT` directly. */
  // No UI edits this (owner ask 2026-09-22 removed the notify checkbox/recipients input from the
  // Fields tab — a future outside mail integration will design its own way to set it). Seeded from
  // the loaded form and carried through unchanged on every save, so an operator saving a form never
  // wipes out a `notify` setting that predates this UI removal. Stays local `useState`, not a
  // `const`, only so `handleSave`'s existing-form branch can resync it from the write's own response
  // exactly like `form`/`name`/`slug`/`fields` already do below.
  // Roving-tabindex focus targets for the tab strip below, indexed the same as `FORM_TABS` — see
  // `nextTabIndex`'s doc comment for why the index math itself lives outside the component.
  // Seeds `form`/`name`/`slug`/`fields`/`notify` from `list.data` exactly once per `formId` — see
  // this file's own header for the regression this guards against (a background refetch of the SAME
  // formId must not clobber in-progress edits).
  // None of these invalidate `KEYS.form(props.formId)` — only `KEYS.list`. `handleSave`/
  // `handleStatusToggle` below already set `form` (and, for save, the rest of the seeded fields)
  // directly from each mutation's own response, so invalidating this hook's OWN read key would only
  // buy a redundant background refetch of data already in hand — the same reasoning
  // `use-collection-entry-editor.hooks.ts`'s `save()`/`toggleLifecycle()` document for why THEIR
  // `invalidates` names only the sibling `KEYS.entries(...)`, never their own `KEYS.entry(...)`.
      // Targets the loaded record's real id, never `props.formId` directly — the admin URL now
      // carries the form's slug when one resolves (ui-fixes-backlog.md #8), so `props.formId` may
      // itself BE that slug. `form.id` is always the real id regardless of which one the URL held,
      // which is what lets the PUT route stay id-only (no matching slug support needed — see
      // `get-by-id.ts`'s own comment on why only the GET route resolves either). The `?? props
      // .formId` fallback only matters if this ever fired before `form` loaded, which it can't:
      // `FormEditor.tsx`'s `!isNew && !form` guards keep the whole editor (Save button included)
      // off-screen until `form` is set.
    // Ordinary Builder saves keep their existing endpoint/permissions. A mode change is explicit.
        // `notify` here is always this hook's own blank default — a new form has no earlier value
        // to carry through, and there is no UI on this screen to set one instead.
        // Slug, not id — see this hook's own file header / `get-by-id.ts` for the id-or-slug
        // resolution this now lands on (ui-fixes-backlog.md #8).
        // `notify` is the value this hook seeded from the loaded form and has never changed since —
        // sent back unchanged so saving name/slug/field edits can never wipe a stored notify setting
        // (see this hook's own `notify` state comment).
        // Set directly from the write's own response — `updateMutation` doesn't invalidate this
        // hook's own `KEYS.form(id)` read (see the mutations' own comment above), so there is no
        // background refetch to wait for or to accidentally clobber an in-progress edit with.
        // Mirrors `use-collection-entry-editor.hooks.ts`'s `save()`.
      // already surfaced through updateMutation.error/createMutation.error -> error below
      // already surfaced through statusMutation.error -> error below
  // Navigates to `/forms/:formId` or `/forms/:formId/submissions` (ADR-063) — `panels.tsx`'s
  // `forms` panel keys `FormEditor` off `ctx.params.formId` on BOTH routes, so this is a route
  // change, not a remount: in-progress Fields edits survive a trip to Submissions and back.
/**
 * Binds the real `/api/.../forms` client, `lib/router`'s `navigate`, and a `FORMS_DICT`-bound
 * translator — see `forms-dependencies.hooks.ts`.
 *
 * The zero-argument-deps half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `FormEditor.tsx` composes this and a test composes {@link useFormEditor} with
 * `createFakeFormsPort`, a fake `navigate`, and a fake `t`.
 */
```

## hooks/use-form-fields-editor.hooks.ts

```text
/**
 * @file `FormFieldsEditor`'s own state (which row's attributes modal is open, plus the per-row
 * kebab-trigger refs for WCAG focus-return), so the fields table in `FormEditor.tsx` is only
 * markup.
 *
 * Extracted verbatim, including the `useRef` array — `Pattern 1` moves every `useRef` out of the
 * component along with state/effects, not just `useState`. The field-list edits themselves
 * (`updateField`/`addField`/`removeField`) are thin wrappers around `rules.ts`'s pure array
 * transforms, applied through the parent-owned `onChange` (this component does not own `fields`
 * itself — `FormEditor`'s own `fields` state does).
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 */
/** Which field's `FieldAttributesDialog` is open, by index — `null` when none is. */
/** Closes the attributes dialog and returns focus to the kebab trigger that opened it (WCAG 2.1
   *  AA "focus returns to trigger element when modal closes"). */
/** Per-row kebab-trigger refs, indexed the same as `fields` — attach via each row's own `ref`
   *  callback in the view. */
```

## hooks/use-form-submission-date.hooks.ts

```text
/** Bind submission timestamps to the same operator locale and local time as the Forms list. */
  // One locale subscription per submissions panel, rather than one per timestamp cell.
```

## hooks/use-form-submission-detail.hooks.ts

```text
/**
 * @file `FormSubmissionDetail`'s own state and delete action, so the detail view in
 * `FormEditor.tsx` is only markup.
 *
 * Permanent delete now confirms through a modal (S5 fix, 2026-09-20), not an inline two-click
 * button: the old `confirming`/`handleDelete` shape flipped a click's own label to "Confirm
 * delete", so a real double-click deleted the submission outright with no way to back out — the
 * same bug widgets' `trashOrPurge` had before its own `pendingPurge`/`ConfirmDialog` fix. This
 * hook now mirrors that shape one-for-one: `requestDelete` only opens the dialog (no network),
 * `cancelDelete` closes it with no request, and `confirmDelete` runs the mutation.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 *
 * `port` is injected — see `form-submissions-port.hooks.ts` (shared with `use-form-
 * submissions.hooks.ts`, since both read/write the same submissions list for a form) — rather than
 * importing `lib/api` directly, so a test can describe load/delete outcomes against
 * `createFakeFormSubmissionsPort` instead of stubbing global `fetch`.
 * `useWiredFormSubmissionDetail` below is the zero-argument pair `FormEditor.tsx` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the load is one `useFetchQuery` keyed on
 * `KEYS.submissionDetail(formId, submissionId)` — a query cannot commit a response belonging to a
 * prior key, which eliminates the load race an external audit flagged at this file's old line 48
 * (a plain `.then()`/`.catch()` effect with no cancellation guard) by construction. `confirmDelete`
 * is a `useFetchMutation` that `invalidates: [KEYS.submissionsList(formId)]`, so the sibling list
 * (`use-form-submissions.hooks.ts`) refreshes on its own — `props.onDeleted()` now only needs to
 * clear the caller's `selectedId` (a UI-navigation concern this hook can't own), not also trigger a
 * reload, so `FormEditor.tsx`'s `onDeleted` callback drops its own `load()` call.
 */
/** `null` until the initial load settles — the caller renders a loading state. */
/** True while the "Delete permanently?" confirm dialog should be open — opened by
   *  {@link FormSubmissionDetailController.requestDelete}, closed by
   *  {@link FormSubmissionDetailController.cancelDelete} or once
   *  {@link FormSubmissionDetailController.confirmDelete} settles. */
/** Opens the confirm dialog. No network call — a click alone can never delete. */
/** Closes the confirm dialog with no request. */
/** Runs the delete. On success, calls `props.onDeleted()`. Closes the dialog in `finally`
   *  either way, so a failed delete doesn't leave the operator stuck behind it — the failure is
   *  still visible via `error` below. */
/** Bound translator — see `use-forms-list.hooks.ts`'s own header for why this arrives via
     *  injection rather than this hook calling `useAdminLocale()` itself. Optional (defaults to
     *  identity) so existing callers/tests that don't pass one keep seeing the raw English copy. */
/** T7a (2026-09-21): the confirmation mutation moves the submission to Trash through the generic
   *  `POST /trash/items` endpoint — see `form-submissions-dependencies.hooks.ts`'s own doc. A 404
   *  (`describeTrashError`'s `alreadyGone`) means the submission is already gone: from
   *  the operator's point of view that's the same outcome as a successful delete, so this still calls
   *  `onDeleted()` and invalidates the list directly — `deleteMutation`'s own `invalidates` only fires
   *  on success, and a failed mutation would otherwise leave the sibling list showing a row that's
   *  already gone. */
      // otherwise: already surfaced through deleteMutation.error -> error below
  // The delete's own failure outranks a background load-refresh failure — flat `if`s rather than a
  // nested ternary, per `@jini-ai/ui/fetch-query`'s `resolveFetchQueryStatus` doc on why the two carry
  // a different complexity-gate weight for the same branch count.
/**
 * Binds the real `/api/.../forms/:id/submissions` client — see
 * `form-submissions-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `FormEditor.tsx`
 * composes this and a test composes {@link useFormSubmissionDetail} with
 * `createFakeFormSubmissionsPort`.
 */
```

## hooks/use-form-submissions.hooks.ts

```text
/**
 * @file `FormSubmissions`'s own state and paginated load, so the submissions list in
 * `FormEditor.tsx` is only markup.
 *
 * Extracted verbatim — same cursor-append load shape, same error strings. `load` keeps its original
 * `(cursor?: string) => void` signature rather than being split into separate "load"/"loadMore"
 * functions, so both call sites (`load(nextCursor)` for "Load more", `load()` after a submission
 * delete) carry over unchanged.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 *
 * `port` is injected — see `form-submissions-port.hooks.ts` (shared with `use-form-submission-
 * detail.hooks.ts`, since both read/write the same submissions list for a form) — rather than
 * importing `lib/api` directly, so a test can describe list outcomes against
 * `createFakeFormSubmissionsPort` instead of stubbing global `fetch`. `useWiredFormSubmissions`
 * below is the zero-argument pair `FormEditor.tsx` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the FIRST page is one `useFetchQuery` keyed on
 * `KEYS.submissionsList(formId)` — a query cannot commit a response belonging to a prior key, which
 * eliminates the load race an external audit flagged at this file's old line 56 (a plain
 * `.then()`/`.catch()` effect with no cancellation guard) for that page. Subsequent "Load more"
 * pages are NOT folded into that same query: `@jini-ai/ui/fetch-query`'s `QueryKey` doc binds one
 * hook to one FIXED key, and a cursor-appended page list is exactly the "moving-target key" shape
 * that doc's own Skip precedent (`useSettingsContainer`, see this migration's dispatch brief) warns
 * against faking — so accumulated pages stay local `useState`, fetched directly through `port`
 * (bypassing the cache, since an appended page is not a cacheable "the current state of X", it's an
 * accumulating view built by this one screen). `pageSettlement` (`useSettlementGeneration`) guards
 * that accumulation against the SAME class of race the base query gets for free: a `loadMore` in
 * flight when `formId` changes, or when a first-page refetch (e.g. a delete's invalidate) resets
 * the list, must not append its page once it resolves — see `resetMorePages` below, which mints a
 * fresh generation on every reset so any older in-flight page fetch is superseded. A synchronous
 * `loadingMoreRef` lock, checked before minting a generation, covers the other half: two `loadMore`
 * calls issued in the SAME tick (a double click) must send only one request
 * (2026-09-20, `plan-content2.md` #3/#5/S2).
 *
 * The audit's second, more serious finding at this file — `selectedId` surviving a `formId` change
 * untouched, so a delete could fire against a submission id belonging to the PREVIOUS form while its
 * stale rows were still on screen — is fixed by the identity-reset effect below, which clears both
 * `selectedId` and the accumulated "more" pages whenever `formId` changes.
 */
/** `null` until the initial load settles — the caller renders a loading state. */
/** The submission `FormSubmissions` is showing `FormSubmissionDetail` for — `null` shows the
   *  plain list. */
/** Re-fetches. Passing a cursor appends to `submissions`; omitting it replaces the list from the
   *  start (used after a submission is deleted, so the list reflects the removal). */
/** True while a "Load more" page fetch is in flight — drives the button's `disabled` and
   *  "Loading…" label in `FormEditor.tsx`. */
  // The "latest call wins" guard for accumulated pages — see the file header. `loadingMoreRef` is
  // the synchronous half (blocks a same-tick double `loadMore`); `pageSettlement` is the async half
  // (a superseded fetch's response must not land once a reset or a form switch has moved on).
  // Supersedes any in-flight "Load more" fetch and clears the accumulated pages/cursor/error back
  // to "just the first page" — called wherever the previous code did a bare `setMorePages([])`, so
  // there is one reset path instead of three ad hoc ones.
  // One effect, not two: the identity reset below fixes the audit's data-loss finding at this
  // file — `selectedId` used to survive a `formId` change untouched, so a delete could fire
  // against a submission id belonging to the PREVIOUS form while its stale rows were still on
  // screen. `resetMorePages()` drops accumulated "more" pages, which belong to the previous form's
  // cursor walk, and supersedes any of that form's `loadMore` still in flight.
  // S2 fix: a refetched first page (e.g. S5's delete invalidating the list) must drop the "more"
  // pages it used to leave stale — they are always a continuation of the CURRENT first page, not
  // whichever first page was on screen when they were fetched. `resetMorePages()` also supersedes
  // any `loadMore` already in flight when the refetch lands, so its page can't append afterward.
      // A superseded call's lock was already released by `resetMorePages`; only the still-current
      // call releases it here.
/** Passing a cursor appends via `loadMore`; omitting it re-reads the first page from scratch
   *  (used after a submission delete, so the list reflects the removal) and drops accumulated pages,
   *  matching the pre-migration `load()`'s own "no cursor replaces everything" behavior. */
/**
 * Binds the real `/api/.../forms/:id/submissions` client — see
 * `form-submissions-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `FormEditor.tsx`
 * composes this and a test composes {@link useFormSubmissions} with
 * `createFakeFormSubmissionsPort`.
 */
```

## hooks/use-forms-list.hooks.ts

```text
/**
 * @file Everything the Forms LIST does, so `FormsList.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error strings. Naming follows
 * `hooks/use-settings-slice.hooks.ts` and `hooks/use-dirty-guard.hooks.ts`: `use-<thing>.hooks.ts`.
 * Feature-local because nothing outside `features/forms` needs it; promote to `src/hooks/` only
 * when a second feature actually does.
 *
 * `port` is injected — see `forms-port.hooks.ts` (shared with `use-form-editor.hooks.ts`, since
 * both read/write the same `AdminFormDefinition` resource) — rather than importing `lib/api`
 * directly, so a test can describe list/write outcomes against `createFakeFormsPort` instead of
 * stubbing global `fetch`. `useWiredFormsList` below is the zero-argument pair `FormsList.tsx`
 * actually mounts.
 *
 * `t` (standing i18n rule — a component with a hook gets a BOUND `t` from that hook, not its own
 * `useAdminLocale()`/dictionary import, same shape `use-post-editor.hooks.ts` established for this
 * conversion): injected alongside `port` rather than `FormsList.tsx` importing `useAdminLocale`
 * and `FORMS_DICT` itself. Pre-bound to `(key: string) => string` so a test can inject
 * `t: (k) => k` and every assertion stays stable against copy changes. `useAdminLocale()` and
 * `FORMS_DICT` are called/read only inside {@link useWiredFormsList}.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `toggleStatus` is one `useFetchMutation` that
 * `invalidates: [KEYS.list]` — same idiom `use-taxonomy.hooks.ts`'s deletes use, so this list stays
 * in sync with a status change made from `FormEditor.tsx` too (a `KEYS.list`-invalidating write
 * elsewhere in the app, not just this screen's own toggle). This DOES cost one extra background GET
 * per toggle that the pre-migration `setForms((prev) => prev.map(...))` optimistic patch avoided —
 * a deliberate trade for cross-screen consistency (`@jini-ai/ui/fetch-query`'s own header names
 * this exact "two screens showing the same resource silently drift apart" bug as the reason the
 * library exists at all); `FormsList.unit.test.tsx`'s old "only one GET" assertion is updated
 * accordingly, not preserved. `rowSavingId` stays local `useState` rather than reading off the
 * mutation directly — one shared `useFetchMutation` object has no per-call "which row" of its own,
 * the exact case this migration's own dispatch brief calls out as the intended `useState` out.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass, see that hook's own header):
 * `forms_create_definition`/`forms_update_definition`/`forms_set_definition_status`
 * (`apps/website/src/features/forms/agent-tools.ts`) are agent-callable, so this list re-invalidates
 * `KEYS.list` on an out-of-band content-refresh notification the same way `use-taxonomy.hooks.ts`
 * does for its own resource.
 */
/** The "Created / Updated" cell's one or two lines — see `rules.ts`'s `formDatesLines`. */
/** In-flight row action (status toggle, or the confirmed delete) — one at a time, same
   *  `rowSavingId` convention `Posts.tsx`/`Pages.tsx` use for their own row actions. Shared between
   *  {@link FormsListController.toggleStatus} and {@link FormsListController.removeForm} so a
   *  Disable click and a Delete confirm on two different rows can never race each other. */
/** No-op while a previous call is still in flight (`rowSavingId` set) — see this function's own
   *  comment; the caller never has to guard against a double toggle itself. */
/** The form a `RowMenu` "Delete" selection is asking to confirm; `null` when the `ConfirmDialog`
   *  is closed. `FormsList.tsx` drives the dialog's `open` prop from this. */
/** Runs the trash move for {@link FormsListController.pendingDelete}. No-op with no
   *  `pendingDelete` (Cancel never reaches the port) or while another row action is already
   *  in-flight (`rowSavingId` set) — see this function's own comment. */
/** Bound translator — see this file's own header for why it arrives via the hook rather than
   *  `FormsList.tsx` calling `useAdminLocale()`/`FORMS_DICT` directly. */
  // Stable identity — see `use-media.hooks.ts`'s identical `invalidateList` for why an inline arrow
  // here would resubscribe `useContentRefreshSubscription` on every render for no benefit.
  // The form a `RowMenu` "Delete" selection is asking to confirm — `null` when the `ConfirmDialog`
  // is closed. `ConfirmDialog` stays mounted unconditionally in `FormsList.tsx`; this is what drives
  // its `open` prop — same shape `use-posts.hooks.ts`'s `pendingDelete` uses for its own row delete.
  // In-flight guard lives here, not in `FormsList.tsx`'s `onToggleStatus` closure — `RowMenu` has no
  // per-item `disabled`, so this is what stops a second toggle firing while the first is still
  // saving. Same shape `use-redirects.hooks.ts`'s own `onToggleStatus` uses for its identical
  // `if (saving) return;` guard (that hook's own comment on why: `disabled={saving}` on the old
  // inline buttons moved into each handler once `RowMenu` replaced them). Shared `rowSavingId` with
  // `removeForm` below (T7a) — only clears THIS row's own lock in `finally`, so a Delete confirm on
  // a DIFFERENT row that lands while this toggle is still in flight doesn't get its own lock wiped,
  // same guard `use-posts.hooks.ts`'s `togglePostPublish`/`removePost` pair documents.
      // already surfaced through toggleMutation.error -> error below
/** Moves `pendingDelete` to the Trash via `port.trashForm` — reached only through the
   *  `ConfirmDialog`'s Confirm button, never the `RowMenu` selection itself (that only opens the
   *  dialog via `setPendingDelete`), so a click alone can never delete. A 404 (`describeTrashError`'s
   *  `alreadyGone`) means the row is already gone: a quiet list refresh instead of an error banner
   *  blaming the operator for something that already happened — see that function's own doc. Every
   *  other outcome closes the dialog and leaves the failure (if any) for `error` below to surface. */
/**
 * Binds the real `/api/.../forms` client and a `FORMS_DICT`-bound translator — see
 * `forms-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `FormsList.tsx`
 * composes this and a test composes {@link useFormsList} with `createFakeFormsPort` and a fake
 * `t`.
 */
```

## html-rules.ts

```text
/** Persisted descriptors, including those derived from HTML, are the submission table's columns. */
/** Editable form BODY only: the server supplies the transport and spam-protection wrapper. */
```

## index.ts

```text
/**
 * @file Public surface of the `forms` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder. That indirection is the
 * point of the feature boundary: everything below can be split, renamed, or grown a `hooks/`
 * directory without the router noticing. Adding a file to this feature is not an API change unless
 * it is exported from this line.
 */
```

## rules.ts

```text
/**
 * @file Pure logic for the `forms` feature (`FormEditor.tsx` — see `FormsList.tsx`'s own
 * `rules.ts`/hook for the list screen's extraction) — everything that computes a value rather than
 * rendering one. Follows the convention `features/posts/rules.ts` establishes: no React, no
 * hooks, importable and directly testable.
 *
 * One deliberate exception to "pure", same as `collections/rules.ts`'s `nextRowId`:
 * {@link nextAttrRowId} is a module-level counter `attrRowsFromField`/`addAttrRow` advance. Only
 * `FieldAttributesDialog` (via `use-field-attributes-dialog.hooks.ts`) consumes it today, so it
 * would be equally correct sitting in that hook file — kept here instead for the same reason
 * `collections/rules.ts` keeps its row-id counter alongside its other draft-list transforms: one
 * place for "how draft rows get local keys" per feature, not split by which hook happens to use it
 * first.
 *
 * `KEYS` (fetch-query migration, 2026-08-12): forms and form-submissions are two independent
 * resources (separate ports, no method overlap — see `forms-port.hooks.ts`/`form-submissions-
 * port.hooks.ts`'s own doc comments), so they get two entirely separate top-level key namespaces
 * rather than sharing one grandparent. Within each, `list`/`detail(id)` (and `submissionsList(formId)`/
 * `submissionDetail(formId, id)`) are SIBLINGS, not parent/child — `@jini-ai/ui/fetch-query`'s
 * `QueryKey` doc warns that invalidation matches by prefix, and `collections/rules.ts`'s own `KEYS`
 * doc records the regression that bit the predecessor when a detail key nested under its list: every
 * save silently fired 3 extra background requests because invalidating the list also invalidated the
 * editor's own currently-open read. Fixed second-array-element ("list" vs "detail") rather than
 * nesting keeps `KEYS.list`'s invalidation from ever touching an open `KEYS.form(id)`/
 * `KEYS.submissionDetail(...)` read, regardless of what `id` happens to be.
 */
/**
 * This screen's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s `TAXONOMY_RESOURCE`
 * for why this is a plain colocated constant rather than a shared registry. `forms_create_definition`/
 * `forms_update_definition`/`forms_set_definition_status` (`apps/website/src/features/forms/agent-
 * tools.ts`) are agent-callable, so `FormsList.tsx` needs the same "an assistant write shows up
 * without a reload" fix `use-taxonomy.hooks.ts` shipped first.
 */
/** The list has no sort control: recently edited forms belong first. Copy before sorting so
 * the query cache and injected repository keep their own order; ties retain response order. */
/** One line of the Forms list's "Created / Updated" cell. */
/** Which event the line shows; `"both"` when the form was never edited after creation. */
/** Compact locale date + time (`dateStyle`/`timeStyle` "short"), or "—" for an unparseable date. */
/** ISO instant for `<time dateTime>`; `undefined` when the stored text does not parse. */
/** Translated event word(s) plus the full date — the hover title and screen-reader text, since
   *  the visible line carries no "Created"/"Updated" word (the column header already says it). */
/** One form event's compact local date and full tooltip. Shared by definitions and submissions;
 * malformed legacy values stay visible as a dash rather than throwing during table rendering. */
/** Form-specific date copy. The shared admin timestamp helper intentionally slices ISO text
 * and its relative helper is English-only; these two events need the operator's locale and
 * browser time zone. Absolute dates remain accurate while the list stays open without a timer.
 *
 * Owner 2026-10-05: line 1 created, line 2 updated, each a compact short date + time with no event
 * word; one line when updated shows the same date and minute as created. The comparison is on the
 * displayed short text, so edits within the same minute collapse and the rule follows the locale's
 * own precision. Intl picks the date order — never a hand-built "M/D/YY".
 *
 * @complexity O(1) time and space — two dates, fixed-size formatting.
 */
/**
 * `useFormEditor`'s error banner, extracted out of that hook (`refactor/fetch-query` complexity
 * pass, 2026-08-12 — same reason `collections/rules.ts`'s `visibleEntryEditorError` was extracted:
 * the hook's own precedence chain over four sources pushed it past the complexity ceiling).
 *
 * Precedence: an active write's own failure (update/create/status, in that order — mirrors
 * `redirects/rules.ts`'s `firstWriteError` array-order precedence, since `update`/`status` can both
 * apply to the SAME loaded form) always wins. The list-load failure only surfaces before the form
 * has ever loaded — once `hasForm` is true, a later BACKGROUND refresh failure must not blank an
 * editor the operator is actively using (same "a later failure must not erase what already
 * rendered" guard `FormEditor.tsx`'s own file header already documents at the render layer; this is
 * its data-layer half).
 *
 * @complexity Time/space: O(1) — four fixed checks, no iteration.
 */
  // Two distinct fallback strings, matching the pre-migration `handleSave`/`handleStatusToggle`
  // catch blocks verbatim ("save failed" vs "status update failed") — not one shared string.
/**
 * `useFormsList`'s error banner: the row-toggle write's own failure outranks a background
 * list-refresh failure, same precedence `redirects/rules.ts`'s `visibleRedirectsError` documents.
 * Two sources only (not the three-plus that pushed `visibleFormEditorError`/`visibleTaxonomyError`
 * out to `rules.ts`), kept here anyway rather than inlined so the hook body doesn't grow a nested
 * ternary chain (`@jini-ai/ui/fetch-query`'s `resolveFetchQueryStatus` doc explains why a flat
 * extraction beats a nested ternary of the same branch count for the complexity gate).
 *
 * @complexity Time/space: O(1) — two fixed checks, no iteration.
 */
  // The delete's own failure outranks both the toggle's and a background list-refresh failure —
  // same precedence tier `use-posts.hooks.ts`'s `removePost` gives its own delete, and a 404
  // "already gone" resolves to `message: null` here so it never reaches this banner at all (see
  // `describeTrashError`'s own doc for why).
/**
 * Classifies a failed `api.trash` call — shared by `useFormsList`'s `removeForm` (forms) and
 * `useFormSubmissionDetail`'s `confirmDelete` (submissions), since both routes now go through the
 * same generic `POST /trash/items` (`routes/trash/items.ts`) and its 404/409 contract:
 *
 * - 404 (`NOT_FOUND`/`FORMS_SUBMISSION_NOT_FOUND`/…): the row is already gone — another tab,
 *   another operator, or a prior click that actually succeeded before a flaky response read as a
 *   failure. `alreadyGone: true`, `message: null` — the caller's job is a quiet list refresh, not
 *   an error banner blaming the operator for something that already happened.
 * - 409 `TRASH_VERSION_CHANGED`: the row changed under the operator since this screen last read
 *   it. Specific reload-and-retry copy, not the generic fallback.
 * - Anything else (network failure, an unrelated `ApiError`, …): falls through to
 *   `describeApiError`'s generic fallback message.
 *
 * @complexity O(1) — one `instanceof` check plus two fixed comparisons.
 */
/** The callbacks a form row menu needs. Passed in rather than imported so this module stays free
 *  of state, mirroring `redirects/rules.ts`'s `RedirectRowMenuHandlers`. `onDelete` opens the
 *  `ConfirmDialog` in `FormsList.tsx` — see that component's own render for why the actual
 *  `port.trashForm` call waits for the confirm, not this selection. */
/**
 * The row-action menu for one form. `RowMenu` has no per-item `disabled` — the in-flight guard lives
 * in `use-forms-list.hooks.ts`'s own `toggleStatus` (a no-op while `rowSavingId` is already set), the
 * same shape `use-redirects.hooks.ts`'s `onToggleStatus` uses for its identical `if (saving) return;`
 * guard. (CORRECTED 2026-09-05: this comment previously said the guard "stays in the caller's
 * `onToggleStatus` closure (`FormsList.tsx`'s own `if (rowSavingId) return;`)" and claimed that was
 * the same shape `Redirects.tsx` uses — false; `Redirects.tsx` never had such a guard inline, only its
 * hook does. Flagged by the 2026-09-05 Gemini admin-tooling audit as a standing no-logic-in-`.tsx`
 * violation; moving the guard into the hook also fixed the comment's own false precedent claim.)
 *
 * @complexity Time/space: O(1) — three fixed entries, no iteration.
 */
    // Slug, not id — the admin URL reads `/admin/forms/<slug>` (ui-fixes-backlog.md #8); the GET
    // route still resolves an id too, so this is not a behavior change for any existing bookmark.
    // Opens `FormsList.tsx`'s `ConfirmDialog` — no network call from this selection itself, same
    // "a click alone can never delete" contract `use-form-submission-detail.hooks.ts`'s
    // `requestDelete` already documents for the sibling submission-delete flow.
/** The two tab-panel views on an existing form's editor (`formId !== "new"`). */
/**
 * Roving-tabindex arrow-key step for the Fields/Submissions tablist — ArrowLeft/ArrowRight cycle
 * between the two tabs, Home/End jump to the first/last.
 *
 * @complexity O(1) — `FORM_TABS` is a fixed 2-item array.
 */
/** Shared "what do we call this field in a title/label" fallback — a blank draft field has neither
 *  a label nor an id yet, so both the kebab's `aria-label` and the modal's own `<h2>` need the same
 *  `label -> id -> "Field N"` chain rather than risking the two drifting apart. */
/** @complexity O(n) in `fields.length`. */
/** @complexity O(n) in `fields.length`. */
/** @complexity O(n) in `fields.length`. */
/** The already-persisted field ids on a form — `FormFieldsEditor` disables the id input and the
 *  Remove button for these (a saved field's id cannot be changed or removed once created). `null`
 *  (form not loaded yet, or the "new form" case) has no existing ids. */
// ---------------------------------------------------------------------------
// Field attributes modal (per-field CSS classes + HTML attributes)
// ---------------------------------------------------------------------------
/** Mirrors `forms.ts`'s `ATTRIBUTE_NAME_PATTERN` exactly — see `FormEditor.tsx`'s own header
 *  comment for why this is a fast-reject-only duplicate, not the authoritative check. Keep in sync
 *  by hand if the server allowlist changes. */
/** Same bounds as `forms.ts`'s `MAX_CLASS_NAME_LENGTH`/`MAX_ATTRIBUTES_PER_FIELD` — client-side
 *  early-reject only, not enforcement (see `ATTRIBUTE_NAME_PATTERN` above). */
/** A handful of the allowlisted names as real, pickable suggestions (the modal's own "here's what
 *  you can do" surface — an operator has no other way to discover the allowlist) rather than every
 *  one: `aria-*`/`data-*` are open namespaces, so `aria-label`/`data-testid` stand in for the whole
 *  prefix family instead of listing every field-specific `aria-*` name that doesn't exist yet. */
/** Local-only row key for the modal's attribute list, so React can key a row before it has a
 *  stable identity — same `_rowId`/module-counter pattern `collections/rules.ts`'s
 *  `EditFieldsDialog` support uses for its own draft field rows. */
/** @complexity O(n) in `rows.length`. */
/** @complexity O(n) in `rows.length`. */
/** @complexity O(n) in `rows.length`. */
/**
 * Validates + shapes `FieldAttributesDialog`'s draft into the `Partial<AdminFormField>` patch
 * `onSave` applies: a class-name length cap, then every named attribute row against the allowlist
 * (blank names are silently skipped — an empty trailing row is not an error), then a total-count
 * cap on the surviving attributes. The security-relevant check is server-side (`forms.ts`'s
 * `validateFieldDescriptors`); this is the fast, pre-save rejection only — see this feature's own
 * `ATTRIBUTE_NAME_PATTERN` doc.
 *
 * @complexity O(n) in `rows.length`, short-circuiting on the first disallowed name.
 */
```


## Part B resumed host rationale (2026-10-08)

The current comments below preserve updated ownership references before their Tovu bodies are removed.

### apps/admin/src/features/forms/hooks/form-submissions-dependencies.hooks.ts

```text
/**
 * @file The only place under `features/forms/hooks` that reaches `lib/api` for submission
 * routes — see `form-submissions-port.hooks.ts` for why the split exists.
 */
/** The live implementation, as a module-level singleton — matches `integrations/jini-admin/redirects-ports.ts`'s
 *  `redirectsHostPorts`.
 *
 * Submission removal (T7a, 2026-09-21) routes through the generic `POST /trash/items`
 * (`type: "form_submission"`) endpoint, which moves the item to Trash. The feature's port keeps
 * its existing boundary; only the wire call changed. */
/** Seed state for {@link createFakeFormSubmissionsPort}. */
/**
 * An in-memory {@link FormSubmissionsPort} for tests — the fake that lets a test describe "this
 * form has these submissions" or "the delete fails" directly, instead of hand-building fetch
 * `Response`s. Shipped alongside the real binding per the pattern's "every port gets a fake" rule
 * (see `assistant-chats-dependencies.hooks.ts`).
 *
 * `listFormSubmissions` ignores `cursor`/`limit` and returns the full seeded list with
 * `nextCursor: null` — none of this feature's existing behavior tests a multi-page cursor walk, so
 * a fake pagination implementation would be untested surface, not a simplification.
 */
/** Every submission currently in the fake's store, in list order. */
```

### apps/admin/src/features/forms/hooks/form-submissions-port.hooks.ts

```text
/**
 * @file What `useFormSubmissions` and `useFormSubmissionDetail` need from the outside world, as an
 * interface rather than a direct `lib/api` import.
 *
 * A separate port from `forms-port.hooks.ts` rather than folding in: submissions are a distinct
 * sub-resource (`AdminFormSubmission`, not `AdminFormDefinition`) with no method overlap with form
 * CRUD. Shared between these two hooks because both read/write the SAME submissions list for a
 * form — `useFormSubmissions` lists it, `useFormSubmissionDetail` deletes one row from it — the
 * same "genuinely matches" shape `Jini redirects/SOURCE-RATIONALE.md` names for its own three hooks.
 */
```

### apps/admin/src/features/forms/hooks/forms-dependencies.hooks.ts

```text
/**
 * @file The only place under `features/forms/hooks` that reaches `lib/api` for form-definition
 * CRUD — see `forms-port.hooks.ts` for why the split exists.
 */
/** The live implementation, as a module-level singleton — matches `integrations/jini-admin/redirects-ports.ts`'s
 *  `redirectsHostPorts`. */
/** Seed state for {@link createFakeFormsPort}. */
/** What `getMailStatus` reports; defaults to `true` (a real mailer is configured). */
/**
 * An in-memory {@link FormsPort} for tests — the fake that lets a test describe "this form
 * exists" or "the save fails" directly, instead of hand-building fetch `Response`s. Shipped
 * alongside the real binding per the pattern's "every port gets a fake" rule (see
 * `assistant-chats-dependencies.hooks.ts`).
 */
/** Every form currently in the fake's store, in list order. */
      // Slug-or-id, mirroring the real GET route's own resolution (ui-fixes-backlog.md #8,
      // `get-by-id.ts`) — a test seeding by slug (the admin URL's new shape) needs this fake to
      // resolve it the same way the server does, not just the legacy id.
```

### apps/admin/src/features/forms/hooks/forms-port.hooks.ts

```text
/**
 * @file What `useFormEditor` and `useFormsList` need from the outside world, as an interface
 * rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) and already applied to `features/redirects` and
 * `features/pages`: this file declares, `forms-dependencies.hooks.ts` binds the real `api` client,
 * and nothing else under `features/forms/hooks` imports `lib/api` for these four routes.
 *
 * One shared port rather than two overlapping ones — `useFormEditor` and `useFormsList` both read
 * and write the SAME `AdminFormDefinition` resource (both call `updateForm`: `useFormsList` for its
 * row status toggle, `useFormEditor` for both its save and its own status toggle), the same
 * "genuinely matches" case `Jini redirects/SOURCE-RATIONALE.md` names for its own three hooks. Deliberately
 * NOT shared with `form-submissions-port.hooks.ts` — submissions are a different sub-resource with
 * no method overlap; see that port's own doc comment.
 */
/** Moves a form to the Trash via the generic `POST /trash/items` route (`type: "form"`) — see
   *  `api.ts`'s `trash` doc comment for why this is the shared route rather than a form-specific
   *  delete endpoint. `useFormsList`'s `removeForm` is the one caller. */
/** Whether the site can actually send email — `useFormEditor` greys out the notify settings
   *  when it cannot. */
```

### apps/admin/src/features/forms/hooks/use-field-attributes-dialog.hooks.ts

```text
/**
 * @file `FieldAttributesDialog`'s own state and submit action (per-field CSS classes + HTML
 * attributes), so the dialog in `FormEditor.tsx` is only markup.
 *
 * Extracted verbatim — same state, same validation, same error strings. Draft-row editing and the
 * validate/shape step now live in `rules.ts` (`updateAttrRow`/`removeAttrRow`/`addAttrRow`,
 * `buildFieldAttributesPatch`).
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it. The former Escape helper was likewise feature-local
 * because only this dialog needed it; Jini now owns that shared modal behavior, so the helper
 * and its document subscription are superseded rather than promoted to another local owner.
 */
```

### apps/admin/src/features/forms/hooks/use-form-editor.hooks.ts

```text
/**
 * @file Everything the FormEditor SCREEN does — load, save, status toggle, and the Fields/
 * Submissions tab strip's roving-tabindex focus management — so `FormEditor`'s exported component
 * in `FormEditor.tsx` is only markup.
 *
 * Extracted verbatim — same load effect, same save/status-toggle error strings, same "later failure
 * keeps the editor on screen" guard (the audit-blocker fix this screen's file header describes —
 * see `FormEditor.tsx`'s own header for the full rationale, which stays with the guard in the view
 * since it describes render behaviour, not this hook's state).
 *
 * `tab` (ADR-063, 2026-08-31): no longer local state — it is `props.tab`, derived from the route
 * (`/forms/:formId` vs `/forms/:formId/submissions`) by `panels.tsx`/`FormEditor.tsx`. Switching
 * tabs calls the injected `navigate` (real app router), the same idiom `Deployment.tsx`'s tab strip
 * uses, rather than a local `setTab` — Submissions has its own independent fetch, so a tab switch
 * is a genuine route change, not a display-layer filter over data already in hand.
 *
 * `tabRefs` moves here too, per Pattern 1 (every `useRef` moves with state/effects, not just
 * `useState`) — the view still attaches each button via its own `ref` callback (an unavoidably
 * DOM-side operation), but the ref array itself and the keydown-to-focus-change logic
 * (`onTabsKeyDown`) are behaviour, not markup.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 *
 * `port`/`navigate` are injected — see `forms-port.hooks.ts` (shared with `use-forms-list.hooks.ts`,
 * since both read/write the same `AdminFormDefinition` resource) — rather than reaching `lib/api`/
 * `lib/router` directly, so a test can describe load/save outcomes against `createFakeFormsPort`
 * instead of stubbing global `fetch`. `useWiredFormEditor` below is the zero-argument pair
 * `FormEditor.tsx` actually mounts.
 *
 * `t` (standing i18n rule — a component with a hook gets a BOUND `t` from that hook, not its own
 * `useAdminLocale()`/dictionary import, same shape `use-post-editor.hooks.ts` established for this
 * conversion): injected alongside `port`/`navigate` because `FormEditor.tsx` itself (the copy
 * around this hook's own state — tab labels, Save button, etc.) DOES need translated strings, even
 * though this hook's own error messages don't. Pre-bound to `(key: string) => string`.
 * `useAdminLocale()` and `FORMS_DICT` are called/read only inside {@link useWiredFormEditor}.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the load is one `useFetchQuery` keyed on
 * `KEYS.form(formId)` (disabled for `isNew`, matching the original `if (isNew) return;` early-out).
 * `form`/`name`/`slug`/`fields`/`notify` stay local `useState` — the operator edits `name`/`slug`/
 * `fields`; `notify` has no UI of its own (owner ask 2026-09-22 removed the notify checkbox/
 * recipients input — see this file's own `notify` state comment) and is only ever carried through
 * unchanged. All are seeded from `list.data` exactly once per `formId` via `seededFormIdRef`, the
 * same shape `collections/hooks/use-collection-entry-editor.hooks.ts`'s `seededIdentityRef`
 * establishes (see that file's header for the regression it guards against: a background refetch of
 * the SAME identity must not clobber in-progress edits). `handleSave`/`handleStatusToggle` set `form`
 * (and, for save, the rest of the seeded fields) directly from each MUTATION's own response, and
 * neither mutation invalidates this hook's OWN `KEYS.form(formId)` read (only the sibling
 * `KEYS.list`) — mirroring `save()`/`toggleLifecycle()` in that same collections hook, which
 * invalidate only the sibling `KEYS.entries(...)`, never their own `KEYS.entry(...)`, for the
 * identical reason: a response already in hand needs no redundant background refetch of itself. This
 * eliminates the load race an external audit flagged at this file's old line 117 (`useEffect(load,
 * [props.formId, port])` with no cancellation guard, so a formId change mid-flight could commit a
 * stale response): a keyed query cannot commit a response belonging to a prior key, by construction.
 */
/** `null` until the initial load settles (or always, for `isNew`) — the caller renders a loading
   *  state or the empty create form accordingly. */
/** Navigates to this form's Fields or Submissions route — real `navigate()`, not local state
   *  (ADR-063: Submissions has its own independent fetch, so a tab switch is a genuine route
   *  change, the same idiom `Deployment.tsx`'s tab strip uses). Pushes a history entry (no
   *  `replace`) so browser back/forward move naturally between the two routes, unlike the
   *  `?tab=` screens' `replace: true` view-filter switches. */
/** Already-persisted field ids on the loaded form — see `existingFieldIdsOf`. */
/** Tabs render only for an existing, loaded form — never for `isNew`, and never before `form`
   *  has loaded. */
/** Per-tab-button refs, indexed the same as `FORM_TABS` — attach via each button's own `ref`
   *  callback in the view. */
/** Roving-tabindex keydown handler for the tablist `<div>` — ArrowLeft/ArrowRight/Home/End move
   *  both the selected tab and DOM focus together. */
/** Bound translator — see this file's own header for why it arrives via the hook rather than
   *  `FormEditor.tsx` calling `useAdminLocale()`/`FORMS_DICT` directly. */
  // No UI edits this (owner ask 2026-09-22 removed the notify checkbox/recipients input from the
  // Fields tab — a future outside mail integration will design its own way to set it). Seeded from
  // the loaded form and carried through unchanged on every save, so an operator saving a form never
  // wipes out a `notify` setting that predates this UI removal. Stays local `useState`, not a
  // `const`, only so `handleSave`'s existing-form branch can resync it from the write's own response
  // exactly like `form`/`name`/`slug`/`fields` already do below.
  // Roving-tabindex focus targets for the tab strip below, indexed the same as `FORM_TABS` — see
  // `nextTabIndex`'s doc comment for why the index math itself lives outside the component.
  // Seeds `form`/`name`/`slug`/`fields`/`notify` from `list.data` exactly once per `formId` — see
  // this file's own header for the regression this guards against (a background refetch of the SAME
  // formId must not clobber in-progress edits).
  // None of these invalidate `KEYS.form(props.formId)` — only `KEYS.list`. `handleSave`/
  // `handleStatusToggle` below already set `form` (and, for save, the rest of the seeded fields)
  // directly from each mutation's own response, so invalidating this hook's OWN read key would only
  // buy a redundant background refetch of data already in hand — the same reasoning
  // `use-collection-entry-editor.hooks.ts`'s `save()`/`toggleLifecycle()` document for why THEIR
  // `invalidates` names only the sibling `KEYS.entries(...)`, never their own `KEYS.entry(...)`.
      // Targets the loaded record's real id, never `props.formId` directly — the admin URL now
      // carries the form's slug when one resolves (ui-fixes-backlog.md #8), so `props.formId` may
      // itself BE that slug. `form.id` is always the real id regardless of which one the URL held,
      // which is what lets the PUT route stay id-only (no matching slug support needed — see
      // `get-by-id.ts`'s own comment on why only the GET route resolves either). The `?? props
      // .formId` fallback only matters if this ever fired before `form` loaded, which it can't:
      // `FormEditor.tsx`'s `!isNew && !form` guards keep the whole editor (Save button included)
      // off-screen until `form` is set.
    // Ordinary Builder saves keep their existing endpoint/permissions. A mode change is explicit.
        // `notify` here is always this hook's own blank default — a new form has no earlier value
        // to carry through, and there is no UI on this screen to set one instead.
        // Slug, not id — see this hook's own file header / `get-by-id.ts` for the id-or-slug
        // resolution this now lands on (ui-fixes-backlog.md #8).
        // `notify` is the value this hook seeded from the loaded form and has never changed since —
        // sent back unchanged so saving name/slug/field edits can never wipe a stored notify setting
        // (see this hook's own `notify` state comment).
        // Set directly from the write's own response — `updateMutation` doesn't invalidate this
        // hook's own `KEYS.form(id)` read (see the mutations' own comment above), so there is no
        // background refetch to wait for or to accidentally clobber an in-progress edit with.
        // Mirrors `use-collection-entry-editor.hooks.ts`'s `save()`.
      // already surfaced through updateMutation.error/createMutation.error -> error below
      // already surfaced through statusMutation.error -> error below
  // Navigates to `/forms/:formId` or `/forms/:formId/submissions` (ADR-063) — `panels.tsx`'s
  // `forms` panel keys `FormEditor` off `ctx.params.formId` on BOTH routes, so this is a route
  // change, not a remount: in-progress Fields edits survive a trip to Submissions and back.
/**
 * Binds the real `/api/.../forms` client, `lib/router`'s `navigate`, and a `FORMS_DICT`-bound
 * translator — see `forms-dependencies.hooks.ts`.
 *
 * The zero-argument-deps half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `FormEditor.tsx` composes this and a test composes {@link useFormEditor} with
 * `createFakeFormsPort`, a fake `navigate`, and a fake `t`.
 */
```

### apps/admin/src/features/forms/hooks/use-form-fields-editor.hooks.ts

```text
/**
 * @file `FormFieldsEditor`'s own state (which row's attributes modal is open, plus the per-row
 * kebab-trigger refs for WCAG focus-return), so the fields table in `FormEditor.tsx` is only
 * markup.
 *
 * Extracted verbatim, including the `useRef` array — `Pattern 1` moves every `useRef` out of the
 * component along with state/effects, not just `useState`. The field-list edits themselves
 * (`updateField`/`addField`/`removeField`) are thin wrappers around `rules.ts`'s pure array
 * transforms, applied through the parent-owned `onChange` (this component does not own `fields`
 * itself — `FormEditor`'s own `fields` state does).
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 */
/** Which field's `FieldAttributesDialog` is open, by index — `null` when none is. */
/** Closes the attributes dialog and returns focus to the kebab trigger that opened it (WCAG 2.1
   *  AA "focus returns to trigger element when modal closes"). */
/** Per-row kebab-trigger refs, indexed the same as `fields` — attach via each row's own `ref`
   *  callback in the view. */
```

### apps/admin/src/features/forms/hooks/use-form-submission-date.hooks.ts

```text
/** Bind submission timestamps to the same operator locale and local time as the Forms list. */
  // One locale subscription per submissions panel, rather than one per timestamp cell.
```

### apps/admin/src/features/forms/hooks/use-form-submission-detail.hooks.ts

```text
/**
 * @file `FormSubmissionDetail`'s own state and delete action, so the detail view in
 * `FormEditor.tsx` is only markup.
 *
 * Permanent delete now confirms through a modal (S5 fix, 2026-09-20), not an inline two-click
 * button: the old `confirming`/`handleDelete` shape flipped a click's own label to "Confirm
 * delete", so a real double-click deleted the submission outright with no way to back out — the
 * same bug widgets' `trashOrPurge` had before its own `pendingPurge`/`ConfirmDialog` fix. This
 * hook now mirrors that shape one-for-one: `requestDelete` only opens the dialog (no network),
 * `cancelDelete` closes it with no request, and `confirmDelete` runs the mutation.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 *
 * `port` is injected — see `form-submissions-port.hooks.ts` (shared with `use-form-
 * submissions.hooks.ts`, since both read/write the same submissions list for a form) — rather than
 * importing `lib/api` directly, so a test can describe load/delete outcomes against
 * `createFakeFormSubmissionsPort` instead of stubbing global `fetch`.
 * `useWiredFormSubmissionDetail` below is the zero-argument pair `FormEditor.tsx` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the load is one `useFetchQuery` keyed on
 * `KEYS.submissionDetail(formId, submissionId)` — a query cannot commit a response belonging to a
 * prior key, which eliminates the load race an external audit flagged at this file's old line 48
 * (a plain `.then()`/`.catch()` effect with no cancellation guard) by construction. `confirmDelete`
 * is a `useFetchMutation` that `invalidates: [KEYS.submissionsList(formId)]`, so the sibling list
 * (`use-form-submissions.hooks.ts`) refreshes on its own — `props.onDeleted()` now only needs to
 * clear the caller's `selectedId` (a UI-navigation concern this hook can't own), not also trigger a
 * reload, so `FormEditor.tsx`'s `onDeleted` callback drops its own `load()` call.
 */
/** `null` until the initial load settles — the caller renders a loading state. */
/** True while the "Delete permanently?" confirm dialog should be open — opened by
   *  {@link FormSubmissionDetailController.requestDelete}, closed by
   *  {@link FormSubmissionDetailController.cancelDelete} or once
   *  {@link FormSubmissionDetailController.confirmDelete} settles. */
/** Opens the confirm dialog. No network call — a click alone can never delete. */
/** Closes the confirm dialog with no request. */
/** Runs the delete. On success, calls `props.onDeleted()`. Closes the dialog in `finally`
   *  either way, so a failed delete doesn't leave the operator stuck behind it — the failure is
   *  still visible via `error` below. */
/** Bound translator — see `use-forms-list.hooks.ts`'s own header for why this arrives via
     *  injection rather than this hook calling `useAdminLocale()` itself. Optional (defaults to
     *  identity) so existing callers/tests that don't pass one keep seeing the raw English copy. */
/** T7a (2026-09-21): the confirmation mutation moves the submission to Trash through the generic
   *  `POST /trash/items` endpoint — see `form-submissions-dependencies.hooks.ts`'s own doc. A 404
   *  (`describeTrashError`'s `alreadyGone`) means the submission is already gone: from
   *  the operator's point of view that's the same outcome as a successful delete, so this still calls
   *  `onDeleted()` and invalidates the list directly — `deleteMutation`'s own `invalidates` only fires
   *  on success, and a failed mutation would otherwise leave the sibling list showing a row that's
   *  already gone. */
      // otherwise: already surfaced through deleteMutation.error -> error below
  // The delete's own failure outranks a background load-refresh failure — flat `if`s rather than a
  // nested ternary, per `@jini-ai/ui/fetch-query`'s `resolveFetchQueryStatus` doc on why the two carry
  // a different complexity-gate weight for the same branch count.
/**
 * Binds the real `/api/.../forms/:id/submissions` client — see
 * `form-submissions-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `FormEditor.tsx`
 * composes this and a test composes {@link useFormSubmissionDetail} with
 * `createFakeFormSubmissionsPort`.
 */
```

### apps/admin/src/features/forms/hooks/use-form-submissions.hooks.ts

```text
/**
 * @file `FormSubmissions`'s own state and paginated load, so the submissions list in
 * `FormEditor.tsx` is only markup.
 *
 * Extracted verbatim — same cursor-append load shape, same error strings. `load` keeps its original
 * `(cursor?: string) => void` signature rather than being split into separate "load"/"loadMore"
 * functions, so both call sites (`load(nextCursor)` for "Load more", `load()` after a submission
 * delete) carry over unchanged.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 *
 * `port` is injected — see `form-submissions-port.hooks.ts` (shared with `use-form-submission-
 * detail.hooks.ts`, since both read/write the same submissions list for a form) — rather than
 * importing `lib/api` directly, so a test can describe list outcomes against
 * `createFakeFormSubmissionsPort` instead of stubbing global `fetch`. `useWiredFormSubmissions`
 * below is the zero-argument pair `FormEditor.tsx` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the FIRST page is one `useFetchQuery` keyed on
 * `KEYS.submissionsList(formId)` — a query cannot commit a response belonging to a prior key, which
 * eliminates the load race an external audit flagged at this file's old line 56 (a plain
 * `.then()`/`.catch()` effect with no cancellation guard) for that page. Subsequent "Load more"
 * pages are NOT folded into that same query: `@jini-ai/ui/fetch-query`'s `QueryKey` doc binds one
 * hook to one FIXED key, and a cursor-appended page list is exactly the "moving-target key" shape
 * that doc's own Skip precedent (`useSettingsContainer`, see this migration's dispatch brief) warns
 * against faking — so accumulated pages stay local `useState`, fetched directly through `port`
 * (bypassing the cache, since an appended page is not a cacheable "the current state of X", it's an
 * accumulating view built by this one screen). `pageSettlement` (`useSettlementGeneration`) guards
 * that accumulation against the SAME class of race the base query gets for free: a `loadMore` in
 * flight when `formId` changes, or when a first-page refetch (e.g. a delete's invalidate) resets
 * the list, must not append its page once it resolves — see `resetMorePages` below, which mints a
 * fresh generation on every reset so any older in-flight page fetch is superseded. A synchronous
 * `loadingMoreRef` lock, checked before minting a generation, covers the other half: two `loadMore`
 * calls issued in the SAME tick (a double click) must send only one request
 * (2026-09-20, `plan-content2.md` #3/#5/S2).
 *
 * The audit's second, more serious finding at this file — `selectedId` surviving a `formId` change
 * untouched, so a delete could fire against a submission id belonging to the PREVIOUS form while its
 * stale rows were still on screen — is fixed by the identity-reset effect below, which clears both
 * `selectedId` and the accumulated "more" pages whenever `formId` changes.
 */
/** `null` until the initial load settles — the caller renders a loading state. */
/** The submission `FormSubmissions` is showing `FormSubmissionDetail` for — `null` shows the
   *  plain list. */
/** Re-fetches. Passing a cursor appends to `submissions`; omitting it replaces the list from the
   *  start (used after a submission is deleted, so the list reflects the removal). */
/** True while a "Load more" page fetch is in flight — drives the button's `disabled` and
   *  "Loading…" label in `FormEditor.tsx`. */
  // The "latest call wins" guard for accumulated pages — see the file header. `loadingMoreRef` is
  // the synchronous half (blocks a same-tick double `loadMore`); `pageSettlement` is the async half
  // (a superseded fetch's response must not land once a reset or a form switch has moved on).
  // Supersedes any in-flight "Load more" fetch and clears the accumulated pages/cursor/error back
  // to "just the first page" — called wherever the previous code did a bare `setMorePages([])`, so
  // there is one reset path instead of three ad hoc ones.
  // One effect, not two: the identity reset below fixes the audit's data-loss finding at this
  // file — `selectedId` used to survive a `formId` change untouched, so a delete could fire
  // against a submission id belonging to the PREVIOUS form while its stale rows were still on
  // screen. `resetMorePages()` drops accumulated "more" pages, which belong to the previous form's
  // cursor walk, and supersedes any of that form's `loadMore` still in flight.
  // S2 fix: a refetched first page (e.g. S5's delete invalidating the list) must drop the "more"
  // pages it used to leave stale — they are always a continuation of the CURRENT first page, not
  // whichever first page was on screen when they were fetched. `resetMorePages()` also supersedes
  // any `loadMore` already in flight when the refetch lands, so its page can't append afterward.
      // A superseded call's lock was already released by `resetMorePages`; only the still-current
      // call releases it here.
/** Passing a cursor appends via `loadMore`; omitting it re-reads the first page from scratch
   *  (used after a submission delete, so the list reflects the removal) and drops accumulated pages,
   *  matching the pre-migration `load()`'s own "no cursor replaces everything" behavior. */
/**
 * Binds the real `/api/.../forms/:id/submissions` client — see
 * `form-submissions-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `FormEditor.tsx`
 * composes this and a test composes {@link useFormSubmissions} with
 * `createFakeFormSubmissionsPort`.
 */
```

### apps/admin/src/features/forms/hooks/use-forms-list.hooks.ts

```text
/**
 * @file Everything the Forms LIST does, so `FormsList.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error strings. Naming follows
 * `hooks/use-settings-slice.hooks.ts` and `hooks/use-dirty-guard.hooks.ts`: `use-<thing>.hooks.ts`.
 * Feature-local because nothing outside `features/forms` needs it; promote to `src/hooks/` only
 * when a second feature actually does.
 *
 * `port` is injected — see `forms-port.hooks.ts` (shared with `use-form-editor.hooks.ts`, since
 * both read/write the same `AdminFormDefinition` resource) — rather than importing `lib/api`
 * directly, so a test can describe list/write outcomes against `createFakeFormsPort` instead of
 * stubbing global `fetch`. `useWiredFormsList` below is the zero-argument pair `FormsList.tsx`
 * actually mounts.
 *
 * `t` (standing i18n rule — a component with a hook gets a BOUND `t` from that hook, not its own
 * `useAdminLocale()`/dictionary import, same shape `use-post-editor.hooks.ts` established for this
 * conversion): injected alongside `port` rather than `FormsList.tsx` importing `useAdminLocale`
 * and `FORMS_DICT` itself. Pre-bound to `(key: string) => string` so a test can inject
 * `t: (k) => k` and every assertion stays stable against copy changes. `useAdminLocale()` and
 * `FORMS_DICT` are called/read only inside {@link useWiredFormsList}.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `toggleStatus` is one `useFetchMutation` that
 * `invalidates: [KEYS.list]` — same idiom `use-taxonomy.hooks.ts`'s deletes use, so this list stays
 * in sync with a status change made from `FormEditor.tsx` too (a `KEYS.list`-invalidating write
 * elsewhere in the app, not just this screen's own toggle). This DOES cost one extra background GET
 * per toggle that the pre-migration `setForms((prev) => prev.map(...))` optimistic patch avoided —
 * a deliberate trade for cross-screen consistency (`@jini-ai/ui/fetch-query`'s own header names
 * this exact "two screens showing the same resource silently drift apart" bug as the reason the
 * library exists at all); `FormsList.unit.test.tsx`'s old "only one GET" assertion is updated
 * accordingly, not preserved. `rowSavingId` stays local `useState` rather than reading off the
 * mutation directly — one shared `useFetchMutation` object has no per-call "which row" of its own,
 * the exact case this migration's own dispatch brief calls out as the intended `useState` out.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass, see that hook's own header):
 * `forms_create_definition`/`forms_update_definition`/`forms_set_definition_status`
 * (`apps/website/src/features/forms/agent-tools.ts`) are agent-callable, so this list re-invalidates
 * `KEYS.list` on an out-of-band content-refresh notification the same way `use-taxonomy.hooks.ts`
 * does for its own resource.
 */
/** The "Created / Updated" cell's one or two lines — see `rules.ts`'s `formDatesLines`. */
/** In-flight row action (status toggle, or the confirmed delete) — one at a time, same
   *  `rowSavingId` convention `Posts.tsx`/`Pages.tsx` use for their own row actions. Shared between
   *  {@link FormsListController.toggleStatus} and {@link FormsListController.removeForm} so a
   *  Disable click and a Delete confirm on two different rows can never race each other. */
/** No-op while a previous call is still in flight (`rowSavingId` set) — see this function's own
   *  comment; the caller never has to guard against a double toggle itself. */
/** The form a `RowMenu` "Delete" selection is asking to confirm; `null` when the `ConfirmDialog`
   *  is closed. `FormsList.tsx` drives the dialog's `open` prop from this. */
/** Runs the trash move for {@link FormsListController.pendingDelete}. No-op with no
   *  `pendingDelete` (Cancel never reaches the port) or while another row action is already
   *  in-flight (`rowSavingId` set) — see this function's own comment. */
/** Bound translator — see this file's own header for why it arrives via the hook rather than
   *  `FormsList.tsx` calling `useAdminLocale()`/`FORMS_DICT` directly. */
  // Stable identity — see `use-media.hooks.ts`'s identical `invalidateList` for why an inline arrow
  // here would resubscribe `useContentRefreshSubscription` on every render for no benefit.
  // The form a `RowMenu` "Delete" selection is asking to confirm — `null` when the `ConfirmDialog`
  // is closed. `ConfirmDialog` stays mounted unconditionally in `FormsList.tsx`; this is what drives
  // its `open` prop — same shape `use-posts.hooks.ts`'s `pendingDelete` uses for its own row delete.
  // In-flight guard lives here, not in `FormsList.tsx`'s `onToggleStatus` closure — `RowMenu` has no
  // per-item `disabled`, so this is what stops a second toggle firing while the first is still
  // saving. Same shape `Jini redirects/react/hooks/use-redirects.hooks.ts`'s own `onToggleStatus` uses for its identical
  // `if (saving) return;` guard (that hook's own comment on why: `disabled={saving}` on the old
  // inline buttons moved into each handler once `RowMenu` replaced them). Shared `rowSavingId` with
  // `removeForm` below (T7a) — only clears THIS row's own lock in `finally`, so a Delete confirm on
  // a DIFFERENT row that lands while this toggle is still in flight doesn't get its own lock wiped,
  // same guard `use-posts.hooks.ts`'s `togglePostPublish`/`removePost` pair documents.
      // already surfaced through toggleMutation.error -> error below
/** Moves `pendingDelete` to the Trash via `port.trashForm` — reached only through the
   *  `ConfirmDialog`'s Confirm button, never the `RowMenu` selection itself (that only opens the
   *  dialog via `setPendingDelete`), so a click alone can never delete. A 404 (`describeTrashError`'s
   *  `alreadyGone`) means the row is already gone: a quiet list refresh instead of an error banner
   *  blaming the operator for something that already happened — see that function's own doc. Every
   *  other outcome closes the dialog and leaves the failure (if any) for `error` below to surface. */
/**
 * Binds the real `/api/.../forms` client and a `FORMS_DICT`-bound translator — see
 * `forms-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `FormsList.tsx`
 * composes this and a test composes {@link useFormsList} with `createFakeFormsPort` and a fake
 * `t`.
 */
```

### apps/admin/src/features/forms/rules.ts

```text
/**
 * @file Pure logic for the `forms` feature (`FormEditor.tsx` — see `FormsList.tsx`'s own
 * `rules.ts`/hook for the list screen's extraction) — everything that computes a value rather than
 * rendering one. Follows the convention `features/posts/rules.ts` establishes: no React, no
 * hooks, importable and directly testable.
 *
 * One deliberate exception to "pure", same as `collections/rules.ts`'s `nextRowId`:
 * {@link nextAttrRowId} is a module-level counter `attrRowsFromField`/`addAttrRow` advance. Only
 * `FieldAttributesDialog` (via `use-field-attributes-dialog.hooks.ts`) consumes it today, so it
 * would be equally correct sitting in that hook file — kept here instead for the same reason
 * `collections/rules.ts` keeps its row-id counter alongside its other draft-list transforms: one
 * place for "how draft rows get local keys" per feature, not split by which hook happens to use it
 * first.
 *
 * `KEYS` (fetch-query migration, 2026-08-12): forms and form-submissions are two independent
 * resources (separate ports, no method overlap — see `forms-port.hooks.ts`/`form-submissions-
 * port.hooks.ts`'s own doc comments), so they get two entirely separate top-level key namespaces
 * rather than sharing one grandparent. Within each, `list`/`detail(id)` (and `submissionsList(formId)`/
 * `submissionDetail(formId, id)`) are SIBLINGS, not parent/child — `@jini-ai/ui/fetch-query`'s
 * `QueryKey` doc warns that invalidation matches by prefix, and `collections/rules.ts`'s own `KEYS`
 * doc records the regression that bit the predecessor when a detail key nested under its list: every
 * save silently fired 3 extra background requests because invalidating the list also invalidated the
 * editor's own currently-open read. Fixed second-array-element ("list" vs "detail") rather than
 * nesting keeps `KEYS.list`'s invalidation from ever touching an open `KEYS.form(id)`/
 * `KEYS.submissionDetail(...)` read, regardless of what `id` happens to be.
 */
/**
 * This screen's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s `TAXONOMY_RESOURCE`
 * for why this is a plain colocated constant rather than a shared registry. `forms_create_definition`/
 * `forms_update_definition`/`forms_set_definition_status` (`apps/website/src/features/forms/agent-
 * tools.ts`) are agent-callable, so `FormsList.tsx` needs the same "an assistant write shows up
 * without a reload" fix `use-taxonomy.hooks.ts` shipped first.
 */
/** The list has no sort control: recently edited forms belong first. Copy before sorting so
 * the query cache and injected repository keep their own order; ties retain response order. */
/** One line of the Forms list's "Created / Updated" cell. */
/** Which event the line shows; `"both"` when the form was never edited after creation. */
/** Compact locale date + time (`dateStyle`/`timeStyle` "short"), or "—" for an unparseable date. */
/** ISO instant for `<time dateTime>`; `undefined` when the stored text does not parse. */
/** Translated event word(s) plus the full date — the hover title and screen-reader text, since
   *  the visible line carries no "Created"/"Updated" word (the column header already says it). */
/** One form event's compact local date and full tooltip. Shared by definitions and submissions;
 * malformed legacy values stay visible as a dash rather than throwing during table rendering. */
/** Form-specific date copy. The shared admin timestamp helper intentionally slices ISO text
 * and its relative helper is English-only; these two events need the operator's locale and
 * browser time zone. Absolute dates remain accurate while the list stays open without a timer.
 *
 * Owner 2026-10-05: line 1 created, line 2 updated, each a compact short date + time with no event
 * word; one line when updated shows the same date and minute as created. The comparison is on the
 * displayed short text, so edits within the same minute collapse and the rule follows the locale's
 * own precision. Intl picks the date order — never a hand-built "M/D/YY".
 *
 * @complexity O(1) time and space — two dates, fixed-size formatting.
 */
/**
 * `useFormEditor`'s error banner, extracted out of that hook (`refactor/fetch-query` complexity
 * pass, 2026-08-12 — same reason `collections/rules.ts`'s `visibleEntryEditorError` was extracted:
 * the hook's own precedence chain over four sources pushed it past the complexity ceiling).
 *
 * Precedence: an active write's own failure (update/create/status, in that order — mirrors
 * `Jini redirects/rules.ts`'s `firstWriteError` array-order precedence, since `update`/`status` can both
 * apply to the SAME loaded form) always wins. The list-load failure only surfaces before the form
 * has ever loaded — once `hasForm` is true, a later BACKGROUND refresh failure must not blank an
 * editor the operator is actively using (same "a later failure must not erase what already
 * rendered" guard `FormEditor.tsx`'s own file header already documents at the render layer; this is
 * its data-layer half).
 *
 * @complexity Time/space: O(1) — four fixed checks, no iteration.
 */
  // Two distinct fallback strings, matching the pre-migration `handleSave`/`handleStatusToggle`
  // catch blocks verbatim ("save failed" vs "status update failed") — not one shared string.
/**
 * `useFormsList`'s error banner: the row-toggle write's own failure outranks a background
 * list-refresh failure, same precedence `Jini redirects/rules.ts`'s `visibleRedirectsError` documents.
 * Two sources only (not the three-plus that pushed `visibleFormEditorError`/`visibleTaxonomyError`
 * out to `rules.ts`), kept here anyway rather than inlined so the hook body doesn't grow a nested
 * ternary chain (`@jini-ai/ui/fetch-query`'s `resolveFetchQueryStatus` doc explains why a flat
 * extraction beats a nested ternary of the same branch count for the complexity gate).
 *
 * @complexity Time/space: O(1) — two fixed checks, no iteration.
 */
  // The delete's own failure outranks both the toggle's and a background list-refresh failure —
  // same precedence tier `use-posts.hooks.ts`'s `removePost` gives its own delete, and a 404
  // "already gone" resolves to `message: null` here so it never reaches this banner at all (see
  // `describeTrashError`'s own doc for why).
/**
 * Classifies a failed `api.trash` call — shared by `useFormsList`'s `removeForm` (forms) and
 * `useFormSubmissionDetail`'s `confirmDelete` (submissions), since both routes now go through the
 * same generic `POST /trash/items` (`routes/trash/items.ts`) and its 404/409 contract:
 *
 * - 404 (`NOT_FOUND`/`FORMS_SUBMISSION_NOT_FOUND`/…): the row is already gone — another tab,
 *   another operator, or a prior click that actually succeeded before a flaky response read as a
 *   failure. `alreadyGone: true`, `message: null` — the caller's job is a quiet list refresh, not
 *   an error banner blaming the operator for something that already happened.
 * - 409 `TRASH_VERSION_CHANGED`: the row changed under the operator since this screen last read
 *   it. Specific reload-and-retry copy, not the generic fallback.
 * - Anything else (network failure, an unrelated `ApiError`, …): falls through to
 *   `describeApiError`'s generic fallback message.
 *
 * @complexity O(1) — one `instanceof` check plus two fixed comparisons.
 */
/** The callbacks a form row menu needs. Passed in rather than imported so this module stays free
 *  of state, mirroring `Jini redirects/rules.ts`'s `RedirectRowMenuHandlers`. `onDelete` opens the
 *  `ConfirmDialog` in `FormsList.tsx` — see that component's own render for why the actual
 *  `port.trashForm` call waits for the confirm, not this selection. */
/**
 * The row-action menu for one form. `RowMenu` has no per-item `disabled` — the in-flight guard lives
 * in `use-forms-list.hooks.ts`'s own `toggleStatus` (a no-op while `rowSavingId` is already set), the
 * same shape `Jini redirects/react/hooks/use-redirects.hooks.ts`'s `onToggleStatus` uses for its identical `if (saving) return;`
 * guard. (CORRECTED 2026-09-05: this comment previously said the guard "stays in the caller's
 * `onToggleStatus` closure (`FormsList.tsx`'s own `if (rowSavingId) return;`)" and claimed that was
 * the same shape `Jini redirects/react/pages/RedirectsPage.tsx` uses — false; `Jini redirects/react/pages/RedirectsPage.tsx` never had such a guard inline, only its
 * hook does. Flagged by the 2026-09-05 Gemini admin-tooling audit as a standing no-logic-in-`.tsx`
 * violation; moving the guard into the hook also fixed the comment's own false precedent claim.)
 *
 * @complexity Time/space: O(1) — three fixed entries, no iteration.
 */
    // Slug, not id — the admin URL reads `/admin/forms/<slug>` (ui-fixes-backlog.md #8); the GET
    // route still resolves an id too, so this is not a behavior change for any existing bookmark.
    // Opens `FormsList.tsx`'s `ConfirmDialog` — no network call from this selection itself, same
    // "a click alone can never delete" contract `use-form-submission-detail.hooks.ts`'s
    // `requestDelete` already documents for the sibling submission-delete flow.
/** The two tab-panel views on an existing form's editor (`formId !== "new"`). */
/**
 * Roving-tabindex arrow-key step for the Fields/Submissions tablist — ArrowLeft/ArrowRight cycle
 * between the two tabs, Home/End jump to the first/last.
 *
 * @complexity O(1) — `FORM_TABS` is a fixed 2-item array.
 */
/** Shared "what do we call this field in a title/label" fallback — a blank draft field has neither
 *  a label nor an id yet, so both the kebab's `aria-label` and the modal's own `<h2>` need the same
 *  `label -> id -> "Field N"` chain rather than risking the two drifting apart. */
/** @complexity O(n) in `fields.length`. */
/** @complexity O(n) in `fields.length`. */
/** @complexity O(n) in `fields.length`. */
/** The already-persisted field ids on a form — `FormFieldsEditor` disables the id input and the
 *  Remove button for these (a saved field's id cannot be changed or removed once created). `null`
 *  (form not loaded yet, or the "new form" case) has no existing ids. */
// ---------------------------------------------------------------------------
// Field attributes modal (per-field CSS classes + HTML attributes)
// ---------------------------------------------------------------------------
/** Mirrors `forms.ts`'s `ATTRIBUTE_NAME_PATTERN` exactly — see `FormEditor.tsx`'s own header
 *  comment for why this is a fast-reject-only duplicate, not the authoritative check. Keep in sync
 *  by hand if the server allowlist changes. */
/** Same bounds as `forms.ts`'s `MAX_CLASS_NAME_LENGTH`/`MAX_ATTRIBUTES_PER_FIELD` — client-side
 *  early-reject only, not enforcement (see `ATTRIBUTE_NAME_PATTERN` above). */
/** A handful of the allowlisted names as real, pickable suggestions (the modal's own "here's what
 *  you can do" surface — an operator has no other way to discover the allowlist) rather than every
 *  one: `aria-*`/`data-*` are open namespaces, so `aria-label`/`data-testid` stand in for the whole
 *  prefix family instead of listing every field-specific `aria-*` name that doesn't exist yet. */
/** Local-only row key for the modal's attribute list, so React can key a row before it has a
 *  stable identity — same `_rowId`/module-counter pattern `collections/rules.ts`'s
 *  `EditFieldsDialog` support uses for its own draft field rows. */
/** @complexity O(n) in `rows.length`. */
/** @complexity O(n) in `rows.length`. */
/** @complexity O(n) in `rows.length`. */
/**
 * Validates + shapes `FieldAttributesDialog`'s draft into the `Partial<AdminFormField>` patch
 * `onSave` applies: a class-name length cap, then every named attribute row against the allowlist
 * (blank names are silently skipped — an empty trailing row is not an error), then a total-count
 * cap on the surviving attributes. The security-relevant check is server-side (`forms.ts`'s
 * `validateFieldDescriptors`); this is the fast, pre-save rejection only — see this feature's own
 * `ATTRIBUTE_NAME_PATTERN` doc.
 *
 * @complexity O(n) in `rows.length`, short-circuiting on the first disallowed name.
 */
```
