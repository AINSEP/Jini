# W1 `chat` — coordinator progress

Branch: `cloud/w1-chat` (from `origin/general-work`). Lot branches: `cloud/w1-chat-<LOT>`, worktrees `/home/user/wt-<LOT>`.
Setup: 155 s (`pnpm install --frozen-lockfile && pnpm --no-bail -r build`; only `integrations` fails tsc, dist still emitted).
Baseline (unmodified tree): `tsc --noEmit -p packages/chat` clean; temp eslint (cyc/cog ≤10) on all lot files = 92 violations.

## Lots

| Lot | Scope | Before worst cyc/cog | After | Coverage | Commits | Status |
|---|---|---|---|---|---|---|
| L046 | core (files) | 20/25 (turn-usage conversationUsage) | 10/7 | 100/100/100 (6 files) | 4b45c6d0, 8ebf7133, 15e1f919, 76ffb858, 2171e817, f2ace699, f681f785 | merged ✓ (eslint 0, tsc ok, 13 files/208 tests) |
| L072 | store/runtime | 28/25 (history-tools assistant_chat_read) | 10/6 | 100/100/100 | c1d3a7d4, bf899b33, 6bd0c44d | merged ✓ (eslint 0, tsc ok, 4 files/115 tests; +2 new test files, ~82 new tests) |
| L076 | embed-widget | 24/31 (fetch-sse startRun arrow) | 10/10 | 100/100/100 | f92068f7, b4625689, 146cb87d | merged ✓ (eslint 0, tsc ok, 51 files/741 tests) |
| L081 | chat-pane/components | 32/22 (ChatPane / AgentRuntimePicker) | ≤10/≤10 | 100/100/100 (ChatPane needs hooks/__tests__/secret-redaction.test.tsx in run) | faa0e0d4, a455b3ef, 6e770ec8, eb03d2a3 | merged ✓ (eslint 0, tsc ok, 96 tests; 1 pre-existing skipped bench) |
| L098 | react (files) | 27/35 (message-blocks interleaveMessageBlocks) | 10/10 | 100/100/100 | b3dcd5c9, 028d8986 | merged ✓ (eslint 0, tsc ok, 41 tests) |
| L120 | store/legacy | 31/24 (messages.ts arrow) | ≤10/≤10 | 100/100/100 | 2c38e718, 1ca54c5a | merged ✓ (eslint 0, tsc ok, 18 files/186 tests; server legacy-sqlite 68/68 per agent) |
| L150 | react/hooks | 15/17 | | | | running |
| L168 | core/run-events | 18/16 (chunkEvent) | 10/10 | 100/100/100 (was 95/81/96) | cb7789da | merged ✓ (eslint 0, tsc ok, 11 files/182 tests) |
| L184 | server | 14/13 (recover decide) | | | | running |
| L185 | chat-pane (files) | 17/12 (uploadAttachments) | 8/6 | 100/100/100 | fbc0eed7, 7a10af80 | merged ✓ (eslint 0, tsc ok, 3 files/91 tests) |

## Problems / notes
- L185 (out of scope, flagged): `rules.ts findMidRunMessageRunId` accepts an `attachmentCount` it never uses; only caller `hooks/useChatPane.hooks.ts`. Pinned (not a bug): selected-but-unavailable agent returns `agent-unavailable` even when API mode is configured.
- L081: removed unused `conversationError` prop of internal ChatPaneStatusMessages and never-passed `useTip` prop of internal RuntimeDropUp. Markup proven identical with temp old-vs-new tests (deleted).
- L120: `getConversation` now reuses the list summary SQL filtered by id (1 query instead of 3); output values identical, object key order now `totalDurationMs` before `latestRun` (same as list).
- L072: older history-tools tests still use bare `rejects.toThrow()`; specific-message versions were added beside them (old ones left, not weakened). bf899b33 message says cog 25→8, measured 6.
- BUG pinned (L046): `transcript.ts` with `highInputTokenWarningThreshold: 0` warns about "0 input tokens" even when no run reported usage (test "... (reported, not fixed)").
- L046 commit 4b45c6d0 message has estimated numbers (16→7/6→5); measured composer-history is 16→10 cyc, 9→6 cog. Not amended (no force-push).

## Next
Wait for running lots; verify + merge each; start queued lots as slots free (≤5 parallel).
