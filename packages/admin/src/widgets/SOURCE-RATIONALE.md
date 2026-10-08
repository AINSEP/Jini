# Source rationale retained for C5 Part A

Active owners use ports/options; historical host path names below identify provenance. Every original why comment is retained here.

## apps/admin/src/features/widgets/WidgetRegions.tsx

/**
 * @file `WidgetRegionsScreen` (`ui.spec.md` §2.4/§3.6/§4.5/§9) — `/admin/widgets/regions` — markup
 * only. Lists currently-bound regions; the bind-new-region control is a free-text `regionKey`
 * input, mirroring `Menus.tsx`'s location-assign control exactly (no "theme declares regions" list
 * API exists to source a dropdown from — `ThemeManifest.regions` is read server-side at render
 * time, not exposed as an admin-listable registry; see `ui.spec.md` §9's disclosed dependency-gap
 * note).
 *
 * State, the fetch, and bind live in `hooks/use-widget-regions.hooks.ts`.
 */

/**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */


  // Region keys are stable and unique, same per-row-handle derivation every other list on this
  // workstream uses (`buildAgentListHandles`) — needed because `DataTable`'s `cell` callback only
  // receives the row, not its index.

/* `page-header-split` (`styles.css`) — same shared idiom every editor with a back button
          now uses: back link alone at the left rail, title block centred. This screen's own
          right-rail action isn't a Save button but the bind-a-region control (input + Bind
          button); `.page-header-actions` treats it exactly the same way (owner, 2026-09-22 — the
          back link used to float above the header entirely, uncoordinated with the title, and
          read "← Widgets"; it now reads the shared "← Back" every other editor got in the same
          pass). */

/* Visible label shortened to a plain "← Back" (owner, 2026-09-22 — every editor's back
              button reads the same short way now). `aria-label` keeps "Back: Widgets" —
              colon-joined rather than concatenated into a sentence so it needs no new per-locale
              phrase key and still starts with the exact visible text (WCAG 2.5.3 Label in Name). */

/* One group, so a wrapping row keeps the key field beside its own Bind button instead
              of beside Publish (mobile sweep 2026-10-07). */

## apps/admin/src/features/widgets/WidgetsLibrary.tsx

/**
 * @file `WidgetsLibraryScreen` (`ui.spec.md` §2.1/§3.1/§4.1) — the widget library/list screen,
 * `/admin/widgets` — markup only. Mirrors `Menus.tsx`'s list-table/status-badge/header-action
 * shape exactly.
 *
 * State and the fetch live in `hooks/use-widgets-library.hooks.ts`; the shared type-label
 * derivation lives in `rules.ts`. Delete always confirms first (`pendingTrash`/`ConfirmDialog`
 * below) and moves the widget to the Trash — there is no purge/force-purge escalation here any
 * more (2026-09-21, `trash-delete-architecture.md`): the server's widget purge route was removed,
 * a trashed widget is hidden from this list by the server, and the Trash screen owns
 * restore/purge from here.
 */

/**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */

/** The list screen's two independent notices — a fetch/action error, and malformed widget records
 *  the server could not read — pulled out of `WidgetsLibrary`'s own render body as a top-level
 *  component under the tightened ≤9/≤9 pass. */

/** Translator closure — see `WidgetsLibrary()`'s own `t`. Optional (identity default) since this
   *  component is exported and unit-tested directly without one — same "default to the real thing,
   *  a stub renders English" convention every `use*Hook` prop in this app already follows. */


  // Widget ids are stable and unique, same per-row-handle derivation every other list on this
  // workstream uses (`buildAgentListHandles`) — the title link and the Trash/Delete button both
  // need one, since `DataTable`'s `cell` callback only receives the row, not its index.

                // Slug, not id (2026-09-22, URL-uses-slug — mirrors `FormsList.tsx`'s
                // `/admin/forms/${form.slug}` row link): the editor resolves either
                // (`read-service.ts`'s `getWidgetInstance`), but the slug is the readable one.

            // Monospace like Collections' "Key" column (`Collections.tsx`) — a slug is an
            // identifier, not prose.

            // Not converted to a `RowMenu` — this is the row's only action (see report: a menu
            // with one item is pure overhead over a direct button). Still labeled for
            // accessibility, matching `Roles.tsx`/`Users.tsx`'s existing pattern for an actions
            // column that isn't a bare `<th></th>`.

## apps/admin/src/features/widgets/WidgetRegionEditor.tsx

/**
 * @file `RegionPlacementEditorScreen` + `RegionPlacementList` (`ui.spec.md` §2.5/§2.6/§3.7/§3.8/
 * §4.6/§4.7) — `/admin/widgets/regions/{regionKey}` — markup only. Flat ordered list, ↑/↓ move
 * controls, mirrors `MenuEditor.tsx`'s `ItemRow`/`moveAtPath` reorder UX exactly, without the
 * nesting a menu tree has (a region's placement list has no parent/child structure, REQ-15).
 *
 * State, the fetch, and save live in `hooks/use-widget-region-editor.hooks.ts`; the reorder swap
 * and the draft-placement builder live in `rules.ts`.
 */

/**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */

