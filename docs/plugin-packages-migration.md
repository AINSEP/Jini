# Plugin packages — 0.6.17, subpaths from 0.6.19

Each provider package contains one prebuilt plugin. From 0.6.19 every agent plugin ships as a
subpath of one package, `@jini-ai/agent-plugins/<id>` (its folder `<id>/`, manifest
`<id>/plugin.json`), and the chart providers ship as subpaths of one package,
`@jini-ai/provider-plugins/<id>/*` (folder `plugins/<id>/<version>/`). There are no per-plugin npm
packages for these. Sources remain in `packages/provider-plugins/src/<id>` and
`packages/agent-plugins/<id>`; generated provider payloads are gitignored. Reviewed manifests,
README, LICENSE and NOTICE stay tracked. No plugin depends on another plugin, and resolving one
subpath never loads another plugin's files. Provider SDKs are bundled at build time, so an
installed provider needs no vendor SDK dependency.

| Previous selection | Explicit dependency |
| --- | --- |
| `analytics-posthog` | `@jini-ai/plugin-analytics-posthog` |
| `observability-sentry` | `@jini-ai/plugin-observability-sentry` |
| `observability-opentelemetry` | `@jini-ai/plugin-observability-opentelemetry` |
| `ai-trace-langfuse` | `@jini-ai/plugin-ai-trace-langfuse` |
| `payments-stripe` | `@jini-ai/plugin-payments-stripe` |
| `fixture-provider` (test only) | `@jini-ai/plugin-fixture-provider` |
| `charts-recharts`, `charts-echarts` providers (0.6.19) | `@jini-ai/provider-plugins/<id>/*` (`plugins/<id>/<version>/`) |
| every agent plugin (0.6.19): charts-echarts, charts-recharts, cloudflare, composio, fly, github, github-pages, google-login, google-workspace, higgsfield-media, jev, meilisearch, netlify, opentelemetry, posthog, railway, render, resend, s3-compatible, sentry, site-compliance, site-import, slide-design, supabase, ui-ux-design, vercel, wordpress | `@jini-ai/agent-plugins/<id>` (one dependency: `@jini-ai/agent-plugins`) |
| `@jini-ai/plugin-ui-ux-design` (0.6.17, superseded) | `@jini-ai/agent-plugins/ui-ux-design` |
| `provider-plugins/catalog` | `@jini-ai/plugin-catalog/catalog` (optional metadata; provider-plugins' own `./catalog` lists only its two charts) |

The posthog, sentry and opentelemetry agent faces are `@jini-ai/agent-plugins/<id>`; their provider
packages (`@jini-ai/plugin-analytics-posthog` and the two observability packages) ship only the
provider. The 0.6.19 per-plugin names (`@jini-ai/plugin-charts-recharts`, `-charts-echarts`,
`-jev`, `-cloudflare` and the rest) were never published and do not exist.

## Host migration

1. Declare only the selected packages as production dependencies. Tovu installs
   **no vendor plugins by default**. Its real OTLP integration fixture may declare
   OpenTelemetry as a development dependency; the fixture plugin is never a
   production default. Keep existing lifecycle, host and domain-contract packages.
2. Resolve `@jini-ai/plugin-<id>/package.json` (charts: `@jini-ai/provider-plugins/package.json`)
   using the host's normal Node resolver and existing payload/shell search roots. Discover
   artifacts beneath that package's `plugins` directory; retain `plugins/<id>/<version>` and pass discovery
   through the existing `loadProviderPluginArtifact`. Site plugins still use the
   normal preview/install/enable/configure flow. An npm dependency grants no
   activation authority. Retain atomic failure cleanup, disposal and consent gates.
3. For each selected agent plugin, resolve `@jini-ai/agent-plugins/<id>` (its `plugin.json`)
   and stage only the directory containing it (ui-ux-design included; the 0.6.17
   `@jini-ai/plugin-ui-ux-design/plugin.json` path still works until hosts move). Stage this selected payload beneath
   the host's bundled-source root, then use `packAgentPluginDirectory`,
   `installAgentPlugin` and the existing seeding/activation/digest readers. Do not
   load npm assets directly as installed contributions. The inner agent manifest
   retains its own version (ui-ux-design: currently 0.6.1), distinct from the npm release version.
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
set is **0.6.17**, including the new public plugin packages and catalog. Set manifest
versions and consume pending changesets into package changelogs by hand for this
release; do not run `changeset version`, which would advance the fixed group to
0.7.x. The private conformance fixture follows 0.6.17 for catalog and pack checks.

In the release environment, install with the frozen lockfile and build from the
Jini root. Run `pnpm guard:plugins`, `pnpm guard:plugins:catalog`,
`pnpm test:plugins:artifacts`, `pnpm test:agent-plugins:content` and the script suites named in `publish.yml`. Then run
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

## `@jini-ai/provider-plugins` after rc.2

Owner decision 11-02: the former aggregate is **not** deprecated. It publishes again as the chart
provider distribution (`files`: only `plugins/charts-recharts`, `plugins/charts-echarts`, its
`catalog.json` and docs; the other providers stay in their own packages). Registry versions so far:
0.0.0-stage, 0.6.15-rc.1, 0.6.15-rc.2, so its release version must sort above 0.6.15-rc.2 (the
workspace still says 0.6.13; set it with the fixed group at release, together with `catalog.json`,
which a test pins to the package version). It is a new first publication of a non-prerelease
version: check its trusted publisher before the tag workflow. Rollback uses the previous host
release and its frozen dependency lockfile.

## `@jini-ai/plugin-ui-ux-design` deprecation (owner runs it)

`@jini-ai/agent-plugins/ui-ux-design` supersedes `@jini-ai/plugin-ui-ux-design`. After the
`@jini-ai/agent-plugins` release that carries the subpaths is published and Tovu has moved to it, the
owner runs (this repository runs no npm command):

```sh
npm deprecate @jini-ai/plugin-ui-ux-design "Use @jini-ai/agent-plugins/ui-ux-design (same plugin, one package for every agent plugin)"
```

Then drop `legacyAgentPluginPackages` (scripts/lib/agent-plugin-packages.ts), the legacy assembler
path and `packages/plugin-ui-ux-design`. Published versions stay installable.
