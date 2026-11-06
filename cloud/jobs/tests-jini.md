# Job tests-jini (owner-approved 11-06): full tests, Jini
Base in both repos: origin/cloud/combine (Tovu b34b9cb7a, Jini 3a41ec5b6), after every fix round. This is the end-of-work full test run, split into three parallel jobs so none hits the cap: tests-jini, tests-tovu-site, tests-tovu-apps. Create cloud/<job> from the base in each repo you change, and push every 10 minutes. Owner approved --no-verify for that branch in Tovu. Hard cap 2 hours. General wording in commits and reports: these repos are public.

Build Jini and link it into Tovu first. Save each log under /workspace/work/<job>/. Use subagents on separate groups of failures if it helps, each on its own files.

For each failure find the real cause and fix it with the smallest change, failing test first when it is a real bug. Fix the code when the code is wrong; change a test only when it is truly out of date, and say why. No cheating: never skip, disable, weaken or delete a test, rule or check. No lowered thresholds, no complexity --update, no debt-list additions, no eslint-disable, no bigger timeouts just to pass. A failure caused only by the container lacking something (Electron, a display, a real provider): list it as environment, and do not change the test. Same failure twice with no progress: list it and carry on. Commerce is on hold for features, but its tests still count.

Report at cloud/reports/<job>.md and in your final message: final shas, per-suite pass and fail counts with exact commands, each fix and its cause, each test changed and why, what still fails and why, and every bug under "Bugs found".

Your suites: Jini recursive tests for all packages, one package group at a time so the container stays healthy; Jini typecheck, complexity and quality gates as CI runs them.