/** The page header's Save-side actions cluster — the save-status message/error and the Save
 *  button — pulled out of `WidgetRegionEditor`'s own render body as a top-level component under
 *  the tightened ≤9/≤9 pass. Each of the three spans below is its own independent conditional (a
 *  save succeeded, a save failed, the save is in flight); extracting the whole cluster moves all
 *  three out of the parent's own scope at once.
 *
 * The "back to regions" link used to live in this same cluster (both sat together at the header's
 * right edge). It moved out to `WidgetRegionEditor`'s own `.page-header-lead` (2026-09-22, split
 * header pass — see that render's own comment) because the split header needs the back link and
 * this actions cluster on OPPOSITE rails, not adjacent — a single component can't render into two
 * non-adjacent grid cells with the title between them without breaking DOM/tab order, so the
 * cluster shed the one piece that had to move. */

/** Translator closure — see `WidgetRegionEditor()`'s own `t`. Optional (identity default) since
   *  this component is exported and unit-tested directly without one. */


  // Placement ids are stable and unique, same per-row-handle derivation every other list on this
  // workstream uses (`buildAgentListHandles`).

/* `page-header-split` (`styles.css`) — same shared idiom Pages/Posts/Forms already use:
          back link alone at the left rail, title block centred. Widget Regions never grew a
          separate `.editor-action-row` below a toolbar, so Save/status (`.page-header-actions`)
          stay IN the header instead of an empty third rail (owner, 2026-09-22: "put the back
          button on the left, like the other editors" — see `WidgetRegionEditorHeaderActions`'s own
          comment for why the back link moved out of that component). */

/* Visible label shortened to a plain "← Back" (owner, 2026-09-22 — every editor's back
              button reads the same short way now). `aria-label` keeps "Back: Regions" —
              colon-joined rather than concatenated into a sentence so it needs no new per-locale
              phrase key and still starts with the exact visible text (WCAG 2.5.3 Label in Name). */

## apps/admin/src/features/widgets/rules.ts

/**
 * @file Pure logic shared by the four `widgets` feature screens (`WidgetsLibrary`,
 * `WidgetInstanceEditor`, `WidgetRegionEditor`, `WidgetRegions`) — everything that computes a
 * value rather than rendering one. One shared module for the whole folder, matching
 * `features/posts/rules.ts` and `features/collections/rules.ts`'s convention for a multi-component
 * feature: the decisions live in one importable, directly testable module with no React in it.
 */

/** The Widgets library screen's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s
 *  `TAXONOMY_RESOURCE` for why this is a plain colocated constant rather than a shared registry.
 *  Agent-writable via `widgets_create_instance`/`widgets_update_instance`/`widgets_trash_instance`
 *  (`apps/website/src/features/widgets/agent-tools.ts`), each of which changes a row this screen
 *  lists. */

/** The Widget Regions screen's own name on the same bus — a separate constant because it is a
 *  separate screen backed by a separate read (`listWidgetRegions`, not `listWidgets`). Agent-
 *  writable via `widgets_bind_region`, which adds a row this screen lists. The per-region PLACEMENT
 *  edits (`widgets_set_region_placements`/`widgets_insert_embed`/`widgets_remove_embed`/
 *  `widgets_reorder_embeds`) land on `WidgetRegionEditor` instead — a single-region editor with its
 *  own `baseVersion`-guarded save, the same "an open editor gets optimistic-concurrency, not a bus
 *  subscription" precedent `use-dockerfile-source.hooks.ts` and `use-post-editor.hooks.ts` already
 *  establish — so it is deliberately NOT wired here. */

/** The five closed v1 widget types (`WIDGET_TYPE_OPTIONS`, REQ-09) as a lookup set — used to catch
 *  a garbage `?type=` query param on `/widgets/new` before it reaches a live editor shell. */

/**
 * The display label for a widget's type — `WidgetsLibrary`'s type column and
 * `WidgetInstanceEditor`'s type caption both fall back to the raw stored value when it isn't one
 * of the known v1 types, rather than rendering blank. The English label is translated afterward via
 * `widgets-i18n.ts`'s `WIDGETS_DICT` (keyed by the English label text, same "translate the resolved
 * display string" shape `lib/admin-nav-i18n.ts`'s `translateAdminNavLabel` uses) rather than
 * `WIDGET_TYPE_OPTIONS` itself carrying per-locale labels — that constant is shared with
 * `WidgetConfigFields.tsx`'s config-form dispatch and is out of this pass's scope.
 *
 * @complexity Time/space: O(k) in `WIDGET_TYPE_OPTIONS`'s fixed, small size (five entries) — not
 * caller-controlled, so effectively O(1).
 */

/** Whether `widgetType` is one of the five closed v1 types — see {@link KNOWN_WIDGET_TYPES}'s own
 *  comment for why this only matters for `isNew`/`?type=` (a garbage already-saved type was
 *  validated server-side at creation and can't reach this check).
 *
 * @complexity Time/space: O(1) — `Set` membership.
 */

/** The field errors a `WIDGETS_CONFIG_VALIDATION_ERROR` 409 carries, or an empty array for any
 *  other error shape — `WidgetInstanceEditor`'s save path only has field-level copy to show for
 *  this one error code. */

/**
 * `WidgetInstanceEditor`'s single source of truth for "what type is this editor configuring" —
 * the `?type=` query param while creating, the loaded widget's own type once one exists. Kept as
 * one derivation (not two independent reads) so the two paths can't drift.
 *
 * @complexity Time/space: O(1).
 */

/**
 * Reorders `items` by swapping the element at `index` with its neighbor in `direction`, or returns
 * `items` unchanged when the swap would go out of bounds — `WidgetRegionEditor`'s ↑/↓ move
 * controls, mirroring `MenuEditor.tsx`'s `moveAtPath` for a flat (non-nested) list.
 *
 * Returns a new array rather than mutating `items` — callers pass this straight to a `useState`
 * setter, which needs a new reference to re-render.
 *
 * @complexity Time/space: O(n) — one array copy per call.
 */


