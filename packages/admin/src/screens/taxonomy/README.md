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
- `TaxonomyRowMenu.tsx` emits only `jini-taxonomy-row-menu-*` classes; the host styles the
  `-danger`/`-warning` tones through its own selectors.
