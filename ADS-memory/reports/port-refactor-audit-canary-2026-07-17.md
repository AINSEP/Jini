# Jini port/refactor audit canary

- Audit started: 2026-07-17 21:30:32 PDT
- Auditor model: OpenAI Codex (GPT-5 family; the runtime does not expose a more specific model identifier)
- Reasoning effort: High
- Execution mode: Sequential, in the primary checkout; no worktrees
- Toolchain: Node v24.2.0; pnpm 10.33.2; git 2.39.3
- Coverage standard: >=99% for statements, branches, functions, and lines, aggregate and per file; 100% goal; `json-summary` plus `json` evidence; no suppression comments
- Audit standards: `AI-Dev-Shop/AGENTS.md`, root `AGENTS.md`, `ADS-memory/reports/jini-port/START-HERE.md`, `ADS-memory/reports/jini-port/extraction-plan.md`, `ADS-memory/reports/jini-port/refactor-roadmap.md`, both Jini-adapted fixing skills, and `ADS-memory/reports/jini-port/god-components-extraction-plan.md`

## Method and evidence policy

Each PR is pinned to an immutable head/base SHA. Claims in the PR body and branch documentation are treated as hypotheses. Verdicts use commands run at the pinned head, coverage JSON inspected directly, source/diff comparison against the cited real Open Design revision, boundary scans, and cross-branch comparison. This report records concise evidence-based reasoning summaries, not private chain-of-thought.

## Checkpoint 1 — PR #12

Status: **FAIL** at pinned head `a119a114d88d16336566f21d98d710449a7f687a`. PR #12 remains an open draft and GitHub reports the pinned head/base pair unchanged.

Evidence completed at pinned head `a119a114d88d16336566f21d98d710449a7f687a` against base `e3110ac6e576208a7f75753020f986b0de1ac7e7`:

- `CI=true pnpm install --frozen-lockfile`: passed after network access was approved.
- `pnpm --filter @jini/cli typecheck`: passed.
- `pnpm --filter @jini/cli build`: passed.
- `pnpm --filter @jini/cli test:coverage`: passed, 9 files and 95 tests.
- Direct `coverage-summary.json` result: 288/288 statements, 178/178 branches, 19/19 functions, 288/288 lines. All nine executable source files appeared as per-file rows at 100% on all four metrics.
- `json-summary` and `json` reporters were both present and emitted evidence.
- Suppression scan: no V8/Istanbul/C8/NYC coverage-ignore comments found outside generated coverage/dist output.
- `pnpm guard`: passed outside the sandbox; output explicitly says the guard is still a skeleton.
- `pnpm typecheck`: failed on the already-existing missing root `tsconfig.json` files in `packages/agent-runtime` and `packages/chat-react`; the PR does not change either failure surface.
- Manual identity/forbidden-import scans over `packages/cli/src`: clean.
- Cited OD commit `ab453241247865ebb2cd9259b37286282506fe65` exists in the real `/Users/la/Desktop/Programming/OSS-Repos/open-design` clone and is an ancestor of both refreshed `origin/main` and `fork/main`.
- Initial cross-branch search found no second implementation of the named CLI primitives on the sampled audit branches.

Fidelity findings and final adjudication:

1. **Required / High — material undisclosed CLI-contract change.** `packages/cli/src/http.ts:91-96` maps a network rejection to structured `daemon-not-running`; `packages/cli/src/errors.ts:17-21` maps that code to exit `64`. OD exits `3` at `apps/daemon/src/cli.ts:5680-5683` at the exact cited revision. This is not accidental or unmeasured: Jini asserts the new mapping in `packages/cli/src/http.test.ts:116-124` and `:200-210`, while OD pins exit `3` in `apps/daemon/tests/cli-startup.test.ts:128-133` and three unreachable-daemon cases in `apps/daemon/tests/cli-templates.test.ts:375-407`. Jini also adds a structured JSON stderr line after the human-readable diagnostic. Exit status and stderr shape are machine-facing CLI behavior. `packages/cli/source-map.md:55-57` describes the formatter, generic default table, and structured-error mechanism, but does not disclose the network-path `3 -> 64` compatibility break or the extra envelope. This exceeds permitted renaming, injected-port, and de-branding changes.
2. **Recommended / Low — non-material but real undisclosed diagnostic regression.** `packages/cli/src/http.ts:35` uses `err instanceof Error ? err.message : String(err)`, whereas OD uses a truthy top-level `err.message` at `apps/daemon/src/cli.ts:1017`. A rejection like `{ message: 'x' }` therefore prints `[object Object]` instead of `x`. Jini tests `Error`, string, and nested-cause cases but not a plain top-level message-bearing object. Native `fetch` failures are ordinarily Error-like and no production dependency on this edge was found, so this does not independently trigger FAIL, but it remains an undisclosed fidelity gap.

