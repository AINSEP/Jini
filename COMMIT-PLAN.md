# Round 3 w3c-w1b — Jini working-tree handoff

Source: Tovu `5ae429b34` (checked merge-23); Jini starting HEAD `10517f584`.
No tests, builds, installs, typechecks, linters, commits, or pushes authorized.
Tests are written before their implementation; mutations below are for Opus to execute and remove.

## Stopped

- 02: required W1-11 codec `packages/cms/src/posts/sql/repo.rows.ts` is absent at HEAD (also absent on `origin/codex/w3-r2allj`). No tests or implementation written for this dependent sheet.
- 06a: source `handleImport` calls `parseSiteImportInput` from `devops/backup/site/import-backend`, whose implementation imports `node:fs`, `node:path`, and `node:crypto`. The required new registrar entry is universal. The sheet supplies host parsers for static export and cursor input, but does not supply a host port for this parser or authorize a pure parser split. A direct move would violate the lane; adding a parser port or file would exceed the named design. No edits made for 06a.
- 07: source handlers call `readPageBodyOptions` from `@jini-ai/diagnostics/web-evidence/page-body`, classified `node` in diagnostics/package.json and importing node:buffer/parse5. The new CMS registrar must be universal, and CMS has no diagnostics dependency. No authorized body-parser injection, parser extraction, or package-edge change is supplied. No edits made for 07.

## Delivery order

04 → 05 → 01 → 03a/helpers → 06a → 07 → 08 → 09a → Appendix A1 (09c).

## Excluded by approved corrections

03 registrar orchestration deferred; 06b database projection stays host; 09b ordered keyring stays host. All w3c-w2 sheets REJECT. W1-01B belongs to w1a, outside this set.

## Completed logical commits

These are working-tree logical units, not commits. All test files below were created before the corresponding implementation.

1. **04 — bundled provider registry**
   - Create `packages/devops/src/source-control/site/{bundled-provider-registry.ts,__tests__/bundled-provider-registry.test.ts}`.
   - Change `packages/devops/package.json`; create `.changeset/w3c-w1b-source-control-registry.md`.
   - Four tests: three duplicate declarations, enumeration failure, import failure/refusal order, lazy host binder.
   - Mutation: `SC-BUNDLED-LAST-DUPLICATE-WINS` — retain one ambiguous provider instead of deleting its ID.
2. **05 — route manifest**
   - Create `packages/devops/src/static-export/site/{route-manifest.ts,__tests__/route-manifest.test.ts}`.
   - Change `packages/devops/package.json`; create `.changeset/w3c-w1b-static-route-manifest.md`.
   - Four tests: explicit false versus unset override, probe collision, unique home/no products/stable read and route order/seed preservation, distinct absent/off reasons and JSON omission.
   - Mutation: `EXPORT-IGNORE-EXPLICIT-THEME-OVERRIDE` — disregard explicit false. The final FIX mandates one mutation name; the redirect/probe test is also included as specified.
3. **01 — attachments and shared OAuth disconnect**
   - Create `packages/user-management/src/project-keys/{sql/attachments.ts,__tests__/attachments.test.ts}`.
   - Create `packages/integrations/src/api-connections/{shared-oauth-disconnect.ts,__tests__/shared-oauth-disconnect.test.ts}`.
   - Change both package manifests; create `.changeset/w3c-w1b-project-keys.md` (both packages).
   - Four attachment tests: detach/worksFor and idempotent attach, duplicate label, over-cap, wrong site/owner/kind/subtype.
   - Four disconnect tests: grant digest conflict before token/provider effects, token-free inspection with byte-identical digest, remove grants before revoke, retry after remote refusal.
   - Mutations: `PK-CACHE-ATTACHMENTS` (cache the label lookup); `PK-ATTACH-LIMIT-OFF-BY-ONE` (read maxGrants rather than maxGrants + 1); `PK-DISCONNECT-IGNORE-GRANT-DIGEST` (omit digest comparison); `PK-DISCONNECT-REVOKE-BEFORE-GRANT-REMOVAL` (revoke first); `PK-REGENERATE-ON-RETRY` (always perform the local pending-state CAS). Retry assertion permits the existing lifecycle's one result revision write, but excludes an additional local stop revision/generation bump.
