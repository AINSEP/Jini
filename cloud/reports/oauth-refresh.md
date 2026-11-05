# oauth-refresh — 2026-11-05

Completed OA-plan-result.md step 2 only. Elapsed time: approximately 12 minutes,
within the two-hour cap. Loaded the plans branch's Software Architect, Programmer,
and TDD personas. Used its AI-Dev-Shop copy and the required read-only Sidekick.

## Branches and commits

- Instructions: Jini `origin/cloud-plans-1105` at
  `a2e6fe163f47309cda7d576a624dd511faea035d`.
- Jini base: `6f507852d50cc5b22914917ad3a80f1168feccee`.
- Jini branch: `cloud/oauth-refresh`.
- Failing regression, pushed first: `ab27ad837113c547ad1cfc027e7d6ca3cb0ee274`.
- Fix and remaining regression coverage, pushed:
  `8c60df9d8c4fad605afb1a3ab5ad277d24b4a321`.
- This report is committed afterward on the same branch; the final delivery message
  identifies that report commit. Pull/rebase preceded updates to the existing remote
  branch; all pushes explicitly targeted `refs/heads/cloud/oauth-refresh`.
- Tovu: no tracked changes or commits. Linked its installed dependencies to rebuilt
  Jini with the requested `link:jini` command; its existing `work` branch is unchanged.

## Change and bug log

BUG FIXED: A delayed lease acquirer could redeem an already-rotated refresh token because it used the token loaded before acquiring the lease.

After successful lease acquisition, reload the token and evaluate its expiry using
the current clock. Return a fresh token, refresh the latest still-due token, or
require reauthorization if storage is empty. Reload errors still release the lease.
The production change is 11 added lines and one replaced line in the existing
refresher; no new abstractions, configuration, schema, or public APIs.

The barrier regression explicitly schedules B's load, A's refresh/persist/release,
then B's acquisition. Before the fix it failed with two redemptions of `rt-current`.
The same schedule also failed against two independent vault-backed store instances,
with the expired refresh token redeemed twice. Both now redeem exactly once.

Added tests cover a changed but still-due token, a newly installed non-expiring
token, deletion before the post-lease reload, reload failure and retry, and
disconnect while the provider request is in flight. Existing affected tests retain
coverage for rotation persisted before return, persistence failure returning no
token, expired-lease takeover/fencing, resource/scopes on the refresh wire request,
polling limits, and ports without leases.

State cost: one extra selected-token load per successful lease acquisition. No new
polling, writes, timers, or background work; a fresh reload avoids a redundant
provider request and persistence write. Existing wait intervals and timeouts remain.

Architecture review: existing storage/provider ports and generation/write fences
are reused. The reload stays inside the existing try/finally so success and failure
release the lease. No product-specific logic enters Jini. The new independent-store
test uses the existing encrypted in-memory vault fixture; real SQLite/process
integration is part of the excluded later OA integration step.

## Validation

Commands below run in `/workspace/Jini` after
`source /workspace/.tovu-build/env.sh`, except where a different directory is stated.

Baseline before adding tests: token refresh 26/26; vault security 28/28.

RED, before changing production code:

```sh
npm --prefix packages/oauth run test -- tests/token-refresh.test.ts -t 'a delayed lease acquirer'
npm --prefix packages/oauth run test -- tests/token-refresh.test.ts -t 'a lease winner|a failed post-lease'
npm --prefix packages/integrations run test -- src/api-connections/token-store/__tests__/vault-token-store.security.test.ts -t 'does not redeem a stale'
```

Results: the first and third commands each failed on duplicate redemption; the
middle command failed all four new post-acquisition cases as expected.

Final GREEN checks:

```sh
npm --prefix packages/oauth run test -- tests/token-refresh.test.ts tests/args-convention.test.ts
npm --prefix packages/integrations run test -- src/api-connections/token-store/__tests__/vault-token-store.security.test.ts src/api-connections/token-store/__tests__/vault-token-store.unit.test.ts src/api-connections/token-store/__tests__/vault-token-store.slice.test.ts
npm --prefix packages/oauth run typecheck
npm --prefix packages/integrations run typecheck
npm --prefix packages/oauth run build
npm --prefix packages/integrations run build
pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/oauth/src/refresh.ts packages/oauth/tests/token-refresh.test.ts packages/integrations/src/api-connections/token-store/__tests__/vault-token-store.security.test.ts
git diff --check
```

Results: OAuth 38/38; integrations 53/53; both typechecks and builds pass; strict
complexity/cognitive-complexity ceiling 10 passes. No tests, assertions, or lint
rules were disabled, weakened, or deleted. No full test suites were run.

From `/workspace/Tovu`:

```sh
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
```

Then `node /workspace/work/oauth-tovu-smoke.mjs` passed: resolve OAuth through
Tovu's package installation, verify it is Jini's rebuilt dist, and exercise a token
replacement between load and lease acquisition. It returns the published token,
makes zero provider redemptions, and releases the lease once. This scratch script
is environment-local; the equivalent permanent regression is in token-refresh.test.ts.

## Setup findings and remaining limitations

- The specified `/workspace/shared/dev-env.sh` and `start-postgres.sh` are absent.
  Used `/workspace/.tovu-build/env.sh` and `start-postgres.sh`; PostgreSQL started
  successfully and `select 1` returned 1. OAuth tests use synthetic data only.
- Repository-wide `pnpm -r build` was attempted. It stopped in untouched
  `@jini-ai/provider-plugins`. A focused diagnostic,
  `pnpm run typecheck` from `packages/provider-plugins`, identified TS2307:
  `src/__tests__/browser-provider-dom.ts(3,23)` cannot resolve `jsdom`.
  This is outside the job's source changes; both touched packages build successfully.
- `pnpm install --frozen-lockfile` attempted setup repair but hit
  `ERR_PNPM_EROFS` on the default store under the read-only home directory and was
  stopped. `pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store
  --fetch-retries 0` aborted with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
  No dependency manifests or lockfiles were changed. The final focused tests,
  package builds, and lint passed after these attempts.
- Unrelated `packages/plugin-ui-ux-design/` build leftovers are untracked after
  switching to the required older base; left untouched and uncommitted.
- No other OAuth bug remains open within step 2. Later OA sharing/UI/MCP steps
  remain outside this job.
