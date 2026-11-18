# codex-args-verify-1 — verification of the 8 Codex `(required, optional = {})` branches

VERIFY ONLY. No source code changed anywhere. Base = `6c9effae4` (= `origin/refactor/terra` at run time). Run 2026-11-18, unattended cloud run.

**Summary: 3 GREEN (integrations, commerce, ar-skills), 5 RED (db: 3 stale-probe test failures; ar-rest: 5 tsc errors + 2 failing tests + broken agent-runtime build; ar-protocol: size-ratchet lower-debt; ap-gw: 1 lost why-comment; ap-rest: 3 lost why-comments). All 8 merge cleanly. Tovu has OLD-shape callers for integrations (1), commerce (2), db (191), ap-rest (6).**

## Baseline (step 1) — unmodified `6c9effae4`, detached

Setup: Node v24.22.3 (nodejs.org → `~/.local/node24`), pnpm 10.33.2 via corepack, `pnpm install --frozen-lockfile` (OK, 13.5 s), `pnpm --no-bail -r build` (exit 0, 1m45). Packages measured = integrations, commerce, db, agent-runtime, agent-plugins + every transitive dependent found by scanning all `package.json` deps/devDeps/peerDeps (25 packages).

| package | tsc errors (base) | vitest (base) |
|---|---|---|
| packages/integrations | 0 | 2053 tests/99 files, 0 failed, 0 failed suites |
| packages/commerce | 0 | 11 tests/4 files, 0 failed, 0 failed suites |
| packages/db | 0 | 917 tests/110 files, 0 failed, 0 failed suites |
| packages/agent-runtime | 0 | 4486 tests/188 files, 0 failed, 0 failed suites |
| packages/agent-plugins | 0 | 2167 tests/147 files, 0 failed, 0 failed suites |
| packages/admin | 2 | 2985 tests/234 files, 0 failed, 0 failed suites |
| packages/search | 2 | 359 tests/12 files, 0 failed, 0 failed suites |
| examples/neutral-host | 0 | 79 tests/15 files, 0 failed, 0 failed suites |
| packages/user-management | 0 | 1283 tests/110 files, 0 failed, 0 failed suites |
| packages/chat | 0 | 4460 tests/307 files, 0 failed, 0 failed suites |
| packages/daemon | 0 | 4790 tests/243 files, 0 failed, 0 failed suites |
| packages/provider-plugins | 0 | 883 tests/58 files, 0 failed, 0 failed suites |
| packages/server | 0 | 467 tests/31 files, 0 failed, 0 failed suites |
| packages/ui | 0 | 8738 tests/641 files, 0 failed, 0 failed suites |
| examples/minimal-host | 0 | 3 tests/2 files, 0 failed, 0 failed suites |
| examples/reference-web | 0 | 54 tests/11 files, 0 failed, 2 failed suites |
| packages/devops | 0 | 1279 tests/85 files, 0 failed, 0 failed suites |
| packages/mcp | 0 | 1849 tests/111 files, 0 failed, 0 failed suites |
| packages/sqlite | 0 | 10 tests/4 files, 0 failed, 0 failed suites |
| packages/cms | 0 | 4322 tests/357 files, 0 failed, 0 failed suites |
| packages/infra | 0 | 155 tests/15 files, 0 failed, 0 failed suites |
| packages/plugins | 0 | 1011 tests/75 files, 0 failed, 0 failed suites |
| packages/registry | 9 | 391 tests/22 files, 0 failed, 0 failed suites |
| examples/notes-app | 0 | 0 tests/11 files, 0 failed, 11 failed suites |
| packages/plugin-fixture-provider | 0 | 2 tests/1 files, 1 failed, 1 failed suites |

