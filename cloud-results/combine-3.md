# combine-3 (2026-11-18) — integration branch `integ/merge-3-2026-11-18`

Both repos: created from `origin/refactor/terra` (Tovu `b5fbf2a5e`, Jini `6c9effae4`), one `--no-ff` merge per branch in the ordered list, Jini first; Jini built (`pnpm --filter "...[HEAD^1]" build`) and linked into Tovu (`link-jini.mjs`) before the Tovu half. Node 24.11.1, pnpm 10.33.2. `refactor/terra` NOT pushed. Lockfiles never edited (`pnpm install --frozen-lockfile` ok). Base ratchets recorded on the unmodified trees first: Jini guard/size/complexity/hooks/why-comments all exit 0; Tovu size/complexity/errors/hooks/why-comments exit 0, architecture BASE-RED (exit 1, same three hard metrics).

## Per-branch result

| branch | Jini | Tovu | notes |
|---|---|---|---|
| wave2/daemon-r7 | merged `cb44ec7a0` | merged `f2fd2678e` | Jini: `createFrontendControl` stays owned by `@jini-ai/daemon/http` (terra removed the server re-export; the branch's re-export dropped), spec rows merged (terra's `toolFamilies` kept), reference-web imports it from daemon/http, server barrel test lists `mountRoutes`/`nodeSessionTimer`, stale env-access debt row dropped. Tovu: `daemon-access.ts`/`visitor-request-origin.ts` import conflicts, `request-facts.ts` import repointed to `platform/express/public-origin`. |
| wave3/daemon-r8-2 | merged `5bb8b5db2` | merged `ad72b4aee` | Pins + the verified patch series under `cloud-results/daemon-r8-2/` only (the series itself is blocked by the lockfile rule until 2026-11-19, per the branch's report). |
| wave3/import-cycle-b-2 | n/a (no Jini branch) | merged `b1a9f73c1` | two test-import unions. |
| wave3/kt-k03-k04 | merged `0dde35f9a` | merged `66a6832b0` | see "Design fix" and "clamp". |
| wave3/kt-k07 | merged `4375cb957` | merged `d3f46853e` | |
| wave3/kt-k09-k10 | merged `3e1383af4` | merged `42f6ed886` | |
| wave3/xpkg-c12obs-r12 | merged `0463d581f` | merged `871b6aa07` | Jini: JSON 3-way merges of `injection-debt.json`/`why-comments-debt.json` (script), api-baselines of core/daemon/http-kit taken from terra (re-added by the api commit). Tovu: observability port imports (`@jini-ai/core/contracts/observability`) in 4 conflicted files + 2 importers the branch had not touched. |
| wave3/moves-b1 | merged `b9244b047` | merged `7cf2d0860` | email-templates index, widgets/entry-refs imports, mail-status test imports, `why-comments-debt.json` 3-way. |
| wave3/desktop-d0c | merged `87be94e82` (empty: its content was already in terra; only a `diagnostics/package.json` conflict, ours kept) | **SKIPPED: merged `99e4ffb09`, reverted `dd639c1fd`** | Cannot resolve with certainty: d0c moves `composition/jini-routes.ts` into the new `@tovu/host-shared` package, but wave2/daemon-r7 (already merged) made that file import the website's `#src/server/inbound/shared/request-facts` (`requestFactsLocals`), which a shared package (also consumed by the desktop) must not import. Needs a design decision (inject the request-facts locals through `mountJiniRoutes`' options, or move request-facts + `resolveProtocol`/`resolveClientIp` into host-shared). To retry: `git revert dd639c1fd` then resolve. |
| wave3/audit2-a | merged `c6f0c8786` | merged `79fbf9dc7` | clean |
| wave3/admin-j3-t1a | merged `513855141` | merged `7f5c680a4` | Jini: 15 conflicts. J4 moved admin's pure runtime + permissions into `@jini-ai/core/admin-runtime` (deleted `admin/core/permissions/rules.ts`, its two tests are duplicated in core); terra's `AdminKitProvider`/forms-catalog changes kept (`renderWithKit`, `fakeFormsCatalog`, kit `useThemeKit` + the branch's `useConsentSettingsPanelHook` prop on `ConsentLookFields`), J3's 3 tests re-added to terra's hook-props test, `hook-injection-debt.json` 3-way, stale `QueueActionsCell` key dropped. Tovu: one import conflict. |
| wave3/su-cms | covered by su-cms-3 (`git cherry`: all 4 commits already in su-cms-3) | same | not merged separately |
| wave3/su-cms-3 | merged `a33119832` | merged `a7fa3161a` | Jini `trash/index.ts` union; Tovu `trash/tool-registrations.ts`, `size-debt.json` 3-way. |
| wave3/su-s5 | merged `d8ab813ff` | merged `5fa3f7fb8` | clean |
| wave2/chat-deps, wave3/tc-wave5 | NOT MERGED (held) | NOT MERGED (held) | |
| superseded: wave2/daemon-r8 | not merged | not merged | Real code (Jini 6 commits `3de2c168`..`4f58cf30`, Tovu `6b058e2a`, `334aa87d`) but re-applied as the patch series in `wave3/daemon-r8-2` `cloud-results/daemon-r8-2/{jini,tovu}/*.patch`; blocked by the lockfile rule, nothing lost. |
| superseded: wave2/admin-j3-t1a, wave2/lo-th, wave2/notes-g4-g6 | not merged | not merged | each holds only a stop-report commit, no code |

## Design fix needed to keep Jini `pnpm guard` green (same R5 trap as combine-2)
kt-k03/k04/k09/k10 name `content_read.<entity>` in model-facing text (guard R5: engine source may not name a host tool). Fixed with the combine-2-fix port, extended:
- Jini `HostReadVocabulary` moved from `@jini-ai/cms/core` to `@jini-ai/core` (integrations, which has no cms dependency, needs it; no forwarder; callers repointed; `HostReadEntity` is now a plain string; neutral wording replaces every underscore) — commit "refactor(core): HostReadVocabulary moves…". Comments, seo, forms (cms) and webhooks (integrations) take `{ hostReads }`; forms/seo catalogs resolve per vocabulary, not at module level; each got a pinned test (host wording, neutral wording, no `{{read:` placeholder, no `content_read`).
- Tovu: `features/{comments,seo,forms,webhooks}/tool-registrations.ts` pass `contentReadVocabulary`; text a model sees is byte-identical (golden files unchanged except the clamp below).
## clamp
Terra added `clamp: true` to the Tovu catalogs of comments (`limit`), trash (`limit`) and forms (submissions + delivery-status limits) after kt-k03/k07/k10 had moved those catalogs to Jini. The Jini copies now carry it (3 commits) and the Tovu goldens of comments, trash, forms record it.

## Owner-approved daemon answers (kept)
remote-run-event routes POST-only; model-proxy/lookup own body reader (null/string 400, oversize 413 JSON); foreign origin + bad body 403 before 400 — taken as the daemon-r7 branch built them; the daemon suite (243 files, 4805 tests) passes.

## Gates — Jini (`/home/user/Jini`, final tree = this report's parent)
- `pnpm install --frozen-lockfile` 0. `pnpm --no-bail -r build` **0**, 0 `error TS` lines (run on the tree before the api-baseline commit; no source changed after it).
- `pnpm guard` **0** ("zero violations"; the one "stale hardwiring-debt" line is in the base output too). `pnpm check:size` 0 (139 debt entries vs 154 base). `pnpm check:complexity` 0. `pnpm check:hooks` 0 (78 direct hook calls vs 155 base; the J3/JM-pre branch retired most admin hooks). `pnpm api:check` 0 after `pnpm api:update` kept ONLY the 143 added exports (14 baselines; the changed hashes/removals it also reports are pre-existing drift and the J4 moves to `@jini-ai/core/admin-runtime`, left alone), committed separately.
- `pnpm check:why-comments` **exit 1 (RED): 170 open blocks of 176 lost** — 5 allow-listed with a containment path (≥0.80). ~165 of the 170 come from wave2/daemon-r7 itself (daemon `http/*.ts` doc comments of the deleted `register*` functions and the deleted `raw-sse.ts`/its tests; comment-only and test-comment blocks, text nowhere else). The branch was never checked against this ratchet (it passes on terra, red after the merge). NOT allow-listed in bulk: I will not claim blocks "moved" that the branch deleted. Needs the owner (restore the why-text next to the route-list code, or sign off the allow-list) before terra fast-forwards.
- Tests (full suites, vitest `--maxWorkers=2 --minWorkers=1`), each run on the tree right after the merge that touched the package: core 207 files/3034 pass; http-kit 28/555; daemon 243/4805 (+1 skip); server (barrel test fixed) all pass; cms 369/4419; integrations 100/2071; admin 245/3018; db 113/943; analytics 15/224; cookie-consent 19/181; diagnostics 66/1067; provider-plugins 60/898; platform/oauth/ui/user-management/agent-plugins/desktop-host changed-file tests pass. NOT re-run as one sweep on the very final tree.
## UNRESOLVED (read first)
1. Jini `check:why-comments` RED (170) — daemon-r7 deletions, see above. 2. Tovu `check:why-comments` RED (24). 3. Tovu `check:architecture` has new lines beyond BASE-RED (list above). 4. Tovu `wave3/desktop-d0c` skipped (host-shared vs request-facts design). 5. Final full changed-test sweep not run on the merged trees. Do not fast-forward `refactor/terra` before 1–3 are ruled on.
