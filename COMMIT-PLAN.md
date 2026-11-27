# Jini extraction commit plan

Base: `ca9a786c919018ac9feb09e26af634b5827ce407` (`codex/x9deployj`). Working-tree changes only; coordinator commits. Tovu reference: `origin/integ/merge-21-2026-11-24`.

Tests are written before their production moves. No tests, mutation runs, builds, installs, type-checks, linters, or API generation run in this dispatch. All validation remains for cloud. Generated API baselines are intentionally unchanged.

## 1. E1.J — Extract export preflight (completed, unverified)

Files created:
- `packages/devops/src/static-export/site/__tests__/export-preflight.test.ts`
- `packages/devops/src/static-export/site/export-preflight.ts`

Files updated: `packages/devops/package.json`.

The source anchors match the reference. Preserved scanner, sampling bound, per-export closure and warning order; moved the existing A400 warning rationale beside its copy seam. No Jini callers require repointing. E1.T must supply host copy at `@jini-ai/devops/static-export/site/export-preflight`.

Four characterization cases cover injected placeholder, script classification, independent/repeated collections and consent-off formatting. Mutation `DROP_CONSENT_CHECK` must fail the consent-off formatter assertion.

Cloud API delta: `api-baseline/jini-ai__devops.json`, new node leaf `./static-export/site/export-preflight`: `ExportPreflightCopy`, `createExportPreflight`, `findContactEmailPlaceholder`, `findThirdPartyScriptHosts`.

Scope-review deletions: none. Host formatter/template text omitted as required; no source file deleted in Jini.

## 2. E2.J — Extract preview-manifest orchestration (completed, unverified)

Files created:
- `packages/devops/src/static-export/site/__tests__/theme-preview-manifest.test.ts`
- `packages/devops/src/static-export/site/theme-preview-manifest.ts`

Files updated: `packages/devops/package.json`.

Reference anchors and existing `RouteManifest`/`ManifestRoute` match. Preserved readiness, opt-out, active-theme guard, route merging/filtering and theme count. No changes to `ports.ts`; no Jini callers to repoint. E2.T retains the host binding and supplies the three ports through `@jini-ai/devops/static-export/site/theme-preview-manifest`.

Five characterization cases cover readiness, explicit opt-out, null/disabled config, active+variant merge, duplicate precedence and discovery-route exclusion. Mutation `DROP_THEME_OVERRIDE` must remove the variant-only preview route and fail the merge case.

Cloud API delta: DevOps universal leaf `./static-export/site/theme-preview-manifest`: `PreviewExportManifestPorts`, `buildPreviewExportManifest`.

Scope-review deletions: none. Host imports/settings binding omitted as specified; no Jini source deleted.

## 3. D1.J — Extract deployment History tab (completed, unverified)

Files created:
- `packages/devops/src/deploy/react/__tests__/HistoryTab.test.tsx`
- `packages/devops/src/deploy/react/HistoryTab.tsx`

Files updated: `packages/devops/src/deploy/react/index.ts`.

Source and named host mounts match. Kept JSX, stable handles, native link, no-backend rationale and heading comment. Required collaborators replace host imports. No Jini callers to repoint. D1.T mounts `HistoryTab` through existing `@jini-ai/devops/deploy/react` with the real locale hook, translator, icon, href and agent attributes.

One SSR characterization asserts h2, absence of fabricated rows, both handles, supplied icon and distinct href. Mutation `HARDCODE_HISTORY_HREF` must fail the href assertion.

Cloud API delta: existing DevOps browser leaf `./deploy/react`, unchanged target: add `HistoryTab`, `HistoryTabProps` (shared regeneration with D2.J).

Scope-review deletions: none; no Jini source deleted.

## 4. D2.J — Extract read-only deployment overview hook (completed, unverified)

Files created:
- `packages/devops/src/deploy/react/__tests__/use-deployment-overview.test.ts`
- `packages/devops/src/deploy/react/use-deployment-overview.hooks.ts`

Files updated: `packages/devops/src/deploy/react/index.ts`.

