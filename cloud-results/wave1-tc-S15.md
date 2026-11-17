# wave1 tc-S15: progress while a call waits; no hidden 300 s wall in the HTTP hop

Repo changed: **Jini only**. Branch `wave1/tc-S15`, base `origin/integ/merge-final-2026-11-16` = `65d73b0d` (Jini).
Tovu base `a28cb1bf` is an ancestor of `origin/integ/merge-final-2026-11-16` (`232764af`); Tovu was not touched, so no Tovu baseline or link step was run.
Plan: `origin/plan/tool-call-fixes-2026-11-16`, sheet `S15-progress-and-long-wait.md` (+ INDEX, DESIGN §2.9/M9, sheets/README).
Setup: Node 24.22.3 (nodejs.org, sha256 checked), pnpm 10.33.2 via corepack, `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build` (exit 0).
Drift check (BLOBS.tsv): no `DRIFT` line for any Jini row. Blocking decision: none. Prerequisites: none.

## Result: all steps done. The header-wait STOP did NOT fire.
Step 0b **proved** the second wall, so change 3 was built (44 lines, no dependency).
- Measured here (real local server withholding headers for 310 s, plain global `fetch`, Node 24.22.3):
  `FAILED after 300823 ms: fetch failed | cause: UND_ERR_HEADERS_TIMEOUT Headers Timeout Error`.
- Node 24.22.3 bundles undici 7.30.2, whose documented `headersTimeout` default is 300 000 ms. Unlimited is NOT the default, so the change stands.
- The 300 s script ran outside the repo (scratchpad `measure-wall.mjs`); the committed test uses the same wall at 200 ms.

## Commits (all pushed to `origin/wave1/tc-S15`)
| SHA | What |
|---|---|
| `6ed4fd19` | 0a: daemon characterization of the 120 s approval window (7 tests) |
| `d4ef8f9a` | 0b: real-server header-wait integration test (2 tests); pins failure text `fetch failed` |
| `13926918` | progress characterization (+ fixture `callWithExtra`) |
| `bd9b57a9` | change 1: `mcp/src/server/call-progress.ts` (79 lines) + 8 unit tests |
| `cddcf073` | change 2: wired into `createCallToolHandler` (+7 lines in `tool-server.ts`, 438 to 445), 6 server tests + 1 wire test, characterization updated 0 to 4 frames |
| `b044ae4a` | change 3: `loopback-fetch.ts` (44 lines) + `serve.ts` default `fetchImpl` + 9 tests + 1 serve test updated, 1 added |
| `99677518` | change 4: idle-exit test (1 test), no source change |
(report commit follows on the same branch)

## Gates and results
- Baseline (unmodified tree): `pnpm guard` ok, `pnpm typecheck` ok, mcp **1776** tests, daemon **4722** passed + 1 skipped (skip pre-existing).
- After: `pnpm guard && pnpm typecheck` ok; mcp **1805** passed; daemon **4729** passed + 1 skipped. No test deleted, skipped or weakened. Block 4.15 prints nothing.
- Gate honesty: commits 6ed4fd19, cddcf073, b044ae4a, 99677518 each had the full gate (mcp + daemon) run on their tree. d4ef8f9a, 13926918 and bd9b57a9 were gated together on one combined tree (guard, typecheck, mcp tests, 1787 passed) and committed as three files-disjoint units; daemon was not re-run for them (no daemon change, none imports mcp).
- Blocks 4.3, 4.4, 4.5, 4.6, 4.7, 4.15, 4.17 print nothing (run over the whole diff vs base). 4.8 (lost comments) prints nothing. 4.16 (50/10/10/500) prints nothing for `tool-server.ts`, `call-progress.ts`, `loopback-fetch.ts`, `serve.ts`. (A first draft of `call-progress.ts` had complexity 14 and a 90-line file; both fixed before commit.) 4.9 not applicable: no new cross-package symbol.
- Acceptance: step 0a's four tests pass **unchanged** after the pump (daemon dir has no diff after `6ed4fd19`).