Verdict basis: the first finding is a material undisclosed behavior change, which independently triggers the audit's FAIL rule despite full tests, 100% measured coverage, clean boundary scans, and a mergeable draft PR. Remediation requires either preserving the cited OD network-failure contract or obtaining explicit architecture/spec authorization and documenting/versioning the intentional compatibility change; tests must pin the approved behavior.

## Checkpoint 2 — PR #13

Status: **FAIL** at pinned head `13cde0eedfbd31d3bec24a6916fd52488f1c0c9c`. PR #13 remains an open draft and GitHub reports the pinned head/base pair unchanged and mergeable.

Evidence completed at pinned head `13cde0eedfbd31d3bec24a6916fd52488f1c0c9c` against base `e3110ac6e576208a7f75753020f986b0de1ac7e7`:

- `CI=true pnpm install --frozen-lockfile`: passed; the lockfile was current and PR #13 does not change it.
- `pnpm --filter @jini/ui typecheck`: passed.
- `pnpm --filter @jini/ui build`: passed.
- `pnpm --filter @jini/ui test`: passed, 167 files and 1,614 tests. jsdom emitted its pre-existing navigation-not-implemented diagnostic from unrelated `ExportDiagnostics` tests, but the command exited successfully.
- `pnpm --filter @jini/ui test:coverage`: passed as a command, 167 files and 1,614 tests, and emitted both `coverage-summary.json` and `coverage-final.json`.
- Direct full-package coverage result: 11,091/11,826 statements (**93.78%**), 3,989/4,336 branches (**91.99%**), 733/787 functions (**93.13%**), and 11,091/11,826 lines (**93.78%**). Every aggregate metric is below the required 99% floor. The fact that the deficits are largely pre-existing does not satisfy this audit's expressly required full-`@jini/ui` coverage gate at the pinned head.
- `pnpm guard`: passed, while explicitly reporting `[guard] ok (skeleton — rules pending implementation during extraction)`.
- `pnpm typecheck`: failed only on the inherited missing `tsconfig.json` files in `packages/agent-runtime` and `packages/chat-react`; PR #13 does not change those surfaces.
- `git diff --check`: passed. Manual product-identity and forbidden-import scans over both new feature trees were clean. Coverage-suppression scan found no V8/Istanbul/C8/NYC ignore comments. React-import layout was clean: React-dependent implementation remains under `react/`.
- The only coverage configuration changes are four exclusions. Direct source inspection confirmed all four are interface/type-only with no executable declaration: `source-config-list/types.ts`, `source-config-list/ports.ts`, `resource-dashboard/types.ts`, and `resource-dashboard/ports.ts`. All 30 changed executable source files were present in the JSON coverage output; none was silently omitted.

Every changed executable per-file row follows. Each row is 100% for all four metrics; counts are covered/total from `coverage-summary.json`:

| Feature/file | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| source-config `constants.ts` | 3/3 | 0/0 | 0/0 | 3/3 |
| source-config `dependencies.ts` | 57/57 | 36/36 | 9/9 | 57/57 |
| source-config `index.ts` | 1/1 | 0/0 | 0/0 | 1/1 |
| source-config `rules.ts` | 106/106 | 48/48 | 13/13 | 106/106 |
| source-config `SourceConfigAddForm.tsx` | 67/67 | 22/22 | 4/4 | 67/67 |
| source-config `SourceConfigField.tsx` | 80/80 | 30/30 | 6/6 | 80/80 |
| source-config `SourceConfigItemCard.tsx` | 86/86 | 38/38 | 3/3 | 86/86 |
| source-config `SourceConfigList.tsx` | 47/47 | 16/16 | 6/6 | 47/47 |
| source-config `SourceConfigListView.tsx` | 62/62 | 26/26 | 5/5 | 62/62 |
| source-config `SourceConfigTestControl.tsx` | 27/27 | 18/18 | 1/1 | 27/27 |
| source-config `useSourceConfigAddForm.ts` | 44/44 | 19/19 | 2/2 | 44/44 |
| source-config `useSourceConfigList.ts` | 110/110 | 37/37 | 2/2 | 110/110 |
| resource-dashboard `constants.ts` | 3/3 | 0/0 | 0/0 | 3/3 |
| resource-dashboard `dependencies.ts` | 88/88 | 55/55 | 15/15 | 88/88 |
| resource-dashboard `index.ts` | 1/1 | 0/0 | 0/0 | 1/1 |
| resource-dashboard `rules.ts` | 80/80 | 56/56 | 10/10 | 80/80 |
| resource-dashboard `ResourceBoard.tsx` | 111/111 | 47/47 | 8/8 | 111/111 |
| resource-dashboard `ResourceBoardToolbar.tsx` | 90/90 | 23/23 | 5/5 | 90/90 |
| resource-dashboard `ResourceBoardView.tsx` | 125/125 | 39/39 | 5/5 | 125/125 |
| resource-dashboard `ResourceCard.tsx` | 79/79 | 41/41 | 6/6 | 79/79 |
| resource-dashboard `ResourceKanbanBoard.tsx` | 60/60 | 14/14 | 4/4 | 60/60 |
| resource-dashboard `ResourceMetrics.tsx` | 13/13 | 5/5 | 1/1 | 13/13 |
| resource-dashboard `ResourceRowList.tsx` | 55/55 | 25/25 | 3/3 | 55/55 |
| resource-dashboard `ResourceRowListItem.tsx` | 65/65 | 28/28 | 2/2 | 65/65 |
| resource-dashboard `ResourceRowListView.tsx` | 99/99 | 28/28 | 4/4 | 99/99 |
| resource-dashboard `ResourceRunHistoryList.tsx` | 58/58 | 25/25 | 2/2 | 58/58 |
| resource-dashboard `StatusPill.tsx` | 8/8 | 1/1 | 1/1 | 8/8 |
| resource-dashboard `useResourceBoard.ts` | 183/183 | 77/77 | 4/4 | 183/183 |
| resource-dashboard `useResourceRowList.ts` | 86/86 | 24/24 | 2/2 | 86/86 |
| package `src/index.ts` | 2/2 | 0/0 | 0/0 | 2/2 |

Findings and adjudication:

