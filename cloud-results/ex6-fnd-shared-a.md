PARTIAL 0f50ed9b32 716758371: K4-seam rows skipped below (avoid-list importers, Buffer/third-party types, value-derived types, cascades), page-html (K3 product copy), the remaining contract sheets blocked by in-flight branches

# ex6-fnd-shared-a: FOUNDATION shared seams and contracts

Branches:
- Tovu `codex/ex6-fnd-shared-a-tovu`, work tip `0f50ed9b32`. This report is the next commit.
- Jini `codex/ex6-fnd-shared-a-jini`, work tip `716758371`. A copy of this report is the next commit there.

## Setup
- **Bases:** Jini `origin/integ/merge-14-2026-11-22` (`4902a6a1`), Tovu `origin/integ/merge-13-2026-11-22` (`f7185f153`).
- **Provisional foundation merged:**
  - Jini (merge `370e3c66`): `ex5-fnd-kit-jini`, `ex5-fnd-seams-jini`, `ex5-fnd-routes-jini`, `ex3-c0b-jini`. The `api-baseline/jini-ai__core.json` conflict was resolved by a key-union merge.
  - Tovu (merge `ab2b0bb0a`): `ex2-tovu-halves`, `ex5-fnd-kit-tovu` (fast-forward), `ex2-holds-tovu`, `ex5-fnd-routes-tovu`, `ex5-fnd-seams-tovu`.
    - Conflicts resolved: `why-comments-debt.json` by id-union; import-path conflicts toward the later moves (`settings-api.ts`, the pages/posts hook tests, `App.hooks.ts`, the sites-sidebar nav hook and its test, the durable-run test).
    - The nine `tool-metadata` files that seams moved to Jini were accepted as deleted.
- **SKIPPED as non-trivial: `ex5-fnd-inject` (both halves).** It conflicts in 22 Jini files and 63 Tovu files against seams. Rv-f says inject must be rebased on the corrected seams first.
  - Its files were treated as **avoid** (list below).
  - Base red caused by this skip: Tovu `plugin-tier2/worker.ts` needs `Tier2ImportPolicy` from inject-jini. It accounts for the 2 base `typecheck` errors and for `worker-import-allowlist` 10/13 red at both base and tip.
- **Setup steps:**
  - Node 24.22.3, pnpm 10.33.2 (corepack). Jini: frozen install 0, `pnpm -r build` 0.
  - Tovu: `npm ci --ignore-scripts` ×4 → 0. `link-jini.mjs` against THIS Jini branch: 82 links. `packages/contracts` tsc 0, `packages/sdk` build 0.
- **Clean base worktrees for base-diff gates:** `jini-base` and `tovu-base` at the merged bases.
- **XP3:** a declaration snapshot was built from a worktree at `35c4961af` (frozen install, core build, `-r` build, `--write-baseline`), as combine-14 did.
- **Avoid lists:** each in-flight branch was diffed against its merge base (`ex4-*`, `ex5-{posts,collections,small,fnd-inject}-*`, `bugs-*`, `p11-next-*`, `sec5-jini`, `visitor-chat-tovu`). That gave Jini 543 files and Tovu 1,483 files. The files the merged foundation branches touch (Jini 446, Tovu 1,075) were also left alone.
  - Exception: append-only manifests (`packages/core/package.json` exports, `api-baseline/jini-ai__core.json`).

## What was available in this lane
The merged `ex5-fnd-seams` already did most of K4-seam-4..23.
- 56 of the 101 sheet rows already had their core file.
- `K4-contracts-core-5`'s nine cleared declarations were already moved to Jini; the merge deleted them in Tovu.
- The 33 "additive copy" core contracts awaiting cutover are all seams-branch files (rv-f FIX 1), so they were left to that branch.
- The remaining 45 rows went to four Opus subagents (A–D) by owning package. A fifth (E) took the only contract-sheet files whose importers were all free.

## Batches

