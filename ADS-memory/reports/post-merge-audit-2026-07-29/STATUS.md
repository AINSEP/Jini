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
| `agentic` | 7 | Fix-agent running locally as of this writing (see risk note below) | `fix/post-merge-audit-agentic-2026-07-29` (local only, never pushed) |
| `agentic` (cloud backup) | 7 | Queued — redundant safety net in case the local run above didn't finish, cloud routine `trig_01BQ8njKGmdrc2XESkdDGArU`, fires 2026-07-30 04:30 PDT | `fix/post-merge-audit-agentic-cloud-2026-07-30` |
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
3. **Risk note on the locally-running `agentic` fix-agent**: unlike the 4 cloud routines, it runs in
   a local git worktree on this specific machine, so it depends on this session/laptop staying alive
   until it finishes and is only committed (not pushed) when done. If the laptop sleeps or the
   session ends before it completes, that work may be lost or left mid-flight with nothing to
   recover — there's no incremental checkpoint, only a single commit at the end. The
   `fix/post-merge-audit-agentic-cloud-2026-07-30` cloud routine above exists specifically as a
   redundant safety net for this scenario. If BOTH the local branch and the cloud branch end up with
   real fixes by morning, reconcile by comparing the two rather than assuming either is authoritative.
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