1. **Required / High — full-package coverage gate fails.** The pinned PR produces 93.78% statements/lines, 91.99% branches, and 93.13% functions for the explicitly required full `@jini/ui` run. New feature files being individually 100% covered and the four type-only exclusions being legitimate do not override the aggregate gate. This independently triggers FAIL.
2. **Required / High — source-config i18n is incomplete and its source map states the opposite.** `rules.ts:49-55` constructs English validation messages; `SourceConfigAddForm.tsx:54-64` passes them through and `SourceConfigField.tsx:99-102` renders them raw. The same component also renders host-supplied field labels, placeholders, and option labels without `t()` (`SourceConfigField.tsx:30,47,51,59,71`), while custom title/subtitle/load/empty copy is raw in `SourceConfigListView.tsx:57-75`. The locked policy says every user-facing string and pure-rule return value must be wrapped at the render boundary. The source map instead claims every string is wrapped and even presents `<SourceConfigField error={issue.message}>` as evidence of translation. The real-provider test at `SourceConfigList.test.tsx:169-186` translates only `Add source` and the empty state; its identity `URL -> URL` entry and lack of invalid submission cannot detect these paths. This is both an implementation failure and invalid certification evidence.
3. **Required / High — retained BYOK “test before save” behavior is unrepresentable.** At candidate OD revision `0b88ef...`, `ByokConnectionTestControl.tsx:36-42,75-105` exposes testing beside the editable configuration, and `EntryShell.tsx:2973-2981,3011-3057,3073-3085` tests the current unsaved values. Jini's port contract says `testSource(id, draft?)` supports this flow (`ports.ts:32-33`), and the hook accepts a draft (`useSourceConfigList.ts:127-138`), but the shipped add form has no test control and the orchestrator always calls `list.test(id)` for an already-persisted item (`SourceConfigList.tsx:68-71`). An unsaved draft has no item id. The dropped-behavior section discusses simplified test chrome and removal of a separate model-fetch action, but never discloses loss of test-before-save. This is a material behavior loss and a contract/implementation contradiction.
4. **Required / High — material MCP edit/enable behavior was silently dropped and the claimed MCP proof is not an MCP shape.** Candidate OD `McpClientSection.tsx:779-794,908-960` supports enabling/disabling an existing server, editing its label, and editing expanded transport/config fields. Jini declares `enabled` (`types.ts:69-76`) but never renders or mutates it; the expanded card is a read-only `<dl>` (`SourceConfigItemCard.tsx:101-109`), and the port has no general update operation. The source map calls this an expand-to-edit descendant and does not disclose these losses. Its “MCP-server-shaped” test instead injects URL plus marketplace-style trust (`SourceConfigList.test.tsx:17-38`), contradicting the feature contract's own statement that MCP has no trust concept (`ports.ts:9-14`). It therefore does not certify the claimed abstraction against the real MCP interaction shape.
5. **Required / High — resource mutations lose OD's visible failure handling and can reject unobserved.** `useResourceBoard.ts:174-203` propagates delete/duplicate rejection, while `ResourceBoard.tsx:88-95` discards those promises with `void`. `useResourceRowList.ts:108-119` likewise propagates action rejection and `ResourceRowList.tsx:88` discards it, with no mutation-error state or error port. At exact cited OD revision `0b88ef...`, `DesignsTab.tsx:440-449` catches duplicate failures into an alert toast and `TasksView.tsx:535-634` catches run/pause/delete failures into visible error state. The source map discloses removal of bulk-delete toast notifications, but not duplicate/delete/row-action error handling. This material error-path loss is untested at the composed component boundary.
6. **Required / High — resource run-history loading loses OD's cancellation and failure semantics.** `useResourceRowList.ts:73-92` starts detached history requests without a catch or per-request generation/cancellation. A rejection is unobserved and leaves `items` undefined, so `ResourceRunHistoryList.tsx:34-39` can display “Loading” indefinitely. Collapsing and re-expanding the same row can also overlap same-id requests, allowing an older response to overwrite newer history. Exact OD `TasksView.tsx:1044-1062` catches failures to an empty result and ignores stale responses using effect cleanup. Tests cover different-row interleaving, not rejection or an overlapping same-row race. Neither loss is disclosed.
7. **Required / Medium — source-config provenance is not reproducible at an exact OD revision.** Its source-map section cites only `/tmp/od-source` on public-fork `main`; that temporary checkout no longer exists and no SHA is recorded. By contrast, the adjacent resource-dashboard section pins `0b88ef56144b5a42dc427c1292ae22676d698a34`, which exists in the real OD clone and is reachable from both tracked mains. Findings 3-4 were validated against that SHA as a candidate, but it remains an inference rather than the documented source-config extraction revision. Exact-origin fidelity cannot be certified until the actual SHA is supplied and verified.
8. **Recommended / Medium — resource-card nested keyboard activation conflicts.** `ResourceCard.tsx:59` and `ResourceKanbanBoard.tsx:55` make a parent container Enter/Space-activated while nesting menu/delete controls. Child controls stop click propagation but not keydown propagation, so activating them from the keyboard can also invoke the parent's open action. This appears inherited from OD rather than an extraction fidelity regression, so it does not independently drive the canary verdict, but it blocks an accessibility-quality sign-off and needs a composed interaction test.
9. **Recommended / Medium — run-history metadata is narrower than OD and undisclosed.** Exact OD `TasksView.tsx:1081-1091` shows trigger and agent-run identifiers. `ResourceRunHistoryItem` and `ResourceRunHistoryList.tsx:49-63` have no structured slots for them. A host could flatten some data into preformatted text, but cannot reproduce the original structure cleanly.
10. **Recommended / Low — the consolidation check leaves a named status-pill duplication.** Current/base UI already renders inline connector status pills in `features/connectors/components/ConnectorCard.tsx` and `ConnectorDetailDrawer.tsx`; PR #13 adds a separate `resource-dashboard/StatusPill.tsx`. A search across available remote UI branches found no second dashboard implementation and no separately named `PillButton`/`PopoverMenu`, but this existing status-pill shape was not compared or consolidated in the source map. Treat this as a narrow maintainability follow-up, not a verdict driver.
11. **Recommended / Low — source-map test evidence has a per-file count error.** The resource-dashboard section says `useResourceBoard.test.ts` has 35 tests, while the executed suite reports 34. Its stated feature total of 253 corresponds to the real 34-test count, so this is a documentation correction rather than a behavior failure.

