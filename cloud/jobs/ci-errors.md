# Job ci-errors (owner-approved 11-06): Jini CI and generic errors
Base in both repos: origin/cloud/combine (Tovu 74fedc132, Jini f07ae3d6f), which already holds every merged job and the UI fixes. Create cloud/<job> from it in each repo you change. Owner approved --no-verify for that branch in Tovu. Hard cap 2 hours. Your prompt may add items that are not listed here; they count the same. General wording in commits and reports: these repos are public. List every bug you notice under "Bugs found", fixed or not.

Earlier jobs never finished these. First work out what is already on the base, and do only what is left.
1. cloud/jobs/ci.md on the plans branch. Also Jini GitHub CI failed quality-gates and semgrep on 7c7552493: find the cause and fix it. No disables, no lowered thresholds.
2. cloud/jobs/errors.md on the plans branch, with its trim. The look of the shared display gets checked in Chrome afterwards.

Report at cloud/reports/ci-errors.md and in your final message: shas, what was already done, what you did, tests with exact commands.

3. Coverage: Jini lcov.ts still selects the higher-hit report instead of a union; admin lacks an explicit coverage scope and floors. Fix with the smallest change. Do not lower any floor.
