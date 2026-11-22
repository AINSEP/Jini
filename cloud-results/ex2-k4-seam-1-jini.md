DONE 7d4661cd3

# K4-seam-1.J (Jini half) — additive approval + daemon-surface contracts

- Branch: `codex/ex2-k4-seam-1-jini`, based on `origin/integ/merge-13-2026-11-22` @ `7c4ee7881` (contains READY `e4e3bf175`).
- Spec applied: `plans/P9-steps/K4-seam-1.md`, corrected by `plans/P9K-fix-B1-B3.md` § K4-seam-1.J (correction wins), scoped by `plans/P9K-fixcheck-B1-B3.md` (READY, **additive approval and surface contracts only**). `plans/P9-extraction.md` §1 contract followed.
- Pushed SHAs (in order):
  - `9edced1d9` test(core,daemon): type fixtures, committed red (the run saw them fail first)
  - `70f821aee` feat(core): the two core contracts, export entries, changeset, recovery.ts doc ref
  - `b629192df` chore(api): `pnpm api:update` delta
  - (this report commit follows `b629192df`)

## Files added / changed

| file | change |
|---|---|
| `packages/core/src/contracts/site/tool-metadata-approval-policy.ts` | **new**. `ToolApprovalClass = ToolApprovalMetadata["class"]`. `interface ToolApprovalPolicy<Rule extends string = string> extends ToolApprovalMetadata { readonly rule?: Rule }`. Imports `ToolApprovalMetadata` from `../../tool-metadata-types.js`. The host's six rule names and its owner-policy docblock **stay in Tovu**, per the correction. Core's doc only says that `rule` is host-owned. |
| `packages/core/src/contracts/site/daemon-surface-exchanges.ts` | **new**. `AssistantSurfaceDeps`, copied verbatim from `packages/daemon/src/surface-exchanges.ts:448–460` together with its full why-docblock and the same-store rationale. Uses `import type { SurfaceExchangeStore } from "../../surface-exchanges.js"`. `readonly surfaceExchanges` is kept. |
| `packages/core/package.json` | 2 export entries in the dist-triple shape, plus 2 `jini` runtime-map rows (both `universal`). Core has no `typesVersions`. |
| `packages/daemon/src/tool-recovery/recovery.ts:375` | Doc reference only: it now points at `@jini-ai/core/contracts/site/daemon-surface-exchanges`'s `AssistantSurfaceDeps` doc, reflowed to 2 lines. No code change. |
| `.changeset/p9-k4-seam-1.md` | patch for `@jini-ai/core` and `@jini-ai/daemon` |
| `api-baseline/jini-ai__core.json` | +2 entries (below) |
| tests | 3 new type-fixture tests (below) |

**Not removed, on purpose (additive B2):** the daemon still declares `AssistantSurfaceDeps` in `packages/daemon/src/surface-exchanges.ts`, identical to core's copy. `packages/integrations/src/webhooks/ports.ts` is untouched: `KeyringPort` and `SecretSealerPort` stay put, and the vault/webhook cutover belongs to **B6**. No source in another package changed except the doc line above. No new cross-package implementation import was added; the only new cross-package edge is a type import of a core contract, in a daemon test.

## Exports and api-baseline delta (`api-baseline/jini-ai__core.json`, additions only)

- `./contracts/site/daemon-surface-exchanges` → `AssistantSurfaceDeps: interface:7b0241e5a6`
- `./contracts/site/tool-metadata-approval-policy` → `ToolApprovalClass: type:04963137d2`, `ToolApprovalPolicy: interface:ac6a5711ce`
- The daemon baseline is unchanged (comment-only edit). `api:check`: 40 packages, 690→692 entries, 17229→17232 symbols, green.

## Tests

New tests. These are compile-time fixtures: vitest erases types, so `tsc` is the real gate.
- `packages/core/src/contracts/site/__tests__/tool-metadata-approval-policy.unit.test.ts` covers:
  - a named rule assigned to `ToolApprovalPolicy<"http-method"|"page-control">`
  - `@ts-expect-error` for a rule outside the union and for an unknown class
  - a specialization that fits `ToolMetadata<ToolApprovalPolicy<…>>`
  - 2 tests
- `packages/core/src/contracts/site/__tests__/daemon-surface-exchanges.unit.test.ts`: `{ surfaceExchanges: store }` satisfies core `AssistantSurfaceDeps` (1 test).
- `packages/daemon/src/__tests__/surface-deps-core-contract.test.ts`: daemon and core `AssistantSurfaceDeps` are assignable both ways. This is the guard for the additive window (1 test).
- Red first: before the sources existed, `tsc` on core failed with TS2307 (module missing) and TS2578 (unused `@ts-expect-error`), and `tsc` on daemon failed with TS2307. Those tests were committed red as `9edced1d9`.