| batch | subagent | files moved / seams | importers repointed | tests | status |
|---|---|---|---|---|---|
| A credentials/integrations | opus-high | 4 core contracts: `admin-surfaces-connections`, `api-connections-hosted-mcp`, `media-providers-catalog`, `core-custom-credential-categories`. Jini `agent-plugins/.../connections/ports.ts` deleted (all of it moved). | 20 Tovu files: custom-credentials, api-connections, external-mcp, member-login, oauth ports, site-backup, webhooks sealer, vault inventory | agent-plugins 407/407, integrations 182/182 | done; 2 rows partial or skipped |
| B cms/ui | opus-high | 3 core contracts: `capability-providers-comments`, `seo-content-analysis`, `ui-sections`. Jini `capability-providers/comments/ports.ts` deleted (all of it moved). | 10 Tovu files: comments, content-analyzer, publish-content ui, admin publish-scope | capability-providers 4/4, cms 2/2 | done; 4 rows skipped |
| C diagnostics/devops/platform | opus-high | 8 core contracts: `packaging-electron`, `platform-process`, `fs-durable-json`, `diagnostics-domain-dns`, `web-evidence-playwright`, `web-evidence-capture-budget`, `commerce`, `skills-install` | 17 Tovu files: desktop resources/asar/durable-json, domain-dns, web-screenshot, commerce status, skills | devops 91, platform 614 (+5 skip), diagnostics 395, agentic 329, commerce 13: all pass | done; 4 rows partial or skipped |
| D Tovu host types | opus-high | **Tovu file deleted:** `contracts/core/site-key-state.ts`. 7 site-key DTOs deleted from `sites-api.types.ts`, which now uses the existing `@jini-ai/core/contracts/site/site-key` (ex3-c0b). No new core file. | 12 Tovu files (security hooks and tests, sites api, site-key route); parity tripwire rewritten to a `Record<AdminSiteKeyState,…>` check | admin vitest 66 files / 1,421 pass | done; 8 rows skipped |
| E contract runtime | opus-high (+ coordinator test) | **Tovu file deleted:** `contracts/core/secret-scan.ts` → Jini `packages/diagnostics/src/redaction/secret-scan.ts`, verbatim, exported from the existing `./redaction/secrets-only` entry. New Jini test `diagnostics/src/__tests__/secret-scan.test.ts`. | 4 Tovu files (publish-content backstop and file-tree policy, webhooks guard and its test) | Jini 4/4. Tovu guard test 17/18 (base 16/18: the real-CLI case is fixed; ENOBUFS on the large `git ls-files` is red at base) | done; page-html stopped (K3) |

**Commits.**

Jini:
- `e4e912125` and `26fad77bd`: wip snapshots of the batch edits.
- `2f8c8a756`: B exports. It also holds A's package edits.
- `777b3fe71`: A exports.
- `6ec97ac86`: E scanner and test.
- `f1cb68a28`: core `contracts/site/README.md` with the Wiring section.
- `716758371`: C exports, API baselines (core and diagnostics), and one patch changeset `ex6-fnd-shared-a-k4-seams.md` covering all 10 touched packages.

Tovu:
- `f2d78677f6` and `0f50ed9b32`: wip snapshots with the B, C, D and E halves.
- `2e09bd19e5`: the A half.

**Pattern used for each Jini-internal row** (the accepted cutover `b259d772`):
1. Core owns the declarations, with their why-comments moved verbatim.
2. The owning package imports them from core. There are no duplicate copies.
3. The package's existing public entry keeps a `/** Deprecated re-export … removed at the next major */ export type {…} from "@jini-ai/core/…"`. No new forwarding file exists in either repo.

## Named mutations
Each mutation renamed a field in the new core contract and ran the consumer typecheck (raw `mutations.txt` in the session).

- **Jini:** typechecked with a source-mapped tsconfig. "Red" = more errors than the restored count.