// Distinguishes draft keys created in the same millisecond without randomUUID.

/**
 * The locally-drafted placement `WidgetRegionEditor` appends when an operator picks a widget from
 * `WidgetAddControl`, before a Save round trip assigns it a server-known identity. `placementId`
 * prefers `crypto.randomUUID()` (unavailable in some test/SSR environments, hence the fallback) —
 * either way it is a draft key the reorder/remove/toggle handlers can address by, not a value the
 * server ever sees verbatim (Save sends `widgetEntryId`/`enabled` per placement, not this id).
 *
 * @complexity Time/space: O(1).
 */

/** What `WidgetInstanceEditor`'s `save` sets on a caught error — the message plus any field-level
 *  errors the `WIDGETS_CONFIG_VALIDATION_ERROR` case carries. */

/**
 * `save`'s catch-block decision, pulled out to a top-level pure function per the 2026-08-12
 * complexity-ceiling pass: classifies a caught error into the message/field-errors combination the
 * save path shows, so the three-way `instanceof`/`.code` branching doesn't count against `save`'s
 * own scope. `staleVersionMessage` is injected rather than imported so this module doesn't need to
 * know which resource's own stale-version copy applies — `WidgetRegionEditor`'s save path has its
 * own, differently-worded one.
 *
 * @complexity Time/space: O(1).
 */

/**
 * `WidgetRegionEditor`'s save catch-block decision, pulled out for the same reason as
 * {@link resolveWidgetSaveError} (2026-08-12 stale-save-guard pass pushed `save`'s own cognitive
 * complexity over the 9/9 ceiling): the `WIDGETS_AREA_CONFLICT`/generic two-way branch doesn't need
 * to count against `save`'s own scope. Only an error string — unlike the instance editor's version,
 * this screen's save path has no per-field validation errors to carry.
 *
 * @complexity Time/space: O(1).
 */

/**
 * The path `use-widget-instance-editor.hooks.ts`'s load effect replace-navigates to once a widget
 * has loaded, when the URL segment that resolved it was the widget's raw id rather than its slug —
 * mirrors `FormEditor.tsx`/`FormsList.tsx`'s `/forms/:slug` convention, now extended to widgets
 * (the server's `getWidgetInstance` resolves either, `read-service.ts`).
 *
 * A thin wrapper over `lib/slug-redirect-path.ts`'s generalised `slugRedirectPath` (readable-slugs
 * S6a, 2026-09-23 — this was the FIRST instance of the rule, before posts/pages needed it too), kept
 * as its own named function so call sites read "widget", not the generic base string. Byte-for-byte
 * unchanged output — see that module's own doc for the full "why UUID, why null" reasoning.
 *
 * @complexity Time/space: O(1).
 */

## apps/admin/src/features/widgets/WidgetInstanceEditor.tsx

/**
 * @file `WidgetInstanceEditorScreen` (`ui.spec.md` §2.2/§3.3/§4.3) — create/edit one widget
 * instance, `/admin/widgets/new?type=X` and `/admin/widgets/{id}` — markup only. Mirrors
 * `MenuEditor.tsx`'s editor-shell shape; config editing delegates to the shared
 * `WidgetConfigFields` (§3.4).
 *
 * State, the fetch, and save live in `hooks/use-widget-instance-editor.hooks.ts`; the field-error
 * extraction, the known-type check, and the type label live in `rules.ts`.
 */

/** REQ-34/`ui.spec.md` §3.5 — rendered only when `references.length > 0`, before the config form. */

/** The four early-exit states `WidgetInstanceEditor` can be in before the full editor shell is
 *  reachable. Decided together as one pure function rather than four sequential `if`s in the
 *  component body — a top-level function, not a nested closure, so it both leaves the component's
 *  own branch count (this is what dropped it from 14/11 to under the ceiling) AND is independently
 *  testable without mounting the component or its hook. */

  // Missing `?type=` is the "no-type" guard above; a GARBAGE one previously wasn't caught (audit
  // Major finding): `widgetType` is a query param cast to `AdminWidgetType` with no runtime check,
  // so an unrecognized value reached a full live editor shell — title field, working Save button —
  // with zero config fields and zero explanation (`WidgetConfigFields`'s switch has no `default`
  // beyond `return null`). Scoped to `isNew` only: an already-saved widget's type was validated
  // server-side at creation, so this guards the one confirmed-reachable path (a hand-typed or
  // bookmarked `?type=` value) rather than second-guessing already-loaded data.

/** Renders the notice for whichever guard applies — split from `widgetInstanceGuard` itself so the
 *  decision (data in, data out) and the rendering stay separately testable. */

/**
   * Dependency injection seam for tests — the same convention `Posts.tsx`'s `usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */

  // Unreachable in practice — `widgetInstanceGuard`'s "no-type" case already covers a null
  // `widgetType` above — but TS can't see through that opaque function call, so this narrows the
  // type for the JSX below rather than asserting it with `!`.


  // `WidgetConfigFields`'s own copy lives in `shared-components-i18n.ts`, a DIFFERENT dictionary
  // from this screen's own `t` (bound to `widgets-i18n.ts`'s `WIDGETS_DICT` — see the hook import
  // above) — reusing `t` here would look "Text"/"Menu"/etc. up in the wrong dictionary and silently
  // render the English fallback in every non-English locale. Bound off the same `locale` this
  // screen already resolves, mirroring `WidgetPickerDialog.hooks.tsx`'s `t = (key) =>
  // sharedComponentsT(locale, key)` shape exactly.

