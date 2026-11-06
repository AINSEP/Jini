# banner-b — complete

Completed November 6, 2026 (America/Los_Angeles), within the two-hour cap. Branch in both repositories: `cloud/banner-b`.

## Branches and SHAs

- Tovu base: `74fedc1320d31431ab4a13d1e38af03a402ca28b` (`origin/cloud/combine`).
- Jini base/source: `f07ae3d6ff55cf4da480acac44cc6f4b7686966b` (`origin/cloud/combine`). Jini changes are this report only.
- Tovu verified source: `e331cb11a9250f7132dc287d8e5d751e77155950`.
- Earlier Tovu checkpoints: `735674e308566308208e8c0d57747025f3a88571`, `2b9610a1b12e9c584586886d945e4ea91495e56f`, `b4c93aecf1e5ba55a74cf5de3cda47eae9e85c90`.
- Final report-only commits are the branch tips; their SHAs are supplied in the final chat.

## Changes and line counts

Static finishing in `pages.ts` (including the missing-template diagnostic) and the standalone static home renderer now request a loader through the existing document-assets port. Consent on adds the existing `/_consent/load.js` tag. Consent off adds nothing. The request callback forwards the static construction mode. No authored scripts are classified, stripped, or converted.

Removed the tag from all 21 static theme files, its theme-skill teaching, and the static-theme loading-slot parser/check. Existing copies need no theme upgrade. The loader's existing config guard prevents duplicate client loading when a legacy copy still has a tag. Export reuses the same loader and local evidence; only the loader's own contribution URLs are rebased from its script location for subpaths. Loader read failures return a no-store 503 with plain words.

Against the specified base, excluding reports and the skill Markdown:

- Production TypeScript/HTML: **40 lines added, 60 removed** (net −20).
- Tests: **57 lines added, 9 removed** (three existing test files).
- Theme-skill Markdown: 1 line added, 1 removed.

All four direct `renderStaticPage` call sites are covered by the existing finishing paths. The two real themes exercise home, marketing/404, raw-script preservation, consent on/off, the alternate home renderer, legacy-tag idempotency, context, and subpath export. Unsupported authored full-document bare Pages retain their existing diagnostics.

## Verification

Commands ran in this container. All commands below use `/workspace/Tovu` after `source /workspace/.tovu-build/env.sh`. HTTP tests used network-enabled sandbox permissions for loopback.

Failing tests were written and run before each production fix. The initial real-theme run passed 3/8 and failed the two untagged-copy cases, the two off cases, and subpath asset resolution. The loader read-failure test reproduced an unhandled rejection; the untagged static readiness test reproduced false eligibility. Both then passed after their fixes. Setup failures were resolved separately before relying on those results.

Focused final command: **49 passed, 0 failed**.

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/server/runtime/composition/__tests__/{app.consent-capture,site-consent.ports.unit}.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/declared-consent.unit.test.ts
```

Affected existing tests: **297 passed, 1 pre-existing failure**. The unchanged assertion at `site-cookie-consent.test.ts:101` expects the old settings-link class; see Bugs found. No tests were disabled, skipped, deleted, or weakened to make this pass. Static-slot expectations were updated to the explicitly requested server-owned behavior; full-document unsupported-slot checks remain.

```sh
node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --test-reporter=tap --experimental-test-module-mocks apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.regressions.unit.test.ts apps/website/src/features/consent/__tests__/unit/declared-readiness.unit.test.ts apps/website/src/server/inbound/public-http/routes/site/__tests__/pages.route.test.ts apps/website/src/server/inbound/public-http/routes/site/__tests__/pages.home.route.test.ts apps/website/src/server/inbound/public-http/routes/site/__tests__/pages.edge-paths.route.test.ts apps/website/src/server/inbound/public-http/http/site/__tests__/render.test.ts
```

Production types: **passed**.

```sh
npx tsc -p tsconfig.json --noEmit
```

Complexity: **passed**, zero errors; one pre-existing duplicate-string warning for `Cache-Control` at middleware line 97. No complexity violations or inline suppressions.

```sh
npx eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/features/consent/readiness.ts apps/website/src/server/runtime/composition/site-consent.ts apps/website/src/server/inbound/public-http/middleware/site-cookie-consent.ts apps/website/src/server/inbound/public-http/routes/site/pages.ts apps/website/src/server/inbound/public-http/http/site/render.ts apps/website/src/server/routes/types.ts
```

`git diff --check` passed. No full suites were run, as instructed.

## Setup and limits

Rebuilt Jini from the job base, then relinked Tovu. `pnpm -r build` stopped at missing provider chart dependencies; `pnpm --no-bail -r build` built 40 packages and identified provider-plugins and user-management dependency gaps. CMS, cookie-consent, devops and server built. Restoring installed dependency links and installing the three exact manifest versions of missing user-management dependencies into workspace scratch made `pnpm --filter @jini-ai/user-management run build` pass. `npm --prefix packages/contracts run build`, `npm --prefix packages/sdk run build`, and `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` passed. Lockfiles and manifests are unchanged.

Provider chart dependencies remain unavailable in this environment; composition logs the pre-existing `charts-recharts` INTEGRITY_FAILED fixture warning. Build-generated untracked `Jini/packages/plugin-ui-ux-design/` was not committed. Bulk logs are under `/workspace/work/banner-b/` and are not tracked.

Architecture/quality review: this extends the existing asset port, cached publication, loader and export flow. No engine abstraction, schema, new package, new polling loop, or commerce change. New static asset selection is O(1); loader installation remains O(its own contribution bytes). Each enabled static page adds one loader request carrying the existing banner/client configuration and the existing client/context requests. The publication snapshot still refreshes at most once per minute per mounted site; no new policy reads, writes, cookies, or polling were added to static page construction. Duplicate legacy loader responses remain client-idempotent. Raw/streamed responses remain unchanged.

## Bugs found

- **Fixed:** static consent depended on authored loader tags, leaving existing untagged theme copies without consent.
- **Fixed:** authored static theme tags loaded consent infrastructure even when consent was off; all 21 shipped tags were removed.
- **Fixed:** an active-theme/asset read failure in the loader could reject outside handling; it now returns plain words and status 503.
- **Fixed:** the exported loader retained root-relative client/extension, declaration and privacy URLs under a subpath; its own contribution now uses the loader's subpath.
- **Open, pre-existing:** managed-document test expects `a.tovu-consent-settings[data-consent-open]`, but both the base and final implementation emit `a.jini-consent-settings`. Baseline evidence: `git show origin/cloud/combine:apps/website/src/server/inbound/public-http/middleware/site-cookie-consent.ts` line 268 versus the unchanged test line 101. Left unchanged per scope and test-integrity rules.
- **Open, environment:** provider chart dependencies/build artifacts are incomplete; provider-plugins build and the bundled chart fixture warning remain as described above.
