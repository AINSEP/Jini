# Standalone plugin packages — 0.6.15

Each package contains one prebuilt plugin. Sources remain in
`packages/provider-plugins/src/<id>` and `packages/agent-plugins/ui-ux-design`;
the destination package's payload is generated and gitignored. Reviewed manifests,
README, LICENSE and NOTICE stay tracked. No plugin depends on another plugin, and
core/lifecycle packages carry no plugin payloads. Provider SDKs are bundled at
build time, so an installed provider needs no vendor SDK dependency.

| Previous selection | Explicit dependency |
| --- | --- |
| `analytics-posthog` | `@jini-ai/plugin-analytics-posthog` |
| `observability-sentry` | `@jini-ai/plugin-observability-sentry` |
| `observability-opentelemetry` | `@jini-ai/plugin-observability-opentelemetry` |
| `ai-trace-langfuse` | `@jini-ai/plugin-ai-trace-langfuse` |
| `payments-stripe` | `@jini-ai/plugin-payments-stripe` |
| `fixture-provider` (test only) | `@jini-ai/plugin-fixture-provider` |
| `agent-plugins/ui-ux-design/*` | `@jini-ai/plugin-ui-ux-design` |
| `provider-plugins/catalog` | `@jini-ai/plugin-catalog/catalog` (optional metadata) |

## Host migration

1. Declare only the selected packages as production dependencies. Tovu installs
   **no vendor plugins by default**. Its real OTLP integration fixture may declare
   OpenTelemetry as a development dependency; the fixture plugin is never a
   production default. Keep existing lifecycle, host and domain-contract packages.
2. Resolve `@jini-ai/plugin-<id>/package.json` using the host's normal Node resolver
   and existing payload/shell search roots. Discover artifacts beneath that
   package's `plugins` directory; retain `plugins/<id>/<version>` and pass discovery
   through the existing `loadProviderPluginArtifact`. Site plugins still use the
   normal preview/install/enable/configure flow. An npm dependency grants no
   activation authority. Retain atomic failure cleanup, disposal and consent gates.
3. Replace design asset references with the directory containing
   `@jini-ai/plugin-ui-ux-design/plugin.json`. Stage this selected payload beneath
   the host's bundled-source root, then use `packAgentPluginDirectory`,
   `installAgentPlugin` and the existing seeding/activation/digest readers. Do not
   load npm assets directly as installed contributions. The inner agent manifest
   retains its own version (currently 0.4.6), distinct from the npm release version.
4. Remove the aggregate dependency and its catalog/subpath resolution. The optional
   metadata catalog does not install or activate anything. Desktop staging must
   follow declared production dependencies and required peers from packed or
   published files, excluding development dependencies and extraneous linked siblings.

Tovu design wording reconciliation is a later, owner-approved step. Preserve its
tool restrictions and associated tests until that cutover. This release changes
packaging only; existing site settings, installed artifacts and activation records
need no data migration. Stripe retains commerce Phase 1's hosted Checkout/evidence
contract, signature rejection and absence of legacy Charge/Refund methods.

## Release and first publication

Keep `.changeset/config.json`'s fixed `@jini-ai/*` group. The approved public release
set is **0.6.15**, including the new public plugin packages and catalog. Set manifest
versions and consume pending changesets into package changelogs by hand for this
release; do not run `changeset version`, which would advance the fixed group to
0.7.x. The private conformance fixture follows 0.6.15 for catalog and pack checks.

In the release environment, install with the frozen lockfile and build from the
Jini root. Run `pnpm guard:plugins`, `pnpm guard:plugins:catalog`,
`pnpm test:plugins:artifacts` and the script suites named in `publish.yml`. Then run
`pnpm guard:plugins:packed` after removing local source maps as the workflow does.
This gate inspects actual tarballs, their manifests/exports and provenance files,
including every public core package; it disables lifecycle hooks and requires
completed build output. Catalog generation validates metadata and integrity first.

Use the existing root packing/discovery machinery to produce and review the final
release tarballs. Confirm one payload per plugin, metadata-only catalog contents,
retained dependency licenses and no lifecycle-library design assets. Run the
external packed-consumer and frozen rc.2 compatibility fixtures before cutover;
this change does not establish their results.

New npm names require a one-time authorized first publication of reviewed tarballs
with npm provenance. `scripts/publish-pending.ts` deliberately skips never-published
names because they cannot yet have a trusted publisher. Configure each new name's
trusted publisher for `AINSEP/Jini`, workflow `publish.yml`, then use the existing
tag/manual workflow for subsequent releases. Its isolation/catalog gates run even
when a release filters package names. Preserve root and artifact attribution;
provenance does not replace license retention.

## Aggregate deprecation after rc.2

Freeze the aggregate's **last verified registry version**; checkout 0.6.13 alone
does not establish what was published. Keep its workspace private and preserve all
published versions/tarballs. After checking the exact rc.2 release manifest and
lockfile, publishing the new packages and migrating hosts, the release owner can
run `npm deprecate '@jini-ai/provider-plugins@<verified-version>' '<migration message>'`.
Use a message pointing to the explicit mapping above. No deprecation or publication
is performed by this repository change. Do not replace the aggregate with an
all-plugin dependency package or repurpose a compatible version as metadata-only.
Rollback uses the previous host release and its frozen dependency lockfile.
