PARTIAL 9704b28b2a 90b3affd3: K5-contracts-core-3/1/2/6/7/8/10, K5-publish-content-3..6/ui-1, K5-settings-1..4, K5-media-1/2/4, K5-agent-plugins-*, K5-plugin-runtime-*, XC-1..5, XC-6a fs.ts + XC-6b..d, K4-seam-1 vault (B6b), K4-seam-2/4/5/7/8/9/11..17/20..23; Tovu test attribution unfinished (22 files inconclusive, see "Tests")

# ex5 — FOUNDATION: K5 injection bases (2026-11-22/23, unattended)

Bases: Jini `integ/merge-14-2026-11-22` 4902a6a1a, Tovu `integ/merge-13-2026-11-22` f7185f153 (tip of 0d7f78fa4 + report). Branches: Jini `codex/ex5-fnd-inject-jini` **90b3affd3**, Tovu `codex/ex5-fnd-inject-tovu` **9704b28b2a**. Plain `git push`, `pull --rebase` first (always a no-op). Setup as combine-13 (Node 22.23.5 here, not 24; pnpm 10.33.2; Jini frozen install + `-r build` 0; Tovu `npm ci` ×4 + link-jini 0). Clone was shallow: `git fetch --deepen=400` was needed for the XP base 35c4961af.

## Why these steps
Every K5 step in this lane's scope depends on `K4-seam-*` type seams, and none of them had landed except 2/3 of K4-seam-1.J. So the run built the seams first (they are FOUNDATION-owned), then the K5 steps they unblock.

## Batches (subagent = Opus high; coordinator reviewed, integrated reserved files, built, gated, committed)
| batch | step(s) | Jini commit | Tovu commit | result |
|---|---|---|---|---|
| A1 | K4-seam-1.T (approval) + K4-contracts-core-5 J/T | ea2cb0941 | 03a8ea066a | DONE: approval-policy.ts deleted, `HostToolApprovalPolicy` = core `ToolApprovalPolicy<six rules>` in tool-metadata/index.ts; 9 decls → `@jini-ai/core/tool-metadata/*` (media-generation + 6 excluded HELD per P9F) |
| A2 | K5-contracts-core-4 | ea2cb0941, 59df376ac | 03a8ea066a, 0a50b40c5e | 11/16 moved. SKIP agent-plugins.ts (model-facing keyword `tovu-theme`: owner), commerce/comments (feature lanes), assistant.ts (needs AgentEvent inject — now unblocked by seam-18), content-read.ts (moved, then **returned**: `content_read` is a guarded host tool name, R5) |
| B | K5-publish-content-1 | befd1fd43, 59df376ac | 03a8ea066a, last commit | DONE 11/11 + 4 tests → `@jini-ai/cms/publish/content/*`. **Behaviour (K5 W1):** `canPublishToLive(options)` takes `resolveRuntimeMode` through its existing options; callers publish-tool, dev-auth, peer-transport, test pass Tovu's. 92 importers. media-references now imports marker/gallery leaves; `gallery.ts` + `media-reference.ts` added to cms `isolation.shared` (SI-domain; precedent 46cbb7d4). ui-stays-client-safe boundary test allows the type-only edge to the Jini report contract |
| C | XC-6a | 6f1b7e2de | 3a79a5a93d | PARTIAL: process.ts + agent-plugins.ts injected (`nodeProcessControl` removed; `createNodeAgentPluginEffects({withFileLock, writeJsonFileAtomicAsync, readBootIdentity})`; agent-plugins peer dep dropped). fs.ts SKIP (constant maps, no args object → owner: new factories or drop `./fs`) |
| D | K4-seam-3 J/T (paired) | 3bbc09f86 | 03a8ea066a | DONE: Tracker types → `@jini-ai/core/contracts/site/diagnostics-observability`; diagnostics exports only TrackerOptions/Providers (major); 52 Tovu importers |
| E | K5-platform-routing-1 | — | — | SKIP all 3: adapter.ts is the host composition root (no args object; owner INFO.md 2026-10-09), reserved-paths = product policy, index = barrel. Sheet stale: generic half already `@jini-ai/cms/routing` |
| F | K4-seam-10 J/T | 7973f65eb | 3a79a5a93d | DONE (targets 1/6 already in core/contracts/cards; T half only). Owning packages keep `export type` re-exports (paired removal later). assistant/tool-contributions.ts deleted |
| G | K4-seam-1 B6 (surface) | 1293444b0 | 3a79a5a93d | Surface DONE (daemon duplicate removed, major; 93 Tovu importers). **Vault NOT done:** core `activeKey({})` vs ~10 zero-arg `activeKey()` callers (oidc-login.ts:83, site-sealer.ts:10, vault-adapter.ts:139, oauth-pending-store.ts:105, storage-secret.ts:76, + tests) → B6b |
| H | RT-K1-0.T (B2) + K4-i18n-common.T | — | d8e3a42d3c, 8cd6675b3d | DONE: settings refusals from `@jini-ai/core/errors/route-refusal` (catch reads `error.response`), cap from `@jini-ai/cms/admin-http/limits` (same value); COMMON_I18N = Jini dict then host branded key (58 identical keys dropped; 716 → 65 lines). B8 mount cutover not done |
| I | K4-seam-19 J/T | 90b3affd3 | 0a50b40c5e | 7/8; PublicPostKind → Posts lane (9 importers). ChatPermanentDeleteToolId spelled as a literal union in core (Tovu table `satisfies`) |
| J | K4-seam-18 J/T (shared) | e8b493aad | 0a50b40c5e | chat-core (AgentEvent), core-run-events, core-commands, assistant-mcp-services. Desktop/Ops targets handed to those lanes. ConversationToolApprovalKey duplicated vs mcp (follow-up) |
| K | K4-seam-6 J/T | 2785ce123 | 0a50b40c5e | DONE as far as XP4 allows; React controllers stay. **cookie-consent now depends on @jini-ai/core** (was dependency-free) — OWNER CHECK |

