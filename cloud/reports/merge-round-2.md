# merge-round-2 — in progress

Branch: `cloud/combine`. Original base: `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`.

Software Architect, Programmer and TDD instructions loaded from the plans branch. Job merge-round-2 governs scope; merge-rest supplies only conflict, check and push rules.

## Merges

| Branch | Source SHA | Result |
| --- | --- | --- |
| cloud/clean-build | 9ef4084a7b7327eb8974fcd55981bf2ebee908c5 | Merged: report says complete; real merge commit. |
| cloud/release-fixes | 57575f583d9dba4f37dc3ff74a2261b5a93af93b | Merged: report says complete; real merge commit. |
| cloud/small-fixes | 7d91815d22b199a8263006b5d97b3acba3fd743e | Merged: report says complete; real merge commit. |
| cloud/om-chat-3 | 5d6edfc3442feda8edfd41b54c08e221ceea1577 | Merged: report says complete; real merge commit. |
| cloud/forms-left | e0dab177afd45fccca44fef82b0a36b37b1c87f5 | Merged: report says complete; real merge commit. |
| cloud/consent-declare | 8ff6006f92e7f157c47c74ab6255652cec3b395c | Merged: report says complete; real merge commit. |
| cloud/forms-privacy | 4bde048688bcba568782929632fb2c4b81c71a72 | Merged after refreshed report declared implementation complete; no textual conflicts. |
| cloud/one-card | 71727983f6febd16e46af84bbbf88afd3f0ebee0 | Ready: bounded implementation reported complete with open items; merge follows current check completion. |

No textual merge conflicts. All branch reports retained. No conflict-targeted tests apply so far; full suites are not run.

## Checks in progress

Jini baseline `pnpm -r build` failed at user-management before merges, without emitted compiler diagnostics. No green starting-tree build is claimed. After installing the merged frozen lockfile, its direct package compile and both complete recursive builds passed. The fresh clone had no dist directories before installation/build and used only seeded download caches, not copied node_modules or dist. An early Tovu tsc attempt during the baseline rebuild encountered stale declarations. All four final Tovu checks now run after the successful working-tree Jini build and relink.

Commit-range gitleaks 8.28.0 scans passed for both repositories with no leaks. Strict complexity checks are running on changed production/tooling files.

Commerce mounting remains activation guarded: an inactive store calls next(), preserving the site-owned /products route. Consent-off document construction uses normal declared-script rendering. No flags were enabled.

No additional features, refactors, version bumps, link-state changes or test/rule weakening introduced by this integration job. No main push, force push, publish, tag or deployment.

## Completed build and source checks

Commands source `/workspace/.tovu-build/env.sh`. Logs are under `/workspace/work/merge-round-2/`.

- Fresh checkout: `git clone --no-hardlinks --branch cloud/combine /workspace/Jini /workspace/work/merge-round-2/clean/Jini`, then `test -z "$(find /workspace/work/merge-round-2/clean/Jini -type d -name dist -print -quit)"` — PASS, no pre-existing dist.
- Both Jini checkouts: `CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/merge-round-2/pnpm-store` — PASS.
- Both Jini checkouts: `npm_config_cache=/workspace/work/merge-round-2/npm-cache pnpm -r build` — PASS, including all examples.
- Working Jini: `pnpm guard:plugins` — PASS.
- Both Jini checkouts: `pnpm --filter @jini-ai/plugin-catalog run generate` — PASS; generated files compare identical. Commit `d5607be9f` changes only three expected digests: PostHog consent-adapter/index and Cloudflare forms-receiver. No integration-authored version bump.
- Tovu: `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` — PASS. No tracked dependency manifest, registry lockfile or link-state change.

## Pending checks

- Clean Jini: `pnpm typecheck` (all workspace packages and scripts).
- Clean Jini: `npm_config_cache=/workspace/work/merge-round-2/npm-cache pnpm guard:plugins:packed`.
- Tovu: `npm run typecheck`; `npm --prefix apps/admin run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm --prefix apps/site-chat run typecheck`.

## Strict complexity

Changed existing production/tooling files were selected with `git diff --name-only --diff-filter=ACMR <original-base>..HEAD`, restricted to JS/TS extensions, excluding tests and vendor files. Exact argv arrays are retained in `jini-complexity-other-command.json`, `tovu-complexity-other-command.json`, and `tovu-complexity-desktop-command.json` in the log directory.

Commands: `./node_modules/.bin/eslint --no-error-on-unmatched-pattern --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' <selected-files>`; desktop uses the same command with both limits 9. Jini: 75 files, 5 errors/7 warnings. Tovu non-desktop: 49 files, 5 errors/8 warnings. Desktop: 1 file, PASS. The error functions/values match findings already documented by the merged source jobs. No rule or code was weakened to remove them.

BUG (existing): Jini `isDocumentOnlyBlob` complexity 11.
BUG (existing): Jini executor `run` complexity 20/cognitive 13.
BUG (existing): Jini `catalogEntry` complexity 12.
BUG (existing): Jini `checkPluginPackages` cognitive complexity 11.
BUG (existing): Tovu `readBundledTemplateFallback` complexity 11.
BUG (existing): Tovu `createRouteDeps` complexity 11.
BUG (existing): Tovu `createApp` complexity 11.
BUG (existing): Tovu `composeSiteRouteDeps` complexity 21/cognitive 21.
BUG (source-job report, unchanged): provider-plugins/catalog.json omits formspree while the shared catalog includes it.

No source tests were run: there were no conflicted files. Full suites are explicitly deferred by the job. Source review confirmed forms cleanup/schema-hash wiring and consent declarations both survived automatic merges in app.ts, deps.ts and render.ts. Commerce-off fallthrough and ordinary consent-off script rendering remain intact.

Final typecheck/packed results, final commit-range scan and completion report pending.

## Refreshed completion reports

forms-privacy became implementation-complete during verification and was merged next in both repositories. Its report records a reproduced baseline commerce approval-classification startup bug; focused validation passed. one-card remains in progress. A second fresh no-dist checkout is building the seven-branch result; working CMS/admin are rebuilding and final validation will be refreshed. The first Tovu final typecheck attempts exposed stale local @tovu/contracts output; contracts/SDK are rebuilding using the existing scripts before rerunning checks. No compiler or source workaround was added.

## Final readiness refresh

one-card now reports its bounded implementation and focused verification complete. The report preserves deliberate exclusions, two large-card migrations, uncached source limitations, unpublished package adoption and reproduced baseline findings. Tovu merged it cleanly; Jini will merge it after the active seven-branch check completes. The final verification will cover all eight requested branches.

Seven-branch clean no-dist recursive build and all four Tovu typechecks passed. The final-clean catalog regeneration matches the committed catalog exactly. Existing source/packed guards passed on the first six branches; the seven-branch packed guard and Jini typecheck are completing.
