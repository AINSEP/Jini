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
| L150 | react/hooks | 15/17 | 9/8 | 100/100/100 | 84e7101e, 91a5887e, fe5ba7b7, 0d14137d, aae3c5a7 | merged ✓ (eslint 0, tsc ok, 10 files/220 tests) |
| L168 | core/run-events | 18/16 (chunkEvent) | 10/10 | 100/100/100 (was 95/81/96) | cb7789da | merged ✓ (eslint 0, tsc ok, 11 files/182 tests) |
| L184 | server | 14/13 (recover decide) | 9/7 | 100/100/100 | 68b5cdd5, 036a7a4a | merged ✓ (eslint 0, tsc ok, 15 files/267 tests; awaitingAnswer rewrite hand-checked equivalent) |
| L185 | chat-pane (files) | 17/12 (uploadAttachments) | 8/6 | 100/100/100 | fbc0eed7, 7a10af80 | merged ✓ (eslint 0, tsc ok, 3 files/91 tests) |

## Problems / notes
- BUG pinned (L150, root cause in core/util/strip.ts `splitStreamingArtifact`, outside lot): a still-open artifact following a closed one is reported complete, not streaming.
- BUG pinned (L150): composer-draft-cache resurrects cleared attachments from storage when `removeItem` throws (drafts likely same, not pinned).
- L185 (out of scope, flagged): `rules.ts findMidRunMessageRunId` accepts an `attachmentCount` it never uses; only caller `hooks/useChatPane.hooks.ts`. Pinned (not a bug): selected-but-unavailable agent returns `agent-unavailable` even when API mode is configured.
- L081: removed unused `conversationError` prop of internal ChatPaneStatusMessages and never-passed `useTip` prop of internal RuntimeDropUp. Markup proven identical with temp old-vs-new tests (deleted).
- L120: `getConversation` now reuses the list summary SQL filtered by id (1 query instead of 3); output values identical, object key order now `totalDurationMs` before `latestRun` (same as list).
- L072: older history-tools tests still use bare `rejects.toThrow()`; specific-message versions were added beside them (old ones left, not weakened). bf899b33 message says cog 25→8, measured 6.
- BUG pinned (L046): `transcript.ts` with `highInputTokenWarningThreshold: 0` warns about "0 input tokens" even when no run reported usage (test "... (reported, not fixed)").
- L046 commit 4b45c6d0 message has estimated numbers (16→7/6→5); measured composer-history is 16→10 cyc, 9→6 cog. Not amended (no force-push).

## Final verification (2026-10-20)
- `pnpm --filter @jini-ai/chat build`: ok (21 s).
- Whole chat suite on cloud/w1-chat: 193 files passed, 1 skipped (pre-existing bench) — 2819 tests passed, 1 skipped, 0 failures (344 s).
- Baseline origin/general-work: 182 files / 2384 tests passed, 1 skipped — so +11 test files, +435 tests, no regressions.
- `tsc --noEmit -p packages/chat`: clean. Cumulative temp eslint (cyc/cog ≤10) on all 34 lot files: 0 (was 92).

## Next
Wave 1 `chat` complete. Owner: review/merge `cloud/w1-chat` into general-work; decide on the 3 pinned bugs and the flagged `findMidRunMessageRunId` unused param.
