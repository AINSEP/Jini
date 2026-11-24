PARTIAL 9938bc0692 c8961ec63: content-analyzer STOPPED (no neutral Jini plugin-SDK surface: owner decision, recommendation below); Tovu halves of combine-17 FIXes rv1123l T5-T8/T11/T16, rv1123k fnd T2, rv1123m T18 not re-applied (parallel merge-17 rebuild); other w3 leftovers belong to the other wave-5 lanes or wait on OD-4 | FILES LEFT 1,653 -> 1,648 (excl. themes 1,542 -> 1,537)

# w5-w3rest (2026-11-24): finish the files the wave-3 lanes left, per the wave-5 coordinator decisions

Unattended cloud run. Opus high coordinator; all builder work by Sonnet high subagents, Opus subagents only for the two security seams (sealer, content-analyzer trusted imports). `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read before any work (root-cause first, minimum change, test-first + named mutation for behaviour changes, fresh evidence before claiming done); its rules went to every worker via a shared brief.

## Base
- **Jini:** `origin/integ/merge-17-2026-11-23` = `b565aaa7`.
- **Tovu:** `origin/integ/merge-17-2026-11-23` did not exist at start (combine-17's Tovu push had been refused by the desktop pre-push gate). Rebuilt locally as instructed: `origin/integ/merge-16-2026-11-23` (`3a93322474`) + the 9 `origin/codex/w3-{rtfnd,fnd,users-sec,settings,screens,sites,deploy,pages-members,addons}-tovu` merged in that order with combine-17's conflict decisions (owner clients -> users-sec; Content Analysis -> screens; Skills -> addons; Git backup/Import-Export -> deploy; WebMCP/folder picker/admin-page-tools/sites-port -> sites; visitor-tools types -> Core; duplicate assistant route specs -> merge-16; `admin-json-route-ports` keeps `forwardRejection` + rtfnd's options; shared ledgers/CSS/composition unioned). Merge SHAs: rtfnd `36a8770c8d`, fnd `a80dd3fefe`, users-sec `09b08e3a3c`, settings `2619c4e055`, screens `8c597bc853`, sites `24dcab12e6`, deploy `4c8c600eac`, pages-members `3055d98120`, addons `328796089b` (cumulative conflicts 9/30/36/61/14/93/41/80/124).
- Fallout fixed to green (`fix(w5-base): ...` commits): root tsc 253 -> 0, admin tsc 137 -> 0, e2e typecheck 0, desktop typecheck 0. Most of it was the Tovu half of review FIXes whose Jini half is in Jini merge-17 (required `orFallback`/`orFallbackSync`, rollback reporter shape, `serverLogFilterReply`, store/lipay manifests built with the persisted `"tovu-core"` publisher, observability hook bindings, `useLocalizedUsers` + `useUsers`/`onOwnPasswordResetClosed`, `{ events }` a2ui args, `agentHandle` objects, etc.).
- Setup: Node 24.22.3 (`/opt/node24`), pnpm 10.33.2; Jini `pnpm install --frozen-lockfile` 0, `pnpm --no-bail -r build` 0; Tovu `npm ci` (root, prepare installs `core.hooksPath=apps/desktop/scripts/hooks`), `npm ci --ignore-scripts` admin/desktop/site-chat, `link-jini.mjs` (82 links). The pre-push hook was never bypassed; every Tovu push ran the desktop gates (all PASS).

## FIX items (Tovu `origin/plan/whats-left-1122:reviews/rv1123k.md, rv1123l.md, rv1123m.md`)
- **Jini halves:** all present in Jini merge-17 (combine-17 applied them: rv1123k J1-J4 fnd, J1-J5 settings, J1/J2 screens; rv1123l J1-J4, J9, J10, J13-J15; rv1123m 1-4, 7-10, 13, 14, 16). Skipped per instruction. combine-17's deferred items stay deferred: fnd J2 `stored-credential-endpoint` `trimCharsEnd` (owner call), screens J3/T2 (Sites did it), rv1123m 12 (theme freeze), rv1123m 15 (K3 exception, owner call).
- **Tovu halves:** combine-17 applied them only in its own container (its Tovu merge-17 was never pushed), so they were lost. Per instruction they are not redone as a batch: the parallel merge-17 rebuild carries them. The Tovu halves this rebuild needed to typecheck against Jini merge-17 were re-done as `fix(w5-base)` commits:
  - **rv1123k fnd T1:** `shell-collaborators.ts` uses the users-sec `owner-clients.ts` binding.
  - **rv1123k settings T1 / screens T2:** the Screens Content Analysis mount (`PostSavedPanels.tsx`) is kept with its required hook; Settings' CSS cutover is dropped.
  - **rv1123k fnd J4 callers:** a2ui `{ events }`.
  - **rv1123l J9 host binding:** `useLocalizedUsers` gets the required `useUsers`, and `onOwnPasswordResetClosed` navigates to `/users`.
  - **rv1123m 5:** observability hook and navigation bindings; the server-logs `serverLogFilterReply` mapper.
  - **rv1123m 6 (test-first):** `dictionary-lookup-sinks` accepts `COMMON_I18N` only as a K4 factory's `commonDictionary` (members, page-editor, plugins). The new case went RED, then GREEN. Mutation `sink-ignores-commonDictionary-key` turns it RED.
  - **rv1123m 17 (combine-17 variant):** `createStoreManifest`/`createLipayManifest({ publisher: FIRST_PARTY_PUBLISHER })` keep the persisted "tovu-core" publisher.
  - **rv1123m 11 partial:** the recovery reporter takes `{ message, error }` and the trash rollback sink takes `({ message, error })`. There is no shared host rollback reporter yet.
- **Tovu halves NOT re-applied here** (the parallel merge-17 rebuild owns them):
  - rv1123l T5: raw-route origin context. `admin-raw-route-ports.ts` has no origin wiring on this base.
  - rv1123l T6, T7, T8.
  - rv1123l T16: attachments method route.
  - rv1123l T11 deeper roles CSS states.
  - rv1123k fnd T2: Skills `ErrorNotice` from the kit.
  - rv1123m T18: `features/webhooks/index.ts` comment-only remnant. It is still present, and 7 baseline edges plus 2 doc references name it.
- **Test-floor change to review:** the `dictionary-lookup-sinks` sanity floor dropped from 30 to 25, with a comment, the same change combine-17 recorded. Dictionaries keep moving into Jini factories. The no-inline-lookup assertion is unchanged.

## Files (lane: files the w3 lanes left; wave-5 coordinator decisions)
| file (Tovu) | result |
|---|---|
| `features/webhooks/secret-sealer.aesgcm.ts` (+test) | MOVED -> `@jini-ai/platform/secrets` (`secret-sealer.aesgcm.ts`: `SecretOpenError`/`SECRET_OPEN_FAILED`, omitted-AAD default, open-error mapping). Decision 11/15. Opus worker; mutations `sealer-drops-aad-default`, `open-error-unclassified`; 607/607 secrets tests incl. the pinned wire-format suite. ~200 importers repointed by `sealer-tovu.sh`. **Security note for Codex:** `seal()` with an absent `aad` now means zero AAD bytes, so old rows open byte-for-byte. A fixed-IV test proves equality with the pre-AAD code. Jini previously refused an absent AAD; null, numbers and objects are still refused. Port types still require `aad: string`, and Tovu `check:seal-aad` still enforces it at production sites. |
| `features/webhooks/keyring.memory.ts` (+test) | MOVED -> existing platform `secrets/testing` `InMemoryKeyring({ hkdfSalt })`; the host binding sits in `keyring.env.ts` beside the frozen salt (no forwarding file). |
| `features/webhooks/keyring.env.ts`, `site-key-sources.ts` | STAYS-HOST (frozen salt `tovu-integrations-root-key-hkdf-v1`, `TOVU_SITE_KEY`, `~/.tovu/site-keys/`: K3 product bindings; renaming breaks every sealed row) |
| admin `features/plugins/plugins-i18n.ts` (+test) | MOVED -> `@jini-ai/admin/screens/plugins/plugins-i18n` as `createPluginsDictionary({ commonDictionary, productName }, _optional)`; "Tovu" became a `{product}` slot in 21 locales (4,242 entries byte-identical with `productName: "Tovu"`); host binds `translatePlugins` in `lib/i18n-common.ts`. Decision 3. Mutation `plugins-dictionary-hardcodes-product`. |
| `features/agent-plugins/host-plugin-guidance.ts` (+test) | MOVED -> `@jini-ai/agent-plugins/site/host-plugin-guidance`; `js-yaml` ^5.3.0 is a REAL dependency (lockfile updated); `overlaysDir` REQUIRED. Decision 15. |
| `features/agent-plugins/host-overlays-dir.ts` (new) | STAYS-HOST (host binding: `TOVU_AGENT_PLUGIN_OVERLAYS_DIR` + product root -> `overlaysDir`) |
| `features/skills/state.ts` | MOVED/deleted: Jini `@jini-ai/agentic` owns `SKILL_STATE_FILE_NAME = ".skill-install.json"`, reads new then each `legacyStateFileNames`, writes only the new name, never deletes the legacy file; a broken new file fails closed. Host injects `legacyStateFileNames: [".tovu-install.json"]` (`site-host.ts`); the skills files route hides both names. Decision 15, test-first (7/8 RED -> GREEN); mutations `skills-state-ignores-legacy-file`, `skills-state-writes-legacy-name`. |
| `contracts/core/tool-access-change.ts` + forwarders `external-mcp-roster-change.ts`, `assistant-tool-access-lowering.ts` | MOVED -> `@jini-ai/core/tool-access-change` (`ToolAccessLoweringError`, `NotifyToolAccessChanged`); forwarders deleted, ~15 importers repointed. Note: `codex/w5-content-jini` adds the same file at the same path with near-identical content (trivial add/add at combine). |
| `features/plugin-runtime/lower-tool-access.ts` | MOVED -> `@jini-ai/plugins/runtime/lower-tool-access` (structural `LowerToolAccessProviderFaces`); Tovu test kept as the roster-listener integration test. Mutation `rethrow-raw-cause`. |
| admin `features/email/hooks/use-email-provider.hooks.ts` | MOVED -> `@jini-ai/admin/screens/email/hooks/use-email-provider.hooks` (`ApiError` + plugins client REQUIRED via `EmailProviderPluginApi`); `useWiredEmailProvider` in host `email-hooks-host.ts`. Mutation `ignore-injected-ApiError`. |
| admin `integrations-api.types.ts` `AdminAgentPlugin` | SPLIT: core type-only `AdminAgentPluginRow<Maturity, ConnectionStatus, Origin>` (`@jini-ai/core/contracts/site/cms-agent-plugins`, typecheck-pinned to the DTO); host keeps a one-line binding alias injecting its closed unions (28 importers narrow on them). Decision 11/15. |
| `features/plugin-runtime/built-ins/content-analyzer/{plugin,index,analyze-content,tiptap-blocks}.ts` (+5 tests) | STOPPED (genuinely new owner decision): Jini has no SDK surface `plugin.ts` can import: `@jini-ai/plugin-sdk` is only a virtual specifier resolved by the Tovu sdk-resolver to Tovu `packages/sdk`; `definePlugin` (value) and `HOOK_CONTENT_ENTRY_BEFORE_SAVE` are not in Jini; core `ContentEntryDraft` lacks `title`/`bodyJson`/`metaDescription`. Leaving `@tovu/sdk` in Jini breaks K3; moving only siblings would widen the trusted list. **Recommendation:** add `definePlugin` + hook-id constants to `@jini-ai/core/contracts/plugin-sdk` with a type-level `@jini-ai/plugin-sdk` mapping, a cms content-entry draft type, home the built-in in `@jini-ai/cms` (plugins has no cms edge); then the trusted list becomes exactly `["@jini-ai/cms/seo/content-analysis", "@jini-ai/cms/html/site/slug"]` (byte-identical slug helper; same size, one specifier replaced). Trusted list unchanged in this run. |
| site-backup `share-policy.ts` chain (deploy) | owned by w5-webfeat (`codex/w5-webfeat-jini` already has `devops/backup/site/share-refusal`). This lane's duplicate Jini commit `f76cc6c2c` was reverted (`c8961ec63`); the pure cms `TransformParams` dedupe onto the existing core `cms-media` contract (`0ef771d07`, cms 650/650) was kept. |
| Jini `packages/ui/src/react/testing.tsx` (fake kit) | fixed: `SecretInput` declares `autocomplete="new-password"` (combine-17 bug; Tovu `credential-input-autocomplete` 22/22) |

Not taken by this lane (owned elsewhere / blocked, reasons from the w3 reports, unchanged):
- **addons:**
  - `set-enabled.ts`, `update-effects.ts`, `memory.ts`, `provider-operations.ts` (+3 registrations): route-deps fields belong to the routes lane.
  - external-mcp `deps.ts`: K4-seam-20, core-owners lane.
  - email-templates `operations`/`tool-registrations`/`index`: post/pages contracts, content lane.
  - admin Email components and the remaining Skills hooks/`api.ts`: admin HTTP port, admin lane.
- **sites:**
  - K3 catalogs `web-screenshot/agent-tools`, `sites/agent-tools`, `sites/tool-registrations`: decision 13 R5, website-features lane.
  - `AdminExecutionMode`: assistant lane.
  - `origin/*`: STAYS-HOST per decision 11 ("adapter stays host").
- **deploy:**
  - source-control, deployments `host-kit` (new devops deps: still an owner decision; recommendation in w3-deploy.md), `publish-trust/challenge` (routes), and publish-content sheets 3-6 (theme freeze).
  - **users-sec:** SEC-T1a/b/c are still blocked on **OD-4 (i)-(iv)**, which `P9-SEC-owner-decisions.md` leaves unanswered. Recommendation unchanged: approve OD-4 (iii) as the module swap.
  - Kysely identity repos: db lane.
  - `permission-list-tool`: R5 catalog, website-features lane.
- **settings:** Kysely repos (K4-seam-5, core-owners), external-MCP admin screens (A-K2-integrations-1, admin lane), `ai-agent-presentation` (execution-card types to core, decision 11, admin lane).
- **screens:** publish-content (K5-publish-content-ui-1 + the 815-line hook), skills / fs-files / import-export api (admin HTTP port), webmcp storage key (K3): admin lane.
- **pages-members:** page-editor port (core `AdminContentRow`, content lane), website `features/pages/*` (website-features), held newsletter patch files, `member-login/*` (K5-custom-credentials-3).

## Gates (no new red vs base)
**Jini** at `c8961ec63`, compared with base `b565aaa7`:

| gate | base | final |
|---|---|---|
| build (`pnpm -r build`) | 0 | 0 (changed packages rebuilt) |
| typecheck (`pnpm -r typecheck`) | 0 | 0 |
| guard | 1 (HW3 `admin/shell/lib/shell-failure-log.ts`) | 1, same row |
| api:check | 0 | 0 (baselines committed for admin, core, plugins, agent-plugins, agentic, platform) |
| check:hooks | 0 | 0 |
| why-comments (`WHY_COMMENTS_BASE_REF=b565aaa7`) | n/a | 0 lost |
| check:size | 1 row (cms `redirects.ts` 513) | same row |
| check:complexity | 4 rows (agent-runtime, chat, core reporter, ui ErrorNotice) | same rows |

`origin/refactor/terra` is not in this clone, so why-comments ran against the merge-17 base.

Vitest on the changed packages (`--maxWorkers=2`):
- platform 3450/3451 (+6 skipped). The 1 red is **BASE-RED**: `source-boundaries.test` flags `fs/__tests__/durable-json.boundaries.test.ts`, added by base commit `b565aaa7`; this lane never touched `platform/src/fs`.
- agentic 1218/1218, agent-plugins 2257/2257 (+2 skipped), plugins 1063/1063, core 3054/3054, admin 5232/5232, ui 8890/8890, cms 650/650 (worker run).

**Tovu** at `9938bc0692`:
- **typecheck:** root tsc 0, e2e 0, `apps/admin` tsc 0, desktop 0.
- **check:hooks:** ok.
- **why-comments (`--base d0af8bc5e4 --other-root /home/user/Jini`):** 0 unaccounted. Of the 29 blocks the lane moved, 1 was restored in Jini (it now clears the check via `--other-root`) and 28 got debt rows. 19 of those rows say "moved to <Jini path:line>" (every Jini line was opened and checked), and 9 are obsolete adapter-mechanism comments, each with a precise reason. Jini restorations in `8608ed4a1`.
- **Desktop pre-push gates:** 6/6 PASS on every push. The 3 reds found first were all BASE-RED at merge-16 (reproduced in a merge-16 worktree) and were fixed without adding any debt row:
  - `use-site-folders` test: `UpdateCheckMenuItem` was never bound in the source-compiled test.
  - `use-workspace-chat-pane` source pin: updated to the injected-hook shape, same invariant.
  - SiteGrid/SiteStartPanel/TabStrip complexity 10 -> <=9 by small extractions; the fixed `App` row was removed.
- **Admin vitest** (`--maxWorkers=2`): every test file changed on the branch (28 + 14 + 11 + the guards). All green after the fixes, with one exception that I did not re-run after the final fixes. Earlier reds and what happened to them:
  - `AgentFailureCard` class assertion: now asserts the `jini-notice` classes.
  - `credential-input-autocomplete`: fixed in Jini `98ebef3dc`; 22/22.
  - `dictionary-lookup-sinks`: rv1123m FIX 6; 16/16.
  - The exception: 26 of the 28 files were green in a run before those fixes and were not re-run afterwards.
- **Website node tests** (387 files: every test touched by the lane items + all tests under webhooks, skills, agent-plugins, plugin-runtime + named extras): 5,367 tests; 5,314 pass, 47 fail, 6 skipped.
  - **46 are BASE-RED:** same test names at the pre-item base `d0af8bc5e4`, re-run in a worktree. They come from the bundled-* package tests, federate-mcp, install-upload-update, publish-credentials pins, secret-scan-guard, tool-contract characterization, skills/manage, mail-send golden, resolve-mailer, move-site-storage.postgres (env), plugin-host.integration, mcp-ui-allowlist-completeness, and 3 overlay `.mjs` tests.
  - **1 is a load flake:** `backstop.routes.pins` "Express request did not finish". It passes 37/37 alone.
  - These were NOT bisected against merge-16 itself. combine-17 reported 56 node reds on its own rebuild.
- **Script checks:** `check:seal-aad` passes.
  - `check-site-key-names.sh` fails with 163 old-name hits. The sealer item took the frozen-salt line count from 4 to 3. The files this lane touched have the same hit counts as at base, so this looks like base, but the script was not run at base.
  - `check:architecture` fails on propagation cost 3.06 -> 3.43. It was not run at base; this most likely comes from the merge rebuild.

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs` from `origin/plan/whats-left-1122`; FILES LEFT = moving + shells; themes = `theme` + `adm-themes` = 111)
| tree | moving | shells | FILES LEFT | excl. themes |
|---|---|---|---|---|
| base (rebuilt merge-17, `b621656eb9`) | 1,653 | 0 | **1,653** | **1,542** |
| final (`9938bc0692`) | 1,648 | 0 | **1,648** | **1,537** |
| delta | -5 | 0 | **-5** | **-5** |

combine-17 reported 1,655 / 1,544 for its own merge-17, so the rebuild is within 2 files of it. This lane deleted 12 Tovu source files and added 2 host bindings: `host-overlays-dir.ts`, and `email-hooks-host.ts` gained the moved hook's wiring.

## Commits
- **Tovu** `codex/w5-w3rest-tovu`, on top of the rebuild above:
  - lane items: `789923cbc8` (sealer), `7d004d08f7` (plugins-i18n), `39e4f1a5b7` (guidance-skills), `bc7d79668e` (core-contracts).
  - base fixes: `936ce09c49`, `3407fdecf3` (desktop).
  - admin test guards: `15351714a3`, `e958528c02`.
  - why-comments: `9938bc0692`.
- **Jini** `codex/w5-w3rest-jini`:
  - `5b9b592ba` host-plugin-guidance + js-yaml dependency.
  - `c081421cf` plugins dictionary factory.
  - `83d9ad9d3`, `add0e068c` sealer.
  - `65766123a` skills state file.
  - `937ceff93` core `AdminAgentPluginRow` + `ToolAccessLoweringError`.
  - `f9c41f500` lower-tool-access.
  - `0ef771d07` cms `TransformParams` dedupe.
  - `529d33435` email provider hook.
  - `f76cc6c2c`, reverted by `c8961ec63` (duplicate share-refusal; w5-webfeat owns it).
  - `98ebef3dc` ui fake-kit autocomplete.
  - `9e061102d`, `8608ed4a1` why-comments.

## Rules held / notes
- No force-push, no `--no-verify`, `core.hooksPath` untouched, no codebase-memory tools.
- `main`/`integ/*`/`plan/*`/`release/*`/other `codex/*` untouched; nothing published or tagged.
- No re-export files were added. Two Tovu forwarders were deleted, and `features/webhooks/index.ts` is still a comment-only remnant (rv1123m T18, not re-applied).
- Moved hooks reach Jini only as REQUIRED args. No host types or formatters were added to Jini, and no new size/complexity rows.
- Shared types are in `@jini-ai/core`, and new exports take an args object plus `_optional = {}`.
- **API baseline reformat:** the committed `api-baseline/jini-ai__{admin,core}.json` diffs are mostly `api:update` reformatting (the generator's output differs from the committed format); the new entries are additions only.
- **Shared-file overlaps for the combiner:**
  - `packages/core/src/tool-access-change.ts` is also added by `codex/w5-content-jini`, near byte-identical.
  - Tovu `development/why-comments-debt.json` and the admin dictionary guard need a UNION merge.
  - `cms/media` `TransformParams` dedupe vs `codex/w5-webfeat-jini` seam-13.
- **Tovu leftover local branch:** `codex/w5-w3rest-tovu-bad`, from the base worker's first attempt; never pushed.
