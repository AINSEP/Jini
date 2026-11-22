# tc-wave2b (Jini side): S17 exclusive-run-lease

Branch `wave2/tc-b`, base `origin/refactor/terra` = `65d73b0d5a43`. Full report (both repos, every gate with its command and result): `cloud-results/tc-wave2b.md` on the Tovu branch `wave2/tc-b`.

- `f40bd7b9` feat(daemon): `packages/daemon/src/exclusive-run-lease.ts` + `__tests__/exclusive-run-lease.unit.test.ts` (4 cases, red first: "Failed to load url ../exclusive-run-lease.js").
- `86cc7d25` chore(daemon): `exports["./exclusive-run-lease"]` and `jini.entries["./exclusive-run-lease"] = "universal"` (left unstaged in the first commit by mistake; same push).
- Gates: `pnpm guard` ok, `pnpm typecheck` rc=0, `check:size`/`check:complexity`/`check:errors` rc=0, `check:hooks` rc=1 exactly as on the base (BASE-RED). Daemon tests with `npx vitest run --poolOptions.threads.maxThreads=2 --poolOptions.threads.minThreads=1 --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=1`: 4726 passed, 1 skipped (base 4722). Vitest 2.1.9 rejects `--maxWorkers` here (RangeError).
- Block 4.9: after `pnpm --filter @jini-ai/daemon build`, `await import('@jini-ai/daemon/exclusive-run-lease')` from `packages/daemon` and `packages/server` prints `[ 'createExclusiveRunLease' ]`; no `node:` import in the entry. Blocks 4.3 to 4.7, 4.15 to 4.17 print nothing; eslint 50/10/10/500 limits clean on the new file.
- New export for REL: `@jini-ai/daemon/exclusive-run-lease` (`createExclusiveRunLease`, types `ExclusiveRunLease`, `ExclusiveRunLeaseAcquisition`).