4. **03a + narrowed helpers**
   - Create `packages/cms/src/publish/content/sql/{raw-row-sqlite.ts,__tests__/raw-row-sqlite.test.ts}`.
   - Create `packages/cms/src/publish/content/{tool-helpers.ts,__tests__/tool-helpers.test.ts}`.
   - Change CMS manifest; create `.changeset/w3c-w1b-publish-tools.md`.
   - Three raw-row tests: nested join and outer FK rollback; policy refusal before introspection; incomplete PK causes no mutation.
   - Four helper tests: whole-message fallback for underscore token; refused report; 1001 overwrite keys; write risk for publish/plan/execute/connect.
   - Mutations: `PUB-ROW-CHECK-FKS-INSIDE-JOIN` (run checkedTransaction for nested joins), `PUBLISH-LOOKUP-BEFORE-POLICY` (introspect before policy), `PUB-PLAIN-SENTENCE-PATCH-TOKEN` (patch rather than fall back whole), `PUB-PULL-ACCEPT-REFUSED` (return refused report), `PUB-PULL-OVERWRITE-UNBOUNDED` (remove 1000-key cap), `PUB-RISK-MARK-PUBLISH-READONLY` (publish risk none).
5. **08 — Trash contracts, visibility, user adapter**
   - Extend `packages/core/src/contracts/site/cms-trash.ts`; replace declarations with approved type exports in `packages/cms/src/trash/ports.ts`.
   - Create `packages/cms/src/trash/{visibility.ts,__tests__/visibility.test.ts}`.
   - Create `packages/user-management/src/identity/sql/{user-trash-adapter.ts,__tests__/user-trash-adapter.test.ts}`.
   - Change CMS and user-management manifests; create `.changeset/w3c-w1b-trash.md` (core/CMS/user-management).
   - Two visibility tests: unknown kind plus source cursor, map precedence and one decision per kind. Four lifecycle tests: race before revoke/event, guard before writes, zero-row restore CAS, purge inside principal lock.
   - Mutations: `TRASH-ALLOW-UNKNOWN-KIND` (admit unknown kinds); `USER-TRASH-DROP-STATUS-CAS` (ignore zero affected rows); `USER-TRASH-GUARD-AFTER-WRITE` (guard after CAS); `TRASH-USER-EVENT-ON-CAS-MISS` (append restore event on CAS miss); `TRASH-USER-PURGE-OUTSIDE-LOCK` (call purge outside the locked callback).
6. **09a — repository scanning**
   - Create `packages/diagnostics/src/redaction/{repo-secret-scan.ts,__tests__/repo-secret-scan.test.ts}`.
   - Change diagnostics manifest; create `.changeset/w3c-w1b-repo-secret-scan.md`.
   - Three tests: path hit despite skipped content, serialized tip/history text and binary reports contain no matched bytes, exact path/value allowlist exception.
   - Mutations: `REPO-SCAN-FILTER-PATH-BEFORE-SCANNING` (skip path scanning when content is skipped); `REPO-SCAN-REPORT-MATCH-TEXT` (include match in line); `REPO-SCAN-EXEMPT-BY-TEXT-ONLY` (drop path equality from allowlist); `REPO-SCAN-RETURN-RAW-MATCH` (return raw hit value).
