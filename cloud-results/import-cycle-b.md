# import-cycle-b — Jini part (2026-11-18)
Branch `refactor/import-cycle-b` from `origin/refactor/terra` `4c1892368`. Full report: Tovu `cloud-results/import-cycle-b.md`.

| SHA | Step |
|---|---|
| `03c3529bc` | J2 commit 1: leaf `agent-executor/mcp-json-file.ts` (`JINI_MCP_SERVER_KEY`, `McpJsonServerEntry`, `mergeMcpJsonContent`, default read/write/remove) moved verbatim; 12 importers repointed; public `mergeMcpJsonContent` kept in `index.ts` from the leaf |
| `0ad345d30` | `scripts/runtime-cycle-debt.json` emptied (R14 requires it) |
| `f2e432b91` | J2 commit 2: two `export … from` lines deleted; `launch.ts`, `index.ts`, 2 tests repointed |

Gates: `npx tsc -p tsconfig.json --noEmit` (packages/daemon) 0 errors; `npx vitest run --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=2` (packages/daemon) 236 files / 4729 pass / 1 skipped, before and after commit 2; `pnpm guard` exit 0 (before commit 1 it failed with the 4 R14 "delete the entry" lines, as designed). `--maxWorkers=2` conflicts with the daemon vitest config (minThreads).
Deviation: the leaf imports `isRecord` from `./values.js` (A7.4 says node built-ins + core/protocol only); lane K must move it or switch to core. Left: nothing for J2. Next: lane K (moves the leaf to agent-runtime, A7.4 handoff).