/* `page-header-split` (`styles.css`) — same shared idiom Pages/Posts/Forms already use:
          back link alone at the left rail, title block centred. Widgets never grew a separate
          `.editor-action-row` below a toolbar, so Save/status stay IN the header instead of an
          empty third rail — `.page-header-actions` (`styles.css`) pins that rail to the right and
          gives it its own narrow-container stacking row alongside the back link (owner,
          2026-09-22: "put the back button on the left, like the other editors" — this used to be a
          plain `.page-header`/`.page-actions` row with Back and Save both crowded at the right;
          the narrow-viewport "title, then a button row underneath" layout it already had is kept
          as-is, since that's the layout the owner said they liked). */

/* Visible label shortened to a plain "← Back" (owner, 2026-09-22 — every editor's back
              button reads the same short way now). `aria-label` keeps "Back: Widgets" —
              colon-joined rather than concatenated into a sentence so it needs no new per-locale
              phrase key and still starts with the exact visible text (WCAG 2.5.3 Label in Name). */

              // Same shape as `PostEditor.tsx`'s back link: `preventDefault` here also stops
              // `router.ts`'s document-level click interceptor from firing `navigate()`, since that
              // listener's first check is `event.defaultPrevented`.

/* Audit finding: placeholder-only, no `<label>` — same fix as `PostEditor.tsx`'s title field
          (see `styles/editor.css`'s `.a11y-label-wrap` comment). */

## apps/admin/src/features/widgets/hooks/use-widget-regions.hooks.ts

/**
 * @file Everything the `WidgetRegions` screen does, so `WidgetRegions.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error handling. Naming follows
 * `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because nothing
 * outside `features/widgets` needs it.
 *
 * `deps.port`/`deps.locale`/`deps.navigate` are injected (see `widget-regions-port.hooks.ts`)
 * rather than reaching for `lib/api`'s `api`, `useAdminLocale()`, and `lib/router`'s `navigate`
 * directly, sharing the `WidgetRegionsPort` `use-widget-region-editor.hooks.ts` also injects.
 * `widgets-i18n.ts`'s own `t(locale, key)` — aliased `translate` here to avoid colliding with this
 * file's own bound `(key) => string` closure — stays a direct import for this hook's OWN error
 * strings: a pure `DICT[locale]?.[key] ?? key` lookup with no host boundary, same "pure, no-I/O"
 * category the convention doc names for `describeApiError`.
 *
 * `deps.t` (standing i18n rule, 2026-08-11 — see `use-widgets-library.hooks.ts`'s identical note):
 * injected so `WidgetRegions.tsx` sources its UI copy from this hook instead of its own
 * `useAdminLocale()`/`WIDGETS_DICT` import.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass — see that hook's own header):
 * `load` is pulled into a `useCallback` so it can also be handed to that hook, which re-runs it
 * whenever `widgets_bind_region` (`apps/website/src/features/widgets/agent-tools.ts`) binds a new
 * region from an assistant run this screen otherwise has no way to learn about.
 */

/** `null` until the initial load settles — the caller renders a loading state. */

/** Bound translator — `WidgetRegions.tsx`'s only source of UI copy; see this file's own header. */

    // Claim this call's generation BEFORE the request starts — see `useSettlementGeneration`'s own
    // doc for why a synchronous ref bump, not `useState`, is what makes two overlapping calls each
    // see the other's claim. Needed now that a content refresh can fire more than once per run
    // (mid-run tool progress, see `AssistantDock.hooks.tsx`), so two overlapping `load()` calls have
    // no ordering guarantee on their responses.

    // `port`/`settlement` are added — see `use-page-editor.hooks.ts`'s identical note: function-
    // scoped values ESLint's exhaustive-deps rule can see, referentially stable in production, so
    // this changes nothing about when this callback's identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps

/**
 * Binds the real `/api/.../widgets/regions` client, the real `useAdminLocale()`, the real
 * `lib/router` `navigate`, and a `WIDGETS_DICT`-bound translator — see
 * `widget-regions-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `WidgetRegions.tsx`
 * composes this and a test composes {@link useWidgetRegions} with `createFakeWidgetRegionsPort`.
 */

## apps/admin/src/features/widgets/hooks/widgets-port.hooks.ts

/**
 * @file What `use-widgets-library.hooks.ts` and `use-widget-instance-editor.hooks.ts` need from
 * the outside world, as an interface rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and `redirects-port.hooks.ts` (the
 * canonical reference): this file declares, `widgets-dependencies.hooks.ts` binds the real `api`
 * client, and nothing else under `features/widgets` imports `lib/api` for these five routes. One
 * shared port rather than one per hook — both hooks read/write the same widget-INSTANCE resource
 * (`AdminWidget`); region/placement routes are a different resource, covered by the separate
 * `WidgetRegionsPort` next to `use-widget-region-editor.hooks.ts`/`use-widget-regions.hooks.ts`.
 *
 * `describeApiError`/`ApiError` stay direct imports in the hooks that use this port — pure
 * error-classification, no I/O, same reasoning as `redirects-port.hooks.ts`'s own exclusion of
 * `describeApiError`.
 */