Pre-existing reds on base (not the branches' fault, excluded from "new" everywhere): `packages/admin` tsc 2 (`src/core/__tests__/args-convention.contract.test.ts(55,70)` and `(59,65)` TS2554), `packages/search` tsc 2 (TS2304 `TextEncoder`, `setTimeout`), `packages/registry` tsc 9 (missing node types), `examples/reference-web` 2 + `examples/notes-app` 11 failed *suites* ("No test suite found" — those packages use `playwright`/`node --test`, not vitest; notes-app was re-run correctly with `node --test` → 112/112 pass on the merged tree), `packages/plugin-fixture-provider` 1 failed test (`__tests__/package.test.ts`). Base gates: `pnpm guard`, `check:size` (154 debt entries), `check:complexity` (17), `check:why-comments` (0 files), `check:hooks` all exit 0. `commerce` also runs `node --test` (52/52) and the kernel config (1414/1414) — identical on base and on `codex/args-commerce`.

Note on `guard` output: base prints `[hardwiring] 1 stale debt occurrences; remove them from scripts/hardwiring-debt.json.` and still exits 0; it is unchanged on every branch (no new lines).



## Verdict table

Verdict covers Jini-side checks only (tsc, tests, ratchet gates, disables). "Tovu old-shape callers" is reported separately: any API-shape change leaves Tovu callers to migrate; that is expected for this rule, so it is a follow-up count, not part of RED/GREEN.

| branch (head) | tsc NEW errors | NEW failing tests | NEW ratchet/gate failures | disables added (`eslint-disable`/`@ts-ignore`/`as any`) | Tovu old-shape callers (refactor/terra) | verdict |
|---|---|---|---|---|---|---|
| `codex/args-integrations` (6fc00d9a (+f099919b)) | 0 | 0 | 0 | 0 | 1 | **GREEN** |
| `codex/args-commerce` (c1d3cf8e) | 0 | 0 | 0 | 0 | 2 | **GREEN** |
| `codex/args-db` (584af535) | 0 | 3 | 0 | 0 | 191 | **RED** |
| `codex/args-ar-protocol` (893c13bf) | 0 | 0 | 1 (check:size) | 0 | 0 | **RED** |
| `codex/args-ar-skills` (2705bf7d) | 0 | 0 | 0 | 0 | 0 | **GREEN** |
| `codex/args-ar-rest` (08bb5488) | 5 | 2 | 2 (check:complexity, check:size) | 0 | 0 | **RED** |
| `codex/args-ap-gw` (dc5d20b3) | 0 | 0 | 1 (check:why-comments) | 0 | 0 | **RED** |
| `codex/args-ap-rest` (a089bec5) | 0 | 0 | 1 (check:why-comments) | 0 | 6 | **RED** |

Ratchet gate reading: a gate that exits 1 counts as red; I also diffed every gate output line vs base (see per-branch detail). All 5 gates (`guard`, `check:size`, `check:complexity`, `check:why-comments`, `check:hooks`) exit 0 on base with no failure text.

## Per-branch detail (exact file:line + message)

### `codex/args-integrations` — GREEN

- tests run (touched packages, branch vs base): packages/integrations 2053/2053 tests (0 failed vs 0 base)
- tsc run on 15 packages (every package that depends on the touched ones); new errors: 0
- new failing tests: 0
- gates: all 5 exit 0, no new lines vs base
- exported functions/methods whose parameter list changed (AST diff of base vs branch): 54

### `codex/args-commerce` — GREEN

- tests run (touched packages, branch vs base): packages/commerce 11/11 tests (0 failed vs 0 base); packages/provider-plugins 883/883 tests (0 failed vs 0 base)
- tsc run on 7 packages (every package that depends on the touched ones); new errors: 0
- new failing tests: 0
- gates: all 5 exit 0, no new lines vs base
- exported functions/methods whose parameter list changed (AST diff of base vs branch): 18

### `codex/args-db` — RED

- tests run (touched packages, branch vs base): examples/notes-app 0/0 tests (11 failed vs 11 base); packages/chat 4460/4460 tests (0 failed vs 0 base); packages/cms 4322/4322 tests (0 failed vs 0 base); packages/commerce 11/11 tests (0 failed vs 0 base); packages/daemon 4790/4790 tests (0 failed vs 0 base); packages/db 917/917 tests (3 failed vs 0 base)
- tsc run on 22 packages (every package that depends on the touched ones); new errors: 0
- new failing tests: 3
  - packages/db/src/__tests__/loads-without-driver.test.ts :: @jini-ai/db in an install with no database driver present ./pglite imports alone, works, and loads only pglite + core
  - packages/db/src/__tests__/loads-without-driver.test.ts :: @jini-ai/db in an install with no database driver present ./postgres imports alone, works, and loads only postgres + core
  - packages/db/src/__tests__/loads-without-driver.test.ts :: @jini-ai/db in an install with no database driver present ./migrate imports alone, works, and loads only migrate + kernel + core
- gates: all 5 exit 0, no new lines vs base
- exported functions/methods whose parameter list changed (AST diff of base vs branch): 57

### `codex/args-ar-protocol` — RED

- tests run (touched packages, branch vs base): packages/agent-runtime 4486/4486 tests (0 failed vs 0 base)
- tsc run on 14 packages (every package that depends on the touched ones); new errors: 0
- new failing tests: 0
- gates: 
  - `pnpm check:size` → exit=1
    - Lower debt value from 748: [max-lines] packages/agent-runtime/src/agent-protocol/acp/session.ts:679 <file> (745)
    - Size ratchet failed.
- exported functions/methods whose parameter list changed (AST diff of base vs branch): 109

### `codex/args-ar-skills` — GREEN

- tests run (touched packages, branch vs base): packages/agent-runtime 4486/4486 tests (0 failed vs 0 base)
- tsc run on 14 packages (every package that depends on the touched ones); new errors: 0
- new failing tests: 0
- gates: all 5 exit 0, no new lines vs base
- exported functions/methods whose parameter list changed (AST diff of base vs branch): 102

### `codex/args-ar-rest` — RED

- tests run (touched packages, branch vs base): packages/agent-runtime 4486/4486 tests (2 failed vs 0 base); packages/chat 4460/4460 tests (0 failed vs 0 base); packages/daemon 4790/4790 tests (0 failed vs 0 base)
- tsc run on 14 packages (every package that depends on the touched ones); new errors: 5
  - packages/agent-runtime: src/__tests__/native-runtime.test.ts(152,138): error TS2554: Expected 1-2 arguments, but got 3.
  - packages/agent-runtime: src/claude-stream-frames.ts(300,4): error TS1230: A type predicate cannot reference element 'block' in a binding pattern.
  - packages/agent-runtime: src/claude-stream-frames.ts(307,4): error TS1230: A type predicate cannot reference element 'block' in a binding pattern.
  - packages/agent-runtime: src/claude-stream-handler.ts(356,45): error TS2322: Type 'unknown' is not assignable to type 'string'.
  - packages/agent-runtime: src/claude-stream-handler.ts(360,49): error TS2322: Type 'unknown' is not assignable to type 'string'.
- new failing tests: 2
  - packages/agent-runtime/tests/loads-without-integrations.test.ts :: @jini-ai/agent-runtime without its optional integrations peer imports the root and uses the legacy discovery API and owned native runtime
  - packages/agent-runtime/src/__tests__/native-runtime.test.ts :: disposal waits for an in-flight model-catalog refresh before clearing the state
- gates: 
  - `pnpm check:complexity` → exit=1
    - Remove stale debt entry: [complexity] packages/agent-runtime/src/model-discovery-config.ts:113 readModelConfiguration (12)
    - Complexity ratchet failed.
  - `pnpm check:size` → exit=1
    - Worsened from 504: [max-lines] packages/agent-runtime/src/providers/openai-chat.ts:831 <file> (505)
    - Size ratchet failed.
- exported functions/methods whose parameter list changed (AST diff of base vs branch): 207

### `codex/args-ap-gw` — RED

- tests run (touched packages, branch vs base): packages/agent-plugins 2167/2167 tests (0 failed vs 0 base)
- tsc run on 5 packages (every package that depends on the touched ones); new errors: 0
- new failing tests: 0
- gates: 
  - `pnpm check:why-comments` → exit=1
    - why-comments: 6 files with removed lines checked against origin/refactor/terra..HEAD, 1 comment blocks lost (0 allow-listed)
    - packages/agent-plugins/google-workspace/ui/dom.mjs:25-31  [ee086d60907a]  an element with attributes, event handlers (`on<event>` functions) and children (strings become text). @param {string} tag @param {record...
    - why-comments: 1 deleted comment blocks appear nowhere else (owner rule: refactors move "why" comments with the code, never delete them)
    -   fix: put the comment back next to the code it explains, or move it with that code.
    -   last resort: add { "id": "<id above>", "reason": "<why this comment is truly obsolete>" } to the debt file (`pnpm check:why-comments`).
- exported functions/methods whose parameter list changed (AST diff of base vs branch): 12

### `codex/args-ap-rest` — RED

- tests run (touched packages, branch vs base): examples/neutral-host 79/79 tests (0 failed vs 0 base); packages/agent-plugins 2167/2167 tests (0 failed vs 0 base)
- tsc run on 5 packages (every package that depends on the touched ones); new errors: 0
- new failing tests: 0
- gates: 
  - `pnpm check:why-comments` → exit=1
    - why-comments: 49 files with removed lines checked against origin/refactor/terra..HEAD, 3 comment blocks lost (0 allow-listed)
    - packages/agent-plugins/github/source-control/write-files.mjs:57-57  [220c148db39f]  @param {unknown} value @param {string} field
    - packages/agent-plugins/resend/lib/domains.mjs:25-25  [e68dbd7adfbe]  `retry-after` (seconds) in ms, when present and sane. @param {readonly<record<string, string>> | undefined} headers
    - packages/agent-plugins/resend/lib/domains.mjs:95-95  [8e91a4b222d6]  a relative record name under `domain` as a full name. @param {string} name @param {string} domain
    - why-comments: 3 deleted comment blocks appear nowhere else (owner rule: refactors move "why" comments with the code, never delete them)
    -   fix: put the comment back next to the code it explains, or move it with that code.
    -   last resort: add { "id": "<id above>", "reason": "<why this comment is truly obsolete>" } to the debt file (`pnpm check:why-comments`).
- exported functions/methods whose parameter list changed (AST diff of base vs branch): 50

### Root causes of the RED branches (confirmed by re-running on the branch tree)

- **`codex/args-db` — stale test probes (3 failing tests, deterministic).** `packages/db/src/__tests__/loads-without-driver.test.ts:47` still calls `m.pgliteLowMemoryStartParams({ defaultStartParams: ["-x"] })` and `:83` still calls `m.sourceChecksum("")` — both functions were converted to `({ pglite })` / `({ text })` in the same commit, so the eval'd child process crashes: `TypeError: Cannot read properties of undefined (reading 'defaultStartParams')` (`dist/pglite/owner.js:40`) and `ERR_INVALID_ARG_TYPE … sourceChecksum (dist/migrate/checksum.js:12)`. `tsc` cannot see it (the probe is a string). Fix: update the two probe strings (and the `./postgres` probe that shares the failure).
- **`codex/args-ar-rest` — 5 tsc errors + 2 failing tests + broken `pnpm --filter @jini-ai/agent-runtime run build` (exit 2).** `src/__tests__/native-runtime.test.ts(152,138)` still calls `offlineSnapshot('fingerprint', 0, [])` (3 positional args; now `({ fingerprint, now, fallback }, { issue })`) → runtime `TypeError … reading 'flatMap'` in `model-discovery-shared.ts:13`; `src/claude-stream-frames.ts(300,4)` and `(307,4)` TS1230 (type predicate `block is …` can no longer reference the destructured parameter `block`); `src/claude-stream-handler.ts(356,45)` and `(360,49)` TS2322 (`unknown` not assignable to `string`). Second failing test: `tests/loads-without-integrations.test.ts:46` still calls `m.parseClaudeInitializeMetadata('invalid')` → `TypeError … reading 'split'` (`dist/model-discovery-adapters.js:107`). Because the package build fails, every dependent build (and `examples/minimal-host` health-boot, which packs from a fresh build) breaks. Also trips `check:complexity` (stale debt entry `packages/agent-runtime/src/model-discovery-config.ts:113 readModelConfiguration (12)` must be removed) and `check:size` (`packages/agent-runtime/src/providers/openai-chat.ts:831` worsened 504 → 505 lines).
- **`codex/args-ar-protocol` — `check:size` red only.** `packages/agent-runtime/src/agent-protocol/acp/session.ts:679` shrank 748 → 745, the ratchet demands the debt value be lowered ("Lower debt value from 748"). Behaviour is green (tsc 0 new, 4486/4486 tests); fix = lower the debt entry in the size baseline.
- **`codex/args-ap-gw` — `check:why-comments` red (1 lost comment block).** `packages/agent-plugins/google-workspace/ui/dom.mjs:25-31` [id `ee086d60907a`]: the `h()` JSDoc block keeps its description line ("An element with attributes, event handlers … and children") but its `@param tag/props/children` lines were replaced by `@param required/optional`, so the block as a whole no longer appears anywhere and the gate reports it deleted. Fix = per the gate: restore the block text or add a reasoned debt-file entry.
- **`codex/args-ap-rest` — `check:why-comments` red (3 lost blocks).** `packages/agent-plugins/github/source-control/write-files.mjs:57-57` [`220c148db39f`] (`@param {unknown} value / {string} field`), `packages/agent-plugins/resend/lib/domains.mjs:25-25` [`e68dbd7adfbe`] (`retry-after` seconds→ms comment) and `:95-95` [`8e91a4b222d6`] (relative record name comment) — JSDoc blocks whose `@param` text changed with the signature, so the gate reports them as deleted.
- **`codex/args-integrations`, `codex/args-commerce`, `codex/args-ar-skills` — GREEN** on every Jini-side check (tsc 0 new across all dependents, all touched-package tests identical counts to base, all 5 gates exit 0 with no new lines). They still leave Tovu callers to migrate (see Tovu section).

Test counts are identical to base on every branch (no deleted/skipped tests): integrations 2053, commerce 11 (+52 node:test, +1414 kernel), provider-plugins 883, db 917, chat 4460, cms 4322, daemon 4790, agent-runtime 4486, agent-plugins 2167, neutral-host 79.

## Tovu callers (step 4) — `origin/refactor/terra` @ b5fbf2a5

Method: AST diff (TypeScript compiler API) of every exported function / arrow-const / class method in each branch's changed files, base vs branch → list of names whose parameter list changed. Then every `.ts/.tsx/.mts/.mjs/.js/.jsx` under Tovu `apps/ packages/ development/` (`git ls-tree` + `git show`, 4415 files import `@jini-ai/*`) was parsed; a call counts only if the name is imported from `@jini-ai/<changed-package>[/subpath]` (alias-aware), so same-named local functions are not counted. Each call was then classified from its first-argument shape: **OLD** = still passes the pre-branch shape (positional / `{deps,input}` / second options arg), **new** = already passes the post-branch shape, **compat** = signature only gained a trailing `_optional = {}` so the existing call still type-checks. Limits: namespace imports (`import * as x`), dynamic imports and wrappers that forward `...args` are not seen; type-only uses are not calls. No Tovu file was edited.

| branch | exported signatures changed | Tovu call sites found | OLD-shape | already new-shape | compatible (only `_optional` added) / non-call refs |
|---|---|---|---|---|---|
| integrations | 54 | 2 | 1 | 1 | 0 |
| commerce | 18 | 3 | 2 | 0 | 1 |
| db | 57 | 212 | 191 | 16 | 5 |
| ar-protocol | 109 | 0 | 0 | 0 | 0 |
| ar-skills | 102 | 0 | 0 | 0 | 0 |
| ar-rest | 207 | 31 | 0 | 0 | 31 |
| ap-gw | 12 | 0 | 0 | 0 | 0 |
| ap-rest | 50 | 13 | 6 | 0 | 7 |

### integrations

- **OLD** `apps/website/src/features/custom-credentials/credentialed-request.ts:767` — `probeCredentialConnection` (from `@jini-ai/integrations/credentialed-http`): `jiniProbe(required, { httpClient: { send: ({ request }, policy) => options.httpClient.send(request, policy) } })`
- already new-shape / unaffected `apps/website/src/features/project-keys/shared-oauth-disconnect.ts:47` — `disconnectApiConnection`: `disconnectApiConnection({ deps: { descriptor: inspected.context.descriptor, records: required.storage.records, tokens: required.storage.tokensFor({ co…`

### commerce

- **OLD** `apps/website/src/server/runtime/composition/commerce.ts:304` — `readOwnedCommerceOrder` (from `@jini-ai/commerce`): `readOwnedCommerceOrder({ deps: { workspaceId: required.workspaceId, siteId: required.siteId, orders, orderPayments, payments: sharedPayments }, input …`
- **OLD** `apps/website/src/server/runtime/composition/commerce-worker.ts:7` — `createSettlementWorker` (from `@jini-ai/commerce/payments/kernel`): `createSettlementWorker(required, { withOwnership: optional.withOwnership ?? (async run => { const release = acquire(); try { await run(); return { acq…`
- already new-shape / unaffected `apps/website/src/server/inbound/admin-http/routes/commerce/status.ts:41` — `readCommerceStatus`: `readCommerceStatus({ workspaceId: deps.workspaceId, resolvePaymentRuntime: () => deps.lipay ?? null, })`

### db

191 OLD-shape call sites across 25 functions (full list in the appendix at the end). Summary:

| function | before → after | OLD call sites |
|---|---|---|
| `jsonText` | `(dialect: StorageDialect, column: Expression<unknown>, path: readonly …` → `({ dialect, column, path }: { dialect: StorageDialect; column: Expression<unknown>; path: …` | 6 (e.g. apps/website/src/features/project-keys/attachments.ts:32) |
| `jsonScalarEquals` | `(dialect: StorageDialect, column: Expression<unknown>, path: readonly …` → `({ dialect, column, path, value }: { dialect: StorageDialect; column: Expression<unknown>;…` | 3 (e.g. apps/website/src/features/entries/repo.sqlite.ts:24) |
| `jsonSortKey` | `(dialect: StorageDialect, column: Expression<unknown>, path: readonly …` → `({ dialect, column, path }: { dialect: StorageDialect; column: Expression<unknown>; path: …` | 3 (e.g. apps/website/src/features/entries/repo.sqlite.ts:25) |
| `jsonSet` | `(dialect: StorageDialect, column: Expression<unknown>, path: readonly …` → `({ dialect, column, path, value }: { dialect: StorageDialect; column: Expression<unknown>;…` | 2 (e.g. apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:159) |
| `nowIso` | `(dialect: StorageDialect)` → `({ dialect }: { dialect: StorageDialect }, _optional: Record<string, never> = {})` | 1 (e.g. apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:178) |
| `listTables` | `(kernel: KyselyKernel<DB>)` → `({ kernel }: { kernel: KyselyKernel<DB> }, _optional: Record<string, never> = {})` | 45 (e.g. apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:116) |
| `tableExists` | `(kernel: KyselyKernel<DB>, table: string)` → `({ kernel, table }: { kernel: KyselyKernel<DB>; table: string }, _optional: Record<string,…` | 24 (e.g. apps/website/src/features/trash/adapters/post.ts:80) |
| `listColumns` | `(kernel: KyselyKernel<DB>, table: string)` → `({ kernel, table }: { kernel: KyselyKernel<DB>; table: string }, _optional: Record<string,…` | 30 (e.g. apps/website/src/features/forms/repo.sqlite.ts:34) |
| `listIndexes` | `(kernel: KyselyKernel<DB>, table: string)` → `({ kernel, table }: { kernel: KyselyKernel<DB>; table: string }, _optional: Record<string,…` | 6 (e.g. apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:76) |
| `buildKernel` | `(driver: KernelDriver<DB>)` → `({ driver }: { driver: KernelDriver<DB> }, _optional: Record<string, never> = {})` | 1 (e.g. apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:218) |
| `pgliteOps` | `(kernel: KyselyKernel<DB>, required: PgliteRestore & { ledgerTable: st…` → `({ kernel, ...required }: { kernel: KyselyKernel<DB> } & PgliteRestore & { ledgerTable: st…` | 1 (e.g. apps/website/src/platform/db/kernel/ops.ts:17) |
| `copyServedPgliteTo` | `(owner: PgliteExclusive, targetPath: string, required: PgliteRestore)` → `({ owner, targetPath, ...required }: { owner: PgliteExclusive; targetPath: string } & Pgli…` | 1 (e.g. apps/website/src/platform/db/kernel/ops.ts:36) |
| `postgresOps` | `(kernel: KyselyKernel<DB>, required: { ledgerTable: string })` → `({ kernel, ...required }: { kernel: KyselyKernel<DB> } & { ledgerTable: string }, _optiona…` | 1 (e.g. apps/website/src/platform/db/kernel/ops.ts:19) |
| `scopeToSchema` | `(kernel: KyselyKernel<DB>, schema: string)` → `({ kernel, schema }: { kernel: KyselyKernel<DB>; schema: string }, _optional: Record<strin…` | 1 (e.g. apps/website/src/platform/db/chat-kernel.ts:64) |
| `readSchemaShape` | `(kernel: KyselyKernel<unknown>, optional: { exclude?: readonly string[…` → `({ kernel }: { kernel: KyselyKernel<unknown> }, optional: { exclude?: readonly string[] } …` | 29 (e.g. apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.test.ts:116) |
| `databaseFile` | `(kernel: KyselyKernel<DB>)` → `({ kernel }: { kernel: KyselyKernel<DB> }, _optional: Record<string, never> = {})` | 1 (e.g. apps/website/src/server/runtime/composition/database-transfer-adapters.ts:35) |
| `sqliteClientOf` | `(source: SqliteConnectionSource)` → `({ source }: { source: SqliteConnectionSource }, _optional: Record<string, never> = {})` | 1 (e.g. apps/website/src/platform/db/kernel/drivers/sqlite.ts:39) |
| `sqliteKernel` | `(source: SqliteConnectionSource)` → `({ source }: { source: SqliteConnectionSource }, _optional: Record<string, never> = {})` | 7 (e.g. apps/website/src/assistant/persistence/__tests__/chat-dialect-matrix.ts:51) |
| `closeSqliteConnection` | `(source: SqliteConnectionSource)` → `({ source }: { source: SqliteConnectionSource }, _optional: Record<string, never> = {})` | 2 (e.g. apps/website/src/assistant/persistence/__tests__/package-adapters.dialects.test.ts:84) |
| `sqliteConnectionOf` | `(kernel: KyselyKernel<DB>)` → `({ kernel }: { kernel: KyselyKernel<DB> }, _optional: Record<string, never> = {})` | 3 (e.g. apps/website/src/assistant/persistence/__tests__/package-adapters.dialects.test.ts:84) |
| `sqliteOps` | `(kernel: KyselyKernel<DB>)` → `({ kernel }: { kernel: KyselyKernel<DB> }, _optional: Record<string, never> = {})` | 1 (e.g. apps/website/src/platform/db/kernel/ops.ts:15) |
| `renderDatabaseTypes` | `(kernel: KyselyKernel<unknown>, required: { interfaceName: string; sou…` → `({ kernel, ...required }: { kernel: KyselyKernel<unknown> } & { interfaceName: string; sou…` | 1 (e.g. apps/website/src/platform/db/kernel/__tests__/database-types.test.ts:73) |
| `hasLedger` | `(kernel: KyselyKernel<unknown>, ledgerTable: string)` → `({ kernel, ledgerTable }: { kernel: KyselyKernel<unknown>; ledgerTable: string }, _optiona…` | 1 (e.g. apps/website/src/platform/db/migrations/runner.ts:27) |
| `pgliteLowMemoryStartParams` | `(pglite: Pick<PgliteClass, "defaultStartParams">)` → `({ pglite }: { pglite: Pick<PgliteClass, "defaultStartParams"> }, _optional: Record<string…` | 1 (e.g. apps/website/src/platform/db/kernel/drivers/pglite-owner.ts:16) |
| `openSqliteSnapshotSource` | `({ bytes }: { bytes: Buffer }, { open }: { open: SnapshotOpener })` → `({ bytes, open }: { bytes: Buffer; open: SnapshotOpener }, _optional: Record<string, never…` | 19 (e.g. apps/website/src/features/database-transfer/__tests__/copy-engine.postgres.test.ts:98) |

Already on the new shape in Tovu (no change needed): qualified, fitIdentifier, createTableSql, reseedIdentitySql, indexSql, constraintSql (16 call sites, e.g. apps/website/src/features/database-transfer/__tests__/postgres-ddl.unit.test.ts:13).

### ap-rest

- **OLD** `apps/website/src/features/agent-plugins/enable-access.ts:26` — `validatedAgentPluginToolGrant` (from `@jini-ai/agent-plugins/connect`): `validatedWithPorts(required, { ...options, ports: options.ports ?? agentPluginMcpProjectionPorts, messages: tovuEnableAccessMessages })`
- **OLD** `apps/website/src/features/agent-plugins/federate-mcp.ts:41` — `planAgentPluginMcpFederation` (from `@jini-ai/agent-plugins/connect`): `planWithTrust(input, { classifyTrust: options.classifyTrust ?? classifyAgentPluginMcpServerTrust, messages: tovuFederationMessages })`
- **OLD** `apps/website/src/features/agent-plugins/federate-mcp.ts:57` — `provisionAgentPluginMcpServers` (from `@jini-ai/agent-plugins/connect`): `provisionWithPorts(withAgentPluginMcpPorts(deps), withOverrides(input, { classifyTrust: input.classifyTrust ?? classifyAgentPluginMcpServerTrust, mess…`
- **OLD** `apps/website/src/features/agent-plugins/switch-on-saved-token.ts:38` — `switchOnSavedTokenConnection` (from `@jini-ai/agent-plugins/connect`): `switchWithPorts({ workspaceId: deps.workspaceId, mcp, isPluginOffByOperator: deps.isPluginOffByOperator ?? ((pluginId: string) => defaultIsPluginOffBy…`
- **OLD** `apps/admin/src/components/__tests__/folder-zip.unit.test.ts:47` — `crc32` (from `@jini-ai/agent-plugins/folder-zip`): `crc32(entry.data)`
- **OLD** `apps/admin/src/components/__tests__/folder-zip.unit.test.ts:53` — `crc32` (from `@jini-ai/agent-plugins/folder-zip`): `crc32(new TextEncoder().encode("123456789"))`

- `ar-rest`: 31 Tovu call sites (`getAgentDef`, `runtimeSupportsExternalTools`, `runtimeSupportsSubagents`, `runtimeSupportsChromeIntegration`, `classifyAgentServiceFailure`, `validateBaseUrlResolved`, `coerceNumericEnumStringsToNumbers`) all already pass a single `{…}` object, and the branch only appended `_optional = {}` → still type-compatible, 0 old-shape.
- `ar-protocol`, `ar-skills`, `ap-gw`: 0 Tovu call sites for any changed export.

<details><summary>Appendix: all db OLD-shape Tovu call sites (191)</summary>

- `apps/website/src/features/project-keys/attachments.ts:32` `jsonText` — `jsonText(kernel.dialect, sql.ref("v.meta"), ["credentialType"])`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:161` `jsonText` — `jsonText(kernel.dialect, doc, path)`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:174` `jsonText` — `jsonText(kernel.dialect, doc, ["a'b"])`
- `apps/website/src/platform/db/kernel/__tests__/pglite-owner.test.ts:303` `jsonText` — `jsonText(kernel.dialect, sql.ref("doc"), ["meta", "lang"])`
- `apps/website/src/server/runtime/composition/project-store.ts:260` `jsonText` — `jsonText(kernel.dialect, sql.ref("meta"), ["credentialType"])`
- `apps/website/src/server/runtime/composition/project-store.ts:261` `jsonText` — `jsonText(kernel.dialect, sql.ref("meta"), ["credentialFormat"])`
- `apps/website/src/features/entries/repo.sqlite.ts:24` `jsonScalarEquals` — `jsonScalarEquals(kernel.dialect, column, path, value)`
- `apps/website/src/platform/db/kernel/__tests__/dialect-json.test.ts:68` `jsonScalarEquals` — `jsonScalarEquals(kernel.dialect, sql.ref("doc"), PATH(field), value)`
- `apps/website/src/platform/db/kernel/__tests__/dialect-json.test.ts:118` `jsonScalarEquals` — `jsonScalarEquals(kernel.dialect, sql.ref("doc"), ["a'b"], 1)`
- `apps/website/src/features/entries/repo.sqlite.ts:25` `jsonSortKey` — `jsonSortKey(kernel.dialect, column, path)`
- `apps/website/src/platform/db/kernel/__tests__/dialect-json.test.ts:74` `jsonSortKey` — `jsonSortKey(kernel.dialect, sql.ref("doc"), PATH(field))`
- `apps/website/src/platform/db/kernel/__tests__/dialect-json.test.ts:119` `jsonSortKey` — `jsonSortKey(kernel.dialect, sql.ref("doc"), ["a b"])`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:159` `jsonSet` — `jsonSet(kernel.dialect, doc, ["meta", "lang"], "fr")`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:160` `jsonSet` — `jsonSet(kernel.dialect, doc, ["s"], "New")`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:178` `nowIso` — `nowIso(kernel.dialect)`
- `apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:116` `listTables` — `listTables(kernel)`
- `apps/website/src/features/site-backup/share-database/repo.sqlite.ts:92` `listTables` — `listTables(source)`
- `apps/website/src/features/site-backup/share-database/repo.sqlite.ts:333` `listTables` — `listTables(from)`
- `apps/website/src/features/site-backup/share-database/repo.sqlite.ts:335` `listTables` — `listTables(target)`
- `apps/website/src/platform/db/kernel/__tests__/database-types.test.ts:97` `listTables` — `listTables(sqlite)`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:184` `listTables` — `listTables(kernel as KyselyKernel<unknown>)`
- `apps/website/src/platform/db/kernel/__tests__/pglite-owner.test.ts:231` `listTables` — `listTables(otherKernel as KyselyKernel<unknown>)`
- `apps/website/src/platform/db/kernel/__tests__/pglite-owner.test.ts:310` `listTables` — `listTables(kernel as KyselyKernel<unknown>)`
- `apps/website/src/platform/db/key-dependent-data.ts:37` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/0000_legacy_baseline.ts:37` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.postgres.test.ts:24` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.test.ts:46` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.test.ts:93` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.test.ts:104` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/commerce-catalog-step.test.ts:52` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/commerce-catalog-step.test.ts:56` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:32` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:38` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:51` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:86` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:106` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:109` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:133` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-legacy-chat-tables-step.test.ts:34` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-unused-deployment-tables-step.test.ts:30` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-unused-deployment-tables-step.test.ts:39` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-unused-deployment-tables-step.test.ts:58` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/post-search-step.test.ts:68` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/post-search-step.test.ts:75` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/postgres-baseline.test.ts:51` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/runner.test.ts:85` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/runner.test.ts:103` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:103` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:190` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:277` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/migrations/legacy-sqlite.ts:93` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/repos/__tests__/vault-repo.fixture.ts:10` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/sqlite/__tests__/share-database.integration.test.ts:426` `listTables` — `listTables(target)`
- `apps/website/src/platform/db/sqlite/__tests__/share-database.integration.test.ts:439` `listTables` — `listTables(target)`
- `apps/website/src/platform/db/sqlite/chat-orphan-check.ts:101` `listTables` — `listTables(kernel)`
- `apps/website/src/platform/db/vault-credential-inventory.ts:86` `listTables` — `listTables(kernel)`
- `apps/website/src/server/runtime/composition/__tests__/commerce.integration.test.ts:131` `listTables` — `listTables(f.kernel())`
- `apps/website/src/server/runtime/composition/__tests__/commerce.integration.test.ts:136` `listTables` — `listTables(f.kernel())`
- `apps/website/src/server/runtime/composition/__tests__/commerce.integration.test.ts:149` `listTables` — `listTables(f.kernel())`
- `apps/website/src/server/runtime/composition/__tests__/commerce.integration.test.ts:150` `listTables` — `listTables(f.kernel())`
- `apps/website/src/features/trash/adapters/post.ts:80` `tableExists` — `tableExists(kernel(), POST_SEARCH_DOCUMENT_TABLE)`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:185` `tableExists` — `tableExists(kernel as KyselyKernel<unknown>, "kernel_probe")`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:186` `tableExists` — `tableExists(kernel as KyselyKernel<unknown>, "no_such_table")`
- `apps/website/src/platform/db/key-dependent-data.ts:63` `tableExists` — `tableExists(kernel, WEBHOOK_SUBSCRIPTIONS_TABLE)`
- `apps/website/src/platform/db/migrations/0002_drop_empty_legacy_chat_tables.ts:29` `tableExists` — `tableExists(kernel, table)`
- `apps/website/src/platform/db/migrations/0011_archive_legacy_commerce.ts:20` `tableExists` — `tableExists(kernel, table)`
- `apps/website/src/platform/db/migrations/0011_archive_legacy_commerce.ts:52` `tableExists` — `tableExists(kernel, archive)`
- `apps/website/src/platform/db/migrations/0011_drop_empty_core_commerce_tables.ts:183` `tableExists` — `tableExists(kernel, table)`
- `apps/website/src/platform/db/migrations/0012_secrets_vault.ts:226` `tableExists` — `tableExists(kernel, "external_mcp_tool_approvals")`
- `apps/website/src/platform/db/migrations/0012_secrets_vault.ts:262` `tableExists` — `tableExists(kernel, "external_mcp_tool_approvals")`
- `apps/website/src/platform/db/migrations/__tests__/publish-backstop.test.ts:34` `tableExists` — `tableExists(kernel, "publish_backstop_log")`
- `apps/website/src/platform/db/sqlite/database-introspection-adapter.sqlite.ts:195` `tableExists` — `tableExists(this.kernel, this.migrationsTable())`
- `apps/website/src/platform/db/sqlite/database-introspection-adapter.sqlite.ts:262` `tableExists` — `tableExists(this.kernel, LEDGER_TABLE)`
- `apps/website/src/platform/db/sqlite/publish-backstop-audit.sqlite.ts:9` `tableExists` — `tableExists(kernel, "publish_backstop_log")`
- `apps/website/src/platform/db/sqlite/reset-legacy-site-title-pin.ts:69` `tableExists` — `tableExists(kernel, MARKER_TABLE)`
- `apps/website/src/platform/db/sqlite/reset-legacy-site-title-pin.ts:72` `tableExists` — `tableExists(kernel, VALUES_TABLE)`
- `apps/website/src/platform/db/sqlite/reset-legacy-site-title-pin.ts:72` `tableExists` — `tableExists(kernel, DEFINITIONS_TABLE)`
- `apps/website/src/platform/site-dir/duplicate-content-db.ts:127` `tableExists` — `tableExists(kernel, name)`
- `apps/website/src/platform/site-dir/read-applied-schema-identity.ts:92` `tableExists` — `tableExists(kernel, LEDGER_TABLE)`
- `apps/website/src/platform/site-dir/read-applied-schema-identity.ts:97` `tableExists` — `tableExists(kernel, "__drizzle_migrations")`
- `apps/website/src/server/runtime/composition/commerce.ts:105` `tableExists` — `tableExists(required.kernel, 'commerce_payments')`
- `apps/website/src/server/runtime/composition/commerce.ts:105` `tableExists` — `tableExists(required.kernel, 'commerce_products')`
- `apps/website/src/server/runtime/composition/commerce.ts:318` `tableExists` — `tableExists(required.kernel, 'commerce_order_payments')`
- `apps/website/src/server/runtime/composition/other-site-keys.ts:102` `tableExists` — `tableExists(kernel, "secrets_vault")`
- `apps/website/src/features/forms/repo.sqlite.ts:34` `listColumns` — `listColumns(kernel, table)`
- `apps/website/src/features/media/__tests__/created-by.test.ts:106` `listColumns` — `listColumns(kernel, "media")`
- `apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:65` `listColumns` — `listColumns(kernel, "p_dm__widgets")`
- `apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:128` `listColumns` — `listColumns(kernel, "p_dm__widgets")`
- `apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:163` `listColumns` — `listColumns(kernel, "p_dm__widgets")`
- `apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:187` `listColumns` — `listColumns(kernel, "p_dm__widgets")`
- `apps/website/src/features/site-backup/share-database/repo.sqlite.ts:122` `listColumns` — `listColumns(target, table)`
- `apps/website/src/features/site-backup/share-database/repo.sqlite.ts:123` `listColumns` — `listColumns(source, table)`
- `apps/website/src/platform/db/kernel/__tests__/database-types.test.ts:108` `listColumns` — `listColumns(sqlite, table)`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:187` `listColumns` — `listColumns(kernel as KyselyKernel<unknown>, "kernel_probe")`
- `apps/website/src/platform/db/key-dependent-data.ts:51` `listColumns` — `listColumns(kernel, table)`
- `apps/website/src/platform/db/migrations/__tests__/document-blob-ownership.test.ts:24` `listColumns` — `listColumns(kernel, 'asset_blobs')`
- `apps/website/src/platform/db/migrations/__tests__/media-createdby.test.ts:15` `listColumns` — `listColumns(kernel, "media")`
- `apps/website/src/platform/db/migrations/__tests__/media-createdby.test.ts:27` `listColumns` — `listColumns(kernel, "media")`
- `apps/website/src/platform/db/migrations/__tests__/media-library.test.ts:16` `listColumns` — `listColumns(kernel, 'media')`
- `apps/website/src/platform/db/migrations/__tests__/member-external-identities-step.test.ts:26` `listColumns` — `listColumns(kernel, "member_external_identities")`
- `apps/website/src/platform/db/migrations/__tests__/members-credentials-revoked-at.test.ts:24` `listColumns` — `listColumns(kernel, "members")`
- `apps/website/src/platform/db/migrations/__tests__/owner-mfa-step.test.ts:20` `listColumns` — `listColumns(kernel, 'owner_mfa_factors')`
- `apps/website/src/platform/db/migrations/__tests__/owner-mfa-step.test.ts:22` `listColumns` — `listColumns(kernel, 'owner_mfa_pending')`
- `apps/website/src/platform/db/migrations/__tests__/owner-recovery-codes-step.test.ts:18` `listColumns` — `listColumns(kernel, 'owner_recovery_codes')`
- `apps/website/src/platform/db/migrations/__tests__/posts-author-migration.test.ts:34` `listColumns` — `listColumns(kernel, "posts")`
- `apps/website/src/platform/db/migrations/__tests__/posts-publish-at-featured-media.test.ts:18` `listColumns` — `listColumns(kernel, "posts")`
- `apps/website/src/platform/db/migrations/__tests__/publish-backstop.test.ts:36` `listColumns` — `listColumns(kernel, "publish_backstop_log")`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:37` `listColumns` — `listColumns(kernel, "oauth_device_authorizations")`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:102` `listColumns` — `listColumns(kernel, "oauth_device_authorizations")`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:105` `listColumns` — `listColumns(kernel, "external_mcp_servers")`
- `apps/website/src/platform/db/repos/media-repo.ts:180` `listColumns` — `listColumns(this.kernel, "media")`
- `apps/website/src/platform/db/sqlite/__tests__/share-database.integration.test.ts:440` `listColumns` — `listColumns(target, "p_fixture__notes")`
- `apps/website/src/platform/db/vault-credential-inventory.ts:88` `listColumns` — `listColumns(kernel, table)`
- `apps/website/src/server/runtime/composition/import-database/repo.sqlite.ts:135` `listColumns` — `listColumns(fresh, table)`
- `apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:76` `listIndexes` — `listIndexes(kernel, "p_dm__widgets")`
- `apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:129` `listIndexes` — `listIndexes(kernel, "p_dm__widgets")`
- `apps/website/src/features/plugins/__tests__/data-module.dialects.test.ts:138` `listIndexes` — `listIndexes(kernel, "p_dm__widgets")`
- `apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.test.ts:55` `listIndexes` — `listIndexes(kernel, "_archive_0011_commerce_products")`
- `apps/website/src/platform/db/migrations/__tests__/publish-backstop.test.ts:45` `listIndexes` — `listIndexes(kernel, "publish_backstop_log")`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:236` `listIndexes` — `listIndexes(kernel, "secrets_vault")`
- `apps/website/src/platform/db/kernel/__tests__/kernel.test.ts:218` `buildKernel` — `buildKernel<unknown>({ dialect: "sqlite", transport: "better-sqlite3", capabilities: { interactiveTransactions…`
- `apps/website/src/platform/db/kernel/ops.ts:17` `pgliteOps` — `pgliteOps(kernel, { PGlite, ownerLockFileName: OWNER_LOCK_FILE, ledgerTable: "tovu_migrations" }, optional)`
- `apps/website/src/platform/db/kernel/ops.ts:36` `copyServedPgliteTo` — `jiniCopyServedPgliteTo(owner, targetPath, { PGlite, ownerLockFileName: OWNER_LOCK_FILE })`
- `apps/website/src/platform/db/kernel/ops.ts:19` `postgresOps` — `postgresOps(kernel, { ledgerTable: "tovu_migrations" })`
- `apps/website/src/platform/db/chat-kernel.ts:64` `scopeToSchema` — `scopeToSchema(kernel as ChatKernel, AI_CHAT_SCHEMA)`
- `apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.test.ts:116` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.test.ts:124` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.test.ts:134` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/archive-legacy-commerce.test.ts:144` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:36` `readSchemaShape` — `readSchemaShape(kernel, { exclude: RETIRED_TABLES })`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:39` `readSchemaShape` — `readSchemaShape(kernel, { exclude: RETIRED_TABLES })`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:43` `readSchemaShape` — `readSchemaShape(kernel, { exclude: RETIRED_TABLES })`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:68` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:81` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:95` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/drop-empty-core-commerce-tables-step.test.ts:97` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/legacy-adoption.test.ts:78` `readSchemaShape` — `readSchemaShape(kernel, { exclude: BOOKKEEPING })`
- `apps/website/src/platform/db/migrations/__tests__/legacy-adoption.test.ts:79` `readSchemaShape` — `readSchemaShape(viaDrizzle, { exclude: BOOKKEEPING })`
- `apps/website/src/platform/db/migrations/__tests__/legacy-adoption.test.ts:87` `readSchemaShape` — `readSchemaShape(kernel, { exclude: BOOKKEEPING })`
- `apps/website/src/platform/db/migrations/__tests__/legacy-adoption.test.ts:92` `readSchemaShape` — `readSchemaShape(kernel, { exclude: BOOKKEEPING })`
- `apps/website/src/platform/db/migrations/__tests__/post-search-step.test.ts:39` `readSchemaShape` — `readSchemaShape(kernel, { exclude: ["__drizzle_migrations", "tovu_migrations"] })`
- `apps/website/src/platform/db/migrations/__tests__/post-search-step.test.ts:43` `readSchemaShape` — `readSchemaShape(kernel, { exclude: ["__drizzle_migrations", "tovu_migrations"] })`
- `apps/website/src/platform/db/migrations/__tests__/post-search-step.test.ts:90` `readSchemaShape` — `readSchemaShape(kernel, { exclude: ["tovu_chat_migrations"] })`
- `apps/website/src/platform/db/migrations/__tests__/post-search-step.test.ts:92` `readSchemaShape` — `readSchemaShape(kernel, { exclude: ["tovu_chat_migrations"] })`
- `apps/website/src/platform/db/migrations/__tests__/postgres-baseline.test.ts:54` `readSchemaShape` — `readSchemaShape(kernel, { exclude: ["tovu_migrations", "post_search_document", ...backups] })`
- `apps/website/src/platform/db/migrations/__tests__/postgres-baseline.test.ts:55` `readSchemaShape` — `readSchemaShape(reference)`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:172` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:187` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:273` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:275` `readSchemaShape` — `readSchemaShape(kernel)`
- `apps/website/src/platform/db/migrations/legacy-sqlite.ts:135` `readSchemaShape` — `readSchemaShape(scratch, { exclude: BOOKKEEPING })`
- `apps/website/src/platform/db/migrations/legacy-sqlite.ts:196` `readSchemaShape` — `readSchemaShape(kernel, { exclude: BOOKKEEPING })`
- `apps/website/src/platform/db/sqlite/__tests__/integration/content-db-fresh.integration.test.ts:55` `readSchemaShape` — `readSchemaShape(sqliteKernel<unknown>(sync), { exclude: BOOKKEEPING })`
- `apps/website/src/platform/db/sqlite/__tests__/integration/content-db-fresh.integration.test.ts:65` `readSchemaShape` — `readSchemaShape(sqliteKernel<unknown>(asyncDb), { exclude: BOOKKEEPING })`
- `apps/website/src/server/runtime/composition/database-transfer-adapters.ts:35` `databaseFile` — `databaseFile(contentKernel({ store: deps.db }))`
- `apps/website/src/platform/db/kernel/drivers/sqlite.ts:39` `sqliteClientOf` — `jiniSqliteClientOf(source)`
- `apps/website/src/assistant/persistence/__tests__/chat-dialect-matrix.ts:51` `sqliteKernel` — `sqliteKernel<ChatDatabase>(openChatDb(":memory:"))`
- `apps/website/src/platform/db/chat-kernel.ts:52` `sqliteKernel` — `sqliteKernel<ChatDatabase>(store as SqliteConnectionSource)`
- `apps/website/src/platform/db/kernel/__tests__/jini-db-facades.integration.test.ts:30` `sqliteKernel` — `jiniSqliteKernel(b)`
- `apps/website/src/platform/db/kernel/__tests__/jini-db-type-identity.test.ts:35` `sqliteKernel` — `jiniSqliteKernel<ContentDatabase>(client)`
- `apps/website/src/platform/db/migrations/__tests__/chat-package-adoption.test.ts:83` `sqliteKernel` — `sqliteKernel<ChatDatabase>(db)`
- `apps/website/src/platform/db/migrations/__tests__/chat-package-adoption.test.ts:142` `sqliteKernel` — `sqliteKernel<ChatDatabase>(db)`
- `apps/website/src/platform/db/sqlite/chat-db.ts:53` `sqliteKernel` — `sqliteKernel<unknown>(sqlite)`
- `apps/website/src/assistant/persistence/__tests__/package-adapters.dialects.test.ts:84` `closeSqliteConnection` — `closeSqliteConnection(sqliteConnectionOf(ledgerKernel)!)`
- `apps/website/src/assistant/persistence/__tests__/package-adapters.dialects.test.ts:85` `closeSqliteConnection` — `closeSqliteConnection(sqliteConnectionOf(independentKernel)!)`
- `apps/website/src/assistant/persistence/__tests__/package-adapters.dialects.test.ts:84` `sqliteConnectionOf` — `sqliteConnectionOf(ledgerKernel)`
- `apps/website/src/assistant/persistence/__tests__/package-adapters.dialects.test.ts:85` `sqliteConnectionOf` — `sqliteConnectionOf(independentKernel)`
- `apps/website/src/platform/db/kernel/drivers/sqlite.ts:44` `sqliteConnectionOf` — `jiniSqliteConnectionOf(kernel)`
- `apps/website/src/platform/db/kernel/ops.ts:15` `sqliteOps` — `sqliteOps(kernel)`
- `apps/website/src/platform/db/kernel/__tests__/database-types.test.ts:73` `renderDatabaseTypes` — `renderDatabaseTypes(pg, { interfaceName: "ContentDatabase", source: "a fresh PGlite database with the content …`
- `apps/website/src/platform/db/migrations/runner.ts:27` `hasLedger` — `jiniHasLedger(kernel, LEDGER_TABLE)`
- `apps/website/src/platform/db/kernel/drivers/pglite-owner.ts:16` `pgliteLowMemoryStartParams` — `pgliteLowMemoryStartParams(PGlite)`
- `apps/website/src/features/database-transfer/__tests__/copy-engine.postgres.test.ts:98` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: bytes }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/copy-engine.postgres.test.ts:110` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: fixtureSnapshot() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/copy-engine.postgres.test.ts:136` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: fixtureSnapshot() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/copy-engine.postgres.test.ts:233` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: replacement }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/copy-engine.postgres.test.ts:283` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: bytes }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/copy-engine.postgres.test.ts:332` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: bytes }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/copy-engine.postgres.test.ts:388` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: bytes }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/exclusions.unit.test.ts:73` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: db.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/exclusions.unit.test.ts:100` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: db.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/exclusions.unit.test.ts:122` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: db.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/exclusions.unit.test.ts:148` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: db.$client.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/table-catalog.unit.test.ts:37` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: db.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/table-catalog.unit.test.ts:57` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: db.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/table-catalog.unit.test.ts:73` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: db.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/table-catalog.unit.test.ts:131` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: db.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/transfer-completeness.unit.test.ts:23` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: content.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/features/database-transfer/__tests__/transfer-completeness.unit.test.ts:24` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: chat.serialize() }, { open: data => openSqliteSnapshot({ data }) })`
- `apps/website/src/platform/db/migrations/__tests__/secrets-vault-step.test.ts:255` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes: sqliteConnectionOf(kernel)!.serialize() }, { open: data => openSqliteSnapsho…`
- `apps/website/src/server/runtime/composition/database-transfer-adapters.ts:26` `openSqliteSnapshotSource` — `openSqliteSnapshotSource({ bytes }, { open: data => openSqliteSnapshot({ data }) })`