| contract | field | consumer | errors before → mutated → restored |
|---|---|---|---|
| capability-providers-comments | consentCategory | capability-providers | 0 → 2 → 0 |
| seo-content-analysis | level | cms | 0 → 7 → 0 |
| admin-surfaces-connections | connectionId | agent-plugins | 0 → 33 → 0 |
| api-connections-hosted-mcp | devices | integrations | 33 → 43 → 33 |
| media-providers-catalog | caps | integrations | 33 → 136 → 33 |
| packaging-electron | relPath | devops | 11 → 19 → 11 |
| platform-process | rssBytes | platform | 3 → 8 → 3 |
| fs-durable-json | consequence | platform | 3 → 23 → 3 |
| diagnostics-domain-dns | httpStatus | diagnostics | 0 → 3 → 0 |
| web-evidence-playwright | navigationRefused | diagnostics | 0 → 8 → 0 |
| web-evidence-capture-budget | reserveMs | diagnostics | 0 → 11 → 0 |
| commerce | displayName | commerce | 86 → 94 → 86 |
| skills-install | contentBase64 | agentic | 1 → 32 → 1 |

The non-zero starting counts are scratch-config noise, the same before and after the mutation. The real package typechecks are base-identical.

- **Tovu** (the linked core `dist` `.d.ts` was mutated, then restored and checked with `cmp`):
  - `ui-sections` `entityTypes`: root tsc 2 → 15 → 2.
  - `core-custom-credential-categories` with `"general"` dropped: 2 → 3 → 2.
- **E (behaviour move):** `index: match.index + 1` in `secret-scan.ts` turns the new Jini test red (1 failed); restored, 4/4 pass.

## Gates (base-diff; base = the merged-foundation worktrees)

**Jini.** Every gate is identical to base.

| gate | base | tip |
|---|---|---|
| guard | 0 | 0 |
| api:check | 0 | 0 (after `api:update`: +15 core subpaths, +2 diagnostics exports) |
| check:cross-package, no snapshot | 1 | 1: the only extra lines are `absolute JINI_DECLARATION_BASELINE_DIR required` on touched files |
| check:cross-package, with the `35c4961af` declaration snapshot | XP1 39 / XP2 33 / XP3 112 / XP4 760 / XP5 6 | **identical** |
| check:size | 1 | 1, identical output |
| check:complexity | 1 | 1, identical |
| check:why-comments | 1, 359 lost / 341 allowed | 1, identical counts |
| check:hooks | 0 | 0 |
| check:errors | 0 | 0 |
| check:log-safety | 1 | 1, identical |
| typecheck | 1 (0 `error TS`) | 1, identical |
| `pnpm -r build` | | 0 |

Changed-package tests (`vitest related`): every count is in the batch table, and all pass.

**Tovu.**

| gate | base | tip |
|---|---|---|
| typecheck | 2 errors (tier2 inject skip) | same 2 |
| admin tsc | 0 | 0 |
| desktop tsc ×4 | 0 | 0 |
| typecheck:scripts | 2 | same |
| typecheck:tests | 2 | same errors |
| size | 1 | identical |
| complexity | 1 | identical |
| hooks | 0 | 0 |
| errors | 0 | 0 |
| architecture | 1 | 1 (2,228 → 2,226 production files) |
| boundaries | 0 | 0 (108 warnings, same) |
| **why-comments** | 1: 526 lost, 438 allow-listed (**88 unlisted**) | 1: 536 lost, 438 allow-listed (**98 unlisted, +10, NEW RED**) |

The why-comments delta: all 10 blocks moved to Jini or were rewritten (list below). The run tried to record them in `development/why-comments-debt.json`. That edit was blocked, because the dispatch forbids new entries in shrink-only lists, so it was reverted. **Owner or Codex call:** allow-list them, or keep the gate red.

The 10 blocks:
- `sites-api.types.ts` ×5 (`5b0f20c0032b`, `948a8ed9c97a`, `bdec9a2f1155`, `0f8f3201b1dc`, `c9804fe532f7`): already present on Jini `core/contracts/site/site-key.ts` from ex3-c0b.
- `site-key-state.ts` ×2 (`aa5ec62f9632`, `f35d66f3ea31`): file deleted. The state meanings live on core `AdminSiteKeyState` and on the route's `siteKeyState()` JSDoc.
- `custom-credential-categories.ts:1-6` (`286d4730e4b2`) → core `core-custom-credential-categories.ts`.
- `publish-content/ui/sections.ts:26-27` (`7fd1b0e034d5`) → core `ui-sections.ts`.
- `site-key-state-parity.unit.test.ts` @file (`19652ffbd7bd`): rewritten. The file it read off disk no longer exists.

