# xpkg-wave1b: G-TESTS-0 setup + R12d

Branch `wave1/xpkg-G-TESTS-0-R12d` (Jini). Base `origin/refactor/terra` = `65d73b0d` (Jini), Tovu `origin/refactor/terra` = `232764af`, which contains `a28cb1bf`.
Tovu: NOT changed, so no Tovu branch. Status: **G-TESTS-0 PARTIAL (stopped on the known lockfile trap)**; **R12d DONE except its OD-5 item (skipped as ordered)**.

## Base checks (COMMON §Base)
- Jini `git merge-base --is-ancestor 65d73b0d HEAD` -> ok. Tovu `git merge-base --is-ancestor a28cb1bf origin/refactor/terra` -> ok.
- Tovu on `origin/refactor/terra` (`git grep`): `agent-runtime/ai-trace` and `from "@jini-ai/agent-runtime"` in `desktop-agent-inventory.ts` both print nothing. (The Tovu checkout in the container sits on `main`; the checks were run against the ref.)
- Jini: Node 24.22.3, `pnpm install --frozen-lockfile` ok, `pnpm --no-bail -r build` exit 0. Baseline `pnpm guard` exit 0 (`/tmp/guard-before.txt`).
- Tovu baseline (npm ci, link, typecheck) was NOT run: no Tovu file changes, and every Jini change here is additive to public surfaces (new entries) or touches payload comments/tests.

## Commits (all pushed)
| SHA | What |
|---|---|
| `22662851` | core: `./contracts/runtime/testing` entry: `fakeFileLock`, `fakeAtomicWriter`, `fakeProcessControl`, `fakeHttpFetch`, `fakeGuardedHttp({ routes })` + 17 tests + exports/`jini.entries`/README row + `api-baseline/jini-ai__core.json` |
| `9df172c3` | ui: `fakeUiKit` moved from `src/react/__tests__/fake-ui-kit.tsx` to `src/react/testing.tsx` (entry `./react/testing`); `renderWithUiKit` stays in `__tests__/render-with-ui-kit.tsx` so the published entry has no test-library import; the one importer repointed; README; `api-baseline/jini-ai__ui.json` |
| `3c6d19ff` | R12d: `vercel.test.mjs` reads `DeployError` from the fake host kit instead of importing devops |
| `b75f82a2` | R12d: netlify + vercel-blob JSDoc `import("@jini-ai/devops/deploy")` types become local typedefs; 2 debt lines (4 sites) retired |
| (this file) | report |

## G-TESTS-0: what is done, what is not
Done: core fakes, ui `/testing` move.
- **Not done: `packages/integration-tests` and the ratchet** (`scripts/injection-test-debt.json` per-owner counts, the gate change, "nothing may import integration-tests"). **STOP on the known trap.** Adding the new workspace package makes `pnpm install --lockfile-only` fail with `ERR_PNPM_NO_MATURE_MATCHING_VERSION ... Version 7.30.2 (released 12 days ago) of undici does not meet the minimumReleaseAge constraint`. Evidence it is the new package: the same command with the package directory moved away prints `Done` and changes nothing. I did not override `minimumReleaseAge` and did not hand-edit the lockfile. The package files I drafted (package.json private, tsconfig, vitest.config.ts with `environmentMatchGlobs` + `passWithNoTests`, `src/.gitkeep`) were removed from the tree and are NOT committed. Retry after 2026-11-19. The ratchet itself does not need the package, but the sheet groups them and the instruction was to stop G-TESTS-0, so it was left for the retry.
- **Admin item skipped, sheet stale at this base:** `packages/admin/src/react/testing-kit.tsx` already exists with a published entry `@jini-ai/admin/react/testing-kit` (`fakeAdminKit`, `fixtureQuery`), and `user-management` imports it. Renaming it to `testing.tsx` would be churn across packages plus a Tovu pair for no gain. No admin api-baseline change was needed.
- Other `api:update` drift (pre-existing, NOT mine): regenerating baselines on the unmodified base rewrites 11 baseline files (core also gains 13 entries such as `./contracts/agents`, `./errors/*`). I committed only the new `./contracts/runtime/testing` and `./react/testing` blocks, inserted into the existing files (diff 19 and 6 lines); `pnpm api:check` reports no removals. Someone should regenerate the baselines on `refactor/terra`.

Fake tests: written with the fakes (new code, so no red on old code); each of four mutations turned one named test red and was reverted: (M1) drop the `trailingNewline` newline -> "serializes JSON ... newline only when asked"; (M2) do not release the held lock -> "holds the path only while the critical section runs"; (M3) record calls in reverse order -> "records url, timeout and init in order"; (M4) stop only the named pids, not descendants -> "stops the requested pids with their descendants". No conformance suite exists for these ports (sheet: "where one exists").

