# tc-wave2a report (2026-11-17)

Branch `wave2/tc-a` in both repos. Bases: Jini `65d73b0d5`, Tovu `232764af5` (`origin/refactor/terra`).
Plan: `plan/tool-call-fixes-2026-11-16` (INDEX, README, S1, S12a, S13, S6). Owner decisions `plan/owner-decisions-2026-11-17`:
TC-OD1 and TC-OD8 decided = Rec, TC-OD9 = Rec (no change needed). The INDEX table still says OPEN, so README block 4.10 was not run literally.

## Result per sheet

| Sheet | Result |
|---|---|
| S1 `404 UNKNOWN_TOOL` | **Done** (Jini, 9 commits). Tovu: no source change (see "Tovu readers"). |
| S12a declared `clamp` | **Done** (Jini, 7 commits). Prerequisites S3 and S6 are not landed: see Deviation 1. |
| S13 Tovu declares repairs | **Partly done** (Tovu, 3 commits). Done: alias, pages not-found sentence, clamp classification and gate. Not done: everything that needs S12b (`obtainFrom`) or S4a (guide lint). See Deviation 2. |
| S6 trusted vocabulary | **STOPPED, not started.** Landed check `rg -n "describeDaemonFailure" packages/mcp/src/server/daemon-error-text.ts` exits 2 (file absent: S8 has not landed). A real dependency (S6 applies the vocabulary in S8's formatter), not base red. |

## Commits (all pushed)

Jini `wave2/tc-a` (base `65d73b0d5`), oldest first:
- S1: `d9783635` characterization · `6dff4665` code `UNKNOWN_TOOL` (protocol, core) · `29ae09c2` `core/tool-call-text` · `f17fcbb1` daemon `resolveToolTarget` · `7980239b` route answers 404 on both gateways · `c998f9d3` MCP-local sentence · `9e9bd632` OpenAPI + changeset · `10affd1f` refactor (`checkToolGates`, complexity 11 → 10) · `25996654` server test (stale-dist catch, see Gates)
- S12a: `a5e25390` characterization · `96c559de` step 0 (unknown keywords are safe) · `f5618736` `core/tool-input-repairs` · `ff1672b9` normalizer clamps on every registry path · `8a6af618` MCP-local tools opt in · `1e646094` refactor (4.16) · `81cab2a5` changeset
- `b7724fca` docs (CAPABILITIES.md, core README)
- (this report: last commit of the branch)

Tovu `wave2/tc-a` (base `232764af5`):
- `ad6423bb` `theme_duplicate` accepts `sourceId` (S13 case 1)
- `6deb0935` clamp classification of 20 schema locations in 16 files + gate test + 5 pinned tests updated + golden rewritten (S13)
- `6bfbc8a4` pages not-found says which tool lists pages (S13 case 5)
- (this report: last commit of the branch)

## Gates run (exact commands, results)

Setup: Node 24.22.3 in `~/.local/node24`; Jini `pnpm install --frozen-lockfile` then `pnpm --no-bail -r build` (green); Tovu `npm ci`,
`JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs` (dry run: 0 links to change), `npm run build` in `packages/contracts` and
`packages/sdk` (without them Tovu typecheck fails with `Cannot find module '@tovu/sdk'`: setup gap, not base red). Vitest in Jini needs
`--poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2` (the plain `--maxWorkers=2` makes tinypool throw).

Jini green baseline on the unmodified tree: `pnpm guard` ok · `pnpm typecheck` ok · tests protocol 793, core 2934, daemon 4722 (+1 skipped), mcp 1776.

Jini final (HEAD, after the last code change): `pnpm guard` rc 0 · `pnpm typecheck` rc 0 (full workspace, 1m41) ·
protocol **794** · core **2964** · daemon **4745** (+1 skipped) · mcp **1791** · server **505** (+1 skipped; not baselined) · devops 1248 · sqlite 9. All pass.
`pnpm api:check` is red on the base (dozens of unrelated added exports); my additions to it are `core ./tool-call-text`, `core ./tool-input-repairs`,
`protocol GENERIC_ERROR_CODES`. I did not run `api:update` (it would record unrelated drift).
README 4.3 to 4.7, 4.15, 4.17: print nothing in both repos. 4.9: `node --input-type=module -e "await import('@jini-ai/core/<entry>')"` from `packages/mcp` prints the exports for both
new entries; no `node:` import in either file. 4.16: Jini prints one line: `mcp/src/server/tool-result-pages.ts: Function 'createToolResultPages' has too many lines (52)`
(was 54 on the base: it shrank, I moved the schema out). Tovu prints nothing.
4.8 (Jini) prints two rewritten comment lines in `daemon/src/http/delegated-tools.ts` (`* \`400 BAD_REQUEST\`. A genuinely unexpected throw…` and
`* every business outcome as a \`200\`. An unregistered \`toolId\` throws…`): the behavior they describe changed (404 UNKNOWN_TOOL with a registry), so the sentence was rewritten in the same place.

Tovu: `npm run typecheck` rc 0 · `npm run check:size`, `check:complexity`, `check:architecture` rc 1 on the base **and** after, with **no new line** vs the base output
(first run showed one: `features/post/agent-tools.ts max-lines 701 (baseline 699)`; fixed by putting `clamp: true` on the `maximum` line) · `check:errors` rc 0, same warn lines as base.
Final Tovu run after the pages commit: typecheck rc 0; check:size / check:complexity rc 1 with no new line vs base; check:architecture rc 1 identical to base; check:errors rc 0 identical.

Tovu tests (runner line of `package.json`, `--test-concurrency=2`):
- S1 inventory, 59 files that mention the route, `TOOL_OPERATION_DENIED`, `unknown tool`…: 835 tests, 821 pass, 13 fail, 1 skipped. All 13 fail with
  `ReferenceError: executorDefinitionPolicies is not defined` from `server/inbound/assistant/__tests__/helpers/daemon-source.ts` (a test helper that evaluates Tovu's own scope file; no Tovu file was
  changed in S1). Base red, not mine.
- S13, 671 files under the touched feature folders + `assistant/`: 8650 tests, 8610 pass, 29 fail, 11 skipped. 6 were mine (members contract, members `members_list`,
  server-logs schema, forms ×2, moved-tools golden): fixed and re-run green (77/77). 12 fail identically on the base: re-run with my changes stashed (80 tests, 12 fail:
  `AssistantDock` iframe, registry reload warning, `no production file … value-imports from src/assistant/`, 7 preview-tag Playwright cases, `real core tree has only reviewed pattern exceptions`,
  default launcher Playwright). The other 11 are `[postgres]`/postgres-named tests (no Postgres in the container); not re-run on the base.
- After the last commit: pages folder + `pages-read-html-batch` 309/309; `tool-registrations.contracts` 37/37 (was 36; +1 gate).

## Red-first evidence (failures pasted, not committed alone)

- S1 route: 8 of 15 failed before the route change, e.g. `read-only gateway: names the closest registered ids` → received `TOOL_OPERATION_DENIED … no tool "content_read" is registered; use search_tools`
  / unconstrained `BAD_REQUEST ToolExecutor: unknown tool …`; `check_messages …` and the byte-identical-answer cases failed on the code. Protocol: `expected [ Array(17) ] to include 'UNKNOWN_TOOL'`;
  core: `expected 500 to be 404`. MCP: four tests received `unknown tool: missing`.
- S12a core: `normalizeToolInput … clamp`: `expected { input: { limit: 8300 }, notes: [] } to deeply equal { input: { limit: 8000 }, … }`; registry path and batch item failed the same way.
  MCP local tools: 9 of 10 failed (`expected true to be undefined` = still refused).
- S13: `theme_duplicate` `Unknown input 'sourceId'. Declared inputs: sourceThemeId (required), newName (required), newId (optional), activate (optional), mode (optional). Resend with the declared name.`;
  gate: 29 undeclared controls (list below); pages: 3 failed on the old text.
- 4.12 gate order (scratch edits, restored): target gate removed → 8 named tests fail; read-only gate removed → 2 fail; gates moved before the run check → the 2 `unknown runId answers 404 NOT_FOUND before any tool answer` tests fail.

## Changed sentences (old → new)

- Read-only gateway, unregistered id: `403 TOOL_OPERATION_DENIED` `no tool "x" is registered; use search_tools — did you mean a, b?` → `404 UNKNOWN_TOOL` `There is no tool named "x". Closest names: a, b. Find tools with search_tools.` (no candidates: `There is no tool named "x". Find tools with search_tools.`).
- Unconstrained gateway: `400 BAD_REQUEST` `ToolExecutor: unknown tool "x"` → the same 404 sentence. A route mounted **without** `toolRegistry` keeps the executor 400 (no registry to decide with).
- `check_messages` as a gateway `toolId`: same sentence, now `404 UNKNOWN_TOOL`.
- MCP-local: `unknown tool: x` → `There is no tool named "x". Closest names: <every local tool name>. Find tools with search_tools.`
- `read_tool_result.limit 8300` and `search_tools.limit/max_results 26`: refusal → run with 8000 / 25 plus the note `limit was lowered to its maximum, N` (0 → `limit was raised to its minimum, 1`). Non-integers still refuse.
- `read_tool_result` missing-`resultId` refusal quotes the schema, which now ends `"limit":{…,"maximum":8000,"clamp":true}`.
- Every Tovu list/search page size (below): out-of-range `limit` is repaired with a note instead of refused (`forms_list_submissions`, `members_list`, …). Non-integers still refuse.
- `theme_duplicate({ sourceId })`: refused → runs as `sourceThemeId`, note `sourceId→sourceThemeId`.
- Pages: `PAGES_NOT_FOUND: page 'x' was not found` → `… was not found. List pages with content_post_list, then pass its id.`

## Deviations and decisions (read these)

1. **S12a ran with its landed checks failing** (`toolCallText` in `core/src/tool-call-text.ts` = S3; `diagnosticVocabulary` in `tool-protocol.ts` = S6). The sheet calls them "shared files only" (ordering of
   edits, not functionality) and the dispatch ordered S1, S12a, S13 before S6, so I ran it. Consequence: S3, S8, S6 will now rebase over my edits of `mcp/src/server/tool-protocol.ts`
   (`normalizeCallArguments`, two imports) and `mcp/src/server/tools/tool-catalog-tools.ts` (the `limit` / `max_results` schema lines and `argumentNormalization`).
2. **S13 is partial** (its prerequisites S12b and S4a are not landed; the dispatch said "clamp opt-in, OD8/OD9"). Skipped: `obtainFrom` on `THEME_ID_PROPERTY` and the `theme_list_files` missing-`themeId` texts (S12b);
   the gate's `obtainFrom` ↔ `tool-guides.json` rule and `check:tool-guides` (S4a, the script does not exist). Step 0 table: `theme_duplicate+sourceId` refused today (fixed);
   `theme_list_files{}` gateway text today `'themeId' (non-empty string) is required` (400; typed path is the MCP validator's `supply required argument`; unchanged, S12b);
   `web_screenshot_page+sitePath` already accepted (dropped); `web_screenshot_page+width`: no such property (the schema has the `viewport` enum), not an alias or a bound: listed for the owner;
   `web_fetch_page+sitePath`: the tool has no `sitePath` (a missing capability, not a repair): listed for the owner; `pages_read_html '/'`: slug accepted, the not-found sentence fixed. OD-9: nothing changed (no `themeId` default).
3. **Classification was one Tovu commit, not one per folder**, because the gate would otherwise be red between commits. `clamp: true`: `search_components`, `analytics_list_recent_hits`, `mail_list_activity`,
   `mail_list_suppressions`, `system_read_server_logs`, `deployment_ops_logs`, `fs_list_files`, `forms_list_submissions`, `forms_delivery_status`, `newsletter_list_subscriptions`, `email_template_list`,
   `content_post_search`, `change_sets_list`, `trash_list_items`, `content_read.{comment_moderation_queue,content_post,member,newsletter_campaign}` (page sizes), `web_screenshot_page.waitMs` (wait).
   `clamp: false`: the `image_transform` `resize`/`extract` `width`/`height` (output size and crop address: unsure → false). **Owner list:** confirm those `false`.
   **Six controls are owned by Jini packages and stay unclassified** (`library_list`, `content_read.media_asset`, `database_query_timeline`, `search_agent_plugin_local`, `assistant_chats_list`, `assistant_chat_read`):
   the gate carries them in a list that only shrinks (a declared entry fails the test). Next step: the cms/db/agent-plugins/chat owners add `clamp: true` in Jini, then delete those lines.
4. The sheet's red-first example `content_reed` gets **no** candidates from the existing `toolCandidates` (edit distance > 2), so the candidate tests use `content_read` (prefix).
5. MCP-local candidates are **all** local tool names (the sheet's wording). With 70+ typed tools the "Closest names" list is long and not ranked. Suggest ranking or capping in S3.
6. `core/package.json`: `./tool-call-text` and `./tool-input-repairs` in `exports` + `jini.entries`; `src/tool-input-repairs.ts` added to `jini.isolation.shared` (the isolation contract test failed without it: the normalizer imports a file that is also its own entry).
7. Two stale-dist traps: after a Jini source change Tovu and other Jini packages read `dist`. The first server run (before `pnpm build`) was green on stale code; the final run caught
   `create-local-node-daemon.test.ts` (400 → 404 UNKNOWN_TOOL), fixed in `25996654`.
8. Tests I replaced because the behavior changed on purpose (counts kept): `argument-shapes` 8 → 3 + 5 cases, `tool-catalog-tools` 4 → 3 + 1, `tool-result-pages` 4 → 2 + 2, forms rows `limit 500/0` → non-integer rows + a new repair test, members `limit` loop.
   The moved-tools golden was rewritten with `MOVED_TOOLS_GOLDEN_WRITE=1` (only `bytes` 755108 → 755434).

## Tovu readers of the old 403/400 (S1 inventory)
`rg -n "TOOL_OPERATION_DENIED" apps packages development` finds no Tovu file. Tovu's `delegatedToolRouteDeps` passes `toolRegistry: siteTools.registry`, the same registry the executor routes by and
the durable guard's `isRegistered` reads, so the new target decision cannot 404 a tool the executor would have run (federated `mcp__*` ids are not served by this route; they live in the BYOK surface).
Tests that pinned the old texts in Tovu: none through the Jini route (the one `delegated-tool-error-disclosure` test mounts the route without `toolRegistry`, so it still gets the 400).

## New Jini exports Tovu now consumes (for REL)
- `@jini-ai/core/tool-call-text` (`unknownToolSentence`): used by daemon and mcp only; Tovu does not import it (REL-1).
- `@jini-ai/core/tool-input-repairs` (`assertRepairKeywords`): imported by Tovu's gate test `assistant/__tests__/tool-registrations.contracts.test.ts`; **that test fails unlinked until REL-3 ships**. The `clamp: true` keywords
  themselves are inert in Tovu until the release carrying `normalizeToolInput`'s clamp (REL-3); they are harmless extra schema keywords (step 0 proved the MCP validator, `parseMcpToolInputSchema`, `tools/list` accept them).
- `UNKNOWN_TOOL` in `GENERIC_ERROR_CODES` and `statusForError` (REL-1).

## Overlaps with parallel runs
- Jini: `core/package.json` (export lines: S6 and others add theirs: keep both sets), `mcp/src/server/tool-protocol.ts`, `mcp/src/server/tools/tool-catalog-tools.ts` (S3, S8, S6 order, see Deviation 1),
  `daemon/src/http/delegated-tools.ts` and `daemon/src/core/read-only-tools.ts` neighbours (R7 moves `daemon/src/http/*`; S2a/S7/S12b edit the same route after S1),
  `core/src/contracts/server/api-error.ts` (error-system E5a, one row added).
- Tovu: 16 schema files across features (one `clamp: true` token each; a lane that moves them must carry it), `features/theme/duplicate-theme-tool.ts` (lane T T-TH-08 move list: this lands before it),
  `assistant/__tests__/tool-registrations.contracts.test.ts` and `moved-tools.golden.json` (any run that changes a schema bytes count rewrites the golden again).
  Not touched: `agent-daemon-scope.ts`, `theme-files.ts`, `package.json`, the lockfile.

## Not verified / left
- Tovu full `apps/website` suite not run (touched folders + `assistant/` only); admin/desktop apps untouched.
- The 11 postgres tests were not compared with the base. `pnpm api:check` baseline not updated.
- Next steps: S3 (wave 2) then S8, S6, S12b; S13 remainder after S12b + S4a; Jini owners declare `clamp` for the six listed controls; owner confirms the `image_transform` `clamp: false` and the two
  capability gaps (`web_screenshot_page width`, `web_fetch_page sitePath`); REL-1 and REL-3 publish.
