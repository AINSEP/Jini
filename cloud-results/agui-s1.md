# agui-s1 — AG-UI S0 goldens and S1 consolidation

Run date: 2026-11-16. Status: **PARTIAL.** S0 is done except two site scenarios. S1 is done for A1, A4, B1, B2, C1, C2. A2 is blocked by the debt ratchets, A3 was not started, B3 and B4 wait on open owner decisions. Nothing from S2 onward was touched.

Branch `refactor/agui-s1` in both repos, from `origin/refactor/terra` (Jini `02edbb68`, Tovu `80b00f5b`). No force-push, no `--no-verify`, no subagents. No test process was left running.

## Commits

| Repo | SHA | Step | What |
|---|---|---|---|
| Jini | `18a150a6` | S0 | T0-2 reducer drift, T0-3 round-trip golden, T0-6 bridge replay and cancel (tests only) |
| Tovu | `7cc450c1` | S0 | T0-1 admin wire golden, T0-5 exact cancel counts, T0-2 host half (tests only) |
| Tovu | `bbd868dd` | S0 | T0-4 site chat golden (tests only) |
| Jini | `4c2ce043` | A1 | `ag-ui/entry.ts` split into `event-projection.ts` and `event-reduction.ts`; new subpath `./core/ag-ui/reduction` |
| Tovu | `f59e3f2e` | A1 pair | admin test takes the reverse names from `/reduction`; the admin type re-export shell is deleted |
| Tovu | `472e381f` | B1 | the route calls `translateRunAgentPayload`; Tovu's reducer and dispatch table are deleted |
| Jini | `8173197f` | B2 | `reduceAgentWirePayload` and `RunAgentWirePayload` deleted from `event-projection.ts` |
| Jini | `3b963dbd` | A4 + C1 (Jini half) | `ag-ui/run-input.ts` with 7 unit tests; real subpath `./server/ag-ui/run-input` |
| Tovu | `1cf25dd7` | C1 | the route parses with Jini's `resolveAgUiRunInput`; the local parsers are deleted |
| Tovu | `18038b18` | C2 | the three forwarders and the type re-export are deleted; one host value `AG_UI_TRANSLATION` |

Tovu `assistant-ag-ui.ts`: 670 → 503 lines. Each Tovu commit message names the Jini SHA it builds on. Three patch changesets were added in Jini (`chat-ag-ui-split-entry`, `chat-ag-ui-one-reducer`, `chat-ag-ui-run-input`).

## Wire bytes

The T0-1 golden changed in exactly one commit, B1, and only by the two differences the design lists:

- `CUSTOM tovu.ext.tool_input_delta` no longer appears.
- an `mcp-ui` resource gains `_meta["jini/surface-exchange"]` when the daemon sent `surfaceExchange`.

Headers and the other four scenarios were byte-identical across B1. A1, C1 and C2 pass against the golden without regenerating it. The run brief asked for bytes identical to the S0 goldens and also for one reducer (OD-2). Those two cannot both hold, so the B1 diff above is the deliberate exception.

## Pins and mutation proof

Every pin was green on the unmodified tree, then run red against a local mutation, then the mutation was reverted.

| Pin | File | Mutation that turned it red |
|---|---|---|
| T0-1 admin wire golden (5 scenarios, bytes + HTTP/1.1 headers) | Tovu `server/__tests__/assistant-ag-ui-wire.golden.test.ts` | `x-accel-buffering` value changed and an extra field on `RUN_FINISHED`: 5 of 5 scenarios red |
| T0-2 reducer drift | Jini `ag-ui/__tests__/reducer-drift.unit.test.ts` | the copy made to drop `tool_input_delta`: 1 red |
| T0-3 round-trip golden + design §5.1 examples parsed with the 0.0.58 schemas | Jini `ag-ui/__tests__/ag-ui-round-trip.golden.test.ts` | status `data` removed from the projection: 2 red |
| T0-4 site chat golden (6 scenarios) | Tovu `server/__tests__/site-chat-stream.golden.test.ts` | extra field on the `end` frame: 5 red |
| T0-5 cancel windows, exactly one cancel | Tovu `server/__tests__/assistant-ag-ui-routes.test.ts` | a doubled cancel call in the close handler: the three abort windows red |
| T0-6 bridge replay and cancel | Jini `embed-widget/browser/__tests__/frontend-session-bridge.replay-cancel.test.ts` | replay check disabled: 1 red; `cancelled` frame ignored: 1 red |
| A4 `run-input` unit tests | Jini `ag-ui/__tests__/run-input.test.ts` | binding length bound off by one, loose `secretRedacted` check, leading instead of trailing history: 3 red |

