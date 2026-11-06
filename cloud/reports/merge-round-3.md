# merge-round-3

in progress

Scope: merge only cloud/google-forms onto cloud/combine in Jini and Tovu. cloud/ui-fixes is excluded by owner instruction. Push only cloud/combine; no main, force push, publish or deployment. Hard cap: two hours from 2026-11-06 04:49 UTC.

Checks and final SHAs pending. Baseline rebuild and relink in progress.

## Merge checkpoint

Jini base: a67df1d7fa0add2ff82751e15b34114e5870f340; source: ddd26f3ab604c7b75b46e0800281c54e5b49c31a; pushed real merge: 67cbf1c5c.
Tovu base: c94bec428d4d20c06ffecc8d5752eb76309c20f4; source: b3d3351c781949f607189d281d087a9e52793a0e; pushed real merge: bae52ecf0.
cloud/ui-fixes was not merged. All existing reports are retained.

Jini conflicts: html-render.ts keeps schemaHash/idPrefix and adds consentOff; contact-form.ts keeps asynchronous schema hashing and adds the host consent policy; provider-plugins/package.json keeps the existing 0.6.24 export versions and adds the hosted-provider exports/build; plugin-catalog/catalog.json keeps combined entries and awaits post-build regeneration.
Tovu conflicts: site/render.ts retains idPrefix and host consent policy; composition/app.ts keeps attachment purge hooks and adds current public-header metadata; the removed unused legacy cleanup import stays removed because cleanup already has its composed owner. No assertions or why comments were dropped.

Baseline: frozen install passed with --store-dir /workspace/.pnpm-store after relocating the read-only preinstalled package cache. pnpm -r build passed on the unmodified source base. Tovu relink passed. An overlapping preliminary Tovu typecheck encountered temporary merge markers; it is excluded as baseline evidence. Final merged checks are pending.

Clean-build output cleanup proved zero workspace dist directories and zero tsbuildinfo files, excluding node_modules and .git. pnpm -r build is in progress.
Both commit ranges passed gitleaks v8.28.0 with unchanged repository configs and --redact. Jini conflict-source complexity passed; Tovu app.ts has the same two complexity-11 functions as its original base.

BUG (inherited): Tovu composition/app.ts createRouteDeps and createApp each have cyclomatic complexity 11 (ceiling 10). No lint rules or tests were weakened.