**Tovu tests:**
- **Node:** 204 files, covering the changed tests plus every test in the touched feature folders, worker-import, site-key, commerce and skills. 191 pass and 13 are red. All 13 were re-run in the base worktree with identical counts. They are postgres ×4 (no DB in this run), vendor-neutrality, member-login providers ×2, playwright launcher, webhooks characterization, site-key boot notice, site-keys-members, and worker-import-allowlist (tier2 inject skip). One file improved: secret-scan-guard 16 → 17.
- **Admin vitest** (security, sites, publish-content and the parity test): 66 files, 1,421 pass.
- **Desktop** `desktop-resources` 38/38 and `ResourcesPanel` 12/12.

## Self-check against the 11-22 review failures
1. **No new re-export or forwarding files.** The deprecated type-only lines sit in existing public entries, per the accepted `b259d772` pattern. Four Tovu files already re-exported these types before this run (`asar-verify.ts`, `durable-json-file.ts`, domain-dns `tools.ts`, web-screenshot `request-guard.ts`); their source moved to core, and they should be cleaned when their consumers repoint. Batch A removed the `CustomCredentialCategoryId` forwarding from `custom-credentials/{index,types}.ts`.
2. **Hooks:** none were added. `check:hooks` is 0 in both repos.
3. **No Express, server-framework or logging types in Jini.** Types needing Node `Buffer`, Playwright or Kysely were dropped, per K4db.
4. **CSS classes:** the run added no UI.
5. **No new size-exception or debt entries.** The why-comments allow-list edit was reverted (see above).
6. **Shared wire types have a neutral core owner.** Every one is under `@jini-ai/core/contracts/site/*`; none is feature-owned.
7. **Mutations:** recorded above for every new contract and the one behaviour move.

## Steps and rows skipped

