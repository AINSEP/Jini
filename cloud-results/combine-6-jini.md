# combine-6 JINI (2026-11-19/20) — `integ/merge-6-2026-11-19`

Unattended cloud run, 22:30–~01:30 UTC. Branch created from `origin/integ/merge-5-2026-11-19` (`e06b3c20`). Node v24.22.3 (`~/.local/node24`), pnpm 10.33.2. No subagents, no codebase-memory tools, no force-push, no `--no-verify`; only this branch pushed.

**Summary: all 7 listed branches merged (ex-log, xd-admin, xd-lockfile, xd5-desktop, xd5-render, xd5-publish, jini-wave-a3). Final tree: full build 0 errors, typecheck 0 errors, guard 0, size / complexity / hooks / why-comments pass; error gate and log-safety stay BASE-RED with one new error-gate line (below). One Codex piece dropped (cms React control). Final full suites: see "Tests".**

## Method
- Per merge: `pnpm --no-bail --filter "...[<pre-merge>]" build`, `tsc --noEmit` of changed packages, then the gates (`/tmp` script): `pnpm guard`; `SIZE_BASE_REF=e06b3c20 node scripts/check-size.mjs`; `COMPLEXITY_BASE_REF=e06b3c20 node scripts/check-complexity.mjs`; `node scripts/check-hook-injection.mjs`; `node scripts/check-why-comments.mjs --base e06b3c20` and default (terra); `node scripts/check-error-gate.mjs`; `node scripts/check-log-safety.mjs` — diffed against base output.
- Tests: full package suites (`npm --prefix packages/<p> run test`, vitest `--maxWorkers=2 --minWorkers=1`) in a separate worktree per group; `vitest run` on the touched test files in the main tree while fixing.
- Debt-file conflicts: 3-way per key (removed on either side stays removed; both changed → lower).

## Base (`e06b3c20`), recorded first
- `pnpm install --frozen-lockfile` 0. `pnpm --no-bail -r build` 0 (0 `error TS`). `pnpm -r --no-bail --if-present run typecheck` 0 + `tsc -p scripts/tsconfig.json --noEmit` 0.
- guard 0 (zero violations); size 0 (71 entries); complexity 0 (2); hooks 0 (33 direct calls in chat); why-comments vs base 0, vs terra 0 (179/179 allow-listed).
- check:errors exits 0 but BASE-RED (WARN, 24 new-or-worse); check:log-safety exits 1 (BASE-RED, 15 "new raw log path" lines).

