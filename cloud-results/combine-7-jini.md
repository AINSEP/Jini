**`integ/merge-7-2026-11-20` @ `06cd7ae7e`** (last merge/fix commit; the only commit on top adds this report and `cloud-results/combine-7-jini-*.txt`)

# combine-7 JINI (2026-11-20) — `integ/merge-7-2026-11-20`

Unattended cloud run, 21:00–~00:15 UTC. Branch created from `origin/integ/merge-6-2026-11-19` (`d3e78b387`). Node v24.22.3 (`~/.local/node24` → `/opt/node24`), pnpm 10.33.2 (corepack). No subagents, no codebase-memory tools, no force-push, no `--no-verify`; only this branch pushed. `main` / `refactor/terra` / `plan/*` untouched (`refactor/terra` only fetched for the default why-comments base).

**Summary: all 23 listed merges done (G1–G5, nothing left). Final tree: full build 0 errors, full typecheck 0, guard 0, size / hooks pass, log-safety unchanged from base (BASE-RED). RED vs base and LISTED, not fixed (not build/typecheck/guard blockers, per the run's fix rule): complexity (2 new: jb2, jy-pads), why-comments vs base (116 lost blocks: jb2's deleted code + the jy-* prose rewrites), error gate 4 new lines (no `--update`). Plugin catalog regenerated; api:update committed. Tovu hits in `packages/`: 519 lines in 183 files (base 1234), all listed in `combine-7-jini-tovu-hits.txt`. Full suites of all 36 touched packages green after 2 fixes, except 1 load-sensitive admin case that passes alone ("Tests").**

## Method
- Base first (unmodified `d3e78b387`): frozen install 0; `pnpm --no-bail -r build` 0 (0 `error TS`); `pnpm -r --no-bail --if-present run typecheck` 0 + `tsc -p scripts/tsconfig.json --noEmit` 0; every gate below recorded (`combine-7-jini-base-<gate>.txt`).
- Per merge (main tree): `pnpm --no-bail --filter "...[<pre-merge>]" build`; `tsc -p tsconfig.json --noEmit` in every changed package; `pnpm guard`; `vitest run --maxWorkers=2 --minWorkers=1` on every test file the merge added/changed (per package); `exports` targets of changed manifests checked to exist in `dist`.
- Per merge (second worktree `/home/user/jg`, detached at the merge SHA, queued in the background): `SIZE_BASE_REF=d3e78b387 node scripts/check-size.mjs`; `COMPLEXITY_BASE_REF=d3e78b387 node scripts/check-complexity.mjs`; `node scripts/check-hook-injection.mjs`; `node scripts/check-why-comments.mjs --base d3e78b387` and default (terra); `node scripts/check-log-safety.mjs`; `node scripts/check-error-gate.mjs` — each diffed against base. (Guard needs built `dist`, so it ran in the main tree.) The worktree check for merges 2–6 first ran against the wrong commit (a `HEAD` argument resolved in the worktree); all were re-run at their real SHAs — the per-merge results below are the re-runs.
- Error gate `--update`: never run — every run reported New lines (base already has 25 New), so the rule forbids it.
- Owed checks: every branch's `commit-plans/<job>.*.md` on Tovu `origin/plan/commit-plans-1120` read before its merge; the tests each named were run (per-merge vitest runs above, plus the dj-jini witnesses). Mutations: NOT-RUN (time) — listed under "Left".
- Full suites: separate worktree `/home/user/jt` at `f3fa92748` (fresh frozen install + `pnpm --no-bail -r build` exit 0, 0 `error TS`), `npm --prefix packages/<p> run test -- --maxWorkers=2 --minWorkers=1`.

