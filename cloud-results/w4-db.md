DONE 1156ce7aa c34bf42dd

# w4-db — Platform / storage lane (wave 4)

Run 2026-11-24 02:25–04:00Z, unattended. Every owned file has a decision: 11 MOVED, 2 SHELL-DELETED, 143 STAYS-HOST (6 of them blocked on other lanes / owner policy, listed under Skipped with a recommendation). Commit subjects are approximate: builders worked in the shared tree, so some batch work landed in the neighbouring wip commit; the batch table below is authoritative.

Lane: **Platform / storage** (`apps/website/src/platform/**`), owned list `origin/plan/whats-left-1122:inputs/w4/db.txt` (156 files). Coordinator read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) before any work — confirmed; its Role/Workflow/Guardrails (minimum change, tests-first for behaviour, architecture audit, no weakened tests, no coverage games) were folded into the builder brief.
Bases: Jini `origin/integ/merge-16-2026-11-23` `7490405a8`, Tovu `origin/integ/merge-16-2026-11-23` `3a9332247` (unchanged at the final re-fetch, so no re-merge was needed). Jini linked into Tovu (`link-jini.mjs`, 79 links), Node 24 for Tovu tests.

## Result per owned file (156)
- **MOVED to Jini: 11** — `routing/reserved-paths.ts`, `media-access-evidence.ts`, `secrets/store-vault-guards.ts`, `db/drift.ts`, `db/journal-kernel.ts`, `db/sqlite/database-journal-schema.ts`, `db/sqlite/database-journal-repo.ts`, `db/repos/publish-content-baseline-repo.ts`, `db/repos/publish-content-bundle-repo.ts`, `db/watermark-kernel.ts`, `db/sqlite/publish-backstop-audit.sqlite.ts` ; pure unit tests moved with them (`store-vault-guards`, `drift`, `journal-kernel`, `journal-schema`, `keyset-cursor`); Tovu wire/integration tests stayed unchanged apart from import lines as parity proof. Plus Jini-internal: `cms/src/core/keyset-cursor.ts` → `@jini-ai/core/keyset-cursor` (needed so `@jini-ai/db` can host the journal repo).
- **SHELL-DELETE: 2** — `oauth/errors.ts` (pure `@jini-ai/oauth` re-export), `oauth/index.ts` (test-only barrel); their rationale headers moved onto Jini `oauth/src/errors.ts` / `registry.ts`.
- **STAYS-HOST: 143** — see the table below (driver/schema bindings, Tovu migrations, site-folder layout, Tovu policy/copy, Express/dev host wiring), incl. the blocked/STOP items with a recommendation.
- Restored after review (guarded doors, see FIX items): `routing/index.ts` (now the adapter door only — no Jini re-export) and `site-dir/moves.ts` (a curated `PUBLIC_ENTRIES` door in `.dependency-cruiser.mjs`).

## FIX items applied (coordinator review of the builder diffs)
1. **Guarded doors (boundaries, new red caught at the gate):** batch D deleted `platform/routing/index.ts` and `platform/site-dir/moves.ts` as "barrels", but both are dependency-cruiser doors (`GUARDED_MODULES` + `PUBLIC_ENTRIES["platform/site-dir"] = ["moves","errors"]`): `check:boundaries` went 0 → 20 errors. Fixed: `moves.ts` restored verbatim with its 2 importers reverted; `routing/index.ts` restored as the door for the Tovu `adapter.ts` only (reserved-path checks import `@jini-ai/cms/routing/site/reserved-paths` directly, so the door forwards nothing from Jini); the 19 production importers that used the door on base use it again. `check:boundaries` 0 errors / 113 warnings = base.
2. **Leftover source:** batch D left the Tovu `platform/routing/reserved-paths.ts` copy in place after repointing every importer; deleted, 2 stale path comments repointed.
3. **Why-comments:** 18 comment blocks moved to Jini with path/product-name neutralisation (exact Tovu text no longer matches) → recorded in `development/why-comments-debt.json` as pure appends with the Jini destination per id (convention of earlier lanes). Unallowed 78 = base (Tovu) / 10 = base (Jini).
4. **Node runtime for tests:** builders' first Tovu runs used Node 22 (4 page tests red on `RegExp.escape`); every Tovu test result below is Node 24 with the real `npm test` imports (`composed-bundle-env.ts`, `--experimental-test-module-mocks`).
5. **db import-isolation:** the moved `recovery/journal-{kernel,schema,repo.sql}.ts` and `watermark/kernel.ts` import kysely; the isolation test got exact-file allowances (same shape as the existing `secrets-vault/repo.sql.ts` one) with rationale + new deny cases, and `loads-without-driver` knows `watermark/kernel`. Flagged for Codex: this widens a guard by 4 exact paths.
No P11 (`ALGO-P11-storage.md`) or `plans1123.md`/`check-P3-P4-P5.md` NEEDS item touches a moved file (the P11 slices live in retention/backup/chat code; `site-running.ts` is cited by P11 but STAYS).