## Group 0 (finish merge-5)
(a) Lockfile: **no-op** — merge-5 already had the `pnpm install` fix (`3741ddd8`); frozen install passes, plain `pnpm install` changes nothing.
(b) **ex-log `4f7d4d37`** → merge `42f3a459`. 57 conflicted files:
- 26 hook-injection-only files: took HEAD. mcp `config.ts`/`tokens.ts`: **ext-r11b2's required files port kept, only ex-log's `report` option** (no default Node filesystem); token get/set/clear/readAll forward `report`.
- `provisionAgentPluginMcpServers` + callers (access-token-tool, connect-tool, plugin-host): HEAD's `({ deps, ...input })` + `{ report }`.
- cms `resolver-service.ts`: ex-log's edits re-applied in the fsplit-j-cms files (content/html-widget/media/post-embed-resolution, page-widget-resolution, resolver-contracts) via one `widgetReport({ context })`.
- ui `use-settings-slice.hooks.ts`: HEAD (ex-log's change logged the error object the comment says may hold secrets — dropped). `Users.tsx`: HEAD (ex-log's edit there was hook injection only).
- agentic dom-page-driver: HEAD's module-level `ambiguousHandleError({ handle, count }, { report })` for both callers; web-clone scripts: HEAD's args shapes + ex-log's `createCliStreams` default; log-safety-debt 3-way.
- `createConsoleLogger`/`Logger` imported from `@jini-ai/core/primitives` (not the root) in 30 files (the Tovu run's local `9516208a4`, redone).
- **#107**: `e8acaeb0` — Jini's mail catalog passes the console provider its required preview (full body, on `deps.log`); failing test first (`catalog-console-preview.unit.test.ts`).
(c) Test-file type errors (185 build errors after the merge, mostly ex-log tests) fixed in `75c7bd73`; all `tsc && post-step` builds run their post-steps again (full build exit 0).
(d) Generic → specific: see the list below.
(e) `e928aece`: user-management `createUsers*Action(s)`, `createUsersController`, `createUsersErrorDescriber`, `useUsersResetMutation`, `useUsersDeletion` take args objects (internal to users/hooks; 1353/1353).
Ratchet fixes `3f6d0211`: R14 cycle ex-log's chat split created (runtimeAgentStatus → RuntimePickerSections); hook-injection baseline locked at 0 (ex-log injected all 33); complexity (optional `report` types accept `undefined`; small helpers); size (db data-module back ≤ 500; stale/lowered rows); 6 rewritten why-comments allow-listed; log-safety receivers named `logger`.
Red tests from ex-log (≈75 across 12 packages at `e928aece`) fixed in `77b1c8f7`, `0e8965df`, `e3ff27c3`, `d4394125`, `e3e53125`, `d3599939`, `7092d025`, `0116d706`, `adf0f213`, `eae9d2ea` (details in each commit).

## Per branch

| # | branch (tip) | merge | conflicts → resolution | red found | fix commits | status |
|---|---|---|---|---|---|---|
| 0 | ex-log `4f7d4d37` | `42f3a459` | see Group 0 | 185 TS errors (tests + 6 code), #107, R14 cycle, 7 L5 rows, 11 complexity, 4 size, 7 why-comments, ~75 test failures | `e8acaeb0` `75c7bd73` `3f6d0211` `c754b527` + test commits above | GREEN (build/typecheck/ratchets); tests see below |
| 1 | xd-admin `7c4e4844` | `f7ed0023` | none | moved admin consent React → cookie-consent with no subpath/deps; devops PublishRunResult with no subpath/deps; **cms ThemePreviewReloadControl: cms forbids `react`** | `2076aa5c` `33137122` (lockfile), `6a6d2bcf` | GREEN; cms React control **dropped** |
| 2 | xd-lockfile `7b5cb1af` | `ede90c57` | none | integration-tests missing jini metadata; diagnostics page-body: no export, parse5 not a dep, positional API, HW3 | `93713ecc` `7c7eeca0` (lockfile), `58711323` | GREEN |
| 3 | xd5-desktop `0e8a4c87` | `5e1c7d87` | ui package.json entries: both `./browser` and `./visible-interval` | 2 exactOptional errors; ui integration-exports test | `c056dd8b`, `e3f2ab29` | GREEN |
| 4 | xd5-render `55e32eec` | `ea3ca4de` | none | strict-index TS errors; 3 complexity; 11 why-comments (rewritten for new ownership); product names in fixtures; result-html tests expected unescaped `$&` | `19587c15`, `d3599939` | GREEN |
| 5 | xd5-publish `c44b0fae` | `9ad708fc` | none | exactOptional errors; vitest-2 `t.onTestFinished`; guard N2 (host app path in a comment) | `29ab6d0a` | GREEN (1 new error-gate line, below) |
| 6 | jini-wave-a3 `afd7ac51` | `48891538` | size-debt 3-way | cms-adapter/route-policy imported from the pre-split write-service; R14 write-values↔write-value-revisions; download split moved HW3 + 26 error-gate rows | `cabcdeb3` | GREEN |

Desktop: the child-entries crash observer is covered by sidecar/desktop-host suites (sidecar 416, desktop-host 749 green); not separately re-audited.
Final API: `0d5b7c2e` api:update for the 29 changed packages; pre-update `api:check` output in `cloud-results/combine-6-jini-api-changes.txt`.

## Generic-message restorations (owner rule)
- ui html-editor/editor-serialization.ts warnFallback: 4 specific reasons restored (ex-log: 'source splice could not be preserved.'); the structural-change label from host editor events is no longer echoed (only its category).
- cms widgets embed resolution (content/html-widget/media/post-embed-resolution.ts, resolver-service.ts gallery/media content): 15 warn lines — ex-log dropped workspaceId/slug/assetId/transformName/postId/entityId/occurrences/key/messages; restored as log `meta` (not secrets).
- mcp core config.ts / tokens.ts corrupt-JSON lines: name the file path and the action taken (ex-log: '[mcp-config] Corrupted JSON, returning empty:').
- agent-plugins federate-mcp provisioning failure: reason 'MCP provisioning write failed' -> 'the MCP server row could not be saved (<error class>)'; report line names server and plugin.
- agent-plugins plugin-host provisioning catch: ex-log's 'MCP provisioning could not run.' -> "Plugin '<id>': MCP provisioning could not run" (injected reporter) / class-only warn line kept (default).
- agentic dom-page-driver duplicate handle: 'Duplicate data-agent-element handle on this page.' -> names the element count.
- db data-modules/data-module.ts: DDL_FAILED 'Data module DDL failed.' -> names the plugin and that the change was rolled back; PREFLIGHT_FAILED 'Data module preflight failed.' -> names the plugin and that nothing was changed; path-mismatch warning restored (plugin id + which kind of database is open; paths stay out as ex-log's test requires).
- agent-plugins credential-card-metadata: 'invalid credential cards' / 'Invalid credential cards.' -> 'the plugin manifest is not valid JSON' (+ 'so its credential cards were refused').
- chat assistant-client/ag-ui-transport.ts: 'Chat request failed. <class>' -> 'The agent run stream stopped with an error (<class>); send the message again.'
- chat embed-widget/vanilla/state.ts: 'Chat request failed.' -> 'The message could not be sent to the agent; send it again.'
- core approval.ts: approval proposal error 'The approved action failed.' -> 'The approved action stopped with an error (<class>).'
- diagnostics collect-page-evidence.ts: 'Page observation failed: <class>' reverted to the specific caught message routed through the host's observation redaction policy (Jini's own 'page work timed out after 15000ms' was being hidden); log-safety-k test now proves the policy redacts.
- diagnostics playwright-runtime.ts: availability reasons name the error class (ex-log had dropped the cause entirely).
- commerce payments/ops/common.ts: 'Payment provider operation failed.' -> 'The payment provider refused the operation (<code>)' / 'could not confirm the operation (<code>); it will be reconciled' / 'threw instead of answering (<class>); the payment will be reconciled' (dispatch, refusal text, stored attempt errorMessage); 6 commerce test files follow.
- kept as judged not generic: admin describeApiError fallbacks ('Failed to load media', 'failed to load the sitemap').
- cms content-types/cleanup.ts: 'Cleanup gateway rejected the plan.' -> names the content type and the gateway error class.
- cms forms/notify-subscriber.ts: 'Form notification send threw/failed.' -> names the submission (recipient address withheld).
- cms media/tool-registrations.ts library_read: 'Document text extraction is unavailable.' / '... failed.' -> 'No document-text extractor is installed for this file's format; see install.' / 'The document-text extractor could not read this file.'
- chat ExtEventErrorBoundary: 'This extension could not be rendered.' -> '"<ext name>" could not be rendered (<class>).'

## Decisions / notes for the owner
1. **cms `ThemePreviewReloadControl`** (xd-admin): removed — cms's isolation forbids `react` in its universal/browser entries and the branch gave it no subpath. Place it in admin or ui (the Tovu half must not import it from cms).
2. **injection-debt (guard, vs merge-5 base with `INJECTION_BASE_REF=e06b3c20`)**: 7 L5 rows changed — 4 moved with ex-log's chat split (QuestionForm→QuestionFormField, AgentRuntimePicker→RuntimePickerSections ×3) and 3 new rows for the same `@jini-ai/ui` imports now spread over more files (ChatPaneComposerArea, RuntimePickerSections, chat-pane `types.ts` type-import). In exchange ex-log cleared all 33 hook-injection entries. Guard with the default base (HEAD) is clean.
3. **Error gate: 1 new line** — `[failure-text-from-catalog] cms/src/trash/adapters/directory.node.ts` (xd5-publish's EXDEV refusal). Adding `{ cause }` fails its own test, which asserts the error carries no cause (deliberate); left for the owner.
4. Pre-existing product names in Jini (not added here): `agent-plugins/src/core/identity-namespace.ts` treats `'tovu'` as the legacy metadata key (log-safety-c test exercises it), cms test comments mention tovu.dev/tovu.fly.dev.
5. ex-log's designs kept where they were log-safety and still specific: chat ag-ui transport now wraps the stream error (old tests updated), admin describeApiError fallbacks for non-API errors (tests' fakes now throw `AdminApiError`).
6. Not run: e2e/playwright, `pnpm test:scripts`.

## Final gates (HEAD, repo root)
| command | base `e06b3c20` | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` |
| `pnpm -r --no-bail --if-present run typecheck` + `tsc -p scripts/tsconfig.json --noEmit` | 0 / 0 | **0 / 0** (0 errors) |
| `pnpm guard` | 0 | **0** (with `INJECTION_BASE_REF=e06b3c20`: 1, note 2) |
| `SIZE_BASE_REF=e06b3c20 node scripts/check-size.mjs` | 0, 71 entries | **0**, 60 entries |
| `COMPLEXITY_BASE_REF=e06b3c20 node scripts/check-complexity.mjs` | 0, 2 | **0**, 2 |
| `node scripts/check-hook-injection.mjs` | 0, 33 direct calls | **0**, 0 (baseline locked) |
| `node scripts/check-why-comments.mjs --base e06b3c20` / default | 0 / 0 | **0** (20 allow-listed with reasons) / **0** |
| `node scripts/check-error-gate.mjs` | 0, BASE-RED 24 | 0, BASE-RED 25 — the same 24 + 1 new (note 3) |
| `node scripts/check-log-safety.mjs` (also `LOG_SAFETY_BASE_REF=e06b3c20`) | 1, BASE-RED | 1, same lines as base, no debt added (several base lines gone) |

## Tests
Final full suites at `5c28d30b` (worktree, fresh install + `pnpm --no-bail -r build` exit 0), every package this run touched:
admin 3071/3071, agent-plugins 2190 (+2 skipped), agent-runtime 4524 (+1), agentic 1149, analytics 226, artifacts 242, capability-providers 198 (these 7 at `e3f2ab29`; agentic/agent-plugins re-run at `5c28d30b`), chat 4505 (+1), **cms 4863/4864**, commerce node 11 + vitest 1421 (+1), cookie-consent 221, core 2947, db 950, desktop-host 749 (+1), devops 1326, diagnostics 1090, http-kit 750, integration-tests (no tests yet, passWithNoTests), integrations 2073, mcp 1882, memory 409, platform 3351 (+6), plugins 1011, registry 392, sandbox 179, search 368, server 468 (+1), sidecar 416 (+3), ui 8827, ui-kit 232, user-management 1353, vibecoding 364.
- cms 1 red under full-suite load: `forms/__tests__/submit-service.host-options.test.ts` "a copy waiting on a first copy that fails is stored itself…" — passes 3/3 run alone; neither the test nor `submit-service.ts` changed in this run (timing-sensitive, pre-existing flake candidate).
- Group 0 at `e928aece` had ≈75 failures (ex-log untested): all fixed (commits listed under Group 0).

## Jini exported signatures and subpaths for the Tovu run
New subpaths: `@jini-ai/cookie-consent/react` (ConsentSettingsPanel, ConsentBannerFields, preview frame/scale — moved from `@jini-ai/admin/consent/react`, **removed**); `@jini-ai/devops/deploy/react` (`PublishRunResult`); `@jini-ai/devops/backup/upload`; `@jini-ai/diagnostics/web-evidence/page-body` (`readPageBodyOptions({ input })`, `shapePageBody({ body }, options)`; parse5@7.3.0 optional peer); `@jini-ai/ui/visible-interval`; `@jini-ai/search/http-query`; cms `./forms/form-controls`, `./forms/result-html`, `./forms/validation-messages`, `./html/document-marks`, `./html/text-layout`, `./listing/request-state`, `./navigation/menu-render`, `./presentation/document-shell`, `./themes/files/{atomic-write,moves,original-source,originals,read-content,reviewed-write,trash}`, `./themes/layout`, `./themes/preview/{roster,watcher}`, `./themes/template-applicability`, `./trash/adapters/directory`, `./widgets/{content-markers,document-markers,media-attributes,media-tags}`. Full list (with older drift) in `cloud-results/combine-6-jini-api-changes.txt`.
Changed signatures:
- mcp: `readMcpConfig({ dataDir, files }, { report })`; `readTokensFile`/`getToken`/`setToken`/`clearToken`/`readAllTokens(required incl. files, { report })`; `McpServerLike` now from `adapters/sdk-server` (still exported from the root).
- agent-plugins: `provisionAgentPluginMcpServers({ deps, ...input }, { report })`; failed entries have no `error` (reason = step + error class); `PluginHostDeps.report?`; `createMailCatalog` host `builtins.console({ clock, preview })` (pass `createConsoleMailProvider`).
- platform: `createConsoleMailProvider({ clock, preview })` (preview required); `createNodeDirectoryWorkspace(..., { report })`.
- agentic: `createDomPageDriver(required, { report })`.
- admin: `useSitemapModal(required, { useQuery })`; `@jini-ai/admin/consent/react` removed.
- chat: `ExtEventErrorBoundary` `report` prop; `useConversation({ report, useRunStreamHook, random })`; `useChatPane(options, { useConversationHook })`; chat components take injected `use*Hook` props (ex-log).
- core: `describeApiError` unchanged; approval store error text now names the class.
- db: `declareDataModule(required, { checkHeadroom, report })`.
- user-management: internal users/hooks helpers only (not exported).

## Left / next step
1. Owner: decisions 1–3 above.
2. Tovu combine-6: build against this branch; cookie-consent React import path, `createConsoleMailProvider` preview, mcp files port + `report`, `provisionAgentPluginMcpServers` failure shape.
