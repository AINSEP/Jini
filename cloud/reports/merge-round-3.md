# merge-round-3 — merged, with inherited findings

Completed 2026-11-06 UTC within the two-hour cap (started 04:49 UTC; final checks completed 05:07 UTC). Branch: `cloud/combine` in both repositories. Only `cloud/google-forms` was merged in this round. `cloud/ui-fixes` was explicitly excluded because it is not ready.

Final verified source heads before the concluding report commits:

- Jini: `6b9cb85040de926abd1aff4dae80ab5ee2ce3ec0`.
- Tovu: `e235fe98c72815eba9e726e2c3b362502016cddf`.

The concluding documentation commits contain this report; their exact delivered heads are recorded in the final chat response. Every pushed checkpoint preceding them is listed below. All pushes target only `cloud/combine`, with a pull immediately before each push. Real two-parent merge commits were preserved. No main update, force push, tag, deployment, publication, package version bump, live vendor request or owner-data access occurred.

## Source tips and conflicts

| Repository | Starting cloud/combine | Merged cloud/google-forms | Real merge commit |
| --- | --- | --- | --- |
| Jini | `a67df1d7fa0add2ff82751e15b34114e5870f340` | `ddd26f3ab604c7b75b46e0800281c54e5b49c31a` | `67cbf1c5cce00d101b6f9a6994d7a937dff5baa7` |
| Tovu | `c94bec428d4d20c06ffecc8d5752eb76309c20f4` | `b3d3351c781949f607189d281d087a9e52793a0e` | `bae52ecf0922ffba93436b7f82d1091e520c33e8` |

Jini conflicts:

- `packages/cms/src/forms/html-render.ts`: retained `schemaHash` and placement `idPrefix`, and added `consentOff` to the collection renderer options. Native forms retain schema evidence and field associations; hosted forms retain consent behavior.
- `packages/cms/src/widgets/resolvers/contact-form.ts`: retained asynchronous canonical schema hashing and its assertions, and passed the host consent policy through the same props builder.
- `packages/provider-plugins/package.json`: retained existing version 0.6.24, kept the Formspree distribution path at that version, and added the Google Forms exports and build step at that same version.
- `packages/plugin-catalog/catalog.json`: preserved both sides' entries, then regenerated digests and versions from the combined built artifacts.

Tovu conflicts:

- `apps/website/src/server/inbound/public-http/http/site/render.ts`: kept both placement `idPrefix` and host `consentOff` when rendering the collection plan.
- `apps/website/src/server/runtime/composition/app.ts`: retained the attachment purge hook import and added the current public-header metadata reader. The unused old `scheduleFormAttachmentCleanup` import remains removed; cleanup already belongs to the existing composition module.

One small metadata integration repair followed the build: the incoming legacy provider catalog pointed Google Forms at nonexistent `plugins/google-forms/0.6.23`. A direct path-existence probe failed. Aligned that row with the already-existing package version 0.6.24 and proved the artifact and its manifest exist at the corrected path. No package version was changed. The inherited omission of Formspree from that legacy catalog was left alone.

All 32 Jini and 35 Tovu pre-existing report files were verified byte-for-byte unchanged. Both Google Forms reports are retained. Commerce configuration and seeded enabled-plugin selection are unchanged; the focused test proving disabled commerce passes `/products` and `/products/example` through to the site's CMS page passed.

## Setup and clean build proof

Loaded the plans-branch AI-Dev-Shop Software Architect, Programmer and TDD personas and read the setup under `/workspace/.tovu-build`.

Commands below run after `source /workspace/.tovu-build/env.sh` in the named repository.

Jini baseline setup:

```bash
pnpm install --frozen-lockfile --store-dir /workspace/.pnpm-store
pnpm -r build
```

Both passed on the starting source base. The first install attempt hit the read-only preinstalled home cache; copied the cache under `/workspace`, updated only local install metadata and used that workspace store. No tracked install metadata or lockfile changed. Tovu was relinked from the baseline build. A preliminary Tovu typecheck overlapped temporary merge markers and is excluded as baseline evidence.

For the merged clean build:

```bash
python3 /workspace/work/merge-round-3/clean-generated.py
pnpm -r build
```

The cleanup script walked the complete Jini workspace excluding `node_modules` and `.git`, checked each removed path against tracked files, removed 40 generated output entries (all workspace `dist` directories and TypeScript incremental files), and asserted that zero `dist` directories and zero `.tsbuildinfo` files remained before invoking the recursive build. The entire recursive build passed from that state, including the examples. No preliminary core build or retained workspace dist output was needed.

Tovu setup after that build:

```bash
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
npm --prefix packages/contracts run build
npm --prefix packages/sdk run build
npm --prefix apps/desktop run build:preload
```