## R12d
- Inventory (`rg -n -P "@jini-ai/(?!core|protocol)" packages/agent-plugins ...` on the base): the sheet's four sites match: `vercel-blob.mjs:76`, `netlify.mjs:16,17,22`; test edge `vercel.test.mjs:8`.
- `3c6d19ff` characterization: missing-token publish case green on old code; mutation (`vercel.mjs:161` throws a plain `Error`) turns "throws DeployError without making a network call when token is missing" red, before and after the change. `node --test` on the vercel file: 53 pass, 0 fail.
- `b75f82a2` red first: deleting only the two debt lines fails `pnpm guard` with two `L5-injected-edge` violations (`netlify.mjs`, `vercel-blob.mjs`); with the typedefs `pnpm guard` exits 0 and its output equals the baseline. Restated: `DeployFile`, `DeployError` instance, `DeploymentUrlCheck`, `DeployPublishResult`, `DeployTarget` (the installed-module `HostDeployTarget`, positional `checkReachability(url)`), the host kit's `DeployError` constructor (positional), `ArtifactStorePort`. The class `DeployError` still arrives through the kit. "Ported from `@jini-ai/devops`" provenance comments untouched.
- Ad hoc `tsc --checkJs` on the two payload files (not a repo gate): 12 errors on the base, 2 after (the remaining two are old: `status: unknown` from the kit's `Function`-typed helpers, and `Uint8Array` as `BodyInit`).
- **OD-5 item skipped as ordered:** `scripts/build-cloudflare.mjs` `readSubmissionEvidence` untouched.
- **`isPayloadPeerDeclaration` NOT retired (sheet wrong):** the sheet retires it with the last payload JSDoc import, but it still serves two non-JSDoc payload imports that remain: the cloudflare build-time bundle of `@jini-ai/cms/forms` (the held OD-5 item) and `core/commerce-server.{mjs,d.ts}` re-exports of `@jini-ai/commerce` (R12/G-STALE-DEPS). It can go once both are gone.
- Not done, needs the missing package: the byte-fit drift guard for these typedefs. Other test edges to devops in agent-plugins (`fake-deploy-host-kit.mjs`, netlify, s3-compatible, github-pages, github commit-site tests) are not R12d rows (T2 lane).

## Gates run (HEAD = b75f82a2 content; BASE = 65d73b0d)
- `pnpm install --frozen-lockfile` ok; `pnpm --no-bail -r build` exit 0; `pnpm --filter @jini-ai/core build`, `pnpm --filter @jini-ai/ui build` ok.
- `npm --prefix packages/core run test`: 198 files, **2951 tests pass** (before: 2934; +17, no removal). `npm --prefix packages/ui run test`: 632 files, **8584 pass** (unchanged count). `node --test` netlify + vercel `__tests__/*.test.mjs`: 112 pass, 0 fail. Vitest runs used `--poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=1` for single files because `--maxWorkers=2` crashes this vitest 2.1.9 / tinypool with `minThreads and maxThreads must not conflict`; the package scripts ran with their own settings.
- `pnpm typecheck` (root, all packages + scripts + examples): exit 0.
- `pnpm guard > /tmp/guard-after.txt`: exit 0, `diff /tmp/guard-before.txt /tmp/guard-after.txt` empty. `pnpm check:size`, `pnpm check:complexity`: pass. `pnpm api:check`: 0 removals.
- S3, S4, S6, S10, S11: print nothing. S9 lists the 5 core fakes (the `(required = {}, optional = {})` pattern of `createRecordingOriginPolicy` precedent) and `renderWithUiKit` (unchanged signature, moved). S8 eslint 50/10/500 gate on `testing.ts`, `netlify.mjs`, `vercel-blob.mjs`: prints nothing. S7 prints five vanished lines: four are the replaced JSDoc import lines (now the typedef block in `netlify.mjs`/`vercel-blob.mjs`), one is the `fake-ui-kit` doc comment (reworded in `testing.tsx`).
- S5: `pnpm check:hooks` FAILS with 32 entries; **PRE-EXISTING**: identical count on the stashed base. This lane adds no hook call and no hook-debt key.
- S6/S14: no `vi.mock` added; no package beyond base.

## Overlap with the parallel integ/wave1-merge run (N1, R13a, R13c, G-STALE-DEPS, tc-S10/S14a/S15, notes-waveA)
Shared files and how they were kept disjoint: `scripts/injection-debt.json` (I deleted two lines by hand), `packages/core/package.json` + `README.md` and `packages/ui/package.json` + `README.md` (one export/entry block each; G-STALE-DEPS edits manifests, expect a textual conflict only if it touches the same `exports`/`jini.entries` region), `api-baseline/jini-ai__{core,ui}.json` (insert-only blocks; regenerate on conflict). No other overlap with their listed write sets.

## Next step
After 2026-11-19: retry G-TESTS-0 package + ratchet (`pnpm install --lockfile-only` must succeed first), then R12c's drift guard can land in `packages/integration-tests`.
