# wave1 / xpkg-G-STALE-DEPS — PARTIAL (18 of 19 rows done; row 1 STOPPED, row 20 skipped by design)

Branch `wave1/xpkg-G-STALE-DEPS` (Jini only; Tovu unchanged, no Tovu push). Base `65d73b0d` (= `integ/merge-final-2026-11-16`; Tovu base `232764af`, `a28cb1bf` ancestor check ok). Node 24.11.1, pnpm 10.33.2.

## Commits (all pushed)
| SHA | Package | Rows |
|---|---|---|
| 84f164df | analytics | 2 (agent-runtime peer deleted) |
| 8c357a2f | capability-providers | 3 |
| ba845da7 | cli | 4 |
| e733a14a | http-kit | 7 |
| da7f5f77 | commerce | 5, 6 |
| ef017b92 | integrations | 8 |
| 570d7bc1 | user-management | 11 (+ package-entries.test.ts: agentic dropped from expected peer list, asserted absent; red on old manifest) |
| a64b3ff6 | registry | 9 (db peer deleted, devDependency kept), 17 (platform dependencies -> devDependencies) |
| 65ef64cc | ui | 10 (platform deleted), 18, 19 (agentic, ui-kit -> devDependencies) |
| 5080bc1f | admin | 12, 13 -> devDependencies |
| d88cd6d0 | cms | 15 -> devDependencies |
| c4567c13 + 20c8d04c | plugins | 16 -> devDependencies. **c4567c13 is red alone** (package-surface.integration.test.ts still named db as optional peer); 20c8d04c fixes the test. My amend did not apply and both went up in one push; history is pushed, not rewritten. |
| f57364fa | chat | 14 -> devDependencies (+ two manifest tests: store/__tests__/manifest.test.ts, __tests__/dbpkg-chat-manifest.test.ts) |
| 341c8dcf | changeset | `.changeset/stale-manifest-deps.md` (patch, 13 packages) |

## STOPs / skips
- **Row 1 agent-plugins -> commerce: STOP, NOT TOUCHED.** Not stale: `packages/agent-plugins/core/commerce-server.mjs` and `.d.ts` re-export from `@jini-ai/commerce`, and `package.json` `exports["./commerce/server"]` publishes them (sheet STOP: exports name the target). Census scans `src/` only so it missed this. Removing the optional peer would break the published `@jini-ai/agent-plugins/commerce/server` entry. Needs an owner decision; census still prints it as STALE.
- Row 20 daemon -> db: skipped as the sheet says (R8b step 9 owns it).
- Census after: `manifest: STALE 2 USED 41` (exactly rows 1 and 20), was STALE 20.

## Gates (final tree, HEAD 341c8dcf)
- Baseline on unmodified tree: `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` green; `pnpm guard` exit 0; per-package tests green (counts below).
- Per commit: build of the package, `npm --prefix packages/<pkg> run test`, `pnpm guard` (diff vs baseline empty). Test counts equal before/after in every package: analytics 224, capability-providers 198, cli 591, commerce 1409(+1 skipped), http-kit 561, integrations 2053, registry 391, user-management 1233, ui 8584, admin 2846, cms 4085, plugins 1011, chat 4434(+1 skipped).
- Final: `pnpm --no-bail -r build` 0, `pnpm typecheck` 0, `pnpm guard` 0 (identical to baseline), `check:size` 0, `check:complexity` 0.
- `pnpm check:hooks` exit 1: **PRE-EXISTING** (fails identically on `65d73b0d`; ui `useT` direct-call findings, no file of this lane touched).
- `pnpm typecheck` was run once after the first commit and once on the final tree, not after every commit (about 2 min each). Manifest-only changes; S1 gap noted.
- S3, S4, S6, S10, S11 print nothing. S13: one removed `expect(` (chat store manifest.test.ts) was rewritten with agentic dropped from the list, plus a new devDependency assertion. S7: one comment reworded in the same file (it said entries "load agentic"; they do not).
- S8: no production source file changed; only package.json, lockfile, injection-debt and test files.

## Deviations
- `pnpm install --config.prefer-workspace-packages=true` cannot re-resolve in this environment: it fails with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` (undici 7.30.2, 11 days old vs `minimumReleaseAge`). To keep every unrelated version fixed (sheet STOP), I edited only the touched `packages/<pkg>` importer blocks in `pnpm-lock.yaml` by hand and verified with `pnpm install --frozen-lockfile` (passes). The only lockfile changes are the removed/moved workspace links.
- devDependency policy: where no file at all (src, tests, config) used the target, its devDependency link was removed too (rows 2-8, 10, 11 except registry db). `@jini-ai/db` stays in registry devDependencies: tsconfig `paths` map db types to `../db/dist`, and the link keeps db built first.
- Step 2 moves to devDependencies re-sorted the devDependencies block in ui (diff noise only).
- Manifest tests the sheet did not list needed updates: plugins package-surface, chat (two).
- Injection-debt keys retired in each commit (one per removed manifest edge; cli had none).
- Test edges left for later lanes: rows 12, 13, 18, 19 -> G-TESTS T3; 14 -> C-CHAT-DEPS/T0; 15, 16, 17 -> T2/T4.

## Next step
Owner decision on row 1 (either document `agent-plugins -> commerce` as a used optional peer and teach the census about `core/*.mjs`, or move the commerce server entry). Then G-TESTS.