All passed. Initial Tovu typechecks and some focused tests found stale local contract output from the preinstalled base; rebuilding those unchanged contract/SDK sources repaired the setup. Root/admin/desktop typechecks were rerun after that repair. Link state, lockfiles and generated local output were not committed.

## Required checks

Jini — all passed:

```bash
pnpm typecheck
pnpm --filter @jini-ai/plugin-catalog run generate
npm_config_cache=/workspace/work/merge-round-3/npm-cache pnpm guard:plugins
npm_config_cache=/workspace/work/merge-round-3/npm-cache pnpm guard:plugins:packed
npm_config_cache=/workspace/work/merge-round-3/npm-cache pnpm --filter @jini-ai/plugin-catalog run test
```

`pnpm typecheck` includes workspace typechecks and the scripts TypeScript check. Catalog tests: 65 passed, zero skipped. Generated catalog changes were committed.

Tovu — all four final checks passed:

```bash
npx --no-install tsc -p tsconfig.json --noEmit
npm --prefix apps/admin run typecheck
npm --prefix apps/desktop run typecheck
npm --prefix apps/site-chat run typecheck
```

## Conflict-focused tests

Jini:

```bash
npm --prefix packages/cms run test -- src/forms/__tests__/html-render.test.ts src/forms/__tests__/html-render.fields.test.ts src/forms/__tests__/provider.test.ts src/forms/__tests__/embed-consent.unit.test.ts src/widgets/__tests__/unit/resolvers-contact-form.unit.test.ts src/widgets/__tests__/unit/resolvers-core-wiring.unit.test.ts
pnpm --filter @jini-ai/provider-plugins exec vitest run src/__tests__/artifact.integration.test.ts
```

CMS: 69 passed across six files. Provider artifacts: 14 passed, zero skipped, including packed installation and loading outside the workspace.

Tovu initial selected run:

```bash
node --import tsx --import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks --test --test-concurrency=1 apps/website/src/server/inbound/public-http/http/site/__tests__/render.test.ts apps/website/src/server/inbound/public-http/http/site/__tests__/render-form-layout.test.ts apps/website/src/server/inbound/public-http/http/site/__tests__/form-attempt-token.unit.test.ts apps/website/src/server/inbound/public-http/http/site/__tests__/render-products.unit.test.ts apps/website/src/server/runtime/composition/__tests__/app.consent-capture.test.ts apps/website/src/server/runtime/composition/__tests__/app.l058a.test.ts apps/website/src/server/runtime/composition/__tests__/form-file-cleanup-wiring.test.ts apps/website/src/server/runtime/composition/__tests__/commerce-http.unit.test.ts apps/website/src/server/runtime/composition/__tests__/commerce-composition.unit.test.ts apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts apps/website/src/features/site-export/__tests__/hosted-forms-static.unit.test.ts
```

Initial result: 288 passed, 8 failed. Three failures were the missing Playwright browser bundle; two file-load failures and two commerce checks encountered stale contract artifacts; one cleanup assertion is inherited. Hosted forms retained consent/fallback markup through the live widget renderer, static HTML and ZIP tests.

After selecting the installed system Chromium 155.0.8059.79 using workspace-local browser-selector symlinks (no test changes):

```bash
PLAYWRIGHT_BROWSERS_PATH=/workspace/.tovu-build/playwright node --import tsx --import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks --test apps/website/src/server/inbound/public-http/http/site/__tests__/render-form-layout.test.ts
```

All 4 passed, zero skipped, including hidden successful forms, fallback colors and inline checkboxes.

After rebuilding local contract output:

```bash
node --import tsx --import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks --test --test-concurrency=1 apps/website/src/server/runtime/composition/__tests__/app.consent-capture.test.ts apps/website/src/server/runtime/composition/__tests__/app.l058a.test.ts apps/website/src/server/runtime/composition/__tests__/commerce-http.unit.test.ts
```

10 passed, 1 failed: the published-consent banner assertion. All recovery/header checks and all commerce HTTP checks passed.

## Inherited failures verified against the starting source

Used an isolated local worktree at `/workspace/work/merge-round-3/tovu-base`, branch `cloud/merge-round-3-baseline`, exact original Tovu commit `c94bec428d4d20c06ffecc8d5752eb76309c20f4`, with installed dependencies linked from the main checkout. This local diagnostic branch was never pushed. Shared Jini cleanup and server banner implementations were not changed by this merge.

Ran these commands in that original-base worktree:

```bash
node --import tsx --import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks --test apps/website/src/server/runtime/composition/__tests__/form-file-cleanup-wiring.test.ts
node --import tsx --import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks --test apps/website/src/server/runtime/composition/__tests__/app.consent-capture.test.ts
```

Each produced 2 passed and the exact same 1 failed assertion as the merged tree. Stopped on those inherited failures; no assertions, test files, guards, skips, exclusions or rules were modified to obtain a pass.

