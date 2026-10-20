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
| L036a | running | | 13/11 → | | |
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
