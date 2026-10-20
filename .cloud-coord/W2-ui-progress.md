# W2 — package `ui` — coordinator progress

Coordinator branch: `cloud/w2-ui` (from `origin/general-work` @ 6bdca722). Lot branches: `cloud/w2-ui-<LOT>`, worktrees `/home/user/wt-<LOT>`.

- STEP 0: `Linux vm 6.18.44-fc-v139 x86_64 / vm / /home/user/Jini / 2026-10-20T01:25:53Z` → commit 3c8dc15f
- Personas loaded by coordinator: software-architect/skills.md ✅, code-inspection/skills.md ✅ (AI-Dev-Shop cloned to /home/user/AI-Dev-Shop)
- Setup: install + `pnpm --no-bail -r build` = 129 s (integrations tsc fails on its tests as expected; dist emitted). Worktree creation x5 in parallel = 11 s.
- Temp complexity config: `eslint.tmp-cx.mjs` at repo root (untracked, in .git/info/exclude).

## Architect lens: ordering / boundaries
Lots are file-disjoint; no lot changes a public export, so lots are independent and can merge in any order. L089 is largest (7 files, 11 fns) and holds McpUiHost (untrusted MCP UI: behaviour must be provably identical) → started first. Merge conflicts only possible in shared test folders (none shared across lots).

## Baseline (eslint cyc/cog ≤10, origin/general-work)
| Lot | worst fn (cyc/cog) |
|---|---|
| L089 | WorkingDirPicker arrow 20/16; WorkingDirPicker 17/20; Toast 16; resolveCustomSelectOriginTheme 15; OnboardingDropdown 15; remixicon 12; select-popover 12; McpUiHost 11 |
| L091 | TabbedDialog 50/26 |
| L102 | AssetTreeBrowser 37/27; rules.ts cog 17 |
| L103 | CommentSidePanel 23/20 (+ arrow 17/11); MarkdownSplitPane 16; useCommentReorder 13/12; rules.ts 11/17 |
| L111 | FileDropzone 28/21; Lightbox renderStage 17/16; ThumbnailGrid renderThumb 12/13 |
| L117 | dom.ts 15/22 worst (5 fns); SketchEditor 15/11 |
| L122 | recordNavigation 24/15; mergeHistoryEntry 22/13; normalizeBrowserAddress 13/13 |
| L127 | IntegrationsTab 33/23; CodexInstallToggleButton 11 |
| L132 | validateAdminTheme 29/26 |
| L133 | InfoTip 21/15; placeInfoTipBubble 17/16; handleKey 13/13 |

## Lot status
| Lot | status | subagent | commits | before→after | coverage | verify |
|---|---|---|---|---|---|---|
| L089 | dispatched | | | | | |
| L091 | MERGED (75e42a6b) | 1 agent, 24 tool calls, 101k tok, 6.3 min | bb71753b | TabbedDialog 50/26 → 8/5 | 100/100/100 on 5 files; 21→34 tests (+12 view-helper tests) | eslint 0, tsc 0, 41 tests green, why-comments moved (verified by grep) |
| L102 | dispatched | | | | | |
| L103 | dispatched | | | | | |
| L111 | dispatched | | | | | |
| L117 | dispatched | | | | | |
| L122 | queued | | | | | |
| L127 | queued | | | | | |
| L132 | queued | | | | | |
| L133 | queued | | | | | |

## Problems / notes
- L091: label explicitly `undefined` falls back to default — untestable under exactOptionalPropertyTypes without a cast (noted, not an issue).

## Next
