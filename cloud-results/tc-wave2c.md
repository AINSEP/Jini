# tc-wave2c — S14b, S16a, S11 (tool-call fixes plan), 2026-11-17

Branch `wave2/tc-c` in both repos. Bases: Tovu `origin/refactor/terra` 232764af5; Jini `origin/integ/wave1-merge-2026-11-17` 9fe7d3d3 (contains S10, S14a, S15). §1.1 ancestor checks printed `ok ok`. Tovu was linked to the local Jini build (`link:jini`, dry run: 0 changes). Node 24.22.3. Nothing left running.

## Result
| Sheet | State |
|---|---|
| S14b | done (Tovu). OD-5 yes: budget 20 s + 10 s full page + requested wait, cap 45 s, reserve 4 s (`CAPTURE_LIMITS`; the full-page +10 s is my choice, the sheet names none). Case 6 (OD-5 = no) not applicable. |
| S16a | done (Jini). Matrix committed; **nothing measured on the wire** (no model credentials for a nested CLI): cells are source-read or unknown, each with its source. |
| S11 | done (Tovu). Lands before T-TH-05 / T-TH-08. |

## SHAs
Jini `wave2/tc-c`: f4d40aa8 (diagnostics `./web-evidence/capture-clock` entry + test), 4ac2e6c1 (matrix doc), 178788ef (matrix test).
Tovu `wave2/tc-c`: 1c5a5e5d (clock seam), a9606faf (S14b characterization), f4234732 (budget + soft fallback), 8ff2bc88 (scroll cut at work deadline), ef619626 (real number in timeout words), 5483c17b (cancel's own error), 22fbaf4d (S11 characterization), 2bdddd0e (reviewed write reports committed version), 3e4592eb (stale sentence), b32e1944 (chain adoption). All pushed; `git pull --rebase` said up to date each time; no force-push; no `--no-verify` (no hook ran on these pushes).

## Gates (exact commands, results)
BASE-RED recorded first (unmodified tree), judged on "no new line beyond base":
- Tovu base: `npm run typecheck` rc 0. `npm run check:size` rc 1 (red, 17 lines, saved), `npm run check:complexity` rc 1 (red, 23 lines). `check:architecture` rc 1 (4 regressed metrics). `check:boundaries` rc 16 (115 violations). `web-screenshot` tests: 99 tests, 98 pass, 1 fail = "the default launcher resolves the host Playwright module..." (Chromium at the expected path missing in this container).
- Jini base: `pnpm guard` ok; `pnpm typecheck` rc 0; diagnostics 997 pass; agent-runtime 4469 pass + 1 skipped.
After every Tovu commit: `npm run typecheck` rc 0; size and complexity: zero lines not in the base output (script compares line-number-normalised); changed-file tests green.
Final Tovu: web-screenshot dir 113 tests, 112 pass, 1 fail (the same base failure); theme dir `theme-*.test.ts` + `reviewed-write-commit.test.ts` 354 tests, 350 pass, 0 fail (4 skipped/todo, pre-existing). `check:hooks`, `check:errors`, `check:error-rule-copies`, `check:inventory` rc 0. `check:boundaries` identical to base (only the module count differs). `check:coverage-integrity` needs an lcov file (not run). `check:jini-registry-drift` rc 1 while linked (unpublished Jini symbols = REL, below).
**One new delta in a base-red ratchet:** `check:architecture` "bidirectional hub count" 335 → 369 (base run: 363). Cause found by bisection: the new sibling file `reviewed-write-commit.ts` (the sheet prescribes a sibling) lowers the median fan-out and 6 files cross it. Left as is; the alternative (put the scope in `theme-files.ts`, +~25 lines over its +12 allowance) breaks the sheet. Owner call.
Final Jini: `pnpm guard` ok; `pnpm typecheck` rc 0; diagnostics 999 pass (997 + 2 new); agent-runtime 4475 pass + 1 skipped (4469 + 6 new). Block 4.9 for the new entry: import resolves, no `node:` import in the file.
Blocks 4.3–4.8, 4.15–4.17 (both repos): empty except — 4.8 vanished comments, all moved/rewritten: "Budget held back from the stable-frame screenshot..." and "Whole capture, launch to screenshot." (now the `CAPTURE_LIMITS` doc: reserve and limits), "A page that hung the renderer can also hang..." (now `dropBrowserAfterTimeout`'s doc), `@returns The original handler's result...` and the `protectThemeFileTools` first line (moved to / extended in `reviewed-write-commit.ts` and the handler doc). 4.16: only `createPlaywrightPageCapture` prints (81 lines at base, 73 now: shrank). Test counts: no test deleted; edited assertions listed below.

## Red failures seen (before each change)
- Budget: wait 3 s + 60 s hang failed at 20 s (`exceeded 20000ms`) instead of an image; fallback never started at T − 4 s; hung renderer failed at 20 s not 25 s; budget never grew (`deadlineSignals` 20 000).
- Scroll hang: `outcome` still undefined at 26 000 ms (kept waiting to T).
- Words: `limitMs` undefined on the error; service text was `... did not finish rendering within 20 seconds.` for every case.
- Cancel: `PageCaptureError: navigation failed` (and `unavailable` for an already-aborted signal) instead of the cancel's reason.
- S11: 7 of 10 failed with `The theme file changed during review...` / `oldString was not found` (call threw, no per-item account).
Mutations that turn the pins red: S14b characterization — render timeout ×2 (2 red), outer race ×2 (1), reserve 3 s (1), message text (2), note text (1). S11 — successor keeps the prepare-time pin (5 red), successor re-reads the file (1 red: the foreign-write-after-item-1 test), sentence reword (red). S16a — def gains a transport (red), loses it (red), row deleted (red), aider no longer `no-client` (red).

## Changed model-facing sentences (old → new)
- Screenshot timeout (every case) `<site> did not finish rendering within 20 seconds.` → never committed: `<site> did not answer within N seconds.` (N = work deadline); loaded but unfinished or hard stop: `<site> did not finish rendering within N seconds.` (N = total); a port that does not know its limit (desktop native capture): `<site> did not finish rendering in time.` (it used to claim 20 s).
- Screenshot note (soft deadline, new): `page loaded but did not settle within N s; captured the current frame (content may still be loading).` Stable-frame note keeps its text; its number is now the request's total: `page was still animating near the N s deadline; ...`.
- Stale file, both sites: `The theme file changed during review. Read it again and retry; this file was not replaced.` → `This theme file changed after it was read. Read it again and retry; this change was not applied.` The writer's old refusal was a `ThemePathError` that the tool decorated with "Fix the input and retry — this will not resolve on retry without an input change. Schema ..." (contradicting "retry"); it is now `ThemeFileChangedError` (a `ToolInputError`) shown as written. This goes one step past "reworded sentence only"; flagged on purpose.
- New: `Skipped: an earlier change to this file in the same call failed.`
- A caller cancel of a screenshot now surfaces the caller's abort reason instead of a failed/unavailable capture error (two existing pins edited: `a caller's already-aborted signal prevents launch...`).
Edited existing assertions: `playwright-page-capture.unit.test.ts` (4 `deadlineMs` options → `limits`; full-page screenshot timeout bound 20 000 → 27 200 (31.2 s − 4 s reserve); 2 cancel pins), `web-screenshot.unit.test.ts` (timeout case: one regex → three exact cases).

## Overlaps with other runs (file-disjoint where possible)
Tovu: `apps/website/src/features/web-screenshot/{playwright-page-capture,web-screenshot}.ts` and tests; `apps/website/src/features/theme/{theme-files,file-mutation-tools}.ts`, new `reviewed-write-commit.ts` and tests. **For T-TH-05 / T-TH-08 refresh `*.files.tsv`:** theme-files.ts blob 29dc214e (1341 lines, −3 vs base), file-mutation-tools.ts blob 1ac5210b, new reviewed-write-commit.ts blob db3884dd. Removed from theme-files.ts: `withReviewedThemeFileWrite`, `ReviewedThemeFile` (moved), the ALS import. Jini: `packages/diagnostics/package.json` (one entry), agent-runtime docs and one test.

## New Jini surface Tovu now consumes (for REL)
`@jini-ai/diagnostics/web-evidence/capture-budget` (S14a), `@jini-ai/diagnostics/web-evidence/capture-clock` (this run, f4d40aa8), `renderPage` options `softDeadlineMs` / `onSoftDeadline` / `clock` and `RenderSession.phaseTimedOut` (S14a), `@jini-ai/core/approval-batch-chain` (S10), `@jini-ai/diagnostics/web-evidence/testing` (tests only). Tovu's `^0.7.x` pins do not have them: release first (`check:jini-registry-drift` is red until then).

## Left / not verified
- S16a probes against a recording MCP server were not run (no model credentials); every non-source-read cell is `unknown`. 15 CLIs were not installed. Next: install and probe them where credentials exist; S16b may use only Claude's `timeout` (ms, hard wall-clock, **progress does not extend it**, per the CLI's own description) and Codex's `tool_timeout_sec`.
- Claude Code's default tool limit is `unknown` (minified; a 300 000 ms clamp sits next to the resolver).
- Tovu S14b: no real browser run (Chromium missing in this container); all deadline behaviour is on a fake page and virtual clock.
- Theme: concurrency between two separate tool calls on the same file is unchanged (only items of one call chain).
- Next step: merge wave2/tc-c after the owner decides the hub-count delta; then REL; then S16b (needs OD-6), T-TH-05/08.