## Base (`d3e78b387`)
| gate | base |
|---|---|
| build | 0, 0 `error TS` |
| typecheck (+scripts) | 0 / 0 |
| guard | 0 (zero violations; HW3 37) |
| size | 0, 60 debt entries |
| complexity | 0, 2 entries |
| hooks | 0, 0 direct calls |
| why-comments `--base d3e78b387` / default (terra) | 0 / 0 (199/199 allow-listed) |
| log-safety | **1 (BASE-RED)**, 9 "New raw log path" lines (listed under Final gates) |
| error gate | 0 (WARN) **BASE-RED: 25 New** (listed under Final gates), 19 improved |

## Per branch
| # | branch (tip) | merge | conflicts → resolution | red found | fix commits | status |
|---|---|---|---|---|---|---|
| 1 | jx-c6fix `8b9cf400c` | `3df2fcf9b` | none | none; 8 exports resolve in `dist`; owed `connections-log-safety.unit.test.ts` 2/2 | — | GREEN |
| 2 | xd-rs-c `228ec8408` | `27f695176` | none | none (owed: agent-runtime 7, cms 4, core 1 changed tests pass) | — | GREEN |
| 3 | xd-rs-c2 `86e9693b1` | `99c197126` | none (only its own commit on top of #2) | none (cms contract test 4/4) | — | GREEN |
| 4 | rs-e-jini `56e8a5584` | `2ff12f689` | none | error gate +1 New `[failure-text-from-catalog] integrations/src/webhooks/tools/tool-handlers.ts` | — (listed) | GREEN (1 EG line) |
| 5 | split-jini `de09c6ed1` | `a621b1973` | none (only its own commit on top of #4) | guard R14 ×6 (search indexer-write/reconcile/backfill ↔ indexer inline `import { type }`); platform `process.test.ts` + `process-probes.test.ts` failed to load (vitest 2: "Cannot export hoisted variable" in the new `process-fixtures.ts`); error gate +2 New (moved code: `platform/src/process-probes.ts` (2), `search/src/indexer-write.ts` (1)) | `4cf2d4022` | GREEN (2 EG lines) |
| 6 | dh-jini `568efca10` | `00fca8148` | none | none (cms 26 tests) | — | GREEN |
| 7 | claude/uiux-split `791890c11` | `c01367580` | none | none (agent-plugins 15, plugin-catalog 68, `guard:plugins` 0, `test:agent-plugins:content` 0) | — | GREEN |
| 8 | rsh-jini `df58ca1d8` | `84e6da4df` | none | TS2379 `publish/transfer/bundle-staging.ts:157` (exactOptional `ttlMs`); guard N2 host path `apps/website/...` in a `file-blob-index.ts` comment | `126ccaff9` | GREEN |
| 9 | tq-jini `32d171689` | `f7ca33f16` | none | TS2379 in `forms/__tests__/destination-registry.test.ts:13` | fix rides in the #10 merge commit `eb269e7b8` (test declares `pull` once) | GREEN |
| 10 | tq-jini2 `1c05f2b54` | `eb269e7b8` | `cms/src/listing/index.ts` (rsh-jini's `static-collections` vs tq-jini2's `entry-list`) → both exports; `cms/package.json`, `cms/src/entries/index.ts` auto-merged | TS2379 `themes/manifest-v2.ts:266`; TS2345 `forms/html/__tests__/import-remote-submissions.test.ts:42`; guard SI-domain (`listing/entry-list.ts` → `navigation/href.ts`), HW3 ×2 (`forms/field-length-caps.ts` untyped `new Set`) | `1221c03dc`, `88a27f365` (cms `isolation.shared` += `src/navigation/href.ts`, a leaf; `ReadonlySet<string>`) | GREEN |
| 11 | ua-jini `d9af16bd1` | `17b92b9a6` | none | none (admin `ThemePreviewReloadControl.test.tsx` 2/2) | — | GREEN |
| 12 | ub-jini `365edf277` | `a6e19dcb5` | none | none (agent-plugins 4, plugins 10); owed `./host/node` API row → api:update | — | GREEN |
| 13 | bl-jini `878ce80c3` | `6049de379` | `.changeset/http-kit-range-entry.md` add/add → jx-c6fix's; `cms/package.json` → HEAD + token-aliases only. **Dropped X1–X8**: bl's cms/devops/http-kit package.json entries (devops/http-kit manifests = HEAD) and `.changeset/{cms-blocked-entries,devops-backup-entries}.md`. jx-c6fix's tags kept where they differ: `./forms/result-flash` universal (bl: node), `./backup/push-jobs` universal (bl: node). `cms/src/media/index.ts` (vs dh-jini) and cms integration contract test (vs xd-rs-c) auto-merged | cms contract-test assertion followed jx's tag (in merge); devops contract test expected every subpath `node` → push-jobs failed; error gate +1 New `[catch-reads-error] cms/src/media/chat-preview.ts` | `43d49a6f2` | GREEN (1 EG line) |
| 14 | jb1 `6da21feaf` | `b8df8418e` | none | none (chat 7, daemon 18, provider-plugins 17) | — | GREEN |
| 15 | jb2 `c39b5bbdd` | `f4502fb6b` | none | daemon `http-mcp-launch.integration.test.ts` "OpenCode ACP pilot…" — fake child had no `kill` (`failRun` SIGTERMs on close); **complexity** `agent-plugins/src/lifecycle/automatic-use.ts:222 prepare (11)`; **why-comments** 28 blocks lost (stuck-run watchdog deleted, redaction guesser removed, automatic-use rework, Sidebar DOMParser) | `60e718b01` (fixture), `06cd7ae7e` (chat `tests/` redaction case, found by the full suite); complexity + why-comments LISTED | tests GREEN; ratchets RED (listed) |
| 16 | dj-jini `a3a507cb4` | `f150add81` | none (ledger J8 merged last of G3) | none; witnesses: admin region-editor 14, chat delivery-and-liveness 18, cms date-label 8, daemon live-session-state 11, ui fetch-query 171, commerce ledger kernel suite 194 (+1 postgres skipped), oauth dynamic-registration 29; J8's 21 removed keys produced no New/Worse line | — | GREEN |
| 17 | jy-core `949c622a1` | `d0f458116` | none (`plugin-catalog/__tests__/catalog.test.ts` vs uiux-split auto-merged) | plugin-catalog 26 failures (catalog stale until the post-G4 regenerate, expected) | `f3fa92748` | GREEN after regenerate |
| 18 | jy-pay `d9c625e6d` | `141991ca3` | none (`.gitleaks.toml` exact-line allowlist merged as is) | agent-plugin content tests: charts-echarts/charts-recharts read `provider.extensions.tovu` (provider manifests now `jini`); cloudflare payload test opened `tovu-deploy-targets.json` (renamed by K9; REFRESH listed these) | `f3fa92748` | GREEN |
| 19 | jy-pads `7decf1a99` | `9be6f5649` | none | **complexity** `integrations/src/api-connections/hosted-mcp/sign-in-configuration.ts:70 selfConfigureConnection (11)`; why-comments +5 | LISTED | tests GREEN; ratchet RED (listed) |
| 20 | jy-cls `1559997e0` | `ad057e610` | none | ui `MemoryExtractionCard.test.tsx:40` selected `.jini-is-success`, but the component's template-literal class (`is-${tone}`) was a skipped token | `a5a38e019` (test follows the unchanged component) | GREEN |
| 21 | jy-pa `996583807` | `96e590d22` | none | cms `routing.ports.test.ts` pins README prose verbatim; J03 removed the ADR-039 references (found by the full suite) | `e1640809d` | GREEN |
| 22 | jy-pb `42031785d` | `c64beda8e` | none (J-06 stopped: nothing for it) | none (tsc of 30 packages 0) | — | GREEN |
| 23 | jz-jini `f3a766a24` | `b4cef9494` | `cms/src/widgets/resolvers/contact-form.ts` (jy-pa dropped "SPEC-043's", jz dropped the host path) → both removals; `html-embeds.ts`, `post-embed-resolution.ts`, `storefront.ts`, `ResourceCardParts.tsx` auto-merged and read | none (daemon 389, ui 27) | — | GREEN |

After G4: `f3fa92748` plugin catalog regenerated (`pnpm --filter @jini-ai/plugin-catalog run generate`; catalog tests 68/68, `guard:plugins` 0, `test:agent-plugins:content` 1391/1391). `bcc8db58d` `pnpm api:update` (40 packages, 676 entries) with the pre-update `api:check` in `combine-7-jini-api-changes.txt`.

## Generic-message notes
No merged branch replaced a specific error/log message with a generic one that I found in the diffs I read (jx-c6fix restores plugin id + error class in the desktop sign-in warning, with tests). Not audited line-by-line for the large G4 sweeps (prose/comment/class renames).

## Decisions for the owner
1. **jb2 why-comments (28 blocks)** — the code they explained is deleted by sheet (J-HW2 stuck-run watchdog + its test; RD-J1 guesser-only redaction; RT-J1/2 automatic-use; J-HW1 Sidebar DOMParser). Allow-list with "code deleted by <sheet>" or move? Not done here (not a build/typecheck/guard blocker).
2. **jy-* why-comments (88 more blocks)** — the de-branding prose rewrites (J01–J14, J05, J08–J11, D3 deletion of the GitHub deployments adapter) register as "lost" because the text changed. They need allow-list rows with reasons (as combine-6 did for its 20). Full list: `combine-7-jini-why-base.txt` (116) / `combine-7-jini-why-default.txt` (314 lost, 199 allow-listed).
3. **Complexity 2 new**: `automatic-use.ts:222 prepare` (11, jb2 RT-J2) and `sign-in-configuration.ts:70 selfConfigureConnection` (11, jy-pads J-ARGS). Split or add debt rows.
4. **Error gate 4 new lines** (no `--update`): `integrations/src/webhooks/tools/tool-handlers.ts` failure-text-from-catalog (rs-e S2); `platform/src/process-probes.ts` catch-reads-error (2) and `search/src/indexer-write.ts` (1) — code moved by split-jini, the old `process.ts`/`indexer.ts` keys are among the 8 "improved or gone", so moving the keys is a ledger move; `cms/src/media/chat-preview.ts` catch-reads-error (bl-jini L08).
5. **bl-jini vs jx-c6fix runtime tags**: kept jx's `universal` for `./forms/result-flash` and `./backup/push-jobs` (neither imports `node:`); bl said `node`.
6. **cms `isolation.shared` gained `src/navigation/href.ts`** so `listing/entry-list.ts` (tq-jini2) can use the href allow-list (alternative: inject `toAllowedHref` as `html/document-marks.ts` does).
7. **jy-cls class renames are breaking for host CSS**: e.g. `jini-memory-action-modal-backdrop`, `jini-memory-connected-summary`, `jini-memory-connector-result jini-is-success`, `jini-image-preview-modal`, `jini-form-editor-panel`; template-literal classes (`is-${tone}`) were skipped, so the same component can now mix `jini-is-*` and `is-*`.
8. **api:check `@jini-ai/daemon` REMOVED** 46 entries (`./terminal`, `./http#register*Routes`, …) — pre-existing baseline drift, not from this run (no change to `packages/daemon/package.json` or `src/http/index.ts` between `d3e78b387` and HEAD; `registerHealthRoutes` is absent at base too). api:update now records the real surface.

## Final gates (gates at `bcc8db58d`; full build at `f3fa92748`; later commits change only two test files and `cloud-results/`)
| command | base `d3e78b387` | final |
|---|---|---|
| `pnpm --no-bail -r build` | 0, 0 `error TS` | **0**, 0 `error TS` |
| `pnpm -r --no-bail --if-present run typecheck` + scripts tsc | 0 / 0 | **0 / 0** (0 errors) |
| `pnpm guard` | 0 (HW3 37) | **0** (HW3 34, 0 new) |
| size | 0, 60 entries | **0**, same output |
| complexity | 0, 2 | **1 — 2 new** (decision 3) |
| hooks | 0 | **0** |
| why-comments `--base d3e78b387` | 0 | **1 — 116 lost, 0 allow-listed** (decisions 1–2) |
| why-comments default (terra) | 0 (199/199) | **1 — 314 lost, 199 allow-listed** |
| log-safety | 1 BASE-RED | 1, **identical to base** |
| error gate | 0 WARN, 25 New | 0 WARN, **29 New** = base 25 + 4 (decision 4); 8 improved |

Every final error-gate line (BASE-RED unless marked):
```
New: [catch-reads-error] packages/admin/src/forms/react/hooks/use-form-editor-parts.hooks.ts (3)
New: [catch-reads-error] packages/admin/src/media/adapters/http.ts (1)
New: [catch-reads-error] packages/admin/src/react/entities/FailureNotice.tsx (1)
New: [no-generic-failure-text] packages/admin/src/react/entities/FailureNotice.tsx (1)
New: [catch-reads-error] packages/agent-runtime/src/agent-protocol/acp/session-permission.ts (3)
New: [catch-reads-error] packages/agent-runtime/src/agent-protocol/acp/session-run.ts (3)
New: [catch-reads-error] packages/agent-runtime/src/claude-stream-handler.ts (1)
New: [catch-reads-error] packages/agent-runtime/src/json-event-stream-shared.ts (1)
New: [catch-reads-error] packages/chat/src/embed-widget/browser/agent-inventory.ts (2)
New: [catch-reads-error] packages/cms/src/media/chat-preview.ts (1)                          <- NEW (bl-jini)
New: [failure-text-from-catalog] packages/cms/src/trash/adapters/directory.node.ts (1)
New: [catch-reads-error] packages/core/src/contracts/ai-trace/capture.ts (1)
New: [catch-reads-error] packages/core/src/contracts/ai-trace/sinks.ts (1)
New: [catch-reads-error] packages/daemon/src/agent-executor/mcp-json-file.ts (1)
New: [failure-text-from-catalog] packages/db/src/sqlite/stopped.ts (1)
New: [catch-reads-error] packages/desktop-host/src/electron/app-version.ts (1)
New: [catch-reads-error] packages/devops/src/packaging/electron/tree-fingerprint.ts (1)
New: [catch-reads-error] packages/diagnostics/src/web-evidence/bounded-body.ts (1)
New: [catch-reads-error] packages/http-kit/src/node-bridge.ts (6)
New: [failure-text-from-catalog] packages/integrations/src/webhooks/tools/tool-handlers.ts (1)  <- NEW (rs-e-jini)
New: [catch-reads-error] packages/mcp/src/federation/hosted/probe.ts (1)
New: [catch-reads-error] packages/platform/src/mail/email-template-operations.ts (1)
New: [catch-reads-error] packages/platform/src/process-probes.ts (2)                          <- NEW (split-jini move)
New: [catch-reads-error] packages/platform/src/secrets/sealer-contract.ts (1)
New: [catch-reads-error] packages/search/src/indexer-write.ts (1)                             <- NEW (split-jini move)
New: [catch-reads-error] packages/ui/src/features/memory/react/hooks/useMemoryConnectors.parts.hooks.ts (3)
New: [failure-text-from-catalog] packages/ui/src/features/memory/react/hooks/useMemoryConnectors.parts.hooks.ts (3)
New: [catch-reads-error] packages/ui/src/features/version-manager/react/hooks/useVersionManager.state.ts (1)
New: [catch-reads-error] packages/ui/src/react/hooks/usePersistedDisclosure.ts (2)
```
Every log-safety line (all BASE-RED, unchanged):
```
New raw log path: [stored-error-text] packages/core/src/approval-batch-chain.ts (2)
New raw log path: [stored-error-text] packages/daemon/src/agent-executor/codex/home-staging.ts (1)
New raw log path: [stored-error-text] packages/daemon/src/http/tool-execution-routes.ts (1)
New raw log path: [stored-error-text] packages/desktop-host/src/app-version/loader.ts (2)
New raw log path: [error-format] packages/desktop-host/src/app-version/update-check.ts (1)
New raw log path: [error-text] packages/desktop-host/src/app-version/update-check.ts (1)
New raw log path: [error-format] packages/http-kit/src/node-bridge.ts (1)
New raw log path: [error-helper] packages/http-kit/src/node-bridge.ts (1)
New raw log path: [console] packages/ui/src/features/panel-kit/hooks/use-settings-slice-save.hooks.ts (1)
```
Complexity and why-comments lines: `combine-7-jini-complexity.txt`, `combine-7-jini-why-base.txt`, `combine-7-jini-why-default.txt` (every line).

## Tests
Full suites at `f3fa92748` in worktree `/home/user/jt` (fresh frozen install + `pnpm --no-bail -r build` exit 0, 0 `error TS`), every package this run touched (36), `--maxWorkers=2 --minWorkers=1`; raw summary `combine-7-jini-suites.txt`:
agent-runtime 4530 (+1 skipped), daemon 4831 (+1), **cms 4999/5000**, platform 3353 (+6), search 371, agent-plugins 2198 (+2), **chat 4464/4468** (+1), ui 8816, **admin 3072/3073**, core 2947, devops 1326, http-kit 750, integrations 2077, plugins 1015, provider-plugins 901, plugin-catalog 68, commerce node 52 + vitest 11 + kernel 1421 (+1), oauth 824, mcp 1882, db 950, diagnostics 1090, desktop-host 749 (+1), sidecar 416 (+3), agentic 1149, analytics 226, artifacts 242, capability-providers 198, cli 604, infra 155, node-adapters 11, protocol 794, registry 392, sandbox 179, ui-kit 232, user-management 1353, vibecoding 364. Plus `pnpm test:agent-plugins:content` 1391/1391 and `guard:plugins` 0 (main tree, after `f3fa92748`).
- search and commerce first exited 1 before running (their own `test` scripts already pass `--maxWorkers`, so the appended flag was duplicated); re-run with the plain script: green (numbers above).
- **cms 1 red** `routing/__tests__/routing.ports.test.ts` "…ADR-039 registry rationale verbatim" — jy-pa J03 rewrote the pinned README prose. Fixed `e1640809d` (test pins the new prose); 5/5.
- **chat 4 red** `tests/folder-drop-redaction.integration.test.ts` (4 path cases) — jb2 RD-J1 stops masking unlabelled long ids, the test (outside `src/`) still expected the AWS-example string removed. Fixed `06cd7ae7e` (glues a runtime-built `ghp_` key instead; same property); 4/4.
- **admin 1 red under load** `agent-plugins/react/__tests__/agent-plugins.test.tsx` "renders both enabled and disabled rows read-only…" (no `Portable components` region found after Expand) — passes 7/7 run alone; the file and `AgentPluginRow.tsx` last changed by jy-pads only in prose/pads. Load-sensitive; not chased.
- E-J1 (cms submit-service host-options) green under load: see Extra checks (a).
- Per-merge targeted runs and their reds: see the per-branch table.

## Extra checks
- **(a) E-J1** cms `forms/__tests__/submit-service.host-options.test.ts` under full-suite load: **25/25 pass** (the "pending copy" case included) in the full cms run.
- **(b) knip** (`pnpm quality:knip`, combined tree; list only, nothing removed) — `combine-7-jini-knip.txt`. Unused dependencies (10): `@jini-ai/db`, `@jini-ai/http-kit`, `@jini-ai/oauth`, `@jini-ai/registry`, `@jini-ai/sidecar` (examples/minimal-host); `@jini-ai/http-kit`, `@jini-ai/mcp` (examples/reference-web); `zod` (packages/agentic); `unpdf`, `mammoth` (packages/cms). Also 24 unused devDependencies, 23 unlisted dependencies, 1 unlisted binary, 15 unresolved imports — every line in the file.
- **(c) ACP parity** — pilot stays OFF (`opencodeAcpAgentDef` is exported but not in `BASE_AGENT_DEFS`). `opencode-ai@1.19.6` installed in scratch (npm), driven raw over `opencode acp` with an empty HOME (`combine-7-jini-acp-probe.txt`). The Jini-path items need a model, and the proxy refuses the opencode model host (403), so:

| # | item | result |
|---|---|---|
| 1 | initialize advertises loadSession; capabilities/models | **PASS (raw)**: `loadSession: true`, mcp http+sse, prompt embeddedContext+image, session close/fork/list/resume; authMethods `opencode-login`; session/new offers `model` (212 options, current `opencode/big-pickle`) and `mode` (2: build/…) |
| 2 | text_delta + succeeded + usage | NOT-RUN — prompt fails: proxy 403 to the model host (only a `usage_update` 0/200000 frame arrived) |
| 3 | resume via session/load (bogus id → resume_failed + reseed) | NOT-RUN through Jini (ACP-3 stopped, no resume wiring). Raw: bogus id → `-32603 "Internal error: OpenCode service failure"` |
| 4 | picker model accepted / bad id → "did not accept the model" | NOT-RUN (ACP-4 stopped; needs a model) |
| 5 | thought_level offered? | raw: **not offered** (configOptions are only `model`, `mode`) |
| 6 | cancel → cancelled ≤ 5 s, no leftover process | NOT-RUN through Jini; raw SIGTERM → exit in 61 ms |
| 7 | restricted run asks and is denied; bypass once | NOT-RUN (needs a model) |
| 8 | one real Jini tool call over HTTP MCP | NOT-RUN (needs a model) |
| 9 | journal holds neither JINI_DAEMON_TOKEN nor the HTTP token | NOT-RUN (no live run) |
| 10 | clean finish leaves no descendants, staged files removed | NOT-RUN (no live run) |
| 11 | signed-out → AUTH_REQUIRED message | NOT-RUN — signed-out opencode falls back to its free model, so the failure here is the proxy 403, not auth (jb2 ACP-2's unit test covers the mapping: agent-runtime suite green) |
| 12 | the 12 existing ACP defs pass `agent-executor-acp.integration.test.ts` | **PASS** — 4/4 in the full daemon suite |

## Exported signatures and subpaths for the Tovu run
New subpaths (14): cms `./themes/token-aliases`, `./themes/manifest-v2`, `./themes/preview/refresh` (node), `./presentation/html`, `./presentation/page-head`, `./forms/result-query`, `./forms/result-flash` (universal), `./publish/transfer`, `./publish/transfer/blob-staging` (node); devops `./backup/plan-store` (node), `./backup/push-jobs` (universal); http-kit `./range`; agent-runtime `./native-permissions`; core `./contracts/server/security-headers`.
New exports (44, see api file): cms `./entries#{entriesDeps, entryWriteErrorStatus, goLiveEvent, wentLiveSinceSave, announcePendingGoLive, announceDueGoLives, GoLiveRow, GoLiveCandidatesPort}`, `./forms#{buildFormDestinationRegistry, capSubmissionFieldLengths, fieldMaxChars, FORM_TEXT_MAX_CHARS, FORM_LONG_TEXT_MAX_CHARS}`, `./forms/html#{importRemoteFormSubmissions, RemoteSubmissionInput, RemoteImportResult, ImportRemoteSubmissionsDeps, FormSubmissionReceiptPort, FormImportCounts}`, `./forms/sql#{SqlFormDeliveryRepo, SqlFormPullLeaseRepo, SqlFormSubmissionReceiptRepo}`, `./listing#{renderEntryList, StaticCollectionList, injectCollectionEmbeds, collectionMarkerKey, splitCollectionMarkerInner, withEntryListStyleOnce, renderEntryListStructuredData, EntryList*}`, `./media#{withChatPreview, parseOptionalTitleField, parseOptionalStringField, parseOptionalSlugField}`, `./themes/template-applicability#rejectTemplateFor`; admin `./react#ThemePreviewReloadControl`; plugins `./host/node#createPluginModuleImporter`; chat `./core/ag-ui#drainRunFramesToAgUi`; agent-runtime `opencodeAcpAgentDef` (pilot, not registered).
Removed: ui `trackRunStart`, `trackRunProgress`, `trackRunTerminal`, `TrackRunStartOptions`, `__resetStuckRunWatchdogForTests` (jb2 J-HW2); `DEFAULT_CHART_THEME` from core `./contracts/charts` (jy-pads J-CHART; moved into the ui chart host); jy-cls J-01/J-02 and jy-pb J-03–J-05 internal exports.
Changed signatures (one object argument, jy-pads J-ARGS / jy-cls J-ARGS-UI2/CHAT): `isCustomSelectEventInside`, `isOutsideHeaderMenu`, `triggerBrowserDownload`, `useWiredBrowserBridgeRegistration`, `useWiredBrowserHistory`, `toastEffectiveTtl`, and the jy-cls conversions (130 "changed export" rows in the api file, incl. ui-kit `./react#{ConfirmDialog, KitProvider, Overlay, ToastRegion}`, user-management `./react#ChangeUsernameDialog`).
Renames that break hosts (owner 11-20: accepted): plugin manifest ids/authors and `extensions.tovu` → `extensions.jini` (jy-core K2, jy-pay K1); agent-plugin files `tovu-*.json` → `jini-*.json` (jy-pay K9, e.g. `cloudflare/jini-deploy-targets.json`); Sheets persisted names, credential fields, env names (jy-pay K6–K8; retired-env advice removed); emitted CSS classes (decision 7).

## Remaining `tovu` hits in `packages/`
`git grep -n -i tovu -- packages` → **519 lines in 183 files** (base `d3e78b387`: 1234), every line in `combine-7-jini-tovu-hits.txt`. Non-test files: `agent-plugins/src/core/identity-namespace.ts` (9, the legacy-key reader), `plugins/src/host/plugin-format.ts` (2), `agent-plugins/vercel/object-stores/vercel-blob.mjs` (2), `agent-plugins/s3-compatible/targets/s3-compatible.mjs` (1), `agent-plugins/s3-compatible/jini-deploy-targets.json` (1), `agent-plugins/resend/NOTES.md` (1), `agent-plugins/calendly/mcp.json` (1), `admin/src/{seo,forms,comments}/PORT.md` (1 each). The rest are tests/fixtures/CHANGELOGs (by package: agent-plugins 238, cms 56, db 44, plugins 43, provider-plugins 31, chat 28, admin 27, daemon 12, ui 10, integrations 5, http-kit 5, agent-runtime 4, desktop-host 3, commerce 3, vibecoding 2, user-management 2, mcp 2, plugin-catalog 1, oauth 1, devops 1, cookie-consent 1). Not restored or renamed here.

## Left / next
1. Owner: decisions 1–8.
2. Mutations owed by the executors (jx-c6fix J4, ua-jini, ub-jini, bl-jini, jb1, jb2 RT/RD/ACP, dj-jini J1–J7, tq-jini2, rsh-jini B01/R6b, rs-e S2): **NOT-RUN** (time).
3. Stopped sheets carried by the executors (not merge work): xd-rs-c S6c (done in xd-rs-c2), rs-e S12-J, rsh S6c-J, tq J1–J6 (done in tq-jini2 except J1 validator full), bl K-04b-J, jb1 RD-J1 (done in jb2), jb2/jz ACP-3/4/5, jy-core K3, jy-pb J-06.
4. Not run: e2e/playwright, `pnpm test:scripts`, ACP live parity items (need a model host the proxy allows).
5. Tovu combine-7: build against this branch; the subpaths/signatures above; renamed plugin ids/files/classes.
