# bugs — bounded runtime verification

Bases: Tovu `e327c07c8`, Jini `6f507852d`. Both work branches are `cloud/bugs`.
Started 2026-11-05 18:50 UTC; cap 20:50 UTC. Instructions read from Jini `origin/cloud-plans-1105` using git show.
Pushed commits: Tovu `794134094` (baseline report), `380c8c9f2` (media/copy tests and receipt guard); Jini `632a69da8` (registry restart test/report). Final report commit SHAs are in the job completion message. Only `cloud/bugs` was pushed.

## Changes and dispositions

No selected production defect reproduced after rebuilding the pinned bases; no speculative production changes.
Three persistent verification cases were added, without deleting/skipping/weakening existing tests:

- Bug 44: source and destination are separate disposable SQLite files. Publish a video and its poster, with source attribution and MIME/provenance, then immediately re-plan: both unchanged, no writes, published references verified.
- Bugs 164/106: fresh workspace instances reload the on-disk registry, remove proven-missing scratch/fixture entries once, retain live scratch and independent sites and unavailable user paths, and retain one relocated independent-site entry after restart.
- Bugs 450/499: copy a fully migrated disposable SQLite DB, record all 41 ledger entries through 0039, reject a truncated older history without changing ledger/content, reopen using current history, and verify idempotence/data preservation. This verifies the migration boundary, not an Electron/admin reconnect or an actual old release boot.

Bug 104: existing PID membership logic 40/40 passed; GUI/OS memory comparison remains unverified.
Bug 110: telemetry cadence/disposal 7/7, named Cloudflare domain-edge suite 8/8, media URL resolver 18/18 and real HTTP replacement/cache/ETag tests 3/3 passed. Current migration-head checks passed. The audit's unnamed original two domain edges remain unidentified.
Bug 467: all 60 tests in the three Tovu receipt-writing HTTP/analytics suites passed under the attached JavaScript filesystem write guard, with TMPDIR set to a fresh fixture root; zero denied writes. Real atomic-write/fsync adapters ran. Jini receipt/HTTP/proof suites also passed 93/93 under the same write guard, using a temporary Vitest cache/config. Guard self-checks allowed a real fixture write and fsync while refusing sync, promises and symlink-escape writes outside the fixture root. Guard scope is Node filesystem APIs used by receipts, not a security sandbox for arbitrary native addons.
Bug 469: measured current hardwiring/type diagnostics; retained below as open findings. Coverage ratchet is excluded by the job.

## Validation

Commands are relative to the named repo unless a working directory is shown. Socket-using commands ran with the container's network permission enabled; no vendor account was used.

