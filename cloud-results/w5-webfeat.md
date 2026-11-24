PARTIAL f32e1c0de b41a9005: left = rv1123q fix 6 (lower-tool-access needs core-owners' `NotifyToolAccessChanged` in `@jini-ai/core`, not on this base) and site-backup `import-verifier-projection` (needs `ArchiveManifest`/`import-verifier-inventory` moved first). Every other lane item and FIX has an outcome. No new red vs base.

# w5-webfeat — website feature files left by w4-webfeat-a/-b plus rv1123q/rv1123s fixes (2026-11-24, unattended)

- **Programmer skill read first:** `AI-Dev-Shop/agents/programmer/skills.md` v1.7.5 (root-cause first, Before-You-Write/pattern priming, test-first for behaviour change, fresh-evidence gate, no metric gaming) — applied to every batch review.
- **Branches:** Tovu `codex/w5-webfeat-tovu` = `origin/codex/w4-webfeat-a-tovu` + merge `origin/codex/w4-webfeat-b-tovu` (`156c1cf3a`; conflicts unioned: `why-comments-debt.json`, and two importers kept both lanes' Jini owners). Jini `codex/w5-webfeat-jini` = `origin/codex/w4-webfeat-a-jini` + merge `origin/codex/w4-webfeat-b-jini` (`481e9d75`; `packages/integrations/package.json` exports unioned). Plain pushes after every batch; no force-push, no `--no-verify`, hooksPath untouched, no main/integ/plan/release/other codex branches, no publish/tag, no codebase-memory tools, no RemoteTrigger.
- **Setup:** Node 24 (`/opt/node24`), pnpm 10. Jini `pnpm install --frozen-lockfile` 0, `pnpm -r build` 0 (0 `error TS`). Tovu `npm ci --ignore-scripts` root/admin/desktop/site-chat 0/0/0/0; `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs`; contracts tsc 0; sdk build 0. `apps/desktop` was not touched, so the desktop gate set was not run.
- **Base attribution:** clean worktrees `Jini-base` (own install + build at `481e9d75`) and `Tovu-base` (`156c1cf3a`, `node_modules/@jini-ai/*` relinked to Jini-base). Every red below was re-run there.
- **Method:** Opus coordinator; 9 builder subagents, max 4 at a time on disjoint folders: 7 Sonnet high-effort (A, B, C, D, E, G, H, plus W for why-comments), and 1 Opus (F, the MCP trust-admission security seam). The coordinator reviewed each report, pushed after each batch, and fixed the guard and boundary regressions itself.

## FIX items applied (Codex `plan/whats-left-1122:reviews/rv1123q.md` webfeat-b, `rv1123s.md` webfeat-a)
| fix | result |
|---|---|
| rv1123q 6 `plugins/runtime/lower-tool-access` → core `NotifyToolAccessChanged` | **DEFERRED.** `@jini-ai/core` on this base has no `tool-access-change` owner (core-owners has not landed here). Apply when core-owners merges (merge-order note 1 in rv1123q). |
| rv1123q 7 `site-backup/archive-media` | MOVED → `@jini-ai/devops/backup/site/archive-media`. Media ops, share policy and refusal are injected through a required `host`. Tovu keeps a thin binding. |
| rv1123q 8 `site-backup/static-export-selection` | MOVED → `@jini-ai/devops/backup/site/static-export-selection`. Parsing and allocation moved together; path policy and `invalidInput` are injected. Tovu keeps the copy binding. |
| rv1123q 9 `publish-content/apply-retire` | MOVED → `@jini-ai/cms/publish/content/apply-retire`. The preflight/retire/create/rollback sequence is together; collaborators come in beside `{ step }`. The `:retire:${runId}` key is byte-identical. Tovu file deleted; the binding is in `apply-row.ts`. |
| rv1123q 10 `settings/site-title-preservation.sqlite` | DELETED (empty subclass). `SqlSiteTitlePreservationStore` and its port moved → `@jini-ai/cms/settings/site/site-title-preservation`, with kernel and table injected. |
| rv1123q 11 `site-search/index-state-store` | MOVED → `@jini-ai/search/site/index-state-store`. `kysely` is a type-only optional peer, mirroring cms. Kernel, `now` and the 0027/0028 table names are injected. The binding is in `composition/modules/site-search.ts`. |
| rv1123s 6 `carryCloudflareActivation` | RENAMED `carryPluginRenameActivation`. Docs speak of predecessor/successor. Tovu binding and tests repointed. |
| rv1123s 7 `(ctx, required)` loaders | `loadAnalyticsProviders`, `loadCredentialSchemeRegistry` and `loadMediaProviderRegistry` now take one required object plus `_optional = {}`. Host callers and tests updated. |
| rv1123s 8 `derive-available-name` policy | Required `CopyNamingPolicy` (`withSuffix`, `exhaustionMessage`). Tovu binds the exact old values in `content-duplication/copy-naming-policy.ts`. |
| rv1123s 9 `navigation/index.ts` forwarder | DELETED. 42 importers repointed to `@jini-ai/cms/navigation`, `/navigation/node` and `@jini-ai/core`; the coordinator caught a missed dynamic import. `database-transfer/copy-engine.ts`: forwarding lines removed and callers repointed; host naming/exclusions kept. |
| rv1123s 10 `tool-guides.json` parity | `check-tool-guides.ts` resolves `@jini-ai/<pkg>/…` refs through the linked package realpath → `src/` (fallback `$JINI_PACKAGES_DIR`), tested 4/4 in `jini-source-root.unit.test.ts`. The three rows point at Jini cms change-sets/content-duplication agent-tools and integrations provider-settings-card. |
| rv1123s 11 STAYS-HOST DISAGREE | `form-destinations/key-store` SPLIT → `@jini-ai/cms/forms/destinations/key-store`. `media/public-urls` logic MOVED → `@jini-ai/cms/media/site/public-urls`; the sanctioned door stays as a real binding, not a re-export. |
| rv1123s 1–5 (routes lane) | Not this lane (other wave-5 lanes own `w4-routes-*`). |

## Files (lane list: webfeat-a undecided 7, webfeat-b sdk-resolver + host-policy splits, every STAYS-HOST DISAGREE)
| file (Tovu `apps/website/src/features/…` unless noted) | outcome |
|---|---|
| identity/recovery-codes.repo.ts | MOVED → `@jini-ai/user-management/server/sql` (`createSqlRecoveryCodeStore`). Kernel, transactions and tables are injected; kysely is a type-only optional peer, mirroring cms. |
| identity/passkeys.repo.ts | MOVED → same (`createSqlPasskeyStore`). |
| identity/mfa.repo.ts | MOVED → same (`createSqlMfaStore`). Mutation: dropping the `principal_id` filter turns it red. |
| identity/repo.assignments.ts | MOVED → same (`SqlRolePolicyRepo`/`SqlPrincipalRoleRepo`/`SqlPrincipalPolicyRepo`). Tovu bindings live in `identity/repo.sqlite.ts`. |
| agent-plugins/bundled-id-upgrade.ts | SPLIT → `@jini-ai/agent-plugins/site/bundled-id-upgrade`. The rename map and wording stay in Tovu (owner decision r62t-rsy-7 honoured). |
| agent-plugins/capability-projection.ts | DELETED. Converged test-first onto the Jini lifecycle owner (Opus, security seam). There were no real behaviour differences; Jini changes are additive (`mcpServerTrustClassifier`). Mutation: `stdio` → `auto-admit` turns it red. Side effect: lifecycle metadata warnings now always carry the `[agent-plugins]` prefix. |
| database-transfer/table-catalog.ts | SPLIT → `@jini-ai/db/transfer` ORM-neutral schema catalog with an injected introspection port. Drizzle stays in Tovu; no new Jini dependency. |
| plugin-runtime/sdk-resolver.ts | MOVED → `@jini-ai/plugins/runtime/sdk-resolver` with REQUIRED `sdkModulePath` and `sdkSpecifiers`. The Tovu file is now the host binding (resolves `@tovu/sdk`). `boot/plugin-sdk-resolver.ts` (a barrel at base) was removed, and the callers import the binding as at base. |
| site-backup/share-policy.ts | SPLIT → `@jini-ai/devops/backup/site/share-refusal` (`SiteShareRefusal`, `archiveRefusalName`). 43 importers repointed; one class identity. Limits, tables and copy stay. |
| publish-content/backstop-policy.ts | SPLIT → `@jini-ai/cms/publish/content/backstop-refusal`. Limits, tables and checks stay. `normalizeMode` lives in `file-tree-policy.ts`, not this file. |
| publish-content/peers.ts | SPLIT → `@jini-ai/cms/publish/content/peers` (5 error classes). Vault, ownerKey `"tovu"`, keyring and repos STAY-HOST (host adapters over Jini ports). Follow-up: `PublishContentPeerSummary` duplicates core `PublishContentPeerView`. |
| site-backup/archive-media.ts, static-export-selection.ts | MOVED (fixes 7, 8). |
| publish-content/apply-retire.ts | MOVED (fix 9). |
| settings/site-title-preservation{,.sqlite}.ts | MOVED / DELETED (fix 10). |
| site-search/index-state-store.ts | MOVED (fix 11). |
| form-destinations/key-store.ts | SPLIT (rv1123s 11). |
| media/public-urls.ts | STAYS-HOST as a real binding: the ADR-009 sanctioned door; the logic moved (rv1123s 11). |
| navigation/index.ts | DELETED (rv1123s 9). |
| database-transfer/copy-engine.ts | STAYS-HOST (host transfer naming/exclusions); forwarders removed. |
| site-backup/archive-paths.ts | STAYS-HOST (Tovu themes/skills/plugins layout + copy). |
| site-backup/share-file-policy.ts | STAYS-HOST (Tovu path layout, `SHARE_LIMITS`, redaction contract). |
| site-backup/package-file-inventory.ts | STAYS-HOST (reads Tovu's bundled agent-plugin dir). |
| site-backup/import-verifier-projection.ts | **NOT DONE.** It depends on Tovu `ArchiveManifest` and `import-verifier-inventory`, which would have to move first. |
| content-duplication/copy-naming-policy.ts (new) | STAYS-HOST: Tovu copy-naming product policy bound into Jini. |

## Self-check (before each push)
- No new re-export/forwarding files: a diff grep of `^+export … from` in `apps` finds none. Two forwarders were removed and one barrel was deleted.
- No custom hooks in the moved code.
- No express types, `console.*`, `process.env` or host log formatters in Jini production code. The only hits are inside a child-process test script.
- No CSS.
- No new size/complexity/injection exception rows.
- Jini guard went back to base after the coordinator fixed 2 new rows in `sdk-resolver` (SI-domain runtime→host and HW3 module state). The fix injects `sdkSpecifiers`, and the once-per-process flag is now keyed on a `globalThis` `Symbol.for`, so CIC U-002 still holds and also survives duplicate module copies. Mutation `sdk-resolver-forgets-registration` went red → restored → green.
- Shared wire types: refusal/error classes have one owner in Jini.
- Object args with `_optional = {}` on every new or changed export.
- Behaviour changes are test-first with named mutations: `derive-available-name-ignores-injected-suffix/-wording`, apply-retire `:runId` key and `undoRetire`, archive-media `aliases.add`, sdk-resolver `registered`, mfa `principal_id`, public-urls `jpeg→jpg`, key-store `baseUrl` guard, schema-catalog `partiallyExcluded.keep`, site-title `preserved_at IS NULL`, index-state `failedBelowAttempts`, capability-projection `stdio→auto-admit`. Each went red → was restored byte-exact → green.
- Why-comments moved with the code. 20 Tovu debt rows cite the Jini destination (or "Forwarder deleted"), and the generic table-catalog rationale was restored in Jini.
- Breaking API: changeset `.changeset/w5-webfeat.md` marks agent-plugins and cms **major**, because of the rename and signature changes. Baselines were regenerated.

## Gates (head vs base)
**Jini** (`b41a9005` vs `481e9d75`):
- `pnpm -r build`: 0 (0 `error TS`).
- `pnpm typecheck`: 0.
- `guard`: 1 row, the same as base (`HW3 admin/shell/lib/shell-failure-log.ts`).
- `api:check`: 0 (39 packages, 1143 entries).
- `check:hooks`: ok.
- `check:why-comments`: 10, the same as base.
- Changed vitest: 143/143. agent-plugins 23, cms 50, db 11, devops 18, plugins 2, search 25, user-management 14.
- Builders also ran: agent-plugins `src/lifecycle src/connect` 1338/1338 (2 skip), and the full search package 396/396.

**Tovu** (`f32e1c0de` vs `156c1cf3a`):
- `tsc -p tsconfig.json`: 0.
- `tsconfig.tests.json`: 0.
- admin tsc: 0.
- `check:hooks`: ok.
- `check:why-comments`: the same 80 ids as base, 0 new.
- depcruise: 0 errors / 111 warnings, the same as base. The coordinator removed 4 new warnings by restoring the resolver binding to `features/plugin-runtime` and folding the identity bindings into `repo.sqlite.ts`.
- `check:tool-guides`: exit 0, 3 unknown calls (the same as base).

**Tovu node tests** (818 files: every changed test plus every `__tests__` in the touched feature folders, Postgres-only files excluded, `--test-concurrency=2`, run on head and true base):
- head: 9,853 tests, 9,808 pass, 33 fail, 12 skip.
- base: 9,882 tests, 9,836 pass, 34 fail, 12 skip.
- **0 failing test names in head that do not also fail on base.** The base reds are:
  - bundled hosting/ui-ux-design/auto-suggest manifests;
  - preview-tag theme pins;
  - provisioning/redaction;
  - serve-command-wiring ×2;
  - site-backup Q4 expiry / starter radio;
  - site migration.
- Not run: Postgres-backed suites (no server).

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`; moving + shells; excl. themes subtracts `theme` + `adm-themes`)
| | moving | shells | FILES LEFT | excl. themes |
|---|---|---|---|---|
| before (base `156c1cf3a`) | 2,139 | 2 | **2,141** | **2,030** |
| after (`f32e1c0de`) | 2,132 | 0 | **2,132** | **2,021** |

Most moves here are splits where a real host binding stays, so the count drops less than the number of files touched. The 2 shells (`navigation/index.ts`, `copy-engine.ts`) are gone.

## Notes for the owner / merge train
1. rv1123q fix 6 is waiting on core-owners (`@jini-ai/core/tool-access-change`).
2. New dependency-shape decisions taken under "inject everything" plus the cms precedent: `kysely` is a type-only optional peer (+ devDependency, lockfile updated) on `@jini-ai/user-management` and `@jini-ai/search`. drizzle is NOT added to `@jini-ai/db`; the host injects the introspection port.
3. Follow-ups:
   - `PublishContentPeerSummary` → core `PublishContentPeerView`.
   - `vendor-exceptions.json` still names the old Tovu `agent-plugins/{bundled-catalog,deploy-split-activation,lifecycle}.ts` paths.
   - `development/refactor-patterns/list-cursor.terra-prompt.md:66` cites the deleted `identity/passkeys.repo.ts`.
   - The `site-title-preservation.integration.test.ts` `t.after` hook was fixed to restore the original prototype methods; it previously deleted them, an order-dependent flake.
