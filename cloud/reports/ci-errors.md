# ci-errors — in progress

Started 2026-11-06 16:41 UTC; hard deadline 18:41 UTC. Branch: `cloud/ci-errors`; base: `f07ae3d6ff55cf4da480acac44cc6f4b7686966b`. No pushes to main, no force pushes, deploys or publishing.

## Already on the base

The earlier error job is merged: approved request wording, safe correlated admin helper defaults, a shared ErrorNotice beside ServerRestartingBanner, analytics/forms/uncaught exception handling, recovery/publishing semantics, and daemon startup/update/model-stream messages. Earlier GA configuration and boundary fixes are also present. Fresh focused verification is in progress.

## Current work

Remaining CI failures and Semgrep rejection callback coverage; LCOV union and explicit admin coverage scope/floors. Setup uses `/workspace/.tovu-build/env.sh`. The default pnpm cache was read-only; reinstall with a workspace store succeeded, recursive rebuild is in progress. Exact validation commands/results and pushed SHAs will be recorded at completion.

## Bugs found

- LCOV aggregation selects one report rather than combining complementary covered entries (fix in progress).
- Admin coverage has neither explicit source scope nor floors (fix in progress).
- Semgrep misses unsafe rejection callback error echoes (fix in progress).
- Current guard reports additional import/metadata/module-state violations; triage in progress.

## Open limitations

Historical GitHub run logs are unavailable through the environment's GitHub API access. Current failures are being reproduced locally. Shared error display Chrome verification is in progress with synthetic replies only.
