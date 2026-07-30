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

## Status as of 2026-07-29 ~22:40 PDT

| package | blocking findings | status | branch |
|---|---|---|---|
| `server` | 6 | **Fixed** (6/6 real, all fixed + 2 non-blocking) | `fix/post-merge-audit-2026-07-29` |
| `chat-core` | 2 | **Fixed** (1/2 real+fixed, 1 false-positive-on-mechanism/doc-fixed) | `fix/post-merge-audit-2026-07-29` |
| `agentic` | 9 (7 blocking found + 2 non-blocking; local agent found 2 *additional* real holes while verifying finding #1 and #6, see its branch's commit message) | **Fixed** (9/9 real, zero false positives — pushed to origin) | `fix/post-merge-audit-agentic-2026-07-29` |
| ~~`agentic` (cloud backup)~~ | — | **Disabled/cancelled** (`trig_01BQ8njKGmdrc2XESkdDGArU`) — the local run above finished and was pushed before this fired, so the redundant safety net was no longer needed | ~~`fix/post-merge-audit-agentic-cloud-2026-07-30`~~ (never ran) |
| `daemon` | 5 | Queued — cloud routine `trig_01LKsrqn1uQ4xZn3F1ZhkqUY`, fires 2026-07-30 03:00 PDT | `fix/post-merge-audit-daemon-2026-07-30` |
| `agent-runtime` + `mcp` | 2 + 1 = 3 | Queued — combined into one cloud routine (both small), `trig_01Ji2QriSVA5Y7NBTWejnWr3`, fires 2026-07-30 03:30 PDT | `fix/post-merge-audit-agent-runtime-mcp-2026-07-30` |
| `http-kit` | 12 | Queued — cloud routine `trig_01P3obaCLTpMqEq6aTMPaN1N`, fires 2026-07-30 04:00 PDT (largest — agent was told to prioritize by severity and report honestly if it can't finish all 12) | `fix/post-merge-audit-http-kit-2026-07-30` |

Routine status/logs: https://claude.ai/code/routines (each routine ID above links to its own run).

**Total: 35 BLOCKING findings.** Every finding independently spot-verified by the coordinating
session before dispatch has come back real (server: 2/2 checked, agentic: 3/3 checked, http-kit:
2/2 checked, agent-runtime: 1/1 checked — 8/8 hit rate). This does not guarantee every remaining
finding is real; each fix-agent is instructed to independently re-verify before touching code, and
to report a finding as a false positive (with reasoning, no code change) rather than force a fix.

## What to check in the morning

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
