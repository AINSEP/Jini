# W2 chat — coordinator progress

- Coordinator branch: `cloud/w2-chat` (from origin/general-work). STEP 0: `Linux vm /home/user/Jini`, 2026-10-20T01:25Z.
- Personas loaded by coordinator: software-architect/skills.md, code-inspection/skills.md (../AI-Dev-Shop at /home/user/AI-Dev-Shop).
- Setup: install + `pnpm --no-bail -r build` = 136 s; only @jini-ai/integrations tsc failed (dist emitted, 36/36 dist).
- Baseline (unmodified tree): `tsc --noEmit -p packages/chat` green; lot test files 17 files / 231 tests green.
- Temp eslint config: `eslint.cx.tmp.mjs` at repo root (untracked, never commit).

## Baseline violations (cyc/cog limit 10)
| lot | worst before |
|---|---|
| L187 | decodeCursor cyc 23; toMessage cyc 12/cog 11; read cyc 11 |
| L208 | newTabLinkHref cyc 15; schedule cyc 12; useChatPane arrows cyc 12/11/11, cog 11 |
| L222 | readAgentPluginChatState cyc 13; tool-events cog 13; assistant-content cog 11; durable-projection cog 11 |
| L226 | frontend-session-bridge arrow cyc 17 |
| L250 | continuationRequest cyc 15 |
| L257 | startRun cyc 13; startByokRun cyc 11 |

## Lot status
| lot | status | subagent | commits | before→after | coverage | verify |
|---|---|---|---|---|---|---|
| L187 | MERGED | 1 | 485464e5 044e2a16 | decodeCursor cyc 23→≤10; toMessage 12/11→≤10; read 11→≤10 | 100/100/100 both (store branch 96.31→100) | eslint 0, tsc 0, store suite 20 files/223 tests green; cursor diff equivalent. NOTE: removed `?? fallback` defaults on schema-NOT-NULL cols (title_source, message_count, msg created_at) — out-of-contract null now yields createdAt:0 / undefined titleSource; flagged, accepted (DDL + ChatDatabase types forbid null) |
| L208 | MERGED | 1 | 7f0cb9f7 dae24c01 d114219f | useChatPane 12/11→≤10; newTabLinkHref cyc 15→≤10; schedule cyc 12→≤10 | 100/100/100 ×3 | eslint 0, tsc 0, 11 files/182 tests green; send-flow rewrite checked line-by-line vs old: equivalent. Tests 88→107 |
| L222 | MERGED | 1 | 0ba4ede2 dbd21a0c e4830aa0 899b9854 | readAgentPluginChatState cyc 13→7 (commit msg says 13→3, wrong; file worst captureAgentPluginUsage 8/2); dedupeToolUsesById cog 13→6 (cyc 10, at limit); assistantContentFromEvents cog 11→9; mergeRunEvents cog 11→8 | 100/100/100 ×4 | eslint 0, tsc 0, 107 tests green; diff read branch-by-branch: equivalent. Tests 20→86 |
| L226 | MERGED | 1 | 52cd96d6 | listener cyc 17→8 (worst now serveLocally 8/6) | 100/100/100 (branch 97.14→100) | eslint 0, tsc 0, 51 tests green; removed unreachable caller-signal merge in internal default send (verified only caller passes no signal) |
| L250 | MERGED | 1 | 0f11b6d2 | continuationRequest cyc 15→8 (worst helper 8/6) | 100/100/100 | eslint 0, tsc 0, 18 tests green, diff read: behaviour-equivalent, why-comments moved |
| L257 | MERGED | 1 | 58e3a508 | startRun cyc 13→≤9, startByokRun 11→≤9 (file worst 9/7) | 100/100/100 | eslint 0, tsc 0, 8 files/151 tests green; git-mv of 2 loose tests into assistant-client/__tests__; diff read: equivalent (dropped unreachable `userMessage ? : base` fallback since startRun already throws). Stale comment "re-exported here" kept per rule |

## Problems / notes
- BUG (L208, pinned not fixed): useChatPaneRuntimeInventory with retryDelaysMs: [] retries failed listAgents after 0 ms → tight loop against an unreachable host.
- BUG (L222, pinned not fixed): captureAgentPluginUsage stores a state lacking `decision`; next read rejects it and resets, losing exclusions. Test "...(reported, not fixed)" in agent-plugin-chat-state.test.ts.

## Next
- 01:33Z: 5 subagents dispatched (L187,L208,L222,L226,L250); L257 worktree prepped, queued. Briefs at /tmp/claude-0/brief-<LOT>.md (not tracked).

## Final (01:53Z)
- All 6 lots merged into cloud/w2-chat; parallelism 5 (L257 started when L250 finished).
- `pnpm --filter @jini-ai/chat build` green; whole package suite (`--maxWorkers=4`): 184 files passed, 1 skipped (pre-existing `ChatPane.long-transcript.bench.test.tsx` bench, untouched) — 2580 passed / 1 skipped, 264 s. tsc green.
- Diff vs origin/general-work touches only lot files, their tests and this progress file (28 files, +2233/-320).
- Not fixed, for the owner: the 2 pinned bugs above; L187's dropped `??` defaults on NOT NULL columns; L187's create-path comment says "Unreachable" but a concurrent delete reaches it (comment kept, inaccurate); L257's stale "re-exported here" comment kept.
- Next: nothing pending for wave 2 chat. Lot branches cloud/w2-chat-L* can be deleted after review.