</details>

## Merge check (step 5) — throwaway local branch `tmp/merge-check-local` (NOT pushed)

`git checkout -b tmp/merge-check-local 6c9effae4`, then `git merge --no-ff` of, in order: args-integrations, args-commerce, args-db, args-ar-protocol, args-ar-skills, args-ar-rest, args-ap-gw, args-ap-rest → **all 8 merged with no conflicts** (merge head `d1f65ded`). Then `pnpm --no-bail -r build` (only `@jini-ai/agent-runtime` fails to build — the ar-rest tsc errors above; the changed packages integrations/db/commerce/provider-plugins/cms/chat/daemon/agent-plugins were then built with a `--filter` run, exit 0), then the same tsc + vitest runner on **all 25** packages, plus the 5 gates.

| check | result on merged tree vs base |
|---|---|
| tsc new errors | **5**, all in `packages/agent-runtime` (identical to the ar-rest ones above); 0 in the other 24 packages (admin 2 / search 2 / registry 9 are the base errors) |
| new failing tests | db 3 (loads-without-driver, as above); agent-runtime 2 (as above); `examples/minimal-host/src/health-boot.test.ts :: boots examples/minimal-host from packed tarballs` (consequence: `pnpm --filter @jini-ai/agent-runtime run build` exits 2 inside the pack step); `packages/admin/src/source-control/react/__tests__/source-control-surface.unit.test.tsx :: surfaces a failed token save` — **flaky, not attributable**: no branch touches `packages/admin`, and re-running that single test twice in isolation gave 1 pass / 1 fail (a 1 s `findByText` timeout under load) |
| gates | `check:size` red (openai-chat.ts 504→505 worsened; acp/session.ts 748→745 lower-debt), `check:complexity` red (stale `readModelConfiguration`), `check:why-comments` red (4 lost blocks = ap-gw 1 + ap-rest 3), `guard` and `check:hooks` exit 0 — i.e. exactly the union of the individual branch reds; no merge-only failures |
| other | `examples/notes-app` `node --test`: 112/112 pass; test totals per package equal to base (no test lost) |