The new i18n smoke tests do mount the real `I18nProvider`: source-config translates its add/empty labels, and resource-dashboard translates board and row-list labels. The failure above is incomplete path coverage and unwrapped configurable copy, not an absence of provider-based tests. Two pipeline Code Review agents independently reviewed the two feature halves; the Coordinator revalidated their material findings against pinned Jini source and the exact resource-dashboard OD revision. The React-layout policy, boundary scans, type-only coverage exclusions, touched-file coverage, builds, and tests otherwise pass.

Verdict basis: findings 1-6 each independently or collectively satisfy a hard gate or establish material undisclosed behavior loss. Finding 7 separately prevents exact-origin certification. Findings 8-11 are named quality/documentation follow-ups and do not drive the verdict.

## Checkpoint 3 — PR #14

Status: **FAIL** at pinned head `6e91a4b471d98b5baf85d835a3fc8761ac5a0852` against base `e3110ac6e576208a7f75753020f986b0de1ac7e7`. PR #14 remains an open, mergeable draft at the pinned pair.

Evidence completed:

- `CI=true pnpm install --frozen-lockfile`: passed; the lockfile was current.
- `pnpm --filter @jini/ui typecheck`: passed.
- `pnpm --filter @jini/ui build`: passed.
- `pnpm --filter @jini/ui test`: passed, 161 files and 1,632 tests. The only stderr was the inherited jsdom navigation diagnostic from unrelated integrations/export-diagnostics tests.
- `pnpm --filter @jini/ui test:coverage`: passed as a command, 161 files and 1,632 tests, and emitted both `coverage-summary.json` and `coverage-final.json`.
- Direct full-package JSON result: 11,846/12,547 statements (**94.41%**), 4,220/4,558 branches (**92.58%**), 730/784 functions (**93.11%**), and 11,846/12,547 lines (**94.41%**). Every aggregate metric is below the required 99% floor.
- `pnpm guard`: passed while again reporting itself as a skeleton.
- Root `pnpm typecheck`: failed on the inherited missing `tsconfig.json` files in `packages/agent-runtime` and `packages/chat-react`; PR #14 does not touch those packages.
- `git diff --check`: passed. No V8/Istanbul/C8/NYC suppression was found. Manual identity and forbidden-import inspection was clean; the only apparent hits were test fixtures/comments, not product identity or imports.
- The PR changes 49 files with 11,503 additions. All 25 changed source paths appear in JSON coverage. Direct inspection identifies 23 executable paths and two interface-only files (`ports.ts`, `types.ts`); PR #14 adds no coverage exclusions.
- Exact OD commit `d695f1e0f2b85a032aa7ce4895a3eb764cb1b65d` exists in the real OD clone and is the fetched `fork/refactor/web-memory-slice` head used by the source map. Codebase Memory located the OD memory symbols; pinned conclusions were validated through direct `git show` reads.
- Cross-ref inspection found the new Jini memory tree only on the PR #14 ref. It reuses the existing connectors barrel/helpers instead of creating a third connector reconciliation implementation.

Every changed source per-file JSON row follows. All are 100% on all reported metrics; counts are covered/total. The two interface-only rows have no statements or lines, while V8 reports a source-map-generated 1/1 branch and function for each:

| File | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `async-commit-guard.ts` | 11/11 | 5/5 | 5/5 | 11/11 |
| `constants.ts` | 52/52 | 1/1 | 1/1 | 52/52 |
| `dependencies.ts` | 172/172 | 73/73 | 21/21 | 172/172 |
| `formatters.ts` | 280/280 | 198/198 | 19/19 | 280/280 |
| memory `index.ts` | 1/1 | 0/0 | 0/0 | 1/1 |
| `ports.ts` — interface-only | 0/0 | 1/1 | 1/1 | 0/0 |
| `rules.ts` | 33/33 | 16/16 | 7/7 | 33/33 |
| `types.ts` — interface/type-only | 0/0 | 1/1 | 1/1 | 0/0 |
| `react/render-markdown.tsx` | 8/8 | 1/1 | 1/1 | 8/8 |
| `MemoryAdvancedModal.tsx` | 154/154 | 27/27 | 5/5 | 154/154 |
| `MemoryConnectedPanel.tsx` | 261/261 | 110/110 | 6/6 | 261/261 |
| `MemoryEntryCard.tsx` | 44/44 | 12/12 | 4/4 | 44/44 |
| `MemoryExtractionCard.tsx` | 55/55 | 11/11 | 3/3 | 55/55 |
| `MemoryHooksPanel.tsx` | 74/74 | 3/3 | 2/2 | 74/74 |
| `MemoryHowPanel.tsx` | 27/27 | 1/1 | 1/1 | 27/27 |
| `MemoryList.tsx` | 113/113 | 31/31 | 5/5 | 113/113 |
| `MemoryManualEditor.tsx` | 182/182 | 20/20 | 6/6 | 182/182 |
| `useMemoryConfig.hooks.ts` | 180/180 | 48/48 | 5/5 | 180/180 |
| `useMemoryConnectors.hooks.ts` | 392/392 | 188/188 | 2/2 | 392/392 |
| `useMemoryEntries.hooks.ts` | 258/258 | 103/103 | 2/2 | 258/258 |
| `useMemoryExtractions.hooks.ts` | 120/120 | 36/36 | 3/3 | 120/120 |
| `useMemoryExtractions.store.ts` | 159/159 | 97/97 | 18/18 | 159/159 |
| `useMemoryFlash.hooks.ts` | 13/13 | 7/7 | 1/1 | 13/13 |
| `useMemoryNavigation.hooks.ts` | 27/27 | 3/3 | 1/1 | 27/27 |
| package `src/index.ts` | 45/45 | 0/0 | 0/0 | 45/45 |

Findings and adjudication:

1. **Required / High — full-package coverage gate fails.** Despite the new memory slice reaching 100% on all its JSON rows, the required full `@jini/ui` aggregate is 94.41% statements/lines, 92.58% branches, and 93.11% functions. This independently triggers FAIL.
2. **Required / High — the advertised malformed-success fix remains structurally incomplete.** `dependencies.ts:55-63` checks only `field in json`; `fetchMemoryList()` applies that presence-only helper to `entries`, `rootDir`, `index`, and `enabled` at `:116-124`. A 2xx JSON object with any required key set to `null` or a wrong type still passes. For example, `entries: null` reaches `setEntries` at `useMemoryEntries.hooks.ts:170` and can fail at `entries.filter` on `:183`; `enabled: null` is committed as boolean state at `useMemoryConfig.hooks.ts:155-170`. Tests at `dependencies.test.ts:60-73` delete keys but do not exercise present-null or wrong-type values. The exact missing-key `{entries: []}` bug is fixed relative to OD `providers/memory/entries.ts:15-23`, but the same malformed-success trust class remains while the source map describes the response as validated. Runtime shape validation plus null/wrong-type regressions are required.
3. **Required / High — mandatory i18n is materially incomplete and the claimed evidence misses every failing path.** `formatters.ts:27-168` produces raw connector diagnostics, failure copy, provider labels, and attempt titles; `useMemoryConnectors.hooks.ts:447-471` creates additional English status/error/plural messages. They render raw in `MemoryConnectedPanel.tsx:272-298` and `MemoryExtractionCard.tsx:40-45`. This contradicts the locked call-site translation policy and `source-map.md:2152-2166`'s claim that every visible string routes through `useT()`. The connected-panel provider test sets status/error/attempt values empty, while the extraction-card provider test translates only `Done` and `Remove`. The eight components do have real `I18nProvider` smoke tests, but those tests do not certify the dynamic formatter/hook paths.
4. **Required / High — the locked React-layout boundary is violated and the source map certifies the opposite.** Top-level `constants.ts:4` imports React's `CSSProperties` while the policy says anything importing React belongs under `react/`. Top-level `formatters.ts:12` imports the React `useT` hook only to derive a type; because `verbatimModuleSyntax` is enabled, the built JavaScript preserves that runtime import, making the claimed pure formatter layer depend on the React i18n module. Move the style into the React subtree and use a framework-neutral translation-function type.
5. **Recommended / Medium — button styling/focus fidelity is not fully disclosed.** `MemoryManualEditor` replaces OD's design-system `Button`, which supplied base CSS-module and focus behavior, with bare buttons carrying only `ghost`/`primary` classes (`MemoryManualEditor.tsx:201+`). The source map discusses CSS-module removal for `MemoryHooksPanel`, but not this control-level visual/focus loss.
6. **Recommended / Low — reducer reuse is correct, but “identical field-by-field” is an overclaim.** Jini's existing `mergeConnectors` preserves additional tool metadata, while exact OD `components/connectors-state.ts:31-45` performs a simpler spread. Jini still correctly subsumes PR #5228's memory-specific merge/upsert behavior, so only the provenance wording needs correction.