| row | reason |
|---|---|
| K4-seam-5 `@jini-ai/db/kernel` KyselyKernel | Kysely type (K4db) |
| K4-seam-5 `tovu-publish-ports.ts` | source and 14 of 24 importers are on in-flight branches; P12 rank 16 bag design |
| K4-seam-7 `gated-mutations/{ports,gateway}.ts` | importers on avoid list (database, recovery, deployments tool registrations, `server/routes/types.ts`, publish-content gated hooks); `GatewayDeps` drags Tovu `TokenStorePort` |
| K4-seam-10 `ui/mcp-ui/{secret-card,surfaces}` | already owned by `@jini-ai/core/contracts/cards`; every Tovu importer still on the ui subpath is on the avoid list (repoint later to `core/contracts/cards`) |
| K4-seam-11 `platform/secrets` SealedSecret, K4-seam-15 `oauth` OAuthClient | already in `core/contracts/{vault,oauth}`; Tovu repointed, no duplicate created |
| K4-seam-11 `visitor-tools-management.ts` | importers `features/settings/visitor-tools-registrations.ts` and `server/routes/types.ts` are on the avoid list; cascade into `visitor-tools.ts` |
| K4-seam-13 `MailTestModeSetting` | already in `core/contracts/mail`; nothing to do |
| K4-seam-15 `db/events` outboxEventValues; K4-seam-16 `folder-zip` zipFolderFiles; K4-seam-21 `db/kernel/sqlite` helpers | runtime values, not types (XP4) |
| K4-seam-17 `agentic/dom` DomPageDriverPage | needs the `agentic.ts` additive-copy cutover first (seams branch) |
| K4-seam-17 `sites-port.hooks.ts`, `use-admin-theme.hooks.ts` | cascade: about 10 host site DTOs, and `MatchMediaPort`/settings-tab config |
| K4-seam-18 `devops/static-export` ExportReport; K4-seam-22 `OwnSiteFetch`, `RequestRouter(Options)`, `RouteLike`, `FetchedResource`; K4-seam-23 `SitePreviewService` | Node `Buffer` (same rule as core `devops-deploy`'s `DeployFile`) |
| K4-seam-18 `apps/desktop/src/contracts/resources.ts` | importer `product-memory-telemetry.ts` is on the avoid list |
| K4-seam-20 `db/secrets-vault` SqlSecretsVaultRepo | a class |
| K4-seam-20 `cms/trash` RemoveEntity, TrashActor | declaring `cms/src/trash/ports.ts` is on the avoid list |
| K4-seam-20 `DnsRecordType`/`DnsQuery`/`PublicDnsResolver`; K4-seam-21 `PublishSectionId` and `cms/redirects` | derived from runtime consts (`typeof X[number]`); a hand union would be a second source of truth |
| K4-seam-20 `SharedExternalMcpOwner` | about 15-type cascade into `integrations/api-connections` |
| K4-seam-20 `@tovu/sdk` Plugin | product-named destination; owner naming call |
| K4-seam-21 `assistant/agent-discovery.ts` | references `NativeAgentRuntime` and `typeof` host runtime functions |
| K4-seam-22 `provider-config-source.ts`, K4-seam-23 `modules/site-search.ts` | source on the avoid list |
| K5-contracts-core-2 `page-html.ts` | `PAGE_HTML_CONTRACT` carries product copy (`data-tovu-agent` retired note, host tool names): needs a K3 args builder; `pages/agent-tools.ts`/`skeleton.ts` re-export lines and `tool-guides.json` follow |
| K4-contracts-core-5 remaining 7 (frontend-control, fs-files, image-transform, media-generation, permanent-delete, plugin-runtime, recovery) | held by the sheet, and every file is on inject/seams |
| C-contracts-headless-1, K4-contracts-headless-1 `secret-form-cards.ts`, K5-contracts-headless-2 | the `headless/index.ts` barrel and its test are on in-flight branches |
| K5-contracts-core-1/2/3/4/6/7/8/10, V-contracts-core-9 (rest) | importers on the avoid list (inject owns most tool-metadata) or depend on files that cannot move yet (`jini-outbox-adapter` ← `outbox-drainer`); runtime files with cross-package deps cannot land in core `src/contracts` (XP4) |
| C-contracts-core-1 | owner-held (guard regex) |

## Follow-ups for the reviewer
- The ex3-c0b core `site-key.ts` `AdminSiteKeyState` doc still says the parity test "reads the server source's own union text". The test is now a typed `Record` check. That file is c0b's, so it was not edited.
- E's destination differs from the sheet. The scanner went to `@jini-ai/diagnostics/redaction` (beside `SECRET_PATTERNS`), not to `core/contracts/site` (XP4 forbids runtime there, and core cannot import diagnostics).
- B's `tiptap-blocks.ts` runs in the tier-2 worker. Its new core import is `import type`, so it is erased at runtime. The worker-import-allowlist test is red at base because of the tier2 inject skip, so it could not confirm this.

## FILES LEFT (`scan.mjs` + `plan.mjs` from `plan/whats-left-1122`)

| tree | moving | shells | FILES-LEFT | excl. themes (111) |
|---|---|---|---|---|
| base (merged foundation, `ab2b0bb0a`) | 2,385 | 0 | **2,385** | **2,274** |
| tip `0f50ed9b32` | 2,383 | 0 | **2,383** | **2,272** |

The two files deleted are `contracts/core/site-key-state.ts` and `contracts/core/secret-scan.ts`. "Ready" rose from 491 to 499 (fewer blocked files) because of the new core seams.

## Wiring docs
New `packages/core/src/contracts/site/README.md` has a `## Wiring` section: what it needs injected, what it provides, a host example, and what it must never import. The four touched Tovu feature folders gained no new wiring; they only changed import paths.
