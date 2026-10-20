# W3 daemon — coordinator progress

## Coordinator
- STEP 0: `Linux vm 6.18.44-fc-v139 x86_64 GNU/Linux; vm; /home/user/Jini; 2026-10-20T04:30:45Z; node v22.22.0` → cloud-proof commit 418a9203 on cloud/w3-daemon.
- Personas loaded (coordinator): software-architect, code-inspection, security (../AI-Dev-Shop @ depth-1 clone at /home/user/AI-Dev-Shop).
- Node 24: container had v22.22.0; installed v24.22.0 from nodejs.org tarball into ~/.local/node24 (every command prefixes `export PATH=$HOME/.local/node24/bin:$PATH`; profile edits not used).
- Setup: install 28.6 s + `pnpm --no-bail -r build` → total 170 s. Only @jini-ai/integrations failed tsc (expected); 36/36 packages have dist.
- Baseline: daemon `tsc --noEmit` clean (10 s). Baseline cyc/cog for all lot functions re-measured with temp eslint config (cyc/cog 10): matches the brief exactly.
- Worktrees: /home/user/wt-<LOT>, branch cloud/w3-daemon-<LOT>, scratch /tmp/w3-daemon-<LOT>/ (cx.config.mjs pre-copied). Helper /tmp/w3-mkwt.sh.

## Lot status
| lot | status | branch head | measured worst cyc/cog before→after | coverage (stmt/br/fn/line, coordinator re-run) | verify |
|---|---|---|---|---|---|
| L063a | MERGED 01d82bfd | 0547cb93 | tool-executor 32/34→10/7; bridge 11/0→8/4; attachment-content 13/20→9/9 | all 3 files 100/100/100/100 (16 test files, 645 tests) | eslint 0, tsc 0, tests green no Errors, guard no new |
| L063b | MERGED 0fc0693d (after doc fix 0bf62c5e) | 0bf62c5e | run-credentials 25/20→8/6; terminal-session 11/0→8/6; legacy-migration 14/0→7/7 | all 3 100/100/100/100 | first merge rejected locally (runExclusive JSDoc detached by inserted helper) → sidekick fix → re-merged, green |
| L083a | MERGED | b38cdc44 | model-proxy 21/19→≤10/≤10 (0 errors) + new model-proxy-fields.ts | model-proxy 100/100/100/100, fields 100 | green; all moved comments located |
| L083b | MERGED | 831d188f | host-tools 13/19→8/10; terminals 18/14→9/6; new resource-request.ts 4/3 | all 3 100/100/100/100 | green. Note (Recommended): new `as unknown as` spawn fake in host-tools.test.ts (file already used `as any` for same) |
| L083c | MERGED 2b9ab7bc | c3b3eaaa | delegated-tools 13/1→10/9 (worst untouched handle); research 14/13→9/6 | both 100/100/100/100 | green |
| L259a | MERGED f830574d | ab1c0b27 | handleAttachmentUpload 11/6→7/3 (file worst 10/8) | changed fns 100%; file 99.06/98.56/100/99.06 (rest = L259b) | 1 test fails — ALSO FAILS ON BASE (see findings) |
| L259b | MERGED b7ff4081 | 065090cc | coverage-only (ftypBoxEnd exported module-locally as test seam; not in barrel) | 99.06/98.56/100/99.06 → 100/100/100/100 | green except known base failure |
| L259c | MERGED | 0593c473 | memory 12/9→8/7; runs 11/7→8/6 | both 100/100/100/100 | green |
| L215-L217 | MERGED 5174045d (after fix 871db948) | 871db948 | retry 16/13→6/2 (file 6/7); recovery 14/13→8/7 | both 100/100/100/100 (162 tests) | first merge rejected locally: `sideEffects[flag] === true` loosened a truthy retry-safety guard → sidekick restored truthiness + malformed-input test (RED/GREEN shown); re-verified green. Note: intermediate commit 2132f924 does not typecheck (fixed by 871db948; not rewritten — no force-push) |
| L126-L228 | MERGED | 55e71734 | tool-audit 12/14→8/5; tool-gaps 20/22→8/7; antigravity 14/12→8/5; mcp-bridge-probe 11→8/3 | all 4 100/100/100/100 | green; guard 26→24 (2 HW3 fixed via ReadonlySet); launch.ts untouched, no export changes. Note (Recommended): `as unknown as ChildProcess` spawn fake in new probe test |