Jini changesets: core minor ×5, cms minor, diagnostics major, node-adapters major, daemon major, cookie-consent minor. Core tool metadata lives at `src/tool-metadata/`, not `contracts/site/tool-metadata/` as the sheets say: those files are values, and XP4 forbids runtime under core `contracts`.

## Named mutations run
identity `confirmation: 'plan'` → identity.test RED, restored. agent-plugins injected `withFileLock` replaced → injection test RED, restored. media-references `collectMediaUrlKeys` returns empty → media-references.test RED, restored (**finding:** dropping its `/m/` URL scan was NOT caught — coverage gap; the sheet's content-hash.test target cannot catch it). Seam-18 mutations run by the subagent against a scratch tsconfig (both RED). Not run: i18n Spanish `Save` (J half ran in combine-14), seam-3/6/10/19 type renames.

## Gates (base-diff)
**Jini** (final tip, clean worktree): build 0 (0 error TS); typecheck 0; guard 0 (was 2 violations mid-run, fixed in 59df376ac); api:check 0; hooks 0; why-comments `--base 4902a6a1a` 0 (2 obsolete blocks allow-listed with reasons; ProcessFunctions comment restored); size 1 and complexity 1 = **identical rows to combine-14 base** (BASE-RED); XP (`--base 35c4961af`, no declaration snapshot) XP1 39→35, XP2 33→**34**, XP5 6→5: the +1 XP2 is `server/kernel-base.ts → @jini-ai/platform/process` (edge moved from node-adapters to the server composer; XC-6c site). XP3/XP4 counts differ only from base worktree having no dist.
**Tovu** (final tip): typecheck 0; typecheck:tests 0; typecheck:scripts 2 = same 3 base errors; admin tsc 2 = same 4 BASE-RED errors (A-K2-0a.T not landed); desktop tsc ×4 0; complexity 0; errors 0; boundaries 0; hooks 0; architecture 1 = 60 NEW-edge rows identical to base; why-comments default needs `origin/refactor/terra` (absent here; failed identically at base) — `--base f7185f153`: 25 lost blocks, all moved with code to Jini, allow-listed (dfed0e0f1d) → ok; size 1: same rows, but dev-auth 508→509, assistant-byok 531→532, publish-agent-tools 775→777 (import lines from B/F/G).

## Tests
- Jini: core tool-metadata 2/2, cms publish/content 56/56, node-adapters 38/38 (+3 new), daemon surface contract 1/1, server kernel-runtime 2/2.
- Admin vitest (related to changed admin files + i18n stay gates): 5 red; 4 identical at base (JiniMediaPicker ×3, dictionary-lookup-sinks); app-panel-permissions passes alone (load flake).
- Tovu node: 803 files planned (changed + importers). Run 1 was invalidated by my mid-run content-read revert. Run 2 (635 files): **482/635 finished** when the budget ran out, 60 non-zero. Of the first 46 reds: **23 identical at base** (BASE-RED with this Jini linked); planner-hash-upgrade was mine → fixed (3/0); ask-choice-tool is a load flake (28/0 alone); **22 inconclusive**: base Tovu cannot load against the new Jini API (base 0/1), mostly static-publish, site pages routes, template-render canary, app.consent-capture, wiring-identity, production-readiness-boot, byho-compat, site-phase-handler-fail-policy. automatic-agent-plugins 41/2 and bundled-inactive-gating 7/1 match combine-13's base-red counts. 12 more non-zero files after that point were not attributed (list in the run output). **Codex review: re-run these against Jini base + Tovu base before merge.**

## Unblocked lane steps
12 steps now have all prerequisites (A-K2-seo-1, K4-contracts-core-5 rest, K4-plugins-1, K5-agent-plugins-1, K5-contracts-core-3/4, K5-presentation-1, RT-K1-adm-{content,database-recovery,redirects,sites,system}-1), and 261 have fewer open prerequisites (full list: `cloud-results/ex5-fnd-inject-unblocked.txt`). where-used.ts (ex4-media hold) can now move: media-references is in Jini.

## Skipped / owner decisions
K5-contracts-core-3 (and core-1): sheets put runtime values (rate-limit.ts, secret-scan, …) under core `contracts/site` → needs a destination decision (XP4). K5-settings-*, media-*, plugin-runtime-*, agent-plugins-4..8, publish-content-3..6: prerequisites still open (see the unblocked file). XC-1..5 not started (XC-1 BLOCK in codex verify). Owner: agent-plugins metadata keyword, node-adapters fs.ts, cookie-consent dependency, cms shared-isolation additions, custom-credentials metadata keywords mention "openai".

## FILES LEFT (scan.mjs + plan.mjs)
| tree | FILES-LEFT | excl. themes |
|---|---|---|
| base f7185f153 | 2,486 | 2,375 |
| tip | 2,454 | 2,343 |
