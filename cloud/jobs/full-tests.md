# Job: full-tests (owner-approved 11-05)
Run the full test suites on the combined work, then fix what fails. This is the end-of-work test run.

Base in both repos: origin/cloud/combine at its current tip, after every other branch is merged. Work directly on cloud/combine in each repo, and push there. Owner approved --no-verify for pushes to cloud/combine in Tovu only.

Build Jini and link it into Tovu first. Then run, one suite at a time so the container stays healthy:
- Jini: the recursive test run for all packages.
- Tovu: root, website, admin, site-chat, and apps/desktop npm run gates (tests, typecheck, coverage, complexity).
Save each log under /workspace/work/full-tests/. Use subagents to work on separate groups of failures if that helps, each on its own files.

For each failure find the real cause and fix it with the smallest change. Failing test first when it is a real bug. Fix the code when the code is wrong; change a test only when the test is truly out of date, and say why in the report.

No cheating: never skip, disable, weaken or delete a test, rule or check. No lowered thresholds, no complexity --update, no debt-list additions, no eslint-disable, no bigger timeouts just to pass.

A failure that only happens because the container lacks something (Electron, a display, a real provider): list it as environment, do not change the test. Same failure twice with no progress: stop on it and list it, then carry on with the others. Other than that keep going until suites are green or the cap ends.

Push every 10 minutes. Report at cloud/reports/full-tests.md and in your final message: final shas, per-suite pass and fail counts with exact commands, each fix and its cause, what is still failing and why. General wording in commits and notes.

Also fix one known finding: composeSiteRouteDeps in Tovu is over the complexity limit (18 against 10). Split it with the smallest change; no debt-list entry.

Also fix: createRouteDeps and createApp over the limit at 11, composeSiteRouteDeps now 21; rendition generation returning 500 in route tests because the in-memory versioned adapter lacks saveRenditionIfSource; the 'L3 isolated guard: secret-sentinel' failure. Confirm whether the rendition failure is test setup or a real site problem.

First fix: `commerce_get_status has no approval classification` at Tovu apps/website/src/assistant/assistant-tool-approval-policy.ts:46 stops the full app starting in fixtures. Also check the baseline failures listed in cloud/reports/one-card.md and small-fixes.md.
