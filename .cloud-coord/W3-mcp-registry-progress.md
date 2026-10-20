# W3 mcp-registry — coordinator progress

## Coordinator
- STEP 0: `Linux vm 6.18.44-fc-v139 x86_64 GNU/Linux; hostname vm; /home/user/Jini; 2026-10-20T04:30:48Z; node v22.22.0` (cloud-proof commit 039ddfb8; hostname/pwd written literally — the auto-mode classifier refused the $(hostname)/$(pwd) form).
- Personas loaded by coordinator: software-architect, code-inspection, security (../AI-Dev-Shop @ depth-1 clone at /home/user/AI-Dev-Shop).

## Setup
- Node 24: v24.22.0 from nodejs.org tarball into ~/.local/node24 (no nvm/volta/n available).
- pnpm 10.33.2 via corepack; install 26 s; `pnpm --no-bail -r build` 2 min (integrations tsc fails as expected; all 36 dist present).
- Heavy lock: /tmp/w3-heavy.lock. cx eslint config: /tmp/w3-coord/cx.config.mjs (createRequire from repo root).
- Worktrees: /home/user/wt-<LOT>, scratch /tmp/w3-mcp-registry-<LOT>/.

## Lots
| lot | status | branch head | before→after worst cyc/cog | coverage (br/fn/ln) | verify |
|---|---|---|---|---|---|
| L152a | MERGED | e4c8ece4 | fn 13/11 → 9/7 (file worst 10/9) | trust.ts 100/100/100, no artifact lines (my run: 32 files, 593 tests) | eslint 0, tsc 0, tests ok no Errors line, guard 26 = base 26 (identical set) |
| L152b | running | | 15/15 → | | |
| L104 | running | | 23/26 → | | |
| L113-L188-L203-L236 | running | | 23/42 → | | |
| L036a | MERGED | 23ee2630 | search-enricher 13/0→10/3; github-backend 11/0→4/0; github-client 11/11→6/5 | all 3 files 100/100/100 (my run: 8 files, 133 tests) | eslint 0, tsc 0, tests ok no Errors, guard = base |
| L036b | running | | 39/25 → | | |

## Guard baseline
- `pnpm guard` is RED on base origin/general-work (26 violations, none in packages/mcp or packages/registry; HW3-module-state etc.). Verify criterion used: violation set identical to base (diff of sorted lines).

## Merges / findings / next
### L152a (subagent: ~138k tokens, 28 tool calls)
- Pins: trust.pins.unit.test.ts (94 pins, green on old) + temp differential ~315k inputs (deleted). RED checks: removalConfirmation, federatedCallConfirmationForAction, sqlCallDeletesData.
- Over-engineering: regexes→named consts, removalConfirmation extracted, sqlCallDeletesData takes boolean, merged SQL regexes, classifyRemoteTool object arg, describeFederatedTool no spread, misplaced JSDoc moved verbatim (coordinator verified).
- Checks removed: none. Messages changed: none.
- SECURITY (pinned, reported not fixed): SQL stripper mis-reads Postgres E'\'' strings → `select E'\'', 1; drop table t; --'` gets no confirm card (real bypass); UPDATE without WHERE no card; `list_and_drop_tables` with no hints no card; remove/erase/wipe not in removal list; maxResultBytes NaN disables truncation (operator config, not pinned).
- Kept: parseFederatedConnectionId (no caller, public, in api.spec), unused writeAllowedToolNames param of refusalForAdmittedToolUnderCurrentGrants.
### L036a (subagent: ~148k tokens, 55 tool calls)
- Commits d91a68fb 033adc64 e823184a 7bd78bd9 55d3a89a 23ee2630. NOTE: 033adc64 states 9/0 (actual 10/3, corrected by 7bd78bd9); 23ee2630 states ensurePullRequest before 4/11 (actual 9/11). Mis-measurements corrected in history/report, not rewritten (no force-push).
- Over-engineering: one private send() replaces 8 request literals; okJson/requireString/repoPath/isOk extracted; redundant `.replace(/\n/g,'')` before base64 decode removed (Node decoder skips newlines; 200k fuzz 0 diffs); dead '' separators in renderPublishBody removed. Temp differential: 378 readManifest + 2458 createPublishPullRequest cases, identical results + request lists.
- Checks removed: none. Messages changed: none.
- Bug pinned: JSON `null` body → bare TypeError (2xx readManifest; non-2xx PR creation).
- SECURITY: github-client encPath lets `..` segments through → manifestPath `../../../../user` resolves to /user on API host with token (PINNED); same for owner/repo `..` via enc/repoPath (not pinned); apiUrl override gets bearer token with no https/host check (host config); no response-size cap (relies on HttpClientPort); PRE-EXISTING literal `EC PRIVATE KEY` PEM in registry src/__tests__/github-backend.test.ts:8-25 (test CA fixture, not added this wave).