Reference controller/query/error anchors match. Snapshot is generic; query key, deferred port read, error truthiness and translator identity are preserved. Kept the single-query/no-mutation/bound-translator comments verbatim. No Admin or UI implementation import. No Jini callers to repoint. D2.T supplies K2 query and the host formatter through existing `@jini-ai/devops/deploy/react`; the wired hook stays in Tovu.

Two characterization cases capture the exact query key/fetch, snapshot/translator identity and sentinel error/locale formatting. Mutation `BYPASS_OVERVIEW_ERROR_FORMATTER` must fail the formatter call and exact error assertions.

Cloud API delta: existing DevOps browser `./deploy/react`: `useDeploymentOverview`, `DeploymentOverviewController`, `DeploymentOverviewArgs`, alongside D1 additions; existing export target unchanged.

Scope-review deletions: removed draft rewording of the moved header and restored the original comments verbatim. Host-only wired function/imports not copied as specified; no Jini file deleted.

## 5. S1.J — Extract source-control page shell (completed, unverified)

Files created:
- `packages/devops/src/source-control/react/__tests__/SourceControl.test.tsx`
- `packages/devops/src/source-control/react/SourceControl.tsx`

Files updated: `packages/devops/package.json`.

Reference shell, sole Providers tab, guard and unconditional panel match. Injected the specified structural TabBar and collaborators; credential subtree/controller remain host-owned. Kept owner-reversal, no-phantom-tabs and deep-link/history rationale. No Jini callers to repoint. S1.T binds the shell behind the existing lazy route via `@jini-ai/devops/source-control/react`.

Two parameterized SSR cases cover valid/stale tabs, exact resolver inputs, only Providers, supplied icon/header/copy and unconditional providers rendering. Mutation `BLANK_ON_UNKNOWN_TAB` must fail the stale-tab panel assertion.

Cloud API delta: DevOps browser leaf `./source-control/react` to `source-control/react/SourceControl`: `SourceControl`, `SourceControlProps`, `SourceControlTabBarProps`.

Scope-review deletions: none. Old host-hook props and binding imports not copied as specified; no Jini file deleted.

## 6. P1.J — Extract criteria report projection (completed, unverified)

Files created:
- `packages/cms/src/react/publish-content/hooks/__tests__/criteria-publish-result.test.ts`
- `packages/cms/src/react/publish-content/hooks/criteria-publish-result.ts`

Files updated: `packages/cms/package.json`.

Both reference functions and the named caller match. Kept statements/order, selection algorithm, throw and S2/subset/carried-media comments; only host next-step literal becomes the required argument. Same-package selectors/types exist at the specified paths. No Jini callers to repoint. P1.T repoints its single report call to `@jini-ai/cms/react/publish-content/criteria-publish-result` and supplies the original next-step string.

Two characterization cases use typed forced/media/deselected/unchanged/skipped rows, verify exact arrays, injected next step and unmatched/unknown identity, and reject a missing skipped reason. Mutation `FORCED_NOT_PUBLISHED` must fail the exact forced-row result.

Cloud API delta: CMS universal leaf `./react/publish-content/criteria-publish-result`: `buildCriteriaPublishResult`. Isolation entry maps to `publish`.

Scope-review deletions: none; no Jini source deleted. Existing CMS manifest indentation retained.

## 7. P2.J — Extract publish-section button markup (completed, unverified)

Files created:
- `packages/cms/src/react/publish-content/__tests__/PublishSectionButton.test.tsx`
- `packages/cms/src/react/publish-content/PublishSectionButton.tsx`

Files updated: `packages/cms/package.json`.

Reference button/hook/handle anchors and existing React test harness match. Native DOM, default secondary class, handle construction, click and hidden return are preserved; section hook and agent attributes are required collaborators. Kept secondary-action and host-primary-override comments. No Jini callers to repoint. P2.T creates one host binding using `@jini-ai/cms/react/publish-content/PublishSectionButton`, the real host hook adapter and exact host agent label.

Three characterization cases cover unavailable output, object hook args, default class/handle/native button/click count, custom class and supplied agent label. Mutation `RENDER_WHEN_UNAVAILABLE` must fail the empty-container assertion.

Cloud API delta: CMS browser leaf `./react/publish-content/PublishSectionButton`: `PublishSectionButton`, `PublishSectionButtonProps`. Isolation entry maps to `publish`; leaf forbidden list matches the existing React leaf precedent.