Suites, final:
- core `vitest run`: **218 files / 2974 tests passed**
- daemon `vitest run`: **252 passed + 1 skipped files / 4855 passed + 1 skipped tests**

Daemon stay gates, all green: `bound-confirmations` (20), `surface-exchange-approval-marker` (1), `surface-exchanges.deadlines` (4), `http/__tests__/surface-callback` (8), `http/__tests__/surface-restoration` (7).

## Named mutations (applied to core, then reverted; tree clean afterwards)

1. Correction's approval mutation: `rule?: Rule` → `rule?: never`. Core `tsc` exits 2:
   `tool-metadata-approval-policy.unit.test.ts(16,86): error TS2322: Type 'string' is not assignable to type 'never'.`
2. Sheet's type-only mutation: rename the moved field `surfaceExchanges` → `surfaceExchangeStore` in core. Core `tsc` exits 2 (TS2561, TS2551 in `daemon-surface-exchanges.unit.test.ts`). Daemon `tsc` exits 2 (TS2741 ×2 in `surface-deps-core-contract.test.ts`).
3. Restored: core and daemon `tsc` clean. `git status` clean.

## Gates — base (unmodified `7c4ee7881`) vs final

| gate | base | final |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 0 |
| `pnpm -r build` | 0 | 0 |
| `pnpm guard` | ok | ok (identical output) |
| `pnpm typecheck` | 0 | 0 |
| `pnpm check:size` | 1 (pre-existing: stale sidecar `json-ipc.ts` debt entries) | 1, **output identical to base** |
| `pnpm check:complexity` | 1 (pre-existing: chat `event-projection.ts:296`, core `errors/reporter.ts:158`, ui `ErrorNotice.tsx:22`) | 1, **identical to base** |
| `pnpm check:hooks` | ok, 0 findings | identical |
| `pnpm check:errors` (WARN mode) | 0, 25 new/worse pre-existing | identical |
| `pnpm api:check` | 0 | 0 |
| `check:why-comments` | script default base `origin/refactor/terra` is absent in this clone | `--base 7c4ee7881`: **ok, 0 comment blocks lost** |
| `check:cross-package` | script's base `35c4961af` is absent (shallow clone) | `--base 7c4ee7881`: exit 1. See note 1. |

No new red on any comparable gate. Function size and complexity are trivial: the new files contain only types.

## Minor findings (listed, not fixed)

1. **`check:cross-package` cannot be fully run in cloud.**
   - XP3 needs `JINI_DECLARATION_BASELINE_DIR`, a declaration snapshot built from the original `35c4961af` checkout. That commit is not in this shallow clone. Its one XP3 line is `recovery.ts: absolute JINI_DECLARATION_BASELINE_DIR required`, and that diff is a comment-only change.
   - XP4 ("contract JavaScript contains runtime statements") fires on every `__tests__` file under `packages/core/src/contracts/**`. That includes the pre-existing `contracts/site/__tests__/strict-base64.unit.test.ts` (17 lines) and the `vault`/`storage` tests. The two new core fixtures follow that same placement, so they are flagged the same way.
   - Owner call: either XP4 should skip `__tests__` under contracts, or contract tests should live elsewhere.
2. `check:why-comments` defaults its base to `origin/refactor/terra`, which does not exist here. Pass `--base` in cloud runs.
3. While the step is additive, `AssistantSurfaceDeps` is declared in two places on purpose. `surface-deps-core-contract.test.ts` keeps the two identical. B6 must delete the daemon declaration **and** that test (or repoint it) together.

## For the Tovu half (`K4-seam-1.T`, B3 — approval only)

- New import specifiers, all type-only, from `@jini-ai/core`:
  - `import type { ToolApprovalPolicy, ToolApprovalClass } from "@jini-ai/core/contracts/site/tool-metadata-approval-policy";`
  - `import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";` (B6 only. Under the fixcheck, T in B3 is approval-only.)
- `ToolApprovalPolicy` is now **generic** (`Rule extends string = string`). Tovu keeps its six-rule union beside its catalog and evaluator. For example, Tovu declares `type TovuApprovalRule = 'http-method' | 'page-control' | 'export-commit' | 'plugin-enable' | 'execution-setting' | 'theme-activation'` and then uses `ToolApprovalPolicy<TovuApprovalRule>` wherever the evaluator needs the closed union. The bare `ToolApprovalPolicy` accepts any `string` rule. Repoints that need the closed union must therefore spell the type argument, or use the Tovu alias, not the bare name.
- Tovu's owner-policy docblock (from `contracts/core/tool-metadata/approval-policy.ts`) was **not** moved into Jini. It stays with Tovu's rule union and evaluator, so do not delete it in T.
- `ToolApprovalClass` is identical to Tovu's eight-member union, because it derives from core `ToolApprovalMetadata["class"]`.
- Link against a Jini build at `b629192df` or later. Core must be rebuilt for the new `dist/contracts/site/*` entries to resolve.