## Batches
| batch | model | files moved (Tovu → Jini) | importers | tests | status |
|---|---|---|---|---|---|
| A | Opus high | `publish-content-baseline-repo` → `cms/publish/content/sql/baseline-repo.ts`; `publish-content-bundle-repo` → `cms/publish/transfer/sql/bundle-repo.ts` (schema-erased kernel + injected table names + structural row slice; Tovu `.sqlite.ts` bindings keep their constructor) | 2 | Jini 4/4 (SQLite+PGlite); mutations `<`→`<=` in `deleteExpired` (2 red), upsert→`doNothing` (2 red); Tovu dialects 12/12 + integration 1/1 | done |
| A2 | Opus high | `watermark-kernel` → `db/watermark/kernel.ts` (`tables.watermark` injected); `publish-backstop-audit.sqlite` → `cms/publish/transfer/sql/backstop-audit-repo.ts` (`tableExists` + table injected; no cms→db runtime edge) | 18 | Jini 9/9 + 4/4; mutations `value+1`→`+2` (6/9 red), drop `run_id=excluded.run_id` (2/4 red); Tovu 19 files all green except the Postgres file (no server, env) | done |
| B | Opus high | `drift` → `db/recovery/drift.ts`; `journal-kernel` → `db/recovery/journal-kernel.ts` | 7 | Jini 26/26 (tests moved node:test→vitest, import lines only); Tovu 8 files green | done |
| B2 | Opus high | `database-journal-schema` → `db/recovery/journal-schema.ts`; `database-journal-repo` → `db/recovery/journal-repo.sql.ts` (K3: `errorRedaction` on the repo's deps; both prod constructions pass `TOVU_ERROR_REDACTION_OPTIONS`); Jini `cms/core/keyset-cursor` → `core/keyset-cursor.ts` | 8 Tovu + 4 Jini | core 3030/3030; mutations: keyset `Date.parse` NaN guard (1 red), schema ledger guard (1 red), repo `!` (1 red), K3 ignore `errorRedaction` (Tovu backup-retention 1 red) | done |
| C | Opus high | `store-vault-guards` → `platform/secrets/credential-sets/store-vault-guards.ts`; `media-access-evidence` → `cms/media/site/access-evidence.ts`; `oauth/errors.ts`, `oauth/index.ts` shell-deleted | 22 | platform 12/12; Tovu 47 files 806/810 (4 = BASE-RED, same counts on base) | done |
| D | Sonnet high | `routing/reserved-paths` → `cms/routing/site/reserved-paths.ts` (+34 Jini characterization cases) | 37 (19 re-pointed back to the door in FIX 1) | Jini 34/34; Tovu 24 files green on Node 24 | done (FIX 1-2) |

## Skipped / STOP (exact reason + recommendation)
| file | reason | recommendation |
|---|---|---|
| `http/index.ts` | ADR-009 guarded door (`GUARDED_MODULES` "platform/http"); 114 import lines; deleting it turns every import into a `no-deep-imports` violation | keep (owner decision only if the door policy changes) |
| `http/ports.ts` (`HttpClientPort` K4 seam) | Tovu `send(request, opts)` vs Core `send({ request }, opts)`: collapsing needs an ABI change across ~100 call sites/fakes = behaviour change | own task with RED + mutation; not an extraction move |
| `db/repos/publish-content-run-repo.ts` + `.sqlite.ts` | its port `PublishContentRunRecord/RepoPort` lives in `features/publish-content/run-repo.ts` (webfeat-b lane); Jini has no equivalent port | after webfeat-b moves the port to `@jini-ai/cms/publish/content`, move the body with the baseline-repo pattern |
| `db/repos/external-mcp-tool-approval-repo.ts` + `.sqlite.ts` | implements a positional Tovu port in `assistant/external-mcp-tool-approval-ports.ts` (another branch's file); moving would import a positional API into Jini | object-arg port in `@jini-ai/mcp` first, then the SQL body with injected tables |
| `db/repos/origin-repo.ts` | read adapter + configured writer already in Jini `db/verified-origin`; only the dev-capability seed is left, and moving it changes the SQL text (`origin_settings.scheme` → `sql.ref`) that two Tovu pins assert | retarget the two pins, then move the seed into Jini `verified-origin/register.ts` |
| `markdown/frontmatter.ts` | Jini already declares it as the injected `readFrontmatterField` port; no Jini package depends on `js-yaml` (adding one = lockfile change) | keep host-injected |

## STAYS-HOST (one line each)
| file | decision | reason |
|---|---|---|
| `db/migrations/0000_legacy_baseline.postgres.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0000_legacy_baseline.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0001_post_search.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0002_drop_empty_legacy_chat_tables.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0003_coercion_json_as_json.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0004_drop_unused_deployment_tables.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0005_media_createdby.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0006_submission_ip_retention.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0007_publish_backstop.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0008_posts_publish_at_featured_media.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0009_posts_author.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0010_members_credentials_revoked_at.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0011_archive_legacy_commerce.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0011_drop_empty_core_commerce_tables.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0012_secrets_vault.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0013_unify_vault_credentials.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0014_media_library.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0015_document_blob_ownership.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0016_publish_destination_history.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0017_publish_history_kind.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0018_form_submission_remote_receipts.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0019_form_delivery_plans.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0020_vault_api_connection_kind.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0021_site_consent_revisions.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0022_workspace_mcp_cascade.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0023_mail_ledgers.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0024_domain_bindings.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0025_mail_feedback_processed.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0026_domain_binding_version.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0027_search_index.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0028_search_index_retired.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0029_mail_activity_indexes.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0030_mail_suppression_admin.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0031_mail_activity_retention.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0032_member_signup_email.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0033_mail_activity_message.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0034_member_auth.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0035_member_external_identities.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0036_publish_history_config_jsonb.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0037_media_source_metadata.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0038_newsletter_sending_index.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0039_owner_recovery_codes.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0040_owner_mfa.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0041_owner_passkeys.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/0042_optimistic_concurrency_versions.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/chat/0000_chat_baseline.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/chat/0001_sqlite_chat_tables.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/chat/0002_durable_run_attempts.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/chat/0003_active_run_index.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/commerce/0000_catalog.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/project/0000_project_vault.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/project/0001_project_credential_kinds.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/project/0002_site_key_attachments.ts` | STAYS-HOST | Tovu schema migration step (ADR-066 TS step; checksum/bytes host-owned; P9K §5 "platform/db schema/migrations") |
| `db/migrations/legacy-sqlite.ts` | STAYS-HOST | Tovu legacy content.db upgrade path over better-sqlite3 + Tovu chat orphan check |
| `db/migrations/runner.ts` | STAYS-HOST | Tovu ledger defaults (`tovu_migrations`) over Jini's shared runner — host binding |
| `db/migrations/source-digests.ts` | STAYS-HOST | digests of Tovu migration step texts (host-owned checksums) |
| `db/migration/manifest.ts` | STAYS-HOST | Tovu SQLite→Postgres semantic manifest over Tovu `schema.sqlite.ts` (drizzle) |
| `db/kernel/drivers/sqlite.ts` | STAYS-HOST | injects better-sqlite3 into `@jini-ai/db/kernel/sqlite` (driver adapter) |
| `db/kernel/drivers/pglite.ts` | STAYS-HOST | injects the PGlite class into `@jini-ai/db/kernel/pglite` (driver adapter) |
| `db/kernel/drivers/pglite-owner.ts` | STAYS-HOST | Tovu home/socket namespaces + historical lock filename over Jini owner state |
| `db/kernel/drivers/pglite-socket.ts` | STAYS-HOST | injects `pg` into Jini's PGlite-socket opener (driver adapter) |
| `db/kernel/drivers/postgres.ts` | STAYS-HOST | injects `pg` + pool limit into Jini's Postgres opener (driver adapter) |
| `db/kernel/ops.ts` | STAYS-HOST | binds PGlite class, `tovu_migrations` ledger and Tovu operator copy into Jini storage ops |
| `db/kernel/stopped-database.ts` | STAYS-HOST | binds Tovu's better-sqlite3 opener to Jini `assertSqliteStopped` |
| `db/kernel/index.ts` | STAYS-HOST | host-local index over the Tovu driver adapters above (no Jini re-exports) |
| `db/content-kernel.ts` | STAYS-HOST | `StorageKernel<ContentDatabase>` over Tovu's generated content schema (318 importers) |
| `db/chat-kernel.ts` | STAYS-HOST | Tovu chat.db kernel over Tovu chat schema |
| `db/client/open-site-db-client.ts` | STAYS-HOST | agent daemon's leaf client opening a Tovu site's content/chat DBs from the site folder (composition) |
| `db/prepare-content-store.ts` | STAYS-HOST | seeds Tovu content-store rows over Tovu drizzle schema |
| `db/site-store-copy.ts` | STAYS-HOST | Tovu scope (schemas, `tovu_migrations` ledgers, vault restore filter) bound to Jini `store-copy` |
| `db/sqlite/content-db.ts` | STAYS-HOST | per-site content.db bootstrap (drizzle + better-sqlite3 + Tovu migrations + Tovu redaction policy) |
| `db/sqlite/chat-db.ts` | STAYS-HOST | sidecar chat.db bootstrap over Tovu chat migrations |
| `site-dir/duplicate-content-db.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/duplicate-pglite-store.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/errors.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/layout.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/local-site-child.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/local-site-intent.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/local-site-supervisor.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/move-sites-home.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/nested-sites-root.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/new-site-owner.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/ports.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/product-root.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/read-applied-schema-identity.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/read-template.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/resolve-install-dir-target.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/schema-guard.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/seed-site-themes.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/seed-starter-title.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/site-key-dependent-data.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/site-root.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/site-running.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/site-storage.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/site-store.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/site-switcher-enabled.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/sites-home.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/sites-project-references.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `site-dir/sites-workspace-options.ts` | STAYS-HOST | Tovu site-folder layout/lifecycle (SPEC-003 install-dir domain, `.site-meta.json`, sites home, local-site supervisor; P9K §5 "platform/site-dir" composition) |
| `html/safe-url.ts` | STAYS-HOST | Codex FIX/BLOCK 11-22: Tovu render policy (`stays-in-tovu.md`); exports no types, so no K4 seam to split |
| `html/published-webmcp-strip.ts` | STAYS-HOST | Codex FIX/BLOCK 11-22: Tovu policy with product marker `data-tovu-webmcp-script`; exports no types |
| `db/sqlite/publish-content-baseline-repo.sqlite.ts`, `…bundle-repo.sqlite.ts` | STAYS-HOST | Tovu table-name binding of the moved Jini classes over the content-db handle |
| `db/sqlite/origin-repo.sqlite.ts` | STAYS-HOST | `ORIGIN_TABLES` binding of Jini `SqlOriginSettingRepo` |
| `db/repos/form-delivery-binding.ts` | STAYS-HOST | Tovu table names + `outboxRow` binding of Jini `SqlFormDeliveryRepo` |
| `db/sqlite/publish-history-repo.sqlite.ts` | STAYS-HOST | binds the content-db handle to `repos/publish-history-repo.ts` (another branch's file) |
| `db/sqlite/gated-mutation-token-repo.sqlite.ts` | STAYS-HOST | adapts Tovu's positional `save(record)` port to Jini `SqlTokenStore` + table names |
| `db/sqlite/database-journal-db.ts` | STAYS-HOST | opens the journal file on Tovu's better-sqlite3 driver; schema now from `@jini-ai/db/recovery/journal-schema` |
| `db/keep-stored-revocation.ts` | STAYS-HOST | Tovu `sessions`/`member_sessions` tables; no Jini session owner |
| `db/vault-credential-recovery.ts` | STAYS-HOST | Tovu envelope kinds, `external_mcp_servers` SQL, Tovu vault inventory |
| `db/key-dependent-data.ts` | STAYS-HOST | Tovu `webhook_subscriptions` table, vault inventory, SQLite driver |
| `db/sqlite/chat-orphan-check.ts` | STAYS-HOST | Tovu content.db/chat.db split + table names |
| `db/sqlite/database-introspection-adapter.sqlite.ts` | STAYS-HOST | binds Tovu migrations + `ContentKernel` to the features/database port |
| `db/sqlite/hydrate-content-db-from-seed.ts` | STAYS-HOST | Tovu site-folder seed layout (`content.seed.db`) |
| `db/sqlite/{outbox,entry-refs,media,change-set}-repo.sqlite.ts`, `analytics-sink.sqlite.ts` | STAYS-HOST | bind Tovu's content-db handle + table names to Jini/Tovu SQL classes |
| `http/client.ts` | STAYS-HOST | Tovu user agent `Tovu/0.1.0`, refusal copy, positional→object ABI adapter |
| `http/test-origin-allowlist.ts` | STAYS-HOST | harness-only wiring over Tovu `client.ts` |
| `oauth/endpoint-safety.ts`, `oauth/legacy-endpoint-error.ts` | STAYS-HOST | Tovu OAuth guard policy/copy and its legacy wording repair |
| `secrets/startup-secrets.ts` | STAYS-HOST | `@tovu/contracts` startup keys; mutates `process.env` at launch |
| `secrets/vault-kinds.ts`, `vault-meta-rules.ts`, `vault-api-connection-meta.ts` | STAYS-HOST | Tovu vault catalogs/row formats (`ownerKey: "tovu"`) |
| `express/async-route.ts` | STAYS-HOST | Express wiring (no server-framework types in Jini); no http-kit equivalent |
| `headless-browser/desktop-render.ts`, `playwright-loader.ts` | STAYS-HOST | host env + Playwright binding |
| `dev-host/dev-tls.ts`, `dev-host/warm-site-agent.ts` | STAYS-HOST | dev host with Tovu env names/paths |
| `test-home-isolation.ts` | STAYS-HOST | Tovu storage roots and copy |
| `routing/index.ts` | STAYS-HOST | dependency-cruiser door for the Tovu routing `adapter.ts` (not ours); re-exports no Jini code |
| `site-dir/moves.ts` | STAYS-HOST | curated `PUBLIC_ENTRIES["platform/site-dir"]` door |

## Gates (base-diff vs merge-16; no new red)
**Jini** (head `c34bf42dd`; base rows from a clean `merge-16` worktree):
- `pnpm -r build` 0 (0 `error TS`) · `pnpm typecheck` 0 · `api:check` 0 after `api:update` (cms, core, db, platform baselines) + changeset `.changeset/w4-db-storage-moves.md` (core/cms/db/platform minor, oauth patch; cms/core drops the keyset exports → moved to `@jini-ai/core/keyset-cursor`) · `check:hooks` ok.
- `guard` 1 violation (base worktree 14 incl. dist-less rows; the remaining HW3 `admin/src/shell/lib/shell-failure-log.ts` is pre-existing) — **0 new rows**.
- `check:size` 6 rows = base 6 · `check:complexity` 4 = base 4 — **0 new**.
- `check:why-comments` 377 lost / 367 allowed → **10 unallowed = base 10**.
- `check:cross-package` (XP): not attributable in this clone — XP3 needs `JINI_DECLARATION_BASELINE_DIR` and the base worktree has no `dist`; **no XP row names any moved/new file** (grep over the final output).
- Changed vitest: core 1 file 2/2, cms 4 files 42/42, db 6 files 91/91, platform 1 file 10/10; cms suites touched by the keyset move (comments/forms/media/core/publish/routing) 1961/1970 under the parallel Tovu load, the 9 PGlite cases re-run alone: 91/92 then the last one 2/2 (load-flaky; passes alone on head and base).
**Tovu** (head `1156ce7aa`, Node 24):
- `typecheck` (+e2e) 0 errors (base 0) · `typecheck:tests` 0 · admin `tsc` 0 · `typecheck:scripts` 3 errors = the same 3 on base (`agent-plugin-activation.ts`, `check-size-drift.ts`, `dev-admin-build.ts`).
- `check:boundaries` 0 errors / 113 warnings = base (after FIX 1; was 20 errors) · `check:why-comments` 78 unallowed = base · `check:hooks` ok · `check:size` same single worsened row as base (`deployments/publish-agent-tools.ts`, not ours) · `check:complexity` ok · `check:errors` WARN 3 = base 3.
- Node tests: every changed test file + every test importing a changed source by path = **372 files, 4,360 pass / 8 fail**; the 4 red files are BASE-RED with identical counts on a clean base worktree: `admin-trash-routes` (4), `site-chat-stream.golden` (1), `wiring-identity` row 7 (combine-16 BASE-RED), `dead-path-sweep` (2: missing gitignored `development/coverage`, `ADS-memory/.local-artifacts`). Postgres-only files skipped (no server in this container): `unreadable-owner-entries-repair.postgres`.
- Admin vitest: no `apps/admin` file changed; admin `tsc` 0 against the linked Jini (covers the removed `@jini-ai/cms/core` keyset exports).

## Self-check before push
- No re-export/forwarding files added (the two restored Tovu doors forward only local Tovu code; the two Tovu constant files `write-watermark-tables.ts` / `publish-backstop-tables.ts` hold host table names only).
- No custom hooks involved; no Express/Electron types or host log formatters in Jini; no `Tovu` strings in moved Jini code (K3: `errorRedaction`, table names, `tableExists` injected by the host).
- No new size/complexity exception entries; why-comments moved with the code (18 neutralised ones recorded); `## Wiring` in `cms/routing/site/README.md`, `cms/publish/{content,transfer}/sql/README.md`, `cms/media/site/INFO.md`, `db/recovery/README.md`, `db/watermark/README.md`, `platform/secrets/credential-sets/INFO.md`.
- Object args with `_optional = {}` on every moved/new function; each moved body has a named mutation that went red.
- Open for Codex: db `import-isolation` allowlist widened by 4 exact paths (FIX 5); `cms/media/site/access-evidence.ts` keeps module-level WeakMap caches (verbatim; HW3 guard does not flag it); `@jini-ai/cms/core` lost 3 exports (other lanes importing keyset helpers from cms/core must repoint to `@jini-ai/core/keyset-cursor`).

## FILES LEFT (`plans/P9-data/tools/scan.mjs` + `plan.mjs`, themes = `theme` + `adm-themes` areas, 86 + 25)
| tree | moving | shells | FILES LEFT | excl. themes |
|---|---|---|---|---|
| before (merge-16 `3a9332247`) | 2,187 | 0 | **2,187** | **2,076** |
| after (`1156ce7aa`) | 2,186 | 0 | **2,186** | **2,075** |
Only 4 of the 156 owned files are inside a counted area (`platform/routing` ×2, `platform/html` ×2, the latter Codex-blocked Tovu policy); `routing/index.ts` stays as the adapter door because `routing/adapter.ts` belongs to another branch. The other 11 moves/2 shell deletions are outside the measured areas (`platform/db`, `secrets`, `oauth`, `media-access-evidence`), so they do not change the number.

## Commits
- Tovu `codex/w4-db-tovu`: `ced58957f`, `6068503f8`, `18340ff54`, `1156ce7aa` (+ this report).
- Jini `codex/w4-db-jini`: `b08c3b2d4`, `1c0e72213`, `5751169c9`, `409a1ab4f`, `c34bf42dd` (+ report copy).