Verdict for the merge: **RED**, but only because of the same ar-rest / db / ap-* defects; the 8 branches are textually independent (no conflicts, no merge-only breakage). Merging `integrations`, `commerce`, `ar-skills` alone is Jini-green.

## Commands run (exact) and results

```
# setup
curl -sSfL https://nodejs.org/dist/latest-v24.x/node-v24.22.3-linux-x64.tar.xz | tar xJ  → ~/.local/node24 ; export PATH=$HOME/.local/node24/bin:$PATH ; corepack enable --install-directory ~/.local/node24/bin   # node v24.22.3, pnpm 10.33.2
git -C Jini fetch origin <8 codex/args-* branches> refactor/terra     # base 6c9effae4 == origin/refactor/terra; each branch = base + 1 commit (integrations = +2)
git checkout --detach 6c9effae4 ; pnpm install --frozen-lockfile      # exit 0
pnpm --no-bail -r build                                              # exit 0
# per package (25 on base + merged; touched+dependents-for-tsc per branch)
<package typecheck script, e.g. tsc -p tsconfig.json --noEmit>        # counts of "error TS" in tables above
npx vitest run --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=<f>   # NOTE: bare --maxWorkers=2 crashes vitest 2.1.9 ("minThreads and maxThreads must not conflict", 0 tests) → --minWorkers=1 added; my first base run with the bad flag was discarded and redone
commerce extra: node --import tsx --test src/catalog/__tests__/unit/*.unit.test.ts ; npx vitest run -c vitest.kernel.config.ts --maxWorkers=2 --minWorkers=1
examples/notes-app: node --test 'src/**/*.test.ts'                      # merged tree only: 112 pass
# gates (base, every branch, merged)
pnpm guard ; pnpm check:size ; pnpm check:complexity ; pnpm check:why-comments ; pnpm check:hooks   # base: all exit 0
# per branch
git checkout --detach 6c9effae4 ; pnpm --filter <pkgs built by previous branch> run build     # restore base dist (see note)
git checkout --detach origin/codex/args-<x> ; pnpm --filter <changed pkgs> run build          # then tsc on all dependents (xargs -P2), vitest on touched pkgs, 5 gates
# diagnostics
npx vitest run src/__tests__/loads-without-driver.test.ts     (packages/db @ args-db)            → 3 failed, stack traces above
npx vitest run tests/loads-without-integrations.test.ts        (packages/agent-runtime @ args-ar-rest) → 1 failed
npx vitest run src/source-control/.../source-control-surface.unit.test.tsx -t "surfaces a failed token save" (admin, merged) ×2 → pass, fail (flaky)
# merge
git checkout -b tmp/merge-check-local 6c9effae4 ; for b in integrations commerce db ar-protocol ar-skills ar-rest ap-gw ap-rest; do git merge --no-ff origin/codex/args-$b; done   # 0 conflicts
pnpm --no-bail -r build   # only agent-runtime fails ; pnpm --filter integrations/db/commerce/provider-plugins/cms/chat/daemon/agent-plugins run build  # exit 0
```