/** No `options` (`api.createWidget`'s own `slug` override) — narrowed to what's actually called:
   *  `use-widget-instance-editor.hooks.ts` always calls this with one argument. Forwarding a second
   *  positional `undefined` when nothing was passed is observably different from omitting the
   *  argument entirely (an exact-arity `toHaveBeenCalledWith` assertion on the real `api.createWidget`
   *  spy distinguishes them) — narrowing here, not widening the wrapper, is what keeps the port a
   *  true callee-rename with zero behavior change. */

/** `title` is optional (SPEC-043 ui.spec §4.3): omitted keeps the widget's current title. */

/** Moves a widget instance to the Trash via the generic single-item route
   *  (`POST .../trash/items`, `api.trash({ type: "widget", id })`) — the same route every other
   *  admin delete button now goes through (see `trash-delete-architecture.md`). The Trash screen
   *  owns restore/purge from here; this port no longer has a purge method at all. */

## apps/admin/src/features/widgets/hooks/use-widgets-library.hooks.ts

/**
 * @file Everything the `WidgetsLibrary` screen does, so `WidgetsLibrary.tsx` is only markup.
 *
 * Trash rewrite (2026-09-21, `trash-delete-architecture.md`): the widget-specific purge/
 * force-purge escalation (`WIDGETS_REFERENCED` 409, "Delete permanently") is gone — the server's
 * widget purge route was removed, and every admin delete button now goes through the generic
 * `POST .../trash/items` (`port.trashWidget`, which binds to `api.trash({ type: "widget", id })`).
 * `load()` no longer asks for `includeInactive` — the server's default (active-only) already does
 * what this screen wants, since a trashed widget belongs on the Trash screen, not here.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local
 * because nothing outside `features/widgets` needs it.
 *
 * `deps.port`/`deps.locale` are injected (see `widgets-port.hooks.ts`) rather than reaching for
 * `lib/api`'s `api` and `useAdminLocale()` directly, sharing the `WidgetsPort`
 * `use-widget-instance-editor.hooks.ts` also injects — both hooks read/write the same widget-
 * instance resource. `widgets-i18n.ts`'s own `t(locale, key)` — aliased `translate` here to avoid
 * colliding with this file's own bound `(key) => string` closure — stays a direct import for this
 * hook's OWN error strings: a pure `DICT[locale]?.[key] ?? key` lookup with no host boundary, same
 * "pure, no-I/O" category the convention doc names for `describeApiError`.
 *
 * `deps.t` (standing i18n rule, 2026-08-11 — a component with a hook gets a BOUND `t` from that
 * hook, not its own `useAdminLocale()`/dictionary import, same shape `use-pages.hooks.ts`
 * established): injected so `WidgetsLibrary.tsx` sources its UI copy from this hook instead of its
 * own `useAdminLocale()`/`WIDGETS_DICT` import. `locale` is ALSO exposed, not just `t`: this
 * screen passes the raw string on to `widgetTypeLabel` (`../rules.ts`), same "row-menu/label
 * builder is a different, out-of-scope thing" precedent `use-pages.hooks.ts` cites for
 * `pageRowMenuItems`.
 *
 * `useContentRefreshSubscription` (staleness-bug generalization pass — see that hook's own header):
 * `load` is pulled into a `useCallback` so it can also be handed to that hook, which re-runs it
 * whenever `widgets_create_instance`/`widgets_update_instance`/`widgets_trash_instance`
 * (`apps/website/src/features/widgets/agent-tools.ts`) writes a widget instance from an assistant
 * run this screen otherwise has no way to learn about.
 */

/** `null` until the initial load settles — the caller renders a loading state. */

/** Count of widget-instance records the server could not read (unparseable `fields_json`).
   *  `0` and `undefined` both mean "nothing to say". */

/** IDs of the malformed widget records counted in {@link skippedCount}. */

/** The widget a "Trash" click is asking to confirm — `null` when the dialog is closed. Set by
   *  `requestTrash`; no network call happens until {@link confirmTrash}. */

/** True only while the CONFIRMED trash for {@link pendingTrash} is in flight — same
   *  `pendingX !== null && xId === pendingX.id` shape `use-media.hooks.ts` uses. */

/** Bound translator — `WidgetsLibrary.tsx`'s only source of UI copy; see this file's own header. */

/** The raw resolved locale — exposed only because `widgetTypeLabel` (`../rules.ts`) genuinely
   *  needs it, not `t`. */

  // Dossier C5 follow-up (2026-08-03): `listWidgetInstances` silently skips a widget-instance row
  // whose `fields_json` doesn't parse into the expected shape, rather than 500ing the whole
  // screen — correct, but it used to be invisible. The server now returns the skip count and
  // record IDs; this surfaces them as a quiet note, never as an error. `undefined`/`0` both mean
  // "nothing to say", handled identically below.

  // The widget a "Trash" click is asking to confirm — `null` when the dialog is closed.
  // `ConfirmDialog` stays mounted unconditionally in `WidgetsLibrary.tsx`; this is what drives its
  // `open` prop.

  // Latest-wins guard for `load()` (S1, plan-content2.md 2026-09-20): a mount read, the content
  // refresh bus, and a write-triggered reload can all be in flight together with no ordering
  // guarantee between them. Without this, trashing A then B races two `load()` calls — if A's
  // stale read answers after B's, B renders as present again even though the server already
  // trashed it. Its siblings `use-widget-regions.hooks.ts` and `use-widget-region-editor.hooks.ts`
  // guard the same shape.

        // No `includeInactive` — the server's default (active-only) is exactly this screen's view
        // now that a trashed widget is the Trash screen's concern, not this list's. See this
        // file's own header for why the old client-side `purged` filter is gone too.

    // `port` is added — see `use-page-editor.hooks.ts`'s identical note: a function-scoped value
    // ESLint's exhaustive-deps rule can see, referentially stable in production, so this changes
    // nothing about when this callback's identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps

