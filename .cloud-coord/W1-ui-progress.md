# W1 ui — coordinator progress

Branch: `cloud/w1-ui` (from `origin/general-work`). Lot branches: `cloud/w1-ui-<LOT>`, worktrees `/home/user/wt-<LOT>`.
Temp eslint config (untracked, git-excluded): `.eslint-cx.tmp.mjs` (complexity 10 / sonarjs cognitive 10, noInlineConfig).

## Status

| Lot | Folder | Status | Before→after worst cyc/cog | Coverage | Commits | Verify |
|---|---|---|---|---|---|---|
| L037 | features/source-config-list | running | | | | |
| L040 | features/skills | merged | SkillDraftForm 44/12, SkillRow 54/32, SkillsTab 26/-, rules -/12 → all ≤10 | 100/100/100 | 0ff8e5de 1b859a44 e717fdee e45de4bb | eslint 0, tsc ok, 167 tests, no removed expects |
| L042 | features/memory | merged | formatters 19/19→10/7, ConnectedPanel 42/41→9/6, MemoryList 11/13→4/3, store 11/11→10/8 | 100/100/100 | d123eb3a e6f1a20f ff4a2d05 5d4792e8 | eslint 0, tsc ok, 181 tests |
| L049 | features/about | merged | rules 38/39→≤10, AboutTab 38/28→≤10 | 100/100/100 | 79ecdac7, 45e230a7 | eslint 0, tsc ok, 79 tests green, why-comments moved (checked) |
| L050 | features/mcp-ui | running | | | | |
| L066 | utils | running | | | | |
| L067 | renderers | running | | | | |
| L075 | features/media-providers | running | | | | |
| L080 | features/resource-dashboard | queued | | | | |
| L085 | features/lexical-rich-text-editor | queued | | | | |

## Timings
- Setup (install + -r build): 188 s; integrations tsc fails on own tests (expected), dist emitted.
- Wave start 00:03 UTC 2026-10-20; L037,L040,L042,L049,L050 dispatched in parallel.

## Bugs pinned (reported, not fixed)
- L040 SkillsTab: host `loadErrorLabel` shown verbatim; real load error dropped, `{error}` placeholder never filled.

## Problems

## Next
