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
| L152b | MERGED | 19393edb | call-confirmation 15/15→9/8 (new remembered-approval 10/4); revocation 11/0→8/5; stdio-launch-resolver 10/12→10/8; adapter.stdio 14/7→10/7 | all lot files 100/100/100 (my run: 37 files, 691 tests) | eslint 0, tsc 0, tests ok no Errors, guard = base |
| L104 | MERGED (2nd try) | 4ba75e8f | daemon-client 14/20→9/6; tool-protocol normalizeToolArguments 23/26→10/5 (moved to tool-arguments.ts, not re-exported); argumentShapeMessage 11/10→6/1; tool-server run 11/7→6/3; tool-protocol worst now handleToolCall 10/8 (untouched) | 4 files 100/100/100 (my run: 26 files, 566 tests) | eslint 0, tsc 0, tests ok no Errors, guard = base. 1st merge rejected (new `as unknown as` test double) → fix subagent (83k tokens, 11 calls) typed FakeProcessStdin extends net.Socket, RED-checked |
| L113-L188-L203-L236 | MERGED | 96cb2b7d | client extractRelativeRefs 23/42→5/5 (file 6/7); serve 23/14→7/5; ask-choice 15/17→7/6; install planAgentInstall 16/0→4/1 (file 8/5) | 4 files 100/100/100 (my run: 15 files, 322 tests) | eslint 0, tsc 0, tests ok no Errors, guard = base |
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
### L113-L188-L203-L236 (subagent: ~185k tokens, 54 tool calls)
- Commits f24a6ada 1a43bf05 4a13508a 5535d525 9da3eb5f f82352a0 c7902325 96cb2b7d. NOTE 1a43bf05 states 3/2 for extractRelativeRefs (actual 5/5; corrected in 5535d525's message).
- Temp differentials: client.ts 20k inputs, install.ts 28.5k combos (incl. prototype slugs) — identical; deleted.
- Over-engineering: client repeated isHtmlLike + per-candidate dir; serve 5 conditional spreads → definedOnly; install unused envKey param, opencode IIFE, genericMcpServersSnippet (== jsonEntry), cline/trae platform dup → editorUserDir; planAgentInstall switch → total AGENT_PLANNERS map + own-property slug guard (constructor/__proto__ still throw, pinned).
- Check removed: ask-choice presentFallback `ticket !== undefined` before cleanup redeem. Proof: mint typed string, only package store always mints non-empty (pinned test), redeem(undefined) refused by contract. Coordinator: accepted — removal makes the invalidation unconditional (stricter), not an auth gate.
- Message changed: serve.ts missing daemon URL → "no daemon URL resolved: <ENV> is unset or empty; the spawning Jini daemon must set it to its HTTP base URL." (old text advised flagUrl/discover/defaultUrl that this process lacks); pinned test updated.
- SECURITY (pinned, reported not fixed): client.ts backslash `..\..\x` not split → passes root-escape check; install.ts relative APPDATA → relative config path; install.ts serverName starting with `-` goes into agent CLI argv (flag injection); install.ts hermes YAML snippet interpolates serverName/env keys unquoted (YAML injection); serve.ts bearer token still sent to remote plain-HTTP daemon URL (warn only).
### L152b (subagent: ~196k tokens, 59 tool calls)
- Commits df3dc8c9 74ec2f14 4a8a6280 ba2a642c f3ee421d 0d5ba6c8 19393edb. New helpers (not in barrel): remembered-approval.ts, scope-option.ts, revocation-reason.ts.
- Over-engineering: 6x scope conditional → scopeOption; npx/npm/node ternary → NODE_TOOLCHAIN_CLI table; 2 identical launchUnavailable throws → 1; misplaced toolchainDir doc comment moved back.
- Checks removed: none. Two redundant duplicate conditions merged (proofs in commit msgs): `offerAlways && !request.destructive` inside `if (!request.destructive…)`; `rememberable` already includes `!destructive`. Coordinator verified equivalence by reading the diff.
- SECURITY: PINNED relative parent PATH entry (e.g. `.`) → resolver checks ./tool against daemon cwd but spawns bare `tool` (re-searched on child PATH) — check≠exec (stdio-launch-resolver findOnSearchDirs). Not pinned: revocation never enforces writeAllowedToolNames (by design since G3, trust.ts:510-515); secrets <4 chars not redacted from stderr (documented); darwin search path appends user-writable $HOME/.local/bin and $HOME/.cargo/bin (lowest rank); resolver check-then-spawn TOCTOU.
### L104 (subagent: ~166k tokens, 55 tool calls; fix subagent 83k/11)
- Commits 382b366a 2912b1bf 239e523c a8a41d98 322cda22 b127c40b + fix 4ba75e8f. NOTE 2912b1bf states requestDaemonJson before 14/2 (actual 14/8; corrected in a8a41d98).
- Temp differential daemon-client: 3000 generated responses/errors identical; deleted. Only difference: a reader double yielding a `null` chunk is now skipped (old crashed); real fetch never does this.
- Over-engineering: unused default on safeDiagnostic options; duplicated message template in formatDaemonHttpError; argument shaping moved to tool-arguments.ts (unreachable "no errors" fallback of argumentShapeMessage KEPT, tested directly).
- Checks removed: none. Messages changed: none.
- SECURITY (pinned, reported not fixed): non-size body-read error rethrown without URL redaction (only handleToolCall's later sanitizer cleans it); timeout message carries raw route. Token never in errors (pinned).
- Pre-existing (not this wave): tool-server.test.ts ~579 `as unknown as NodeJS.ReadStream` cast; FakeProcessStdin could replace it.
