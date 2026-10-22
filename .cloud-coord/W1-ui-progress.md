# W1 ui — coordinator progress

Branch: `cloud/w1-ui` (from `origin/general-work`). Lot branches: `cloud/w1-ui-<LOT>`, worktrees `/home/user/wt-<LOT>`.
Temp eslint config (untracked, git-excluded): `.eslint-cx.tmp.mjs` (complexity 10 / sonarjs cognitive 10, noInlineConfig).

## Status

| Lot | Folder | Status | Before→after worst cyc/cog | Coverage | Commits | Verify |
|---|---|---|---|---|---|---|
| L037 | features/source-config-list | merged | deps 11/-→6/3, TestControl 12/16→7/5, ListView 14/16→5/5, AddForm 18/14→8/3, Field 28/42→7/5, ItemCard 30/32→6/7 | 100/100/100 | 09606f71 19ad68de 30c74d13 284ad4e7 56782039 7711dc91 | eslint 0, tsc ok, 279 folder tests, new tests pass on OLD source; dependencies.test.ts left in src/__tests__ (node env) |
| L040 | features/skills | merged | SkillDraftForm 44/12, SkillRow 54/32, SkillsTab 26/-, rules -/12 → all ≤10 | 100/100/100 | 0ff8e5de 1b859a44 e717fdee e45de4bb | eslint 0, tsc ok, 167 tests, no removed expects |
| L042 | features/memory | merged | formatters 19/19→10/7, ConnectedPanel 42/41→9/6, MemoryList 11/13→4/3, store 11/11→10/8 | 100/100/100 | d123eb3a e6f1a20f ff4a2d05 5d4792e8 | eslint 0, tsc ok, 181 tests |
| L049 | features/about | merged | rules 38/39→≤10, AboutTab 38/28→≤10 | 100/100/100 | 79ecdac7, 45e230a7 | eslint 0, tsc ok, 79 tests green, why-comments moved (checked) |
| L050 | features/mcp-ui | merged | secret-card 22/22, fields 22/34, text-input 15/15, outcome 12/-, form 21/12, confirmation 21/14 → all ≤10 | 100/100/100 | 626dd818 3f9abfeb ca7daced df5da529 425af337 4b59f5c8 | eslint 0, tsc ok, 234 tests; new tests (sha256 digests + snapshots) also pass on OLD source → behaviour identical |
| L066 | utils | merged | sse 11/13, polygon 12/-, auto-open-file 27/43, md-scroll-sync 17/16 → all ≤10 | 100/100/100 | 51c765be 9d2f5683 4cdea228 94545b89 0937898d | eslint 0, tsc ok, 123 tests (85→123), new tests pass on OLD source |
| L067 | renderers | merged | build 11/-→8/5, ArtifactView 12/-→6/3, PreviewModalShell 23/20→10/8, AnnotationCanvas 27/42→8/7 | 100/100/100 | 587c844b 53281a6c e7b4e0df 58a5c270 | eslint 0, tsc ok, srcdoc byte snapshots pass on OLD source; diff read: escaping/CSP/sandbox order unchanged |
| L075 | features/media-providers | merged | Tab 60/17, hook -/13, rules 13/- → all ≤10 | 100/100/100 | 0287fe56 aaa574fe 2412bd5b | eslint 0 (incl. new MediaProviderCard.tsx), tsc ok, 118 tests pass on OLD source too |
| L080 | features/resource-dashboard | merged | rules 12/11, RowListItem 12/16, RowList 13/-, RowListView 14/13, Card 15/20, BoardView 16/20, Board 21/15 → all ≤10 | 100/100/100 | feaf9b67 1f205d6f 005560d4 0e47d37c ad8554d2 4aab2dab a9442309 | eslint 0 (whole folder), tsc ok, 167 tests pass on OLD source too |
| L085 | features/lexical-rich-text-editor | merged | mention-parser 16/18, serialize 7/11, keyboard 11/-, rules 20/42 → all ≤10 | 100/100/100 | 894db7e1 81040c02 6320cc1b 02e94345 | eslint 0, tsc ok, 149 tests pass on OLD source too |

## Timings
- Setup (install + -r build): 188 s; integrations tsc fails on own tests (expected), dist emitted.
- Wave start 00:03 UTC 2026-10-20; L037,L040,L042,L049,L050 dispatched in parallel.

## Bugs pinned (reported, not fixed)
- L040 SkillsTab: host `loadErrorLabel` shown verbatim; real load error dropped, `{error}` placeholder never filled.

- L085 serialize: mention nested in a generic ElementNode → token lands in `text` but entity omitted from `mentions`.

## Problems
- Some commit messages (L037 TestControl, L067 build/ArtifactView/PreviewModalShell) state slightly wrong after-numbers; table above has measured values. Not amended (no force-push).

## Flagged, not changed
- L080: `useWiredResourceBoard` public prop only passed by tests; old ResourceBoard tests use `customHook as any` (pre-existing); ResourceBoardView test 'bubbles select-mode/bulk-delete toolbar interactions' asserts nothing on callbacks.
- L085: `selectBeforeMention`/`selectAfterMention` near-duplicates (exported, under limit).
- L049/L075: lot files not prettier-clean before the wave; left as is.

## Final
- `pnpm --filter @jini-ai/ui build` ok; `tsc --noEmit -p packages/ui` ok; whole ui suite (`vitest run --maxWorkers=4`): 549 files / 7540 tests passed, 162 s. No failures, so no base comparison needed.
- Wall time ~45 min (23:59→00:44 UTC). Parallelism: 5 concurrent subagents; all 10 lots completed by one subagent each, none hit the context cap (97k–172k tokens).

## Next
- Wave 1 ui done. cloud/w1-ui is ready for owner review/merge into general-work (coordinator never pushes there).
