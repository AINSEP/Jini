# ab-devops-verify — base 98d7439b3 vs A (2c8f18b3) vs B (b8d40c4b)

Verify-only; no product code edited. Node v24.22.3, pnpm 10.33.2. Per ref: `git checkout --detach <ref>; git clean -fdxq`, then:
`pnpm install --frozen-lockfile` → `pnpm --no-bail -r build` → `cd packages/devops && npx tsc -p tsconfig.json --noEmit` →
`cd packages/devops && npx vitest run --maxWorkers=2 --minWorkers=1` → `pnpm guard` → `pnpm check:size` → `pnpm check:complexity`.

Changed packages (`git diff --name-only 98d7439b3..HEAD`): A = packages/devops only (25 files); B = packages/devops only (48 files). So only devops needed tsc/vitest.

Deviation: the specified `--maxWorkers=2` alone crashes vitest 2.1.9 in this environment on the **base** too
(`RangeError: options.minThreads and options.maxThreads must not conflict`, tinypool 2.1.2) — so `--minWorkers=1` was added. Env issue, not branch-related.

| metric | base | A | B |
|---|---|---|---|
| install / build (exit) | 0 / 0 | 0 / 0 | 0 / 0 |
| tsc --noEmit devops (errors, exit) | 0 (0) | 0 (0) | 0 (0) |
| vitest devops (failed / total) | 0 / 1248 | 0 / 1248 | **1 / 1248** (exit 1) |
| pnpm guard (exit, new violations) | 0, 0 | 0, 0 | 0, 0 |
| check:size (exit, new) | 0, 0 (157 debt entries) | 0, 0 (157) | 0, 0 (157) |
| check:complexity (exit, new) | 0, 0 (17 entries) | **1, 1 new** | **1, 1 new** |

## New failures vs base

### A
- `pnpm check:complexity` exit 1 — `New violation: [complexity] packages/devops/src/deploy/ops-runner.ts:151 runDeployOps (11)`
- no typecheck/test/guard/size regressions.

### B
- vitest: `packages/devops/src/checks/__tests__/hardwiring-node.test.ts` > "review lg: shared Node adapters > the shared generator writes exact current debt and preserves the occurrence ratchet"
  — first error: `AssertionError: expected [] to include '[hardwiring] HW3-module-state: 2 total; 1 new'` (hardwiring-node.test.ts:96). B modified `src/checks/hardwiring-node.ts` (23 lines); A did not and passes.
- `pnpm check:complexity` exit 1 — `New violation: [complexity] packages/devops/src/deploy/ops-runner.ts:153 runDeployOps (11)` (same function as A, line shifted by 2).
- no typecheck/guard/size regressions.

## Summary
Both branches are clean on typecheck/guard/size. Both add the same complexity-ratchet violation (`runDeployOps`, complexity 11; the overload signatures changed to `optional?:`). B additionally breaks 1 devops test. A is the cleaner of the two (1 regression vs 2).
