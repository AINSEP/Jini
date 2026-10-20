# W1 ui — coordinator progress

Branch: `cloud/w1-ui` (from `origin/general-work`). Lot branches: `cloud/w1-ui-<LOT>`, worktrees `/home/user/wt-<LOT>`.
Temp eslint config (untracked, git-excluded): `.eslint-cx.tmp.mjs` (complexity 10 / sonarjs cognitive 10, noInlineConfig).

## Status

| Lot | Folder | Status | Before→after worst cyc/cog | Coverage | Commits | Verify |
|---|---|---|---|---|---|---|
| L037 | features/source-config-list | running | | | | |
| L040 | features/skills | running | | | | |
| L042 | features/memory | running | | | | |
| L049 | features/about | running | | | | |
| L050 | features/mcp-ui | running | | | | |
| L066 | utils | queued | | | | |
| L067 | renderers | queued | | | | |
| L075 | features/media-providers | queued | | | | |
| L080 | features/resource-dashboard | queued | | | | |
| L085 | features/lexical-rich-text-editor | queued | | | | |

## Timings
- Setup (install + -r build): 188 s; integrations tsc fails on own tests (expected), dist emitted.
- Wave start 00:03 UTC 2026-10-20; L037,L040,L042,L049,L050 dispatched in parallel.

## Problems

## Next
