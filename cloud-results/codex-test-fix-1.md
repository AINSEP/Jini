# codex-test-fix-1 — test + fix-red of the 16 Codex branches (Jini)

Unattended cloud run, 2026-11-18 (20:58–23:10 UTC). Base = `6c9effae4` (= `origin/refactor/terra`). Node v24.22.3, pnpm 10.33.2, `pnpm install --frozen-lockfile` OK, `pnpm --no-bail -r build` exit 0. No subagents. Lockfile untouched, `minimumReleaseAge` untouched.

**Summary: all 16 branches end GREEN on every check I ran. 5 reds found and fixed (4 lost why-comment blocks on ap-gw / ap-rest / platform(+fsize-platform), 1 compile break on fsize-integ). All 16 merge with one trivial `scripts/size-debt.json` conflict. Tovu still has 48 old-shape call sites not covered by `codex/tv-callers-db` / `codex/tv-callers-misc` (7 direct, 41 through Tovu re-export modules).**

## Method

- Per branch: checkout → `pnpm --filter "...{pkg}" run build` for the packages the branch touches plus every package the previous branch had touched (so no stale `dist/`) → `tsc --noEmit` (`pnpm run typecheck`) on the touched packages **and** on every transitive dependent that imports a changed export name from a touched package (dependents that import none of the changed names were skipped) → vitest (`--maxWorkers=2 --minWorkers=1`, or the package's own `test` script where it is not plain vitest: commerce = node:test + vitest + kernel config, notes-app = node:test, reference-web = vitest + playwright e2e) on every touched package → when `scripts/` changed: `tsc -p scripts/tsconfig.json` + `pnpm test:scripts` → the 5 gates.
- Gates: `pnpm guard`, `check:size` / `check:complexity` (with `SIZE_BASE_REF`/`COMPLEXITY_BASE_REF=6c9effae4`, so a raised debt value would fail), `check:why-comments --base 6c9effae4`, `check:hooks`. Output diffed against base, not only the exit code.
- fsize branches: an AST diff of every exported function/arrow/class-method signature, args branch vs fsize branch, found **0** changed signatures on all 5, so fsize dependents were not re-typechecked (only touched packages).
- Disables: `git diff 6c9effae4..branch` added lines searched for `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `as any`, `: any`, `<any>`.
- Assertion weakening: counted removed vs added `expect`/`assert` lines and `it(`/`test(` lines in test files, and weak matchers (`toBeDefined`, `toBeTruthy`, `expect.anything`, `objectContaining`, bare `toThrow()`); every branch is balanced (same counts removed and added, the only changed `test(` lines are call-shape updates).
- Debt files: every change to `scripts/size-debt.json` / `complexity-debt.json` across the 16 branches only removes entries or lowers values (none raised).

## Base (6c9effae4) — reds that are NOT the branches'

- All 5 gates exit 0. `guard` prints `[hardwiring] 1 stale debt occurrences` and exits 0 on base and on every branch (unchanged).
- `pnpm test:scripts`: 8 failed tests / 4 failed files on base (`check-why-comments.test.mjs` "No test suite found" — it is a node:test file; `coupling-isolation.test.ts` ×6; `extract-s3-source-contracts.test.ts` — `git show 35c4961af:packages/ui/package.json` fails on this clone; `optional-peer-contract.test.ts` ×2). Identical failing set on every branch that touches `scripts/` and on the merged tree.
- `examples/reference-web`: `node --test e2e/*.test.mjs` fails 3/3 (`Cannot find package 'playwright'` — environment); its vitest part is 54/54 on base and every branch.
- `scripts/tsconfig.json` typecheck: 0 errors on base.
- Typecheck of every package: 0 errors on base for every package I typechecked.

## Per-branch table

"tsc new" = new `error TS` lines vs base across all typechecked packages. "new failing tests" = vs base. "new gate lines" = gate output lines not present on base (before my fixes). Test counts are identical to base on every branch (no test deleted or skipped).

| branch (final head) | packages typechecked | tsc new | packages tested (tests) | new failing tests | new gate lines (before fix) | disables added | fixed by me | final |
|---|---|---|---|---|---|---|---|---|
| `codex/args-integrations` (6fc00d9a, unchanged) | integrations + 13 dependents | 0 | integrations 2053 | 0 | none | 0 | — | **GREEN** |
| `codex/args-commerce` (e0f5cf11, unchanged) | commerce, provider-plugins, agent-plugins | 0 | commerce 11 + 1414 kernel + 52 node:test; provider-plugins 883 | 0 | none | 0 | — | **GREEN** |
| `codex/args-db` (c3bc0b5e, unchanged) | db, chat, cms, commerce, daemon, notes-app, server, sqlite, plugins | 0 | db 917, chat 4460, cms 4322, commerce 1477, daemon 4790, notes-app 112 | 0 (verify-1's 3 stale `loads-without-driver` probes are fixed by c3bc0b5e) | none | 0 | — | **GREEN** |
| `codex/args-ar-protocol` (ce1ebdef, unchanged) | agent-runtime, daemon | 0 | agent-runtime 4486; scripts (= base) | 0 | none (verify-1's size red fixed by ce1ebdef) | 0 | — | **GREEN** |
| `codex/args-ar-skills` (2705bf7d, unchanged) | agent-runtime + 7 dependents | 0 | agent-runtime 4486 | 0 | none | 0 | — | **GREEN** |
| `codex/args-ar-rest` (049e762f, unchanged) | agent-runtime + 10 dependents | 0 | agent-runtime 4486, chat 4460, daemon 4790; scripts (= base) | 0 (verify-1's 5 tsc + 2 test reds fixed by a511beaa/049e762f) | none | 0 | — | **GREEN** |
| `codex/args-ap-gw` (**6fce9a40**) | agent-plugins, neutral-host | 0 | agent-plugins 2167 | 0 | `check:why-comments` exit 1: `google-workspace/ui/dom.mjs:25-31 [ee086d60907a]` (h() JSDoc still lost after Codex's fix) | 0 | 6fce9a40 | **GREEN** |
| `codex/args-ap-rest` (**dc2f817f**) | agent-plugins, neutral-host | 0 | agent-plugins 2167, neutral-host 79 | 0 | `check:why-comments` exit 1: `github/source-control/write-files.mjs:57 [220c148db39f]`, `resend/lib/domains.mjs:95 [8e91a4b222d6]` | 0 | dc2f817f | **GREEN** |
| `codex/args-small` (c484e91a, unchanged) | 12 touched + daemon, server, sqlite, http-kit, cli; scripts tsconfig | 0 | agentic 1143, analytics 224, artifacts 242, chat 4460, devops 1279, infra 155, memory 409, protocol 794, registry 391, sandbox 179, sidecar 341, ui 8738; scripts (= base) | 0 | none | 0 | — | **GREEN** |
| `codex/args-platform` (**9f2d9a78**) | platform, registry, agent-runtime, server, integrations, mcp, reference-web | 0 | platform 3215, registry 391, agent-runtime 4486, server 467, minimal-host 3, reference-web 54 | 0 | `check:why-comments` exit 1: `platform/src/fs/errno.ts:8-9 [f8520bd5f031]` (fallbackIf JSDoc example rewritten) | 0 | 9f2d9a78 | **GREEN** |
| `codex/args-jini-small2` (29803fa1, unchanged) | oauth, plugins, server | 0 | oauth 819, plugins 1011, server 467 | 0 | none | 0 | — | **GREEN** |
| `codex/fsize-small2` (5dcc98cf, unchanged; on args-jini-small2) | oauth, plugins, server, user-management | 0 | oauth 819, plugins 1011, server 467, user-management 1283; scripts (= base) | 0 | none | 0 | — | **GREEN** |
| `codex/fsize-integ` (**a294d391**; on args-integrations) | integrations | 0 after fix (1 before: `shared-sign-in.ts(221,128) TS2304 Cannot find name 'attachments'`, package build failed) | integrations 2053; scripts (= base) | 0 | none | 0 | a294d391 | **GREEN** |
| `codex/fsize-platform` (**4df5318f**; on args-platform) | platform, registry, agent-runtime, server, reference-web | 0 | platform 3215, agent-runtime 4486, registry 391, server 467, minimal-host 3, reference-web 54; scripts (= base) | 0 | `check:why-comments` (inherited from args-platform, same errno.ts block) | 0 | 4df5318f (cherry-pick of 9f2d9a78) | **GREEN** |
| `codex/fsize-small` (951771dd, unchanged; on args-small) | 12 touched packages | 0 | agentic 1143, analytics 224, artifacts 242, chat 4460, devops 1279, infra 155, memory 409, protocol 794, registry 391, sandbox 179, sidecar 341, ui 8738; scripts (= base) | 0 | none | 0 | — | **GREEN** |
| `codex/fsize-commerce` (e88ada2b, unchanged; on args-commerce) | commerce, provider-plugins | 0 | commerce 1477, provider-plugins 883; scripts (= base) | 0 | none | 0 | — | **GREEN** |

### My fix commits (all pushed, each on top of the Codex commits, no force-push)

| branch | commit | what |
|---|---|---|
| `codex/args-ap-gw` | `6fce9a40` | restore the `h()` JSDoc `@param tag / [props] / [children]` lines word-for-word (Codex had renamed them `required.tag` / `optional.*`). Comment-only. |
| `codex/args-ap-rest` | `dc2f817f` | restore the one-line JSDoc of `extractStringField` and `qualify` word-for-word. Comment-only. |
| `codex/args-platform` | `9f2d9a78` | restore the `fallbackIf` JSDoc block word-for-word; the new call shape sits in a `//` line under it. Comment-only. |
| `codex/fsize-platform` | `4df5318f` | the same fix cherry-picked (fsize-platform is built on args-platform, so it carried the same red). |
| `codex/fsize-integ` | `a294d391` | **real break**: the split moved `assertAttempt` into `createSharedMcpAttempts` but did not destructure `attachments` from the access bag → `TS2304 Cannot find name 'attachments'` (`shared-sign-in.ts:221`), integrations did not build, and `assertAttempt` would throw `ReferenceError` at run time. Fix adds `attachments` to the destructure (same `shared.attachments` the unsplit function closed over). No unit test hit that path (integrations' 2053 tests run from source and stayed green while it was broken in the merge run) — the failing check was the build/tsc. |

## Behaviour review (diff read, beyond the checks)

- No default value moved, no spread order changed, no assertion weakened that I found. Every `= default` / `??` / `||` removed from non-test code was matched against the added lines; the unmatched ones are call-site rewrites of the same expression (spot-checked: `reseedIdentitySql`/`constraintSql` keep `sqlTag = "transfer"` as an optional-bag default — same semantics; `createSettlementWorker` moved `withOwnership`/`schedule` from the old second positional bag into `required`, values unchanged).
- fsize splits read structurally identical (state still created once in the outer factory and passed by reference); all fsize test counts equal their args base.
- `args-ar-rest` (a511beaa): `isUnstreamedTextBlock` / `isUnstreamedThinkingBlock` keep `block` positional because a TS type predicate cannot name a destructured binding (TS1230). That is a forced exception to the args rule, not a regression.

## Merge (throwaway local `tmp/merge-test` from 6c9effae4, NOT pushed)

Order: all `args-*` then all `fsize-*`, `--no-ff`, using the final branch heads (with my fixes).

- Conflicts: only `scripts/size-debt.json` when merging `codex/fsize-small` (fsize-small2 and fsize-small each delete different debt entries next to each other). Resolved by keeping only entries present on both sides (138 ∩ 152 → 136 entries).
- Build: `pnpm --no-bail -r build` first failed in `@jini-ai/integrations` (the fsize-integ TS2304 above); after merging the fix (a294d391) integrations and all its dependents build (exit 0).
- tsc: 37 packages typechecked (every touched package + every dependent importing a changed name) + `scripts/tsconfig.json`: **0 errors** (integrations re-run after the fix: 0).
- Tests on the merged tree, every touched package: minimal-host 3, neutral-host 79, notes-app 112, reference-web vitest 54 (e2e = base playwright gap), agent-plugins 2167, agent-runtime 4486, agentic 1143, analytics 224, artifacts 242, chat 4460, cms 4322, commerce 11 + 1414 + 52, daemon 4790, db 917, devops 1279, infra 155, integrations 2053, memory 409, oauth 819, platform 3215, plugins 1011, protocol 794, provider-plugins 883, registry 391, sandbox 179, server 467, sidecar 341, ui 8738, user-management 1283 — **0 failed**. (The first 9 of those ran before the integrations fix was merged, against the args-integrations `dist/` of integrations; fsize-integ changes no exported signature, and integrations' own suite passed on the fixed tree.)
- Gates on the merged tree: guard, check:size, check:complexity, check:why-comments, check:hooks all exit 0, no new lines vs base.

## Tovu (origin/refactor/terra @ b5fbf2a5) call sites still on the OLD shape

Method: TypeScript-AST diff of every exported function / arrow const / exported-class method in each args branch (823 changed signatures in total, 0 more from fsize), then a TS-AST scan of every Tovu file under `apps/ packages/ development/` importing a touched `@jini-ai/*` package: each call of a changed name is classified OLD when it passes more args than the new signature takes, or a bare value / non-matching object where the new first parameter is a destructured object. The same scan was run on `codex/tv-callers-db` (72a2612a) and `codex/tv-callers-misc` (b50dafb3); a site counts as fixed when either branch fixes it. 206 old-shape sites on terra → 199 fixed by those two branches → **7 left (direct imports)**, plus **41 through Tovu re-export modules** that neither branch touches (same lines on terra and both branches).

### Direct imports, not fixed on either tv branch

| file:line | function (package, branch) | call |
|---|---|---|
| `apps/website/src/features/deployments/deploy-ops/__tests__/extract-s9-deploy-ports.test.ts:129` | `waitForDeployOps` (devops, args-small) | `waitForDeployOps({status: …}, {until: 'healthy', …})` — new shape is `({ deps, until }, { timeoutSeconds, signal })` |
| `apps/website/src/features/deployments/deploy-ops/__tests__/extract-s9-deploy-ports.test.ts:131` | `waitForDeployOps` (devops, args-small) | same |
| `apps/website/src/server/runtime/composition/__tests__/product-telemetry.unit.test.ts:258` | `isNoopProductAnalytics` (analytics, args-small) | `isNoopProductAnalytics(product.productAnalytics)` — new `({ port })` |
| `…/product-telemetry.unit.test.ts:272` | `isNoopProductAnalytics` | same |
| `…/product-telemetry.unit.test.ts:449` | `isNoopProductAnalytics` | same |
| `…/product-telemetry.unit.test.ts:471` | `isNoopProductAnalytics` | same |
| `apps/website/src/server/runtime/lifecycle/local-site-process.ts:271` | `readFlagValue` (platform, args-platform) | `readFlagValue(args, "--local-site-api-pid")` — new `({ args, flagName })` (production code) |

### Re-export callers (Tovu modules that re-export a changed @jini-ai function; the scanner follows only direct imports, so these were found by name)

| function (package, branch) | Tovu re-export | call sites still on the old shape |
|---|---|---|
| `assertValidSteps` (db/args-db) | `apps/website/src/platform/db/migrations/runner.ts:12` | platform/db/migrations/__tests__/runner.test.ts:119, platform/db/migrations/__tests__/runner.test.ts:120, platform/db/migrations/__tests__/runner.test.ts:121, platform/db/migrations/__tests__/runner.test.ts:122 |
| `runningPgliteOwner` (db/args-db) | `apps/website/src/platform/db/kernel/drivers/pglite-owner.ts:13` | platform/site-dir/duplicate-pglite-store.ts:42, server/__tests__/integration/pglite-boot-owner.unrun.integration.test.ts:124, server/__tests__/integration/pglite-boot-owner.unrun.integration.test.ts:141, server/__tests__/integration/pglite-boot-owner.unrun.integration.test.ts:68, server/__tests__/integration/pglite-boot-owner.unrun.integration.test.ts:85 |
| `assertSocketPathFits` (db/args-db) | `apps/website/src/platform/db/kernel/drivers/pglite-owner.ts:13` | platform/db/kernel/__tests__/pglite-owner.test.ts:141, platform/db/kernel/__tests__/pglite-owner.test.ts:142, platform/db/kernel/__tests__/pglite-owner.test.ts:155 |
| `ensurePrivateDir` (db/args-db) | `apps/website/src/platform/db/kernel/drivers/pglite-owner.ts:13` | platform/db/kernel/__tests__/jini-db-facades.integration.test.ts:156, platform/db/kernel/__tests__/jini-db-facades.integration.test.ts:158, platform/db/kernel/__tests__/jini-db-facades.integration.test.ts:167, platform/db/kernel/__tests__/jini-db-facades.integration.test.ts:169, platform/db/kernel/__tests__/pglite-owner.test.ts:162, platform/db/kernel/__tests__/pglite-owner.test.ts:168, platform/db/kernel/__tests__/pglite-owner.test.ts:174, platform/db/kernel/__tests__/pglite-owner.test.ts:178 |
| `findAgentPluginMcpServerDefaults` (agent-plugins/args-ap-rest) | `apps/website/src/features/agent-plugins/federate-mcp.ts:19` | assistant/__tests__/external-mcp-connection-source.operator-read-only.test.ts:56, assistant/__tests__/external-mcp-connection-source.operator-read-only.test.ts:57, assistant/__tests__/external-mcp-connection-source.operator-read-only.test.ts:58, assistant/__tests__/external-mcp-connection-source.operator-read-only.test.ts:70, features/agent-plugins/__tests__/unit/federate-mcp.unit.test.ts:665, features/agent-plugins/__tests__/unit/federate-mcp.unit.test.ts:666, features/agent-plugins/__tests__/unit/federate-mcp.unit.test.ts:667, features/agent-plugins/__tests__/unit/federate-mcp.unit.test.ts:668, features/agent-plugins/__tests__/unit/federate-mcp.unit.test.ts:669 |
| `waitForDeployOps` (devops/args-small) | `apps/website/src/features/deployments/deploy-ops/run-ops.ts:13` | features/deployments/deploy-ops/__tests__/run-ops-contract.test.ts:176, features/deployments/deploy-ops/__tests__/run-ops-contract.test.ts:181, features/deployments/deploy-ops/__tests__/run-ops-contract.test.ts:188, features/deployments/deploy-ops/__tests__/tool-registrations.test.ts:122, features/deployments/deploy-ops/__tests__/tool-registrations.test.ts:127, features/deployments/deploy-ops/__tests__/tool-registrations.test.ts:131, features/deployments/deploy-ops/__tests__/tool-registrations.test.ts:136, features/deployments/deploy-ops/__tests__/tool-registrations.test.ts:145, features/deployments/deploy-ops/__tests__/tool-registrations.test.ts:161, features/deployments/deploy-ops/__tests__/tw3-L041.pins.test.ts:137, features/deployments/deploy-ops/__tests__/tw3-L041.pins.test.ts:139, features/deployments/deploy-ops/__tests__/tw3-L041.pins.test.ts:142 |


Limits: method calls on instances (`obj.method(...)`) of changed exported classes are not resolved (only constructors and free functions); `.cjs` files are not scanned.

## Decisions needed (not guessed)

1. **New private helpers in the fsize splits use positional params.** The fsize commits add 71 non-exported helpers with ≥2 positional parameters (fsize-small2 41, fsize-integ 13, fsize-platform 13, fsize-commerce 3, fsize-small 1; e.g. `packages/plugins/src/host/hook-registry.ts:242 clearHookFailures(consecutiveFailures, pluginId, workspaceId)`, `packages/commerce/src/react/Payments.tsx renderPaymentProviders(t, providers)`). The Codex args branches applied `(required, optional = {})` to exported functions only. Does the owner rule cover internal helpers too? If yes it is a mechanical follow-up sweep on the fsize branches.
2. **Type-predicate exception** (`args-ar-rest`, `isUnstreamedTextBlock(block, { alreadyStreamed })`): TS forbids a predicate on a destructured name, so the rule cannot be applied literally. Accept the exception, or change the predicate into a boolean + separate narrowing?
3. **Tovu re-export modules**: 41 Tovu call sites go through Tovu modules that `export { … } from "@jini-ai/…"` (pglite-owner.ts, migrations/runner.ts, federate-mcp.ts, run-ops.ts). Migrate the callers to the new object shape, or have the Tovu module wrap the function with the old positional signature?
