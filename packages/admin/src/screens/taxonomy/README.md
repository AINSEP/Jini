# screens/taxonomy

Categories & Tags admin screen pieces: the row menu, HTML-embed rules, the API wire types, the
per-hook ports, the taxonomy API client and the live/fake port implementations.

## Wiring

The host injects everything this folder needs; nothing here reaches a host module.

- `api/taxonomy-api.ts` — `createTaxonomyApi({ request })`. `request` is the host's authenticated
  admin request (`TaxonomyRequestFn`): it owns the base URL, auth, retries and error decoding.
- `hooks/*-dependencies.hooks.ts` — `createMergeTermSectionPort({ api })`,
  `createNewTaxonomyFormPort({ api })`, `createNewTermFormPort({ api })` and
  `createTermPickerPort({ api, me })`, where `me` is the host auth client's current-user call. The
  host builds each once at its composition root. Each file also ships an in-memory
  `createFake*Port` for tests.
- `taxonomy-host-kit.ts` — the `TaxonomyHostKit` every taxonomy hook takes: `translate` (the host's
  taxonomy dictionary translator), `isApiError` + `describeApiError` (the host request's error class
  and base-case copy — `rules.ts`'s `describeDeleteBlocked`/`describeTrashError`/`visibleTaxonomyError`
  take them as a required `errors` field), `failures` (the host's admin failure channel, read by
  `use-taxonomy-html-embed.hooks.ts`) and `useContentRefreshSubscription` (the host's content-refresh
  subscription hook; `use-taxonomy` invalidates the list on an out-of-band write to `taxonomy`).
- `hooks/taxonomy-dependencies.hooks.ts` — `createTaxonomyPort({ api, trash })`, where `trash` is the
  host's generic single-item Trash client; `createFakeTaxonomyPort({ blockedError }, options)` takes
  the host's real request-error factory so blocked-delete seeds narrow like production errors.
- `hooks/use-new-taxonomy-form`, `use-new-term-form`, `use-term-detail-panel`,
  `use-merge-term-section` — each `useX({ options, port, locale, kit })`. `use-taxonomy` takes
  `useTaxonomy({ port, locale, t, kit })` (`t` is the host's bound translator the screen reads its
  copy through) and `use-term-picker` takes `useTermPicker({ target, port, locale, kit })` (`target`
  is the `{ contentType, contentId }` the box tags). The host binds its zero-argument `useWiredX`
  (admin locale + live port + kit); `use-term-list-reveal` and `use-taxonomy-html-embed` are pure
  view-state hooks. `use-taxonomy` subscribes to `shell/lib/content-refresh-bus` itself, so a host
  publishing there refreshes the list.
- `TermPicker.tsx` — the editors' Categories & Tags box. Both hooks are REQUIRED props: the host
  passes `useTermPickerHook` (its `useTermPicker` bound to its live port, locale and kit) and
  `useTermListRevealHook` (`useTermListReveal` or a double). Copy comes through the controller's `t`.
  It emits `jini-term-picker*` classes plus the host's shared `card`, `field-*`, `btn-*`, `save-*`,
  `editor-actions`, `form-checkbox-field` and `link-button` design classes; the host styles them.
- `TaxonomyRowMenu.tsx` emits only `jini-taxonomy-row-menu-*` classes; the host styles the
  `-danger`/`-warning` tones through its own selectors.