## Red-first and mutation evidence
- 0a mutations (each turns the named tests red, file restored): window x2 (`APPROVAL_WAIT_TIMEOUT_MS * 2`) fails cases 1 and 2; removing the `approvalWindowUsed` guard fails both 0a.4 cases; `cancel()` not aborting fails case 3.
- Change 1 red: `Failed to load url ../call-progress.js` (module missing).
- Change 2 red (before wiring): `expected [] to deeply equal [ 25000 ]`, `expected [] to deeply equal [ {..} ]`, `expected +0 to be 1`. After wiring, dropping `progress.stop` fails 3 tests (incl. the wire test).
- Change 3 red: module missing; then with a passthrough stub: `fetch failed` for the 1.5 s header-wait case (the wall), plus a no-throw failure for the string-body case.
- Change 4: removing the `trackRequest` wrapper makes it fail (`expected 1 to be +0`).

## Findings worth a human look
1. **The 120 s window only covers handler-owned approvals.** In `tool-executor.ts` the `requiresConfirmation` / `onConfirm` / `resumeConfirmation` path (`confirmGate`) has **no timeout at all** (its own comment says the wait is unbounded). Only `onApprovalStateChange({ pending })` from a handler arms `APPROVAL_WAIT_TIMEOUT_MS`. The 0a tests model the handler-owned kind (that is how the real approval handlers work). Relevant to OD-10.
2. A second pending phase gets **no window** for a call with no `timeoutMs` (pinned in 0a.4): that phase is unbounded until the caller aborts.
3. `pinnedFetch` in agent-runtime has its own 300 000 ms idle timeout (`PINNED_FETCH_IDLE_TIMEOUT_MS`); not touched, separate path.

## Deviations
- **0b dispatcher**: the sheet says "a dispatcher whose header wait is 200 ms". `mcp` declares no `undici`; adding it as a devDependency made pnpm re-resolve unrelated lockfile entries (release-age policy), so I dropped that. The test loads `undici` through `createRequire` from `@jini-ai/platform`'s declared dependency (test only, local `UndiciSubset` type). This is a runtime resolution of a package `mcp` does not declare: please review. Also: Node's **global** `fetch` ignores a userland `Agent`, so the test uses that undici's own `fetch`; undici's timers tick at 500 ms, so the wall fires at about 0.7 s for a 200 ms setting (server delay set to 1.5 s for margin).
- `createLoopbackFetch` sends `http:` loopback URLs over `node:http` and hands any other URL (https, non-loopback) to the global `fetch`, so those keep the 300 s wall. This follows "for the loopback daemon URL only". It also rejects non-string bodies with `TypeError('loopback fetch sends only string bodies')`.
- `Logger`/`createConsoleLogger` come from `@jini-ai/core/primitives` (existing entry). The default logger writes to stderr (console), prefix `[jini-mcp]`.
- Extra module-state guard fix: `loopback-fetch.ts` first used a module-level `Set` (guard HW3); replaced by an inline check.
- `tool-server-capture.fixture.ts` gained `callWithExtra` (additive). The shared fake scheduler/logger moved to `call-progress.fixture.ts`.

## Changed sentences (old to new)
None model-facing. New: stderr log line `progress notification failed; this call sends no more progress` (once per call). Progress frames are `{ progressToken, progress: n, message: "waiting" }` to the CLI only. Failure text of a header-wait timeout stays `fetch failed` (unchanged; the loopback adapter returns the same `TypeError('fetch failed', { cause })` shape so "cannot reach the daemon" wording is kept for ECONNREFUSED).
Existing test changed: `serve.test.ts` "omits fetchImpl/stdin/stdout ... when not injected" now asserts `fetchImpl` is a function (the loopback fetch), stdin/stdout still omitted; new test proves the default reaches a loopback daemon with the global `fetch` stubbed to throw.

## New Jini exports Tovu consumes (for REL)
None. All new modules are internal to `@jini-ai/mcp`; `jini-mcp` behaviour changes only through its bin.

## Not verified
- Whether any real agent CLI resets its tool-call timeout on `notifications/progress` (S16a measures).
- Progress frames over a real stdio transport (only in-memory transport + fake capture were exercised).
- A full 300 s+ end-to-end call through `jini-mcp` to a real daemon with the new fetch (adapter proven against a real server at 1.5 s, the wall measured separately at 300 s).
- Behaviour on Node other than 24.22.3 (`engines` is `~24`).
- Tovu side (nothing changed there; no Tovu baseline run).

## Next step
S16a (needs S15) and S8 (after S3 and S15) can now start; S15 shares `tool-server.ts` and `serve.ts` with S3 and S8 (S3 rebases onto this branch).