7. **Appendix A1 / 09c — root-key reconciler**
   - Create `packages/platform/src/secrets/root-key/{reconcile.ts,__tests__/reconcile.test.ts}`.
   - Change platform manifest; create `.changeset/w3c-w1b-root-key-reconcile.md`.
   - Nine tests exactly as A1: pre-write mismatch, move-aside, no restamp over dependent data, create-race winner, memoized scan, absent with dependent data, lazy stamped-source read, no-meta, unstamped meta.
   - Mutations: `ROOT-KEY-ADOPT-BEFORE-STAMP-CHECK`, `ROOT-KEY-DELETE-INSTEAD-OF-MOVE-ASIDE`, `ROOT-KEY-RESTAMP-WITH-DEPENDENT-DATA`, `ROOTKEY-RETURN-CANDIDATE`, `ROOT-KEY-UNMEMOIZED-SCAN`, `ROOT-KEY-MINT-OVER-DATA`, `ROOT-KEY-READ-ALL-SOURCES` (literal changes named in A1).

## Tovu cutover contracts

- All Tovu changes are left to the Tovu half. Use the ten new subpaths in the changed manifests. Existing core `contracts/site/cms-trash` now supplies adapter shapes and TrashAuthorizeFn; CMS keeps its approved type compatibility exports.
- Attachments require `sql`, `{ attachments, vault }`, `nowIso`, policy and `credentialTypeText`; the SQL methods accept a RawBuilder directly. Bind jsonText with the host dialect. Preserve all current policy literals.
- Disconnect requires ownerWorkspaceId, digest({ text }), and copy. Pass the storage context unchanged into tokensFor; the transaction and attachment ports must share the owner store. Existing descriptor/record/token types are reused from integrations.
- Raw-row `kernel.query/execute` accept `{ statement }`. `tableInfo({ table })` and `checkedTransaction({ work, onViolation })` close over the same host kernel. Bind checkRawTable and exact existing refusal copy in the current outer host factory ABI.
- Provider loader maps host registry.list() to `providers`, preserving refusals. Copy has sourceFailure, packageFailure({ pluginId }), duplicateId({ id }); only enumeration errors reach reportSourceFailure.
- Route sources keep readThemeAndPosts as one operation with the current parallel host reads. Selected theme input contains identity, tier and page IDs. Policy supplies seeded routes/skips, standalone predicate, post/product paths, probe base/suffix, and absent/off/nonexact copy. Host theme selection and conventions stay in Tovu.
- User Trash store methods close over one transaction/lock context. Keep `trash:user:<workspaceId>:<principalId>`, status CAS and affected counts, all-session revoke, raw outbox insert, eventValues and lazyKernel in the host binder. Omit disabledAt on a non-active restore; null clears it for active. policy carries entityType and the existing optional account guard. No caller is inferred for retention.
- Scanner readTracked returns bounded latin1 content and binary status (or null); policy selectPath applies extension selection and maxScanBytes preserves the current cap. Git parsers/commands and exact allowlist remain host-owned. Historical paths are read before selected blob references and batch content; preserve host SHA dedup and order.
- Reconciler uses Appendix A1's literal ports and returns no filesystem path; Tovu adds perSiteFilePath and retains the production early return and all filesystem arbitration.

## Review and verification handoff

- 41 new test cases across 10 test files. No existing tests removed, weakened, skipped, or excluded. Tests and mutations were NOT RUN, as dispatched.
- Reviewed source snapshots, created source/test files and tracked diffs by reading them. No validation commands were run. Architecture review is PARTIAL: 06a/07 stopped on Node/universal boundary conflicts, 02 on a missing prerequisite. Built units add no package dependency edges; user-management imports neither CMS nor db.
- Opus must execute the named tests/mutations, retain Tovu SQL/dialect/wire witnesses, build and run `pnpm api:update` for core, CMS, user-management, integrations, devops, diagnostics and platform. API baselines intentionally untouched.
- No commits, index writes, pushes, host edits, subagents, package installs, or validation runs.

## Deletions in final scope review

- Removed only the four adapter shape declarations from CMS ports, relocating their unchanged contracts and why-comments into existing core cms-trash; CMS retains approved type exports.
- Removed an unused local TrashPurgeOutcome type import during final scope review. No files or tests deleted.
