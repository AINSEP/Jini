# Commit plan

Scope: admin sheet 5, Jini half only. Coordinator commits; leave this file uncommitted.

1. `fix(ui): record public system locale resolver export`
   - Created `.changeset/ui-system-locale-export.md` for `@jini-ai/ui` (patch).
   - Preserved `packages/ui/src/features/i18n/locale.ts`, its `resolveSystemLocale` export in `packages/ui/src/core.ts`, and the existing `./core` package export map.
   - Preserved the existing public-entry witness in `packages/ui/src/features/i18n/__tests__/locale.test.ts`: `pt-PT uses the available Portuguese dictionary through the framework-free entry point`.

## Regression and mutation

- No new Jini test: the sheet requires retaining the existing Portuguese witness, verified in source before the changeset was added.
- Host regression still required: `pt-PT uses the available Portuguese dictionary, not English`, asserting whole-copy equality with `pt-BR` and inequality with English.
- Named mutation: `desktop-base-must-be-a-dictionary-key` restores the bare `pt` fallback in the host's `desktopLocaleKey`; whole-copy equality must fail. Not applied or executed in this Jini-only job.
- Host must import `resolveSystemLocale` from the existing `@jini-ai/ui/core` subpath and replace only its remaining base-key fallback, preserving underscore normalization, exact-match precedence, and Chinese mapping.

## Verification and scope

- Static inspection confirmed the resolver matches available locale bases, the public export exists, and the Portuguese public-entry witness asserts `pt-BR`.
- No installs, builds, tests, typechecks, linters, version bumps, releases, commits, or pushes performed, as directed.
- Final review: only the named changeset and this uncommitted plan were added. No deletions or unrelated edits.
- Architecture audit: PASS for the documentation-only change; no runtime code, dependencies, exports, or themes changed.
- Sheets 1, 2, and 8 are outside this dispatch. No new subpaths or exports are needed by the host.