## Guard
`pnpm guard` exits 1 on BASE with 26 pre-existing violations (HW1/HW3/N1/R10/R13; R13 lines differ only by local CLI availability). Criterion used: no NEW violations vs base — held after every merge.

## Findings (security / bugs, all pinned or reported, none fixed)
- attachments.ts `isUnchangedAttachment` (~517-524) compares dev/ino/size only, no mtime/ctime → same-size swap passes on ext4 (inode reuse) — TOCTOU. Existing test "rejects a file replaced by a different file of the same size after registration" FAILS ON BASE in this container.
- http/memory.ts: mutating routes return raw store exception text to HTTP client (path leak) — pinned "(reported, not fixed)".
- tool-recovery/recovery.ts: normal (non-setup) recovery path asks for/forwards fields like `apiKey` with no containsSecret filter, contradicting header claim — pinned "(reported, not fixed)". remedyReportedFailure only recognises top-level saved/created/cancelled/connected.
- http/model-proxy.ts: a throwing host `onInternalError` escapes as unhandled rejection (catch-all calls it twice first) — pinned (reported, not fixed). Azure whitespace baseUrl accepted at parse (fails closed later).
- http/terminals.ts: create accepts NaN/Infinity/negative/fractional cols/rows and any non-empty shell string; resize coerces via Number(); open-in passes resolver dir as editor argv (leading `--` → flag); probeCommandOnPath honours relative PATH entries — all pinned (reported, not fixed).
- research.ts: host provider with id 'tavily' gets TAVILY_API_KEY by default; resolveCredentials errors reach sink unredacted (pinned as current behaviour).
- run-credentials.ts (by design, documented): body.runId check only with validateDelegatedRunId opt-in; proxy-token requests pass caller principal header through (host must strip).
- Outside lots: http/delegated-tools.ts:333-339 passes `signal` in bridge's first arg rather than optional arg (pinned in bridge test).

## End-of-wave checks
- `pnpm --filter @jini-ai/daemon build`: ok.
- Whole daemon suite, wave (cloud/w3-daemon @ 5174045d+): 133 files, 3368 passed / 1 failed, no `Errors` line, 58 s.
- Whole daemon suite, base (origin/general-work 6bdca722, clean worktree, dist copied): 121 files, 2636 passed / 1 failed, no `Errors` line, 56 s.
- The single failure is the SAME test on both (attachments same-size swap TOCTOU, environment-dependent inode reuse). +732 tests, +12 test files in the wave.
- tsc --noEmit daemon: clean on both. guard: base 26 → wave 24.
- More findings: L126-L228 pinned (reported, not fixed): tool-gaps `observe` throws RangeError on NaN `ts` after marking tool seen (tool never recorded); antigravity-permissions with symlinked settingsPath copies the link TARGET's bytes into `<settings>.jini-backup` before the atomic writer refuses the symlink. L259b: attachments test "does not leak an unhandled rejection when JINI_ALLOWED_ORIGINS is malformed" (~attachments.test.ts:1686) is hollow (sets process.env; guard reads adapter.env), and the comment at attachments.ts ~1475-1480 is stale (configuredAllowedOrigins no longer throws). L063a: http/delegated-tools.ts:333-339 signal passed in bridge first arg.

## Subagent usage (tokens / tool calls, from task notifications)
L083c 123k/37 · L063b 140k/52 · L083b 163k/50 · L083a 178k/39 · L259a 107k/25 · L259c 112k/33 · L215 157k/43 · L063a 199k/72 · L259b 110k/36 · L126-L228 180k/70 · fix sidekicks 23k/6, 25k/7. No hand-offs, no overruns.

## Next
ALL 10 LOTS MERGED into cloud/w3-daemon. Owner: review and merge cloud/w3-daemon into general-work. Follow-ups: fix the TOCTOU in isUnchangedAttachment (add mtime/ctime or content hash), hollow JINI_ALLOWED_ORIGINS test, mcp-bridge-probe HW1 (needs hostEnv option; touches launch.ts importers), memory.ts raw store errors to client, recovery.ts secret filter on non-setup path.
