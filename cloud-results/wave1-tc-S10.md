# wave1 tc-S10: chained batch handler in core (Jini only)

Branch `wave1/tc-S10` (Jini). Base `origin/integ/merge-final-2026-11-16` = `65d73b0d` (ancestor check: ok). Tovu not touched, not checked out for build.
Environment: Node v24.22.3, pnpm 10.33.2. `pnpm install --frozen-lockfile` and `pnpm --no-bail -r build` succeeded.
Drift check (Jini rows of BLOBS.tsv): no `DRIFT` line, so `approval.ts` is the planned blob (400 lines).

## Steps and SHAs
| Step | SHA | What |
|---|---|---|
| Characterization | `c46d03c2` | `approval.batch-same-target.characterization.test.ts` + shared fake `batch-chain-store-fake.ts` |
| Red-first + change | `402d81a7` | `approval-batch-chain.ts` (102 lines), `approval-batch-chain.unit.test.ts` (11 tests), `expandBatchContexts` exported, `core/package.json` entry, knip, README, CAPABILITIES |

## Inventory (block 4.2)
- `approval.ts:191 createPreparedBatchHandler`, `:228 createBatchApprovalHandler` (prepare loop 238-245, run loop 257-265).
- `batch-tool-inputs.ts`: `BatchItemResult:60`, `batchOutcomeFor:86`, `withBatchInput:323`. Existing tests: `batch-approval-direct`, `batch-approval`, `batch-tool-inputs`, `batch-tool-outcomes`.

## Characterization result (DESIGN "not verified" item 7)
Three items on one key, `run` refuses on a stale pinned version: item 1 applied (`bytes == '1'`), `run` called for items 1 and 2 only, the call **throws** item 2's error (rejects; nothing returned), item 3 never runs, no per-item account.
Mutation that turns it red: catch the `steps.run` error in the `createBatchApprovalHandler` run loop and push a result. Result: "promise resolved ... instead of rejecting". Restored.

## Red-first (before the change)
`Error: Failed to load url ../approval-batch-chain.js ... Does the file exist?` (no such module/function). Not committed alone.

## Mutation proofs on the new code (each restored)
- no chaining (never call `successor`): 4 tests red (chain order, B keeps pin, successor-computed window, committed-undefined).
- failed key not recorded: 2 red (async-preparation window, A1 own failure).
- skip every key after any failure: 1 red (B1 must still run).
- no abort check between items: 1 red (abandoned outcome).
- wrong `previous`: 3 red.

## Gates (Jini) at `402d81a7`
`pnpm guard` ok; `pnpm typecheck` clean; `npm --prefix packages/core run test`: **before 197 files / 2934 tests; after 199 files / 2946 tests** (+1 characterization, +11 unit; none removed or skipped). `check:size` ratchet passed.
Blocks 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.15, 4.16, 4.17: all print nothing (4.16 files checked: `approval-batch-chain.ts`, `approval.ts`).
Block 4.9: `import('@jini-ai/core/approval-batch-chain')` from `packages/daemon` after build exits 0 and exposes `createChainedBatchHandler`; no `node:` import in the file.
4.10: `Blocking decision: none`. 4.12 / 4.14: not applicable. No STOP fired.

## Ten acceptance cases (unit test)
1 order + `successor` args + zero reads by core (store read count equals the 3 prepares). 2 A1,B1,A2. 3 `targetKey` called with `{ prepared }` only, distinct keys never chain. 4 foreign write before successor: A2 gets the host stale text, A1 stays. 5 foreign write after successor: same. 6 foreign write during async preparation: A1 stale, A2 `Skipped: an earlier change to this file in the same call failed.`, nothing written. 7 A1 own failure: A2 skipped, B1 runs. 8 `committed: undefined`: successor receives `committed: undefined` and `previous` (the predecessor's own pin). 9 abort between items: throws `This tool call was abandoned before the next change. Retry the remaining changes when ready.`, nothing after runs. 10 existing handlers untouched (their test files pass; characterization unchanged). Extra: single call returns output unchanged and its failure propagates; duplicates (`Duplicate batch inputs are not allowed.`) and item cap (`items must contain between 1 and N inputs.`) still refuse before any preparation.

## Sentences (old -> new)
No existing sentence changed. New: `Skipped: an earlier change to this <targetNoun> in the same call failed.` (default noun `target`; the abandoned sentence is reused verbatim from `createPreparedBatchHandler`).

## Exports for REL (Tovu consumes in S11)
New entry `@jini-ai/core/approval-batch-chain`: `createChainedBatchHandler`, types `ChainedBatchSteps`, `PrepareStep`. `expandBatchContexts` is now exported from `approval.ts` and therefore from the core root (`export *`); one-word change, no copy, `approval.ts` still 400 lines.

## Deviations / notes
- `run`'s second parameter is typed `ToolExecutionOptions` (the sheet says `object`) so a host can reach `invokeTool` etc.; it is a subtype, method-syntax declaration, callable as the sheet shows.
- Batch result is exactly the sheet's `{ batch: true, total, results }` (ok items carry `result: output`, failed items `error`); no `outcome/succeeded/failed` fields, `batchOutcomeFor` derives the outcome (tests assert `completed`, `partial_failure`, `error`).
- `committed: undefined`: core still calls `successor` with `committed: undefined` and `previous`; the host's `successor` chooses the predecessor's pin (the test fake does `committed ?? previous.pinned`). Core does not itself skip the call.
- A throw from `successor` is recorded as that item's failure (not swallowed, not rethrown).
- Not verified: Tovu adoption (S11), and the real `writeFileAtomically` digest-before-rename value.

## Next step
S11 (Tovu theme tools adopt `createChainedBatchHandler`) after REL publishes core.