/** Opens the "Move to trash?" confirm for `widget` — no network call happens until
   *  {@link confirmTrash}. */

/** The confirmed trash request. Maps the two error shapes the generic Trash route defines
   *  (`items.ts`): a `409 TRASH_VERSION_CHANGED` (the row changed since this screen last read it —
   *  shown so the operator can reload) and a `404 NOT_FOUND` (it's already gone — no error to show,
   *  just a quiet re-read so the row drops out of the list). Any other failure falls back to the
   *  generic "delete failed" message.
   *
   * @complexity Time/space: O(1) plus `load()`'s own re-read cost. */

/**
 * Binds the real `/api/.../widgets` client, the real `useAdminLocale()`, and a `WIDGETS_DICT`-bound
 * translator — see `widgets-dependencies.hooks.ts`.
 *
 * The zero-argument-dependencies half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `WidgetsLibrary.tsx` composes this and a test composes {@link useWidgetsLibrary} with
 * `createFakeWidgetsPort`.
 */

## apps/admin/src/features/widgets/hooks/use-widget-region-editor.hooks.ts

/**
 * @file Everything the `WidgetRegionEditor` screen does, so `WidgetRegionEditor.tsx` is only
 * markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error handling. Naming follows
 * `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because nothing
 * outside `features/widgets` needs it.
 *
 * `deps.port`/`deps.locale` are injected (see `widget-regions-port.hooks.ts`) rather than reaching
 * for `lib/api`'s `api` and `useAdminLocale()` directly, sharing the `WidgetRegionsPort`
 * `use-widget-regions.hooks.ts` also injects — both read/write the region/placement resource.
 * `widgets-i18n.ts`'s own `t(locale, key)` — aliased `translate` here to avoid colliding with this
 * file's own bound `(key) => string` closure — stays a direct import for this hook's OWN error
 * strings: a pure `DICT[locale]?.[key] ?? key` lookup with no host boundary, same "pure, no-I/O"
 * category the convention doc names for `describeApiError`.
 *
 * `deps.t` (standing i18n rule, 2026-08-11 — see `use-widgets-library.hooks.ts`'s identical note):
 * injected so `WidgetRegionEditor.tsx` sources its UI copy from this hook instead of its own
 * `useAdminLocale()`/`WIDGETS_DICT` import.
 */

/** Locale-aware replacement for the old `STALE_VERSION_MESSAGE` constant — this string is only
 *  ever read inside this hook itself (after a `WIDGETS_AREA_CONFLICT` 409), so it can be a
 *  function of `locale` instead of a locale-blind module constant. */

/** Bound translator — `WidgetRegionEditor.tsx`'s only source of UI copy; see this file's own
   *  header. */

/** The raw resolved locale — exposed only because `widgetTypeLabel` (`../rules.ts`) needs it. */


  // Stale-response guard (2026-08-12 audit finding): `load` has two call sites — the mount/
  // `regionKey`-change effect below, AND `save()`'s own post-mutation re-read — so a per-effect-run
  // closure flag (fine when there is only one call site) can't track staleness here: a `save()`-
  // triggered reload has no effect run of its own to flip a flag on cleanup. A monotonic request id
  // does: every `load()` call — from either site — mints the next id, and a completion only commits
  // if it is still the most recent one. Without this, navigating from one region to another while an
  // older `getWidgetRegion` is still in flight (or a `save()`-triggered reload racing a nav away) can
  // overwrite the currently-viewed region with a previous one's placements. Guarded on every
  // completion path (`then`/`catch`/`finally`), not just the success path — an unguarded `finally`
  // clearing `loading` is the one most likely to leave stale data on screen with no spinner to flag
  // it.

    // A freshly-loading region, by definition, has no save of its OWN in flight yet — clears
    // `saving` so a save started against the region navigated away FROM (guarded no-op below once
    // it resolves) can't leave this region's spinner stuck on indefinitely. Also fires (harmlessly,
    // to the same value) when THIS call is save()'s own post-success reload, since `saving` is about
    // to read false either way once that save's own `finally` runs.

  // A draft placement carries no title/type (the region's placement list only has them for saved
  // rows), so without this lookup the new row rendered nameless until Save. A failed lookup just
  // leaves the draft as it was — the row still saves, and the post-save reload names it.


  // Stale-response guard, save() half (2026-08-12 audit finding): reuses `loadRequestIdRef` rather
  // than adding a second mechanism — save() snapshots the request id in flight when it STARTS, and
  // a completion only commits if no `load()` (from the `regionKey`-change effect below, i.e. the
  // operator navigating to a different region) has minted a newer one since. This also fixes the
  // interaction the audit flagged: an unguarded save used to call `load()` on completion even after
  // going stale, and THAT trailing `load()` would mint a newer request id than the new region's own
  // in-flight load — discarding the new region's correct response as "stale" by comparison. Skipping
  // the trailing `load()` entirely once `save()` itself is known-stale removes that interaction.

