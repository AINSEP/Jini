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
| L102 | MERGED (52f48f6e) | 1 agent, 54 calls, 150k tok, 11.4 min | 9ad0cad8 7006529a | AssetTreeBrowser 37/27→8/6; rules 17cog→7/7 | 100/100/100 (rules + 3 component files); +8 tests | eslint 0, tsc 0, 266 tests green, 4 why-comment blocks moved (grep-verified) |
| L103 | MERGED (14d15f11) | 1 agent, 47 calls, 137k tok, 13.4 min | 87e6e4e8 6e1d21b1 aad8a988 55e7405f 80ec22fc | CommentSidePanel 23/20→10/6; MarkdownSplitPane 16→9/5; useCommentReorder 13→9/4; rules 11/17→5/7 | 100/100/100 on 4 files; +25 tests | eslint 0, tsc 0, 208 tests green; comment-line counts only grew |
| L111 | MERGED (057659f7) | 1 agent, 45 calls, 130k tok, 11.3 min | 47de0d8c 83cb4cdb a7a0bdb7 bc25286e 49d139bb | FileDropzone 28/21→10/5; Lightbox 17/16→3/1; Grid 12/13→3/1 | 100/100/100 (4 files incl. new FileDropzoneZone.tsx); 66→81 tests | eslint 0, tsc 0, 163 tests green, why-comment moved to FileDropzoneZone |
| L117 | dispatched | | | | | |
| L122 | dispatched | | | | | |
| L127 | dispatched | | | | | |
| L132 | dispatched | | | | | |
| L133 | dispatched | | | | | |

## Problems / notes
- L091: label explicitly `undefined` falls back to default — untestable under exactOptionalPropertyTypes without a cast (noted, not an issue).

- L111: commit 47de0d8c has broken test imports (fixed in 83cb4cdb) — don't bisect onto it. useFileDropzone/useFileDropzonePreviews override props only used by tests (public props; kept). Existing FileDropzone.test.tsx has 3 pre-existing `as any` (not introduced).
- L102: KNOWN FOLLOW-UP (deps not behind wired hook) unchanged; new useAssetTreeBrowserController could host it — design decision for owner.
- L103: rules.ts commit message says 6/6, measured 5/7. aad8a988 had a tsc error fixed in 55e7405f (don't bisect onto it). CommentSidePanel useCommentReorder override prop only used by tests (kept).

## Next
