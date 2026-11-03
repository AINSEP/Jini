# Plugin wrapper removal — Programmer handoff

Branch: `merge-1029` in both integration clones. No git writes, installs, builds, test runs or
registry mutations. Only the permitted package typechecks were executed.

## Ownership and content

| Deleted wrapper directory (`packages/`) | Agent subpath (`@jini-ai/agent-plugins/`) | Provider runtime (`@jini-ai/provider-plugins/`) |
| --- | --- | --- |
| `plugin-ai-trace-langfuse` | `langfuse`, `langfuse/*` (added manifest) | `ai-trace-langfuse`, `ai-trace-langfuse/*` |
| `plugin-analytics-posthog` | `posthog`, `posthog/*` (existing) | `analytics-posthog`, `analytics-posthog/*` |
| `plugin-observability-opentelemetry` | `opentelemetry`, `opentelemetry/*` (existing) | `observability-opentelemetry`, `observability-opentelemetry/*` |
| `plugin-observability-sentry` | `sentry`, `sentry/*` (existing) | `observability-sentry`, `observability-sentry/*` |
| `plugin-payments-stripe` | `stripe`, `stripe/*` (added manifest) | `payments-stripe`, `payments-stripe/*` |
| `plugin-ui-ux-design` | `ui-ux-design`, `ui-ux-design/*` (existing full payload) | none |

Provider source already belonged to `packages/provider-plugins/src/<provider-id>`. Wrapper
README/NOTICE/LICENSE/changelog files and all five test files now live beside those sources.
Existing Stripe contract documentation was retained alongside the migrated publication guide.
Generated local artifacts were copied into the provider distribution; they await its normal build.
The builder copies selected-provider documents before the existing integrity owner seals them.
It propagates document I/O failures other than absent optional documents.
UI/UX wrapper documents now live in `packages/agent-plugins/ui-ux-design`; its generated wrapper
payload was byte-identical to the existing source. The source publishes in place. UI/UX's pinned
published file count changes from 50 to 54 because its four attribution/documentation files moved in.

## References and guards

- Removed the legacy agent-wrapper map, assembler and assembler-only lifecycle tests. Kept the
  layout/export/file-selection assertions in `scripts/__tests__/agent-plugin-subpaths.test.ts`.
- Catalog generation always names the two distribution owners, including when an old wrapper
  directory exists. Updated checked-in catalog records, both package manifests, provider-local
  catalog, isolation gates and their tests, release test selection, README, CAPABILITIES and the
  plugin migration guide. The pnpm workspace and Changesets fixed group use wildcards and had no
  explicit wrapper entries to remove.
- `assertJiniPackagePublicationAllowed` is shared by package discovery/packing and both publishers.
  It rejects retired wrapper identities before publication effects; direct packing checks both the
  requested identity and the actual source manifest. Regression cases cover the six names, future
  names, the private fixture name, innocent folder aliases and permitted owners. The release
  workflow runs these guard tests.
- The metadata-only `@jini-ai/plugin-catalog` is the explicit prefix exception. It remains a
  dependency in both hosts. Private conformance fixtures remain private, while direct packing
  through the shared packer refuses their standalone plugin identity too.
- Old names remain only where they are negative regression inputs or historical records. No
  active manifest, provider catalog record or consumer import names the six wrappers.

## Tovu

Removed the development OTLP wrapper dependency and the two old wrapper entries from the local,
ignored `development/.jini-link-state.json`. Both distribution dependencies already existed.
Updated CLI OTLP fixture resolution, desktop packaging/staging selection fixtures and telemetry
consumer tests. Telemetry tests now put both selected artifacts in one provider distribution and
explicitly verify that selecting one never imports its sibling. Missing distribution, missing
artifact, contract, integrity, initialization, consent and cleanup cases remain represented.
The SDK resolver's documented virtual import aliases are preserved: changing them would change
agent CLI/security contracts, and they are not wrapper npm packages. Product telemetry already
resolves catalog-selected owners, so the production resolver required only its ownership comment.
No edits to the concurrently owned backup/share/registry files, or the unrelated admin hook diff.

## Evidence and remaining work

- `npx tsc --noEmit -p packages/provider-plugins/tsconfig.json`: exit 0 after the final runtime change.
- `npx tsc --noEmit -p packages/agent-plugins/tsconfig.json`: exit 0.
- `git diff --check` in both clones: clean.
- Static declaration counts in all migrated wrapper test files: Langfuse 2→2, PostHog 4→4,
  OpenTelemetry 4→4, Sentry 4→4, Stripe 2→2. These are source declaration counts, not executed tests.
- Tests, packing, builds, Tovu checks and release gates were not run, as instructed. No process
  started by this task remains running.
- Coordinator must refresh lockfiles, build provider artifacts, regenerate the catalog and run
  release/package/consumer tests. Updated catalog entries carry pending `expectedDigests: null`
  rather than claiming old-wrapper digests describe the new distributions. The existing release
  generator refuses stale/missing artifacts and computes actual file digests.
- Provider distribution is still version 0.6.13, as on entry. Its normal release bump must exceed
  previously published prereleases; advance versioned bare export targets and its local catalog
  together. No release versions or lockfiles were changed here.

Architecture audit: ownership stays with agent-plugins/provider-plugins; loaders, installation,
consent and provider lifecycle owners are reused. No new runtime dependency or CLI change.
Documentation: new guard documents its input, throw contract, complexity and example; migration
and package docs match current ownership. Guard score skepticism: the catalog prefix exception is
explicitly tested, source identity is checked separately from requested identity, and variable
names describe their values. Fresh package checks establish TypeScript validity only; unexecuted
integration tests and release artifact generation remain limitations.