BUG (inherited): `form-file-cleanup-wiring.test.ts`, unowned bytes case, expects one `owner-probe`; both base and merged execution produce two probes before deleting bytes and removing the blob.

BUG (inherited): `app.consent-capture.test.ts`, published consent case, expects `id="jini-consent"`; both base and merged site app HTML omit that banner.

OBSERVATION (inherited): the original-base and merged composition tests emit `charts-recharts` initialization warnings with `INTEGRITY_FAILED`. The required Jini plugin and packed guards pass. No unrelated provider/runtime repair was attempted.

## Complexity, whitespace and secrets

Jini conflict source passed:

```bash
pnpm exec eslint --no-inline-config --no-error-on-unmatched-pattern --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/cms/src/forms/html-render.ts packages/cms/src/widgets/resolvers/contact-form.ts
```

Tovu conflict source:

```bash
npx --no-install eslint --no-inline-config --no-error-on-unmatched-pattern --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/server/inbound/public-http/http/site/render.ts apps/website/src/server/runtime/composition/app.ts
```

Renderer passed. App reports the same two errors as this exact baseline comparison:

```bash
git show c94bec428d4d20c06ffecc8d5752eb76309c20f4:apps/website/src/server/runtime/composition/app.ts | npx --no-install eslint --stdin --stdin-filename apps/website/src/server/runtime/composition/app.ts --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' --format json
```

BUG (inherited): `createRouteDeps` and `createApp` each have cyclomatic complexity 11, above ceiling 10. No new lint diagnostic was introduced.

Both whitespace checks passed:

```bash
git -C /workspace/Jini diff --check a67df1d7fa0add2ff82751e15b34114e5870f340 HEAD
git -C /workspace/Tovu diff --check c94bec428d4d20c06ffecc8d5752eb76309c20f4 HEAD
```

Downloaded gitleaks 8.28.0 to the job scratch directory and verified its published archive SHA256. Both commit-range scans passed with zero findings; existing configs/allowlists were unchanged:

```bash
/workspace/work/merge-round-3/tools/gitleaks git /workspace/Jini --config /workspace/Jini/.gitleaks.toml --log-opts='a67df1d7fa0add2ff82751e15b34114e5870f340..HEAD --full-history -m' --redact --report-format json --report-path /workspace/work/merge-round-3/jini-secrets-final.json
/workspace/work/merge-round-3/tools/gitleaks git /workspace/Tovu --config /workspace/Tovu/.gitleaks.toml --log-opts='c94bec428d4d20c06ffecc8d5752eb76309c20f4..HEAD --full-history -m' --redact --report-format json --report-path /workspace/work/merge-round-3/tovu-secrets-final.json
```

The concluding documentation-only ranges are also scanned before the final push.

## Pushed checkpoints

Jini, all on `cloud/combine`:

- `45972a0bf93443a5ad044496bb6135694197e152` — scope/progress report.
- `67cbf1c5cce00d101b6f9a6994d7a937dff5baa7` — real hosted-forms merge.
- `e1e3884fde0bc2878f6559f533a140216b2cb304` — conflict/check progress report.
- `6b9cb85040de926abd1aff4dae80ab5ee2ce3ec0` — regenerated catalog and aligned artifact metadata.

Tovu, all on `cloud/combine`:

- `2ddea005707b37ed4e5138153e7bcccf49eb0ed7` — scope/progress report.
- `bae52ecf0922ffba93436b7f82d1091e520c33e8` — real hosted-forms merge.
- `e235fe98c72815eba9e726e2c3b362502016cddf` — conflict/check progress report.

Final pushes use `git pull --rebase=merges origin cloud/combine` immediately before `git push origin HEAD:refs/heads/cloud/combine`; Tovu alone uses the explicitly authorized `git push --no-verify origin HEAD:refs/heads/cloud/combine`. No force option is used. The final chat records the subsequent report commits and verified remote heads.

## Scope and remaining work

Architecture/scope review: preserved generic forms/provider logic in Jini and host composition in Tovu, preserved all assertions and why comments, and added no merge-specific framework, table or runtime feature. This round adds no I/O or state cost beyond the merged feature itself. Existing package versions, registry lockfiles and commerce-off behavior were checked. Pre-completion checks confirmed source ancestry, clean tracked state apart from this report, and unchanged prior reports.

Runtime verification is partial because of the two confirmed inherited assertions above. Full repository suites remain the next job; no full suite was run here. The real public Google Form anonymous-browser and publication checks remain open as stated in the source job's report; no live form or owner data was used. `cloud/ui-fixes` remains excluded. The preinstalled untracked Jini `packages/plugin-ui-ux-design/` directory remains uncommitted.

Detailed logs remain under `/workspace/work/merge-round-3/` in this execution workspace.
