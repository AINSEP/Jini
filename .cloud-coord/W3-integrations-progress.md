# W3 integrations — coordinator progress

Branch: cloud/w3-integrations (base origin/general-work 6bdca722). Brief: origin/cloud/w3-briefs:.cloud-coord/W3-integrations-brief.md

## Personas
- Coordinator loaded: software-architect, code-inspection, security (../AI-Dev-Shop/agents/*/skills.md, cloned 05:35Z).

## Setup (run 2 — a prior run at 04:30Z pushed only its cloud-proof commit)
- Container: 4 cores / 15 GB. Node 22 preinstalled; Node v24.22.0 installed from nodejs.org tarball into ~/.local/node24 (PATH prefixed per command; persisting it in shell rc was refused by the sandbox). pnpm 10.33.2 already present (corepack not needed).
- `pnpm install --frozen-lockfile` 25 s; `pnpm --no-bail -r build` 2 min (only @jini-ai/integrations fails tsc on its own tests; dist emitted).
- Base `tsc --noEmit -p packages/integrations`: 8 errors, all in test files (convention-tests/merge-contracts.test.ts ×2, webhooks/__tests__/delivery.test.ts ×5, webhooks/__tests__/vocabulary.contract.test.ts ×1). Lots must not add to this list.
- Base complexity (cyc/cog >10) over the 22 lot files: 45 eslint errors (/tmp/w3-integrations-coord/base-cx.txt).
- Worktrees ../wt-<LOT> for L052a, L052b, L048, L129a, L129b; dist copied from main checkout.

## Resume (run 3, coordinator #2) — 2026-10-20 06:17Z
- Previous coordinator stopped ~05:46Z at the account usage limit; its subagents died. No lot branch (cloud/w3-integrations-*) existed on origin → every lot restarts from scratch.
- Fresh container: Node v24.22.0 re-installed into ~/.local/node24 (PATH export per command), AI-Dev-Shop re-cloned, coordinator personas re-loaded (software-architect, code-inspection, security). install 21 s, `pnpm --no-bail -r build` 06:18:30→06:20:19 (integrations tsc fails on its tests only; dist emitted).
- Base complexity re-measured: 45 errors (/tmp/w3-integrations-coord/base-cx-all.txt). eslint temp config: /tmp/w3-integrations-coord/cx.config.mjs (createRequire from repo root).
- Worktrees recreated for L052a, L052b, L048, L129a, L129b; subagents re-dispatched ~06:25Z. L235 queued.

## Lot status
| lot | status | subagent | commits | before→after worst cyc/cog | coverage | verify |
|---|---|---|---|---|---|---|
| L052a | MERGED b2e9e3c5 | run3 agent (~163k tok, 57 calls) | d92710f5 206c3a0f b0a0e2f0 fae19968 b00bf49a 0daa64e7 fddf6067 | context buildRenderContext 12/0→8/0; outbound fetchMediaOutbound 14/0→7/3 (34,560-input old-vs-new differential, deleted); async-operation-store update 20/11→4/1, hydrate 13/0→8/0 (file worst now claimDue 9/10); sqlite updateTxn 21/11→3/2 | coord re-run: all 4 files 100/100/100/100, 10 files 268 tests, no Errors line | eslint 0, tsc = base 8, guard 26 = base; diff review OK (one `as unknown as` = commented malformed-input fixture; new helpers exported at module level only, dispatch/index.ts uses named re-exports so public surface unchanged) |
| L052b | dispatched (run 3) | | | | | |
| L048 | MERGED 6e0229e0 | run3 agent (~170k tok, 51 calls) | de1d21a6 843f4478 f1066217 855d63f4 92c88800 430119e3 81287722 17302bf8 | policy evaluate 12/0, staging stage 18/24, task-store update 17/14 + reconcileOnBoot 11/0, sqlite updateTxn 17/14, video-request buildVideoRequest 18/30 + normalizeVideoResponse 36/13 + mergeExtraBody 0/11 → all ≤10/10 (eslint 0); old-vs-new differentials: policy 1,536, staging 644 fs scenarios, video >5k builds + >20k normalize (deleted) | coord re-run: 6 files incl. new task-lifecycle.ts 100/100/100/100, 9 files 321 tests, no Errors line | eslint 0, tsc = base 8, guard 26 = base; diff review OK (SEC staging/policy: every check kept, order kept, comments moved; task-lifecycle imports task-store types only — no runtime cycle; `as unknown as` only in commented malformed-input fixtures) |
| L129a | MERGED 959bdb48 | run3 agent (~136k tok, 41 calls) | c221d962 ea3b7421 41eda400 446a8626 5c00e6dd b3a3f431 87da92e5 4ca5dd77 | aihubmix 15/14→≤10, imagerouter-video-async 11/11→≤10, imagerouter 10/13→≤10, nanobanana 12/16→≤10 | coord re-run: all 4 files 100/100/100/100, 11 files 196 tests, no Errors line | eslint 0, tsc = base 8, guard 26 = base, diff review OK (moved test dispatch/__tests__/imagerouter-video-async → providers/__tests__) |
| L129b | MERGED 097c22fc | run3 agent (~137k tok, 41 calls) | 00c8c17c fd5a4583 bec1250d a366ad28 680f1f99 511e340e | openai 13/11→8/9, openrouter 16/9→8/5, senseaudio 13/11→9/6 | coord re-run: openai/openrouter/senseaudio 100/100/100/100, 14 files 287 tests, no Errors line | eslint 0, tsc = base 8, guard: 26 violations = same as base (none in integrations), diff review OK |
| L235 | MERGED bd7c4098 | run3 agent (~135k tok, 37 calls) | 27570096 737d2fd6 bb2520c3 a629ab09 9f164bd1 | auth-schemes parseRule 12/0→5/4 (commit 737d2fd6 subject says cog 2 — measured 4; file worst parseCredentialSchemesFile 9/8 untouched); credentialed-request makeCredentialedRequest 13/11→5/3 (new response-redaction.ts worst 5/7); differentials: 27k+ rule files, 1,152 request scenarios (deleted) | coord re-run: auth-schemes/credentialed-request/response-redaction 100/100/100/100 (4 files 149 tests) + barrel importers (package-surface, merge-contracts) 5 files 141 tests pass, no Errors line | eslint 0, tsc = base 8, guard 26 = base; SEC diff review OK: egress-refusal rethrow kept (isEgressRefusal now called once; a JS host whose describeEgressRefusal returns undefined would now get a wrapped, redacted TransportError instead of a raw rethrow — fails closed, typed port forbids it), audit key order kept, prefix non-empty enforced by anchored `+` pattern, why-comments moved |

## Findings (bugs / security) pinned
- L235 (reported, not fixed): SECURITY — ConsoleCredentialedRequestAuditLog writes label raw → newline in label forges audit lines; redactResponseHeaders scans values only, so a secret in a header NAME is kept. Not a leak: transport error under <8-char token says "[body withheld…]" (pinned). Left: exported `CredentialSchemeRegistry` interface in auth-schemes.ts is unused (public export, not removed).
- L048 (reported, not fixed): SECURITY fail-open — policy.ts treats `mode: undefined` or unknown string ('off') from an untyped host as ENABLED; staging: in-cwd file named `..foo.png` treated as outside cwd (fails closed); sqlite-task-store: unknown stored status → TypeError in update() and reconcileOnBoot never cleans the row; video-request: object-valued url → "[object Object]". Not pinnable (races): staging TOCTOU between realpath/stat and copyFile (symlink swap, size change) and staging-dir symlink check before writes/prune; uploadRoot `/` admits everything (by design). Outside scope: vendor URL from normalizeVideoResponse must be SSRF-checked by whoever downloads it (caller not located).
- L052a (reported, not fixed): hydrate passes unknown status string through (in-memory claimDue treats it live); assertTransition throws TypeError not RangeError for Object.prototype keys ("toString"); SECURITY fail-open: a Map stored under allowed key `jobId` bypasses the credential allowlist (Object.entries(Map) empty; structuredClone keeps Map); maxAttempts accepts fractions (pinned). Not pinned: sqlite claimDue order = insertion not nextPollAt; fetchMediaOutbound sets no Content-Type for URLSearchParams body.
- L129a (reported, not fixed): aihubmix gemini non-JSON 200 → raw SyntaxError; empty `inlineData` masks same part's `inline_data`; aihubmix openai providerNote prints "undefined" with no aspect; imagerouter video poll `completed` with no data stays pending forever. Security: none seen.
- L129b (reported, not fixed): openai.ts + senseaudio.ts throw raw TypeError on JSON `null` body; openai speech drops instructions for non-gpt-4o-mini-tts but still notes "styled"; senseaudio `base_resp: {}` → "api error undefined: unknown". Security note (outside scope): adapters do not SSRF-check caller-set `credentials.baseUrl` (main request) — unverified whether engine/guarded client does.

## Problems
- `pnpm guard` is RED on base origin/general-work too (26 violations in agent-runtime/chat/cms/core/daemon/ui/diagnostics; 0 in integrations). Verify criterion used: no NEW guard lines vs base (/tmp/w3-integrations-coord/guard-base.txt).

## Next
