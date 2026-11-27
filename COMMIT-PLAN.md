# bug-rules — Jini handoff

Working tree only. Coordinator makes commits. Tests, builds, installs, typechecks,
and linters are prohibited by dispatch; no RED/GREEN execution is claimed.

## Completed implementation units in commit order (unverified; tests written first)

1. Rules 5 — reject duplicate raw manifest export/isolation keys.
   - `scripts/__tests__/manifest-export-keys.unit.test.ts`
   - `scripts/lib/package-sources.ts`
   - `scripts/check-api-surface.ts`
   - `packages/ui/package.json`
   - Mutation: `parse-manifest-before-duplicate-check` enumerates parsed object
     keys instead of raw syntax properties, losing both duplicate diagnostics.
   - Cases: repeated subpath in both maps; clean cross-map and nested-condition control.
   - Core/plugins already contain one occurrence per map; leave them untouched.

2. Rules 1 — require the media-providers state hook (same pending UI release as data 4).
   - `packages/ui/src/features/media-providers/__tests__/react/components/MediaProvidersTab.test.tsx`
   - `packages/ui/src/features/media-providers/__tests__/catalog-ports.test.ts`
   - `packages/ui/src/features/media-providers/react/components/MediaProvidersTab.tsx`
   - `.changeset/rules-media-providers-hook-required.md`
   - Mutation: `media-providers-hook-optional` restores `?` on the prop and
     fails the exact `Pick`/`expectTypeOf` type assertion.
   - Root already exports `useMediaProvidersTab` through the feature barrel.

## Remaining sheets

- Rules 2: stop Jini edits: `AccessTokensTabProps` now extends
  `AccessTokensTabBindings`, whose `hooks.useOtherCredentialsHook` is already
  required. The sheet's optional top-level prop/default is absent there.
  The bound component factory is a different contract; no redesign authorized.
  Tovu must reconcile its wrapper, parent, and named fixtures after admin 3 c1.
- Rules 3: skipped, explicitly NEEDS-OPUS (census and diagnostic-preserving migration).
- Rules 4: blocked behind rules 3; roots still live in Tovu and must stay there.
- Rules 6: skipped Jini; signal worker list remains in Tovu `serve-listen.ts`.
- Rules 7: skipped Jini; fake-clock repair is in Tovu's `providers-tools.test.ts`;
  Jini production provider tools require no change.
- Rules 8: skipped Jini; missing top-level candidate is still in Tovu's
  `installPublishingAndPluginTools`; Jini consumes the field already.
- Source Control ProvidersTab: remains skipped as directed.

## Boundary and verification notes

- Reuse existing TypeScript JSON AST parser for direct-key enumeration; no new dependency.
- New parser seam is pure `{ file, source }`, `_optional = {}` -> diagnostic strings.
- Only direct keys in `exports` and `jini.entries` count; repeated nested conditions
  and the same key across maps are allowed.
- Preserve effective export targets, isolation values, other hook contracts, and themes.
- No subpaths or exports needed by the host; media host must import the existing
  `useMediaProvidersTab` root export and pass `useMediaProvidersTabHook` explicitly.
- Final diff reread: no unrelated additions found to remove. Required deletions:
  the duplicate UI `./resource-monitor` entry in each map and the component's
  real-hook destructuring default. No tests, assertions, why-comments, or
  capabilities deleted. Three test cases added; existing test cases retained.

## Review handoff

- Architecture audit: source review found no new product dependency, export
  target change, theme change, forwarder, or undeclared dependency. Automated
  boundary checks and runtime validation were not run, as explicitly prohibited.
- Requirements and diff reviewed via `git diff` plus direct reads of new files.
  No behavioral, mutation, typecheck, or coverage result is claimed.
- Parser direct tests cover the duplicate-key behavior and clean control. The
  media contract test is compile-time evidence and must be checked with types;
  merely running the test callback does not verify the assertion.

| Unit | Disposition | Findings / local fix |
| --- | --- | --- |
| `duplicateManifestExportKeys` | INCONCLUSIVE | 24-line pure parser function; O(source length + direct properties) time/space; execution and mechanical metrics deferred by dispatch. |
| API gate integration | INCONCLUSIVE | Raw check precedes JSON.parse and the update branch; both modes share the failure flag. Execution deferred by dispatch. |
| `MediaProvidersTab` hook contract | INCONCLUSIVE | Only prop requiredness/default changed; invocation and other props preserved. Compile-time regression check deferred by dispatch. |

No new source comments were added under the explicit sheet constraint. No
additional helpers, interfaces, options, dependencies, or abstractions were added.
Coordinator: commit units 1 then 2, omit this file, run the named tests and the
media type assertion, and coordinate the UI release with data 4 and its host bump.