Validated positives: the exact OD SHA and missing-key regression are real; connector reducer reuse is sound; the orchestrator/subscription/SSE ownership, fake connector transport, markdown substitution, and principal CSS-module omissions are disclosed; Markdown's HTML path has an adversarial escaped-output test; no suppression, product leak, forbidden import, or competing memory implementation was found.

Verdict basis: findings 1, 3, and 4 each independently trigger an explicit hard gate. Finding 2 invalidates the advertised malformed-response certification and leaves a material crash/state-corruption class. Findings 5-6 are named non-blocking gaps.

## Final punch list

All three audited PRs fail at their pinned heads.

1. **PR #12:** preserve OD's network-failure exit/stderr contract, or obtain explicit compatibility authorization and document/version the intentional `3 -> 64` plus structured-envelope change. Add a regression case for plain message-bearing rejected objects.
2. **PR #13:** raise the full `@jini/ui` package aggregate to at least 99% on statements, branches, functions, and lines; retain both JSON reporters and the legitimate interface-only exclusions.
3. **PR #13:** apply `t()` at every source-config render boundary, including rule errors and configurable visible copy; add real-provider tests for invalid submissions, labels, placeholders, options, and custom messages.
4. **PR #13:** either implement BYOK test-before-save and MCP enable/edit behavior through the generic contracts, or explicitly narrow the abstraction and disclose the material losses. Replace the mislabeled MCP test with representative MCP and BYOK interaction proofs.
5. **PR #13:** add explicit composed-boundary error handling for board/row mutations, and restore failure plus stale-request semantics for run-history loads. Add rejection and overlapping-same-row race tests.
6. **PR #13:** record and verify the exact OD SHA used for source-config extraction; re-check its source claims against that immutable revision.
7. **PR #13:** isolate nested-control keyboard events, decide how structured history metadata is represented, reconcile or distinguish status-pill implementations, and correct the `useResourceBoard` test count.
8. **PR #14:** raise the full `@jini/ui` package aggregate to at least 99% on all four metrics; retain both JSON reporters and every changed source row.
9. **PR #14:** replace presence-only `fetchMemoryList` checks with complete runtime shape validation and add present-null/wrong-type regression tests.
10. **PR #14:** translate formatter/hook-generated diagnostics and status/plural/time copy at the render boundary; recertify the dynamic failure/status paths under a real non-English provider.
11. **PR #14:** remove React dependencies from top-level pure files, restore/disclose button focus styling, and correct the connector-reducer identity wording.

No suppressions, product-identity leakage, forbidden imports, changed executable omissions, or React-layout violations were found in PR #13. Those clean results do not offset the hard coverage, i18n, and provenance failures above.