- Jini setup: `node /home/agent/.cache/node/corepack/v1/pnpm/10.33.2/bin/pnpm.cjs install --store-dir /workspace/work/pnpm-store --frozen-lockfile --fetch-retries=0` then `node /home/agent/.cache/node/corepack/v1/pnpm/10.33.2/bin/pnpm.cjs -r build`: passed.
- Tovu setup: `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini`; `npm --prefix packages/contracts run build`; `npm --prefix packages/sdk run build`: passed.
- Jini platform: `npm --prefix packages/platform run test -- src/fs/__tests__/directory-workspace.test.ts src/fs/__tests__/verified-directory-move.test.ts`: 41 passed (baseline 40).
- Jini platform: `npm --prefix packages/platform run typecheck`: passed.
- Jini: `node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' packages/platform/src/fs/__tests__/directory-workspace.test.ts`: passed.
- Tovu: `node --import tsx --test apps/website/src/features/media/__tests__/publish-content.apply.test.ts apps/website/src/features/media/__tests__/publish-content.characterization.test.ts apps/website/src/platform/db/migrations/__tests__/migrated-copy.test.ts`: 31 passed (29 existing + 2 new).
- Tovu desktop (`cd apps/desktop`): `node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test src/desktop-resources.test.ts src/product-memory-telemetry.test.ts`: 47 passed.
- Jini: `node --test packages/agent-plugins/cloudflare/lib/__tests__/domain-edges.test.mjs`: 8 passed.
- Jini (`cd packages/cms`): `npm run test -- src/consent/__tests__/records.test.ts src/consent/__tests__/http.test.ts src/consent/__tests__/file-records-w2g.unit.test.ts src/consent/__tests__/analytics-proof.test.ts`: 93 passed.
- Tovu migrations: `source /workspace/.tovu-build/env.sh && node --import tsx --test apps/website/src/platform/db/migrations/__tests__/runner.test.ts apps/website/src/platform/db/migrations/__tests__/runner.postgres.test.ts`: 12 passed, SQLite/PGlite/PostgreSQL including concurrent real connections, rollback, checksums, current head and chat-ledger isolation.
- Tovu receipt guard: `BUGS_FIXTURE_ROOT=$(mktemp -d /tmp/bugs-receipts-XXXXXX) && TMPDIR="$BUGS_FIXTURE_ROOT" node --import ./cloud/reports/bugs-fixture-write-guard.mjs --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/server/inbound/public-http/middleware/__tests__/site-consent.test.ts apps/website/src/server/inbound/public-http/middleware/__tests__/site-cookie-consent.test.ts apps/website/src/server/runtime/composition/__tests__/analytics-providers.unit.test.ts`: 60 passed, zero `FIXTURE_WRITE_DENIED` messages.
- Tovu: `node development/scripts/check-hardwiring.mjs`: exit 1, 89 occurrences, 16 new against its debt file, 3 stale debt entries. These are raw scanner findings, not independently certified defects.
- Tovu: `npm run typecheck:tests`: exit 2, **50 diagnostics across 27 files**, zero diagnostics in changed tests. A query-result type error in the new test was corrected before this final measurement. Exact diagnostics are attached in Tovu `cloud/reports/bugs-typecheck-diagnostics.txt`.
- Tovu complexity on the two changed tests with the same strict rule as Jini: existing async test in publish-content.apply.test.ts has complexity 13, ceiling 10; baseline stdin lint from `git show e327c07c8:<path>` reproduces it. Existing nested-increment warning also unchanged. No new lint errors in added code.
- `git diff --check`: passed in both repos.

## Open findings (one per line)

Bug 469: all 16 scanner locations are attached in Tovu `cloud/reports/bugs-hardwiring-diagnostics.txt`. Totals HW2 12 (2 new), HW5 26 (7 new), HW6 2 (2 new), HW7 45 (3 new), HW8 4 (2 new); all other rules zero. No debt entries/rules changed.
Bug 469: 50 existing test-typecheck diagnostics across 27 files remain; no test/rule was weakened to clear them. Per-file diagnostics are attached in Tovu `cloud/reports/bugs-typecheck-diagnostics.txt`.
Bug 469: existing media apply test complexity 13 remains; added cases do not increase it.
Finding: fixture startup reports charts-recharts `INTEGRITY_FAILED`; fixtures continue and assertions pass. Listed, not repaired.
Finding: the only remaining production-source test-typecheck diagnostic observed is apps/website/src/features/deployments/publish-credentials/store.ts:410, string | undefined assigned to string. Listed, not repaired.

## Limits and exclusions

Skipped GUI/vendor-account/customer-theme/video/translation rows: 49; both 83 theme defects and its carousel; 86; 89; 98; 101 Full CLI runtime; 106 local-owner sign-in; 155; 199; 326; 327; 365; 488; 501; 504; 506; 507; 511. Bug 104 runtime footprint comparison and full desktop restart/card rendering, and bugs 450/499 admin reconnect, require their real application environments.
No Group A coverage ratchet/full coverage, kUInetic/vendor changes, owner DB/registry repairs, customer publication, deployment, npm publication or main push. Full suites are reserved for the final integrated run, per job instructions.