/**
 * Binds the real `/api/.../widgets/regions` client, the real `useAdminLocale()`, and a
 * `WIDGETS_DICT`-bound translator — see `widget-regions-dependencies.hooks.ts`.
 *
 * The zero-argument-dependencies half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `WidgetRegionEditor.tsx` composes this and a test composes {@link useWidgetRegionEditor} with
 * `createFakeWidgetRegionsPort`.
 */

## apps/admin/src/features/widgets/hooks/widget-regions-dependencies.hooks.ts

/**
 * @file The only place under `features/widgets` that reaches `lib/api` for the four
 * `WidgetRegionsPort` routes — see `widget-regions-port.hooks.ts` for why the split exists.
 */

/** The live implementation, as a module-level singleton — matches `redirects-dependencies
 *  .hooks.ts`'s `defaultRedirectsPort`. */

/** Seed state for {@link createFakeWidgetRegionsPort}. */

/** Keyed by `regionKey` — an area + its placements, as `getWidgetRegion` would return them. */

/** Keyed by widget id — what `getWidget` returns for a just-added placement. */

/**
 * An in-memory {@link WidgetRegionsPort} for tests — lets a test describe "this region has these
 * placements" directly, instead of hand-building `Response` objects and stubbing global `fetch`.
 * Shipped alongside the real binding per the pattern's "every port gets a fake" rule.
 */

/** Every region binding currently in the fake's store, in list order. */

## apps/admin/src/features/widgets/hooks/use-widget-instance-editor.hooks.ts

/**
 * @file Everything the `WidgetInstanceEditor` screen does, so `WidgetInstanceEditor.tsx` is only
 * markup.
 *
 * Extracted verbatim — same state, same effect deps, same error handling. The doc comments below
 * moved WITH the functions they describe. Naming follows `hooks/use-settings-slice.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/widgets` needs it.
 *
 * `deps.port`/`deps.locale`/`deps.navigate` are injected (see `widgets-port.hooks.ts`) rather than
 * reaching for `lib/api`'s `api`, `useAdminLocale()`, and `lib/router`'s `navigate` directly,
 * sharing the `WidgetsPort` `use-widgets-library.hooks.ts` also injects — both read/write the same
 * widget-instance resource. `widgets-i18n.ts`'s own `t(locale, key)` — aliased `translate` here to
 * avoid colliding with this file's own bound `(key) => string` closure — stays a direct import for
 * this hook's OWN error strings: a pure `DICT[locale]?.[key] ?? key` lookup with no host boundary,
 * same "pure, no-I/O" category the convention doc names for `describeApiError`.
 *
 * `deps.t` (standing i18n rule, 2026-08-11 — see `use-widgets-library.hooks.ts`'s identical note):
 * injected so `WidgetInstanceEditor.tsx` sources its UI copy from this hook instead of its own
 * `useAdminLocale()`/`WIDGETS_DICT` import. `locale` is ALSO exposed, not just `t`: this screen
 * passes the raw string on to `widgetTypeLabel` (`../rules.ts`), same "row-menu/label builder is a
 * different, out-of-scope thing" precedent `use-pages.hooks.ts` cites for `pageRowMenuItems`.
 */

/** `options.replace` (2026-09-22, URL-uses-slug): the load effect below replace-navigates a
   *  raw-id URL to the widget's slug once it resolves — see `widgetSlugRedirectPath` (`../rules.ts`)
   *  — which must not grow a Back-button stop for a link the operator never actually followed. */

/** Locale-aware replacement for the old `STALE_VERSION_MESSAGE` constant — this string is only
 *  ever read inside this hook itself (after a `WIDGETS_VERSION_CONFLICT` 409), so it can be a
 *  function of `locale` instead of a locale-blind module constant. */

/** Identity of "which widget this hook is currently pointed at", matching the load effect's own
 *  `[props.widgetId, props.widgetType, isNew]` dependency list exactly. Collapsed to a single string
 *  so `save()`'s completion handlers can compare it with `!==` instead of a three-field object diff. */

/** The subset of `WidgetInstanceEditor`'s props this hook needs — the DI seam prop itself stays
 *  the component's own concern. */

/** The type this editor is configuring — the `?type=` query param while creating, the loaded
   *  widget's own type once one exists. `null` when neither is available. */

/** `useDirtyGuard`'s `confirmLeave` for the title/config pair — `WidgetInstanceEditor.tsx`'s back
   *  link calls it before leaving (Opus themes+widgets review, OPEN item 2: this editor previously
   *  had no unsaved-changes guard at all, unlike Posts/Pages). Always `true` with no prompt while
   *  `widget` is `null` (a brand-new, not-yet-saved widget) — same "nothing loaded to compare
   *  against yet" contract `useDirtyGuard`'s own doc describes; matches every other editor's
   *  identical carve-out. */

/** Bound translator — `WidgetInstanceEditor.tsx`'s only source of UI copy; see this file's own
   *  header. */