## Gates at the end of the run

| Gate | Result |
|---|---|
| Jini `@jini-ai/chat` full suite | 4410 passed, 1 skipped (302 files) |
| Jini `pnpm -r typecheck` | 0 errors |
| Jini `pnpm guard`, `check:size`, `check:complexity`, `check:log-safety` | pass |
| Tovu AG-UI suites (routes, translate, wire unit, wire golden) | 62 of 62 |
| Tovu admin `assistant-transport.ag-ui` + `AssistantDock.hooks` | 225 of 225; admin `tsc` 0 errors |
| Tovu `tsc` root and `tsconfig.tests.json` | 0 errors |
| Tovu `check:size` | **exit 1** |
| Tovu `check:complexity` | **exit 1** |
| Tovu `check:boundaries` | **exit 16** (16 errors, 95 warnings) |

The three red Tovu gates name no file this run touched: stale debt entries, admin complexity (`App.tsx`, `Plugins.tsx`, …) and `no-deep-imports` in feature folders. I did not run them on a clean `refactor/terra` checkout, so "already red before this run" is inferred from the file names, not measured.

## Deviations and stops

1. **A2 stopped (move `ag-ui-transport.ts` → `ag-ui/client/run-client.ts`).** The design says to move the two debt entries by hand. Both ratchets key debt by path and compare against the base commit, so the moved entries are reported as new debt: `check:size` (`createAgUiRunClient`, 113 lines) and `check:log-safety` (`stored-error-text`, 1). CI uses the PR base, so the move would fail there. A3 would clear the size entry. The log-safety entry is the `String(error)` inside the Observable's `error:` callback, which error-system E8 is scheduled to change at the final path, so the two steps block each other. The move was made, tested (214 of 214) and reverted; nothing of it is committed.
2. **A3 not started** (split `createAgUiRunClient`). It is valid in place and would remove the size debt entry.
3. **B3 skipped: OD-9 is open.** Tovu's four frame handlers, `parseDaemonFrame`, `readDaemonSseFrames` and its own `terminalReasonNotice` stay. T0-1 already holds the frame cases, so the B3 diff will be visible.
4. **B4 skipped: OD-3 is open.** The X4 field map (`status.data`, `RUN_ERROR.error`) rides with B4 and E8. T0-3 already pins `status.data` round-tripping exactly.
5. **"Move the agentic projection" not done.** Design rev 2 moves `agentic/src/core/ag-ui.ts` in S4, when it gets a user; the run brief listed it under S1. I followed the reviewed design.
6. **"Frame source" not done.** `daemon-frames-source.ts` is design step 2.4 (S2); the frame parsing swap is B3.
7. **T0-4 is short two scenarios:** confirmation expiry (needs the exchange store's timer injected through the module) and a successful `page.navigate` (needs an attached page session). The file header says so. Both are needed before S5.
8. **T0-6 did not exist.** The design lists `bridge-replay` and `bridge-cancel` as existing tests; no test covered either property, so both were written.
9. **T0-2 is split across the repos.** Jini cannot import Tovu's copy, so the Tovu copy was pinned in Tovu. That file (14 cases) was deleted in B1 with the copy it compared; Jini's file keeps every row as a single-reducer test.
10. **T0-3 frames bytes by hand** (`data: <json>\n\n`): `@ag-ui/encoder` is not a dependency of `@jini-ai/chat`. The real encoder is pinned by T0-1.
11. **`AgUiRunInput` optional fields** are typed `string | undefined` (key always present), which is what Tovu's object had; Jini's `exactOptionalPropertyTypes` rejects the `?:` form for that shape.

Test-count changes: Tovu translate 20 → 21 (one case split), wire unit 3 → 2 (parsing case moved to Jini), host drift file 14 → 0 (deleted with the copy). Jini ag-ui + conversation-cost 63 → 62 in B2 (one check folded into its row), plus 7 new `run-input` cases.

## Next step

Decide A2: either let the ratchets accept a renamed path, or land A3 and E8's change to the `error:` callback first and move the file after. Then A3, and B3 / B4 once OD-9 and OD-3 are answered.