Setup deviations: /workspace/shared/dev-env.sh and start-postgres.sh were absent; used existing /workspace/.tovu-build equivalents. Original pnpm store is read-only, so copied it under work before filling missing tarballs. Initial stale Jini/Tovu outputs produced import errors; rebuilt before attributing failures. Node permission mode was unsuitable for receipt tests because it disables fsync even inside allowed roots; used the attached guard instead. Landlock/bwrap were unavailable. No receipt adapter or test was mocked to bypass durability.
Negative control: temporarily including `createdBy` in the existing media hash reproduced bug 44: both new rows became `conflict` instead of `unchanged`. The new test failed at its outcome assertion. Original production source was restored byte-for-byte, and the focused test passed again. No production patch was retained.

Architecture audit: PASS for changes; existing owners reused, no runtime API/schema/abstraction changes, no new production reads/writes/polls. Self-validation: PASS for selected headless paths; GUI/owner-data rows explicitly unverified.

Additional exact commands:

- Tovu media URL: `source /workspace/.tovu-build/env.sh && node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/media/__tests__/resolve-media-public-urls.test.ts apps/website/src/server/inbound/public-http/routes/site/__tests__/integration/media-replace-cache.integration.test.ts`. The 18 resolver tests passed; the initial integration import hit stale contracts. After rebuilding contracts, the integration file alone with the same flags passed 3/3.
- The migration command above also used `--import ./development/test-support/composed-bundle-env.ts --experimental-test-module-mocks` (the isolated bundled-source fixture).
- Guarded Jini receipts (`cd /workspace/Jini/packages/cms`): 93 passed, zero denied writes. Temporary config changes cache location only; default node test environment and assertions remain intact.

```sh
BUGS_JINI_FIXTURE_ROOT=$(mktemp -d /tmp/bugs-jini-receipts-XXXXXX)
printf 'export default {cacheDir: "%s/vite-cache", test: {cache: false}};\n' "$BUGS_JINI_FIXTURE_ROOT" > "$BUGS_JINI_FIXTURE_ROOT/vitest.config.mjs"
TMPDIR="$BUGS_JINI_FIXTURE_ROOT" NODE_OPTIONS='--import /workspace/Tovu/cloud/reports/bugs-fixture-write-guard.mjs' node /workspace/Jini/node_modules/vitest/vitest.mjs run --config "$BUGS_JINI_FIXTURE_ROOT/vitest.config.mjs" src/consent/__tests__/records.test.ts src/consent/__tests__/http.test.ts src/consent/__tests__/file-records-w2g.unit.test.ts src/consent/__tests__/analytics-proof.test.ts
```
- Tovu added test strict lint: `node_modules/.bin/eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/platform/db/migrations/__tests__/migrated-copy.test.ts`: passed. The report guard uses `/workspace/Jini/node_modules/.bin/eslint --config /workspace/Jini/eslint.config.mjs` with the same flags and ceiling, because Tovu does not register the Sonar plugin for .mjs files; passed with that explicit config. The initial combined lint command failed to load the plugin; no rule was disabled.

Function-quality review: tests reuse production publish/migration/registry owners and real disposable databases/files. No new production logic was assessed. The report-only filesystem guard is linear in filesystem path depth per write; it covers the Node write seams exercised here and explicitly does not claim a native-code security boundary. No positive closure claim is made for GUI, owner-data or unnamed-edge cases.

Tovu production typecheck: `node_modules/.bin/tsc -p tsconfig.json --noEmit`: exit 2, one pre-existing diagnostic at features/deployments/publish-credentials/store.ts:410 (same diagnostic also present in the test typecheck). No production files were changed.

Focused runtime totals: **313 passed** across the eight non-overlapping groups above; no skipped tests. The expected failing negative control is recorded separately. Strict lint passes for the new migration case, new registry case and receipt guard; the pre-existing complexity-13 case remains disclosed.

Workspace note: Jini packages/plugin-ui-ux-design contains pre-existing untracked material after selecting the pinned base; it was left untouched and excluded from every commit.

Final setup verification: repeated Jini `node /home/agent/.cache/node/corepack/v1/pnpm/10.33.2/bin/pnpm.cjs -r build` after adding the registry test, then Tovu `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini`: both passed. Production source is unchanged in both repos. Work completed 2026-11-05 19:10 UTC, within the two-hour cap.