## Review fixes

Applied the Codex 6.2 review FIX list (coordinator: apply FIX 1 and 2 as written). Fix commit: `7d4661cd3` on `codex/ex2-k4-seam-1-jini`, rebased on top of `be4d246af`. No other scope.

**FIX 1: XP4 on contract fixtures.** Moved with `git mv`, so history is kept:
- `packages/core/src/contracts/site/__tests__/daemon-surface-exchanges.unit.test.ts` → `packages/core/src/__tests__/daemon-surface-exchanges.unit.test.ts`. Imports at `:4–5` now point to `../surface-exchanges.js` and `../contracts/site/daemon-surface-exchanges.js`.
- `packages/core/src/contracts/site/__tests__/tool-metadata-approval-policy.unit.test.ts` → `packages/core/src/__tests__/tool-metadata-approval-policy.unit.test.ts`. Imports at `:4–5` now point to `../tool-metadata-types.js` and `../contracts/site/tool-metadata-approval-policy.js`.
- Test bodies are unchanged.
- Result: `check-no-cross-package.ts --base 7c4ee7881` now reports **0** XP lines for either fixture. It reported the XP4 runtime-statement failures before.
- Compared against a merge-13 base worktree, file by file, every file the checker flags at HEAD is also flagged at base, except one: `XP3 packages/daemon/src/tool-recovery/recovery.ts: absolute JINI_DECLARATION_BASELINE_DIR required`. That is the known cloud limit from minor finding 1, on a comment-only edit, and this fix did not add it. The checker still exits 1 because of XP4 on contract files that already existed.

**FIX 2: changeset.** `.changeset/p9-k4-seam-1.md:1–6`:
- The `"@jini-ai/daemon": patch` bump is removed. Only `"@jini-ai/core": patch` remains.
- The text no longer says the contracts come from the host. It now says that `AssistantSurfaceDeps` is an *additive copy of the declaration in `@jini-ai/daemon/surface-exchanges`*, and that daemon keeps its identical declaration and its exports until the paired cutover.
- The approval contract is described as specializing core's `ToolApprovalMetadata` with an optional, host-owned rule name.
- The daemon's exports and API baseline are unchanged.

**Gates (after the fixes):**

| gate | result |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm -r build` | 0 |
| `pnpm typecheck` | 0 |
| `pnpm guard` | ok |
| `pnpm api:check` | 0: 40 packages, 692 entries, 17232 symbols. No `api:update` needed: the fixes touch no exports. |
| `check:size` | 1. Output is identical to a merge-13 base worktree run, so these are pre-existing. |
| `check:complexity` | 1. Output is identical to base, so these are pre-existing. |
| `check:errors` (WARN) | 0. Output is identical to base. |
| `check:hooks` | ok |
| `check:why-comments --base 7c4ee7881` | ok, 0 blocks lost |
| `check:cross-package --base 7c4ee7881` | No new red from these fixes. See FIX 1. |

**Test suites:**
- core vitest: 218 files / **2974 passed**. This matches the run before the fix, so no tests were lost. Both moved fixtures run from `src/__tests__/` (2 tests + 1 test).
- daemon vitest: 252 passed + 1 skipped files / **4855 passed + 1 skipped** tests. This also matches the run before the fix.

**Named mutations** (each was red, then restored; `git status` was clean afterwards):
1. `rule?: Rule` → `rule?: never`: core `tsc` exits 2 with `src/__tests__/tool-metadata-approval-policy.unit.test.ts(16,86): error TS2322`.
2. `surfaceExchanges` → `surfaceExchangeStore` in the core contract:
   - core `tsc` exits 2 with TS2561 and TS2551 in `src/__tests__/daemon-surface-exchanges.unit.test.ts`.
   - With core rebuilt, daemon `tsc` exits 2 with TS2741 ×2 in `surface-deps-core-contract.test.ts`.
3. Restored: core rebuilt. Core and daemon `tsc` both exit 0.

**Review notes, recorded and deliberately not acted on:**
- The daemon keeps its `AssistantSurfaceDeps` export until B6.
- For the Tovu half (B3), catalog entries keep `as const satisfies`.
- Also for B3, `HostToolApprovalPolicy` is specialized at the catalog projection boundary and at the evaluator boundary.