/** The raw resolved locale — exposed only because `widgetTypeLabel` (`../rules.ts`) genuinely
   *  needs it, not `t`. */


  // Stale-response guard (2026-08-12 audit finding): this is a route-param loader — the panel
  // router reuses this same component/hook for `/new` and every `/:id`, so navigating from one
  // widget to another (or from an existing widget to `/new`) can let an OLDER `getWidget` response
  // land after a NEWER one, overwriting the currently-viewed widget with a previous one's data (or,
  // for `/new`, populating a blank editor with a stale record). `cancelled` is flipped by this same
  // effect's own cleanup the instant `props.widgetId`/`props.widgetType`/`isNew` changes again,
  // before the new run starts — guarded on every completion path (`then`/`catch`/`finally`), not
  // just the success path, since an unguarded `finally` clearing `loading` is the one most likely to
  // leave stale data on screen with no spinner to flag it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stale-response guard keyed on widgetId/widgetType/isNew — see comment above.

    // A freshly-loading entity, by definition, has no save of its OWN in flight yet — clears
    // `saving` so a save started against the widget navigated away FROM (guarded no-op below once
    // it resolves) can't leave this new widget's spinner stuck on indefinitely.

        // URL-uses-slug (2026-09-22): `props.widgetId` reached this widget by whatever the URL
        // held — its current slug (the common case) or a raw id from an old bookmark/link, since
        // `getWidgetInstance` (`read-service.ts`) now resolves either. Only the id case needs a
        // history update; see `widgetSlugRedirectPath`'s own doc comment for why it returns `null`
        // otherwise. `replace`, not a pushed entry: the operator never chose to visit the id URL as
        // a distinct step, so Back shouldn't stop there either.


  // Stale-response guard, save() half (2026-08-12 audit finding): the load effect's `cancelled`
  // flag above is scoped to a single effect run and flipped by that SAME effect's own cleanup — but
  // save() isn't an effect, so a route change mid-save never flips it. `activeEntityRef` always
  // holds the latest widget identity this hook was RENDERED with (updated every render, not just on
  // effect re-run), so save()'s completion handlers can tell whether the operator has already
  // navigated to a different widget by the time an update/create call resolves, and skip committing
  // — including clearing `saving` — onto whatever widget is on screen now. (The load effect's own
  // `setSaving(false)` is the other half of that: it's what actually clears the spinner for the
  // NEWLY-viewed widget, since a stale save is no longer allowed to.) The `isNew` branch's own
  // `navigate()` + early `return` stays unguarded on purpose: it must always fire to land the
  // operator on the widget they just created, staleness or not.


  // Unsaved-changes guard (Opus themes+widgets review, OPEN item 2) — same shape
  // `use-post-editor.hooks.ts` already wires: `original` is `null` until a real widget is loaded, so
  // a brand-new/not-yet-saved widget has nothing to compare against yet and `confirmLeave` stays a
  // silent no-op for it, same as every other editor.

        // Slug, not id (2026-09-22 — mirrors `use-form-editor.hooks.ts`'s identical create-navigate,
        // see `get-by-id.ts`'s forms equivalent, `resolve-definition.ts`, for the id-or-slug
        // resolution this now lands on for widgets too, `read-service.ts`).

/**
 * Binds the real `/api/.../widgets` client, the real `useAdminLocale()`, the real `lib/router`
 * `navigate`, and a `WIDGETS_DICT`-bound translator — see `widgets-dependencies.hooks.ts`.
 *
 * The zero-argument-dependencies half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `WidgetInstanceEditor.tsx` composes this and a test composes {@link useWidgetInstanceEditor}
 * with `createFakeWidgetsPort`.
 */

## apps/admin/src/features/widgets/hooks/widget-regions-port.hooks.ts

/**
 * @file What `use-widget-region-editor.hooks.ts` and `use-widget-regions.hooks.ts` need from the
 * outside world, as an interface rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and `redirects-port.hooks.ts` (the
 * canonical reference): this file declares, `widget-regions-dependencies.hooks.ts` binds the real
 * `api` client, and nothing else under `features/widgets` imports `lib/api` for these four routes.
 * One shared port rather than one per hook — both hooks read/write the region/placement resource
 * (`AdminWidgetRegionBinding`/`AdminWidgetArea`/`AdminWidgetPlacement`), a DIFFERENT resource from
 * the widget-INSTANCE routes covered by the sibling `WidgetsPort` next to
 * `use-widgets-library.hooks.ts`/`use-widget-instance-editor.hooks.ts`.
 *
 * `describeApiError`/`ApiError` stay direct imports in the hooks that use this port — pure
 * error-classification, no I/O, same reasoning as `redirects-port.hooks.ts`'s own exclusion of
 * `describeApiError`.
 */

/** The one widget-INSTANCE read this resource needs: a just-added placement's title/type, which
   *  the region's own placement list only carries for rows it has already saved. */

## apps/admin/src/features/widgets/hooks/widgets-dependencies.hooks.ts

/**
 * @file The only place under `features/widgets` that reaches `lib/api` for the five `WidgetsPort`
 * (widget-instance) routes — see `widgets-port.hooks.ts` for why the split exists.
 *
 * `trashWidget` goes through `api.trash({ type: "widget", id })`, the generic single-item Trash
 * route every admin delete button now shares. The Trash screen owns restoration and permanent
 * removal from here.
 */

/** The live implementation, as a module-level singleton — matches `redirects-dependencies
 *  .hooks.ts`'s `defaultRedirectsPort`. */

/** Seed state for {@link createFakeWidgetsPort}. */

/**
 * An in-memory {@link WidgetsPort} for tests — lets a test describe "the library has these two
 * widgets" directly, instead of hand-building `Response` objects and stubbing global `fetch`.
 * Shipped alongside the real binding per the pattern's "every port gets a fake" rule.
 */

/** Every widget currently in the fake's store, in list order. */

      // Slug-or-id, mirroring the real `getWidgetInstance` (`read-service.ts`, 2026-09-22) — a test
      // that seeds a widget and loads it by its `slug` needs the same resolution the server gives.