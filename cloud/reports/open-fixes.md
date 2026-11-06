# open-fixes

Completed the requested Jini checks on `cloud/open-fixes`, based on `origin/cloud/combine` at `f07ae3d6ff55cf4da480acac44cc6f4b7686966b`. No Jini implementation change was needed. The only Jini changes are this report and its progress checkpoint.

Tovu work is on the same branch name, based on `74fedc1320d31431ab4a13d1e38af03a402ca28b`; its implementation tip before the final report is `b33c455f7`. See the [Tovu report](https://github.com/AINSEP/Tovu/blob/cloud/open-fixes/cloud/reports/open-fixes.md) for every item, Tovu commit ledger and exact affected commands. Scoped work finished within the two-hour cap. Validation is PARTIAL across Tovu because the explicitly listed baseline failures remain.

## Item dispositions

| Item | Result |
|---|---|
| 1 | Fixed in Tovu: case variants now reach commerce handlers. |
| 2 | Fixed in Tovu: site/app names remain literal in Stop prompts; related prompts checked. |
| 3 | Already fixed: isolated warning regression passes. |
| 4 | Fixed stale Tovu tests/fixtures; all ten known failures now pass, 95/95 focused cases. No new consent mechanism. |
| 5 | Fixed Tovu test types: independently reproduced 76 diagnostics on exact base; final production and test compilers pass. |
| 6 | Fixed starter Reset originals to match shipped pages; the shipped loader additions were authoritative. Separate other-theme drift listed only. |
| 7 | Already fixed for Cloudflare; Vercel version complaint is incorrect for the current identical published bytes. |
| 8 | Already fixed; large-choice regression passes. |
| 9 | Already fixed; auth classification regressions pass. |
| 10 | Already fixed; shared 50 MiB document limit verified. |
| 11 | Already fixed; disabled-plugin discovery metadata retained. |
| 12 | Existing ETag/short-cache correction verified. Retroactive invalidation of client caches needs a new mechanism; stopped there. |
| 13 | Already fixed; release checks bind catalog entries to selected archives and immutable published versions. |

The additional requested lifecycle correction was completed in Tovu. Its details are intentionally omitted as requested.

## Build and verification

All commands first source `/workspace/.tovu-build/env.sh`. Jini cwd `/workspace/Jini` unless stated.

```sh
CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store
pnpm --no-bail -r build
```

Both passed on the requested base. In `/workspace/Tovu`, contracts/SDK builds and `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` passed. Initial setup retries corrected a read-only default cache and a noninteractive purge prompt; they were not source failures.

Commands ran from `/workspace/Jini` after the coordinator rebuilt and relinked the baseline, with `source /workspace/.tovu-build/env.sh` first:

| Item | Finding | Exact command | Result |
| --- | --- | --- | --- |
| 8 | Already fixed: selections are appended with a loop; the existing 200,000-selection regression preserves every answer without an argument-stack overflow. | `npm --prefix packages/chat run test -- src/core/__tests__/question-answer.test.ts` | 22 passed |
| 9 | Already fixed: an environment-key mention needs an actual authentication problem; plain mentions and rate/upstream errors are not classified as missing authentication. | `npm --prefix packages/agent-runtime run test -- src/__tests__/auth.test.ts` | 75 passed |
| 10 | Already fixed: document admission, upload, reads and extraction reuse the shared inclusive 50 MiB limit, with a plain refusal naming the limit. | `npm --prefix packages/cms run test -- src/media/__tests__/document-ingress.test.ts` | 9 passed |
| 11 | Already fixed: disabled candidates retain discovery metadata while tool availability stays disabled; existing tests cover metadata preservation, ranking and bounded pages. | `npm --prefix packages/agent-plugins run test -- src/lifecycle/__tests__/unit/search-projection.unit.test.ts` | 3 passed |


Items 8–11: 109 passed, no failures/skips. No source edits.

### Plugin checks

Items 7 and 13 already resolved; no files changed for these items.
7: Cloudflare current manifest 0.3.2 vs immutable npm @jini-ai/agent-plugins@0.6.23 manifest 0.3.1. Changed published files: lib/forms.mjs, lib/target.mjs, worker/forms-receiver.mjs, plugin.json. Payload changes include shared portable form validation/schema evidence and retained pending submissions after provider switches. Vercel current and published 0.1.0, all nine published files byte-identical, so no bump justified. Current catalog versions/digests match both. Explicit updates compare semver and digest, bundled selection uses recorded content digest.
13: Already fixed: both release entrypoints call preparePluginRelease before upload; catalog checked against exact prepared archives and immutable skipped registry package versions. Changed agent bytes require newer inner semver.
Tests after baseline setup (source /workspace/.tovu-build/env.sh):
pnpm exec vitest run scripts/__tests__/plugin-release-consistency.test.ts scripts/__tests__/plugin-release-prepare.test.ts -- 10 passed.
npm --prefix packages/plugin-catalog run test -- 65 passed.
npm --prefix packages/agent-plugins run test -- src/lifecycle/__tests__/unit/compatibility-update-plan.unit.test.ts -- 55 passed.
node --test packages/agent-plugins/cloudflare/__tests__/bundled-package.test.mjs packages/agent-plugins/vercel/__tests__/bundled-package.test.mjs -- both files passed.
Read-only registry commands: npm --cache /workspace/work/open-fixes/npm-cache view @jini-ai/agent-plugins dist-tags --json; npm --cache /workspace/work/open-fixes/npm-cache pack @jini-ai/agent-plugins@0.6.23 --ignore-scripts --json --pack-destination /workspace/work/open-fixes/plugin-published. Latest 0.6.23. Extracted tarball SHA-256 file comparison excluding unpublished tests.
Architecture audit PASS; no source changes, no added runtime state cost; no additional bugs noticed. Logs plugin-{release,catalog,update}-tests.log in /workspace/work/open-fixes.


## Bugs found

- No additional Jini bug was found in the requested checks. The previously reported items above already have corrections on the base.
- Tovu findings, including open baseline tests, template drift and lint debt, are listed individually in its report.

## Review and delivery

Architecture review PASS for the scoped changes: existing Jini ownership/ports preserved; no new mechanism, dependencies, state, polls or runtime I/O here. No tests/checks were weakened, deleted, disabled or excluded. No coverage percentage is claimed; only affected checks were run, as directed.

Jini pushed checkpoint: `a565bdbd9` (`docs: record open fixes work in progress`). The final report commit follows that checkpoint; its full SHA is provided in the final response. Tovu implementation commits and results are in the linked report. All pushes target only `cloud/open-fixes`; no deployment or publication was performed.
