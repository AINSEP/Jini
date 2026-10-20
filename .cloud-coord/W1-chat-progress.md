# W1 `chat` — coordinator progress

Branch: `cloud/w1-chat` (from `origin/general-work`). Lot branches: `cloud/w1-chat-<LOT>`, worktrees `/home/user/wt-<LOT>`.
Setup: 155 s (`pnpm install --frozen-lockfile && pnpm --no-bail -r build`; only `integrations` fails tsc, dist still emitted).
Baseline (unmodified tree): `tsc --noEmit -p packages/chat` clean; temp eslint (cyc/cog ≤10) on all lot files = 92 violations.

## Lots

| Lot | Scope | Before worst cyc/cog | After | Coverage | Commits | Status |
|---|---|---|---|---|---|---|
| L046 | core (files) | 20/25 (turn-usage conversationUsage) | | | | running |
| L072 | store/runtime | 28/25 (history-tools assistant_chat_read) | | | | running |
| L076 | embed-widget | 24/31 (fetch-sse startRun arrow) | 10/10 | 100/100/100 | f92068f7, b4625689, 146cb87d | merged ✓ (eslint 0, tsc ok, 51 files/741 tests) |
| L081 | chat-pane/components | 32/22 (ChatPane / AgentRuntimePicker) | | | | running |
| L098 | react (files) | 27/35 (message-blocks interleaveMessageBlocks) | 10/10 | 100/100/100 | b3dcd5c9, 028d8986 | merged ✓ (eslint 0, tsc ok, 41 tests) |
| L120 | store/legacy | 31/24 (messages.ts arrow) | | | | running |
| L150 | react/hooks | 15/17 | | | | running |
| L168 | core/run-events | 18/16 (chunkEvent) | | | | queued |
| L184 | server | 14/13 (recover decide) | | | | queued |
| L185 | chat-pane (files) | 17/12 (uploadAttachments) | | | | queued |

## Problems / notes

## Next
Wait for running lots; verify + merge each; start queued lots as slots free (≤5 parallel).
