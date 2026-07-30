# Post-merge audit — feat/agentic-capability-layer → main (085c4799a) — status

Independent post-merge security/correctness audit of the `feat/agentic-capability-layer` → `main`
merge (base `9cb4ffc50`, merge commit `085c4799a`). Dispatched via OpenAI Codex (`gpt-5.6-sol`,
high/xhigh reasoning) as an independent peer reviewer, one dispatch per package/group, each
instructed to reproduce suspected issues (not just reason statically) before reporting them. Every
finding below that a fix-agent has touched was independently re-verified against current source
before any fix was written — see each package's own fix-agent report for what was confirmed real
vs. false positive.

Fixes follow test-first (TDD) discipline: a failing test demonstrating the bug is written and run
BEFORE the fix, then the fix is applied and the test (plus the package's full suite) is re-run green.

## Status as of 2026-07-30 ~09:35 PDT — DONE: all 7 branches reconciled and merged to `main` (`7fab9f42a`)

All 4 findings tables below are historical — everything in this report has landed on `main` and
been pushed to origin. The three-way `agent-executor.ts` conflict flagged below was resolved by
hand (not blind-merged): `mcpJsonPathForRun`'s run-scoped path was threaded through
`buildMcpBridgeDelivery`'s `'claude-mcp-json'` case so the credential-leak fix (B1) and the
4-strategy generalization compose correctly; the duplicate `buildArgs` try/catch guard (B2 ==
AR-2, found independently by both the daemon and agent-runtime-mcp audits) was de-duplicated to
one copy; one test assertion was updated for the run-scoped path filename change, and one test
`describe` block gained a de-duplicated superset of both branches' assertions. Full verification
after every merge step: `@jini-ai/daemon` 716/716, `@jini-ai/agent-runtime` 1876/1876,
`@jini-ai/mcp` 369/369, then a full `pnpm -r typecheck` (31/31 projects) and `pnpm -r test`
workspace-wide (exit 0) after all 7 branches landed, plus `pnpm guard` clean. One non-conflict
snag: `packages/server`'s typecheck failed against a stale `@jini-ai/http-kit` `dist/` (this
repo's known "workspace packages resolve through built dist, not source" gotcha) — fixed with
`pnpm -r build`, not a code change.

All 7 branches, the 7 now-redundant worktrees tied to them, and the associated origin branches
have been deleted post-merge. `main` is the only place this work lives now.

## Status as of 2026-07-30 ~09:15 PDT — all 4 queued routines done; merge coordination now the blocker (superseded above)

| package | blocking findings | status | branch |
|---|---|---|---|
| `server` | 6 | **Fixed** (6/6 real, all fixed + 2 non-blocking) | `fix/post-merge-audit-2026-07-29` |
| `chat-core` | 2 | **Fixed** (1/2 real+fixed, 1 false-positive-on-mechanism/doc-fixed) | `fix/post-merge-audit-2026-07-29` |
| `agentic` | 9 (7 blocking found + 2 non-blocking; local agent found 2 *additional* real holes while verifying finding #1 and #6, see its branch's commit message) | **Fixed** (9/9 real, zero false positives — pushed to origin) | `fix/post-merge-audit-agentic-2026-07-29` |
| ~~`agentic` (cloud backup)~~ | — | **Disabled/cancelled** (`trig_01BQ8njKGmdrc2XESkdDGArU`) — the local run above finished and was pushed before this fired, so the redundant safety net was no longer needed | ~~`fix/post-merge-audit-agentic-cloud-2026-07-30`~~ (never ran) |
| `daemon` | 7 | **Fixed** — cloud routine `trig_01LKsrqn1uQ4xZn3F1ZhkqUY` completed and pushed (commit `c3390edea`, "close 7 real findings") | `fix/post-merge-audit-daemon-2026-07-30` |
| `agent-runtime` + `mcp` | 6 | **Fixed** — cloud routine `trig_01Ji2QriSVA5Y7NBTWejnWr3` completed and pushed (commit `da71faaa0`, "resolve all 6 findings") | `fix/post-merge-audit-agent-runtime-mcp-2026-07-30` |
| `http-kit` | 12 | **Fixed** — cloud routine `trig_01P3obaCLTpMqEq6aTMPaN1N` completed and pushed (commit `5a6da50e2`, "resolve 11 of 12; refute 1") | `fix/post-merge-audit-http-kit-2026-07-30` |

Routine status/logs: https://claude.ai/code/routines (each routine ID above links to its own run).

### Unplanned 7th branch: MCP bridge delivery generalization

Separately from the audit above, the working tree on `main` had uncommitted local WIP left over
from before the cloud routines were dispatched — a generalization of the `a490e6775` MCP
auto-discovery fix (which only patched `claude.ts`) to all four `externalMcpInjection` strategies
(`claude-mcp-json` for claude+codebuddy, `acp-merge` for the 8 ACP-native defs, and the
opencode/mimo env-content mechanisms). Verified green (agent-runtime: 1858 tests, daemon: 687
tests, both typecheck clean, `pnpm guard` zero violations) and committed to its own branch,
`fix/mcp-bridge-delivery-all-strategies-2026-07-30` (commit `8239f1af2`), pushed to origin. Not
merged, no PR — same checkpoint discipline as the rest of this batch.

### ⚠️ Merge-conflict warning before landing any of these

`packages/daemon/src/agent-executor.ts` (+ its test file) is independently modified by **three**
of the branches above: `fix/post-merge-audit-daemon-2026-07-30`,
`fix/post-merge-audit-agent-runtime-mcp-2026-07-30`, and
`fix/mcp-bridge-delivery-all-strategies-2026-07-30`. These will conflict with each other on merge —
none has been merged into another, so pick a merge order and resolve by hand (or re-dispatch a
rebase) rather than merging blind. The other 4 branches (`server`/`chat-core`, `agentic`,
`http-kit`) don't share touched files with each other or with these three.

**Total: 35 BLOCKING findings.** Every finding independently spot-verified by the coordinating
session before dispatch has come back real (server: 2/2 checked, agentic: 3/3 checked, http-kit:
2/2 checked, agent-runtime: 1/1 checked — 8/8 hit rate). This does not guarantee every remaining
finding is real; each fix-agent is instructed to independently re-verify before touching code, and
to report a finding as a false positive (with reasoning, no code change) rather than force a fix.

## What to check in the morning (historical — all resolved, see status table above)

1. Each branch above (once its fix-agent has run) has its own local commit(s) with a full report
   in the commit message: which findings were confirmed real vs. false positive, the failing-test
   output before the fix, and the passing output after. None of these branches are merged into
   `main` and none have PRs opened — that's a deliberate human checkpoint.
2. The 4 scheduled runs (`daemon`, `agent-runtime`+`mcp`, `http-kit`, `agentic`-cloud-backup) are
   **cloud** agents (via Claude Code routines / `RemoteTrigger`, model `claude-opus-5`) — they run
   in Anthropic's cloud infrastructure, not on this machine, so they do NOT depend on this laptop
   staying on. Each one clones `main` fresh, creates its own branch, and — unlike a local worktree —
   MUST push that branch to `origin` for its work to be retrievable (the routine has no other way to
   hand back results). If a branch listed above doesn't exist on `origin` in the morning, that run
   failed or is still in progress; check https://claude.ai/code/routines for run status.
3. ~~Risk note on the locally-running `agentic` fix-agent~~ — resolved: it finished
   (9/9 findings real, 765/765 tests passing, 100% coverage on `packages/agentic`) and was pushed to
   `origin/fix/post-merge-audit-agentic-2026-07-29` before the cloud backup's 4:30 AM fire time, so
   the backup routine was disabled rather than left to run redundantly.
4. **Environment gotcha discovered by the `agentic` fix-agent, now patched into the 3 remaining
   routines' prompts**: a fresh checkout has no `node_modules`/`dist`, and this repo's vitest configs
   resolve some workspace packages (e.g. `@jini-ai/protocol`) through their `package.json` exports
   map rather than source — so tests can fail to even *collect* until `pnpm install --frozen-lockfile
   && pnpm -r build` has been run. Confirmed pre-existing (via `git stash` against a clean checkout),
   not caused by any fix. If a branch's report mentions this, it's expected, not a red flag.
3. The detailed technical brief each fix-agent worked from is in this same directory:
   `daemon-findings.md`, `agent-runtime-findings.md`, `http-kit-findings.md`, `mcp-findings.md`.
   Full Codex output (raw JSONL) for every dispatch, including the ones already fixed, is under
   `/Users/la/.claude/harness-tmp/claude-501/-Users-la-Programming-Jini/939a6e4e-b987-4bbe-baad-ac7e2cc75ba7/scratchpad/audit/`
   on this machine (session-scoped scratch, not in the repo) if deeper source material is needed.

## Not yet audited

`ui`, `chat-react` (beyond the transport.ts fix), `renderers-react`, `desktop-host`, `composio`,
`cli`, `core`, `protocol`, `registry`, `sqlite`, `artifacts`, `deploy`, `sidecar`, `memory`,
`platform`, `diagnostics` have not been through this Codex audit pass at all. Prioritization
reasoning (why `http-kit`/`daemon`/`agentic`/`agent-runtime`/`mcp` went first) is in the
conversation history that produced this report, not restated here.