Scope-review deletions: none; no Jini source deleted.

## Handoff and held work

All seven executable `.J` sheets above are implemented in order. No `.J` sheet stopped: source anchors and named host callers match the pinned reference. There is no P0.J; the destination DTO is already in core, and P0.T is host-only. No source was removed from Tovu or repointed there in this Jini-only dispatch. No new dependencies, lockfile edits, root exports, providers, architecture exemptions or generated baseline edits.

Created seven production leaves and seven characterization files; added 19 cases (including parameterized cases), removed zero existing tests. Mutations are named above and were not applied or run. Scope reviewed against the reference source and working-tree diff; no extra implementation retained.

Tovu sheets still to execute, in the design's Tovu order: P0.T; E1.T, E2.T; D1.T, D2.T, S1.T; P1.T, P2.T. New host imports are the five leaves below plus additions on the existing deploy React entry:

- `@jini-ai/devops/static-export/site/export-preflight` — node; copy binding required.
- `@jini-ai/devops/static-export/site/theme-preview-manifest` — universal; host preview ports required.
- `@jini-ai/devops/deploy/react` — existing browser entry; `HistoryTab`/props and `useDeploymentOverview`/generic controller/args added.
- `@jini-ai/devops/source-control/react` — browser; host page binding and lazy-route preservation required.
- `@jini-ai/cms/react/publish-content/criteria-publish-result` — universal; host next-step required.
- `@jini-ai/cms/react/publish-content/PublishSectionButton` — browser; host section-hook adapter and agent label required.

Cloud owns original-base characterization, mutation checks, tests/build/type/API/guard verification and `pnpm api:update` for the exact deltas listed per sheet. None of those commands ran here. The coordinator owns all commits; no commits or pushes were made.

### OPUS-CLOUD rows left untouched

No separately numbered OPUS-CLOUD executable sheets were supplied. Every OPUS-marked reservation remains unimplemented. Paths below are relative to each area in the design; grouping is only for the handoff.

- **deployments:** `deploy-config.ts`; `deploy-ops/{agent-tools,registry,run-ops,secrets,tool-registrations,typed-secret-card}.ts`; `deploy-targets/{host-kit,registry}.ts`; `publish-agent-tools.ts`; `publish-credentials/{compatibility-port,index,store}.ts`; `publish-tool-deps.ts`; `static-publish/{adapter,credentials,domain-publish-tool,index,inspection,publish-consent,publish-history,publish-run,verify}.ts`; `tool-registrations.ts`.
- **adm-deployment:** `DockerfileTab.tsx`, `StaticSiteTab.tsx`, `deployment-host-ports.ts`, `hooks/{dockerfile-source-dependencies,publish-credentials-dependencies,static-publish-dependencies,static-publish-port,use-dockerfile-source,use-publish-credentials,use-static-publish}.hooks.ts`, `rules.ts`.
- **source-control:** `commit-site.ts`, `credential-setup.ts`, `provider-kit-host.ts`, `provider-registry.ts`, `repo.memory.ts`, `source-control-credential-repo.sqlite.ts`, `source-control-credential-repo.ts`, `store.ts`, `tool-registrations.ts`, `types.ts`, `write-port.ts`.
- **adm-source-control:** `ProvidersTab.tsx`, `hooks/{source-control-credentials-dependencies,use-source-control-credentials}.hooks.ts`, `rules.ts`, `source-control-host-ports.ts`.
- **site-export:** `export-failure-summary.ts`, `export-html-policy.ts`, `media-original-urls.ts`, `site-exporter.ts`, `static-security-headers.ts`.
- **database-transfer:** `confirmation-ui.ts`, `copy-engine.ts`, `destination-exchange.ts`, `destination-repo.ts`, `destination-store.ts`, `destination-ui.ts`, `exclusions.ts`, `table-catalog.ts`, `tool-registrations.ts`.
- **adm-publish-content:** `PublishContentDialog.tsx`, `api/publish-content-api.ts`, `hooks/{publish-availability.store.ts,publish-content-port.hooks.ts,use-publish-content-confirm.hooks.ts}`.

All other NOT-PLANNED/STAYS-HOST rows also remain untouched. Reserved destination paths were not created for held work.