### Deviations / honesty notes

- **Dependents' tests were not run per branch** (time box 2.5 h): per branch I ran tsc on *every* dependent package but vitest only on the packages the diff touches (plus `chat`/`daemon`/`cms`/`commerce`/`notes-app`/`neutral-host`/`provider-plugins` where the diff reaches them). The full 25-package test sweep was run on the **merged** tree instead (which contains all 8 changes), so a dependent-package test regression from any single branch would have surfaced there; only the 5 failures listed above appeared (4 attributable, 1 flaky).
- **Dist hygiene:** `dist/` is gitignored, so switching branches leaves stale builds. My first pass over `commerce…ar-rest` ran on contaminated dists (it showed bogus neutral-host/provider-plugins tsc errors on ar-protocol/ar-skills); I discarded it, added a "checkout base + rebuild previously built packages" step before every branch and re-ran all branches except `integrations` (which was first, on a clean base build). A final run on base (`baseRestore`) reproduced the base numbers exactly. Per-branch builds only rebuild the packages the branch changes; dependents' own dist stayed at base (their sources are unchanged).
- On `ar-rest` the build of `agent-runtime` fails, so `chat`/`daemon` were not rebuilt in that run (their tsc/tests still ran on their branch sources and passed).
- Tovu classification is an AST heuristic (+ manual review of every non-db hit); `validatedAgentPluginToolGrant` was corrected by hand to OLD (ports/messages moved from `options` into `required`). Tovu `readOwnedCommerceOrder`/`createSettlementWorker`/`probeCredentialConnection` are old-shape; `disconnectApiConnection` in Tovu already uses the post-branch flat shape.
- No source file was changed. `tmp/merge-check-local` is local only (not pushed). Only this file is pushed, on `verify/codex-args-1` (from 6c9effae4).
