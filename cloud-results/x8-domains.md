PARTIAL e0fb57bcc3 621c12e8c: 72 lane files left by planner count (contracts-core 24, site-backup 33, publish-content 15); 3 real moves left (site-backup backup-service, push-content, tool-registrations), 33 STAYS-HOST bindings await keep-rules; Tovu node test comparison still running

SHAs in the first line are the work tips before this report commit (Tovu `codex/x8-domains-tovu`, Jini `codex/x8-domains-jini`).

# x8-domains (2026-11-25): Tovu -> Jini extraction, CONTRACTS / BACKUP / PUBLISH lanes

This was an unattended cloud run. Opus coordinated. 19 worker dispatches (W1–W19), at most 4 running at once:
- **Opus subagents (security / auth / data):**
  - W1: gated-hooks `planHashOf`/`resolveActorClassIdentity` seam
  - W2: peer-transport and the redaction seam
  - W5: share passwords, share-backend and redaction
  - W11: peer credential vault
- **Sonnet subagents (high effort):** all other moves and the gate work.

`AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) was read first, and **this report confirms it**. Every worker got one brief built from it (`BRIEF.md`). The brief required:
- root cause first and minimum change;
- test-first, with a named mutation for every behavioural seam;
- fresh evidence before any claim;
- why-comments moving with the code;
- the owner rules (no forwarding files, inject everything, no Tovu words in Jini, object args, function size and complexity limits, no new exception rows);
- the STOP rules.

## Setup
- **Base.** Tovu `origin/codex/x6-server-tovu` (`963838d1f`). Jini `origin/codex/x6-server-jini` (`57479909b`). Both branches were pushed before any work, then after every batch. The intermediate pushes are `wip(x8-domains)` snapshot commits (19 per repo).
- **Node** is 24.22.3 (`/opt/node24/bin` first on PATH).
- **Jini:** `pnpm install --frozen-lockfile` and `pnpm -r build` both exit 0.
- **Tovu:** `npx npm@11.6.2 ci --ignore-scripts` in root, admin and desktop.
  - `link-jini` exited 1 at first, because it defaults to `/root/Programming/Jini`. It was re-run with `JINI_PACKAGES_DIR=/home/user/Jini/packages`.
  - The workers were told to re-take any baseline they had run before the link.
  - The `packages/contracts` build passes once linked.
- **Baselines** came from clean worktrees `/home/user/wt/{jini-base,tovu-base}` at the two x6 tips, each with its own build and link.
- **Planner:** `combine-18-plan.mjs` (from `integ/merge-18-2026-11-24`) and `scan.mjs` (from `plan/whats-left-1122`).

## FILES LEFT (combine-18 planner, `src` count per area)

| area | before (x6 tip) | after | LOC before -> after |
|---|---|---|---|
| contracts-core | 25 | 24 | 2,075 -> 2,050 |
| site-backup | 37 | 33 | 6,444 -> 2,468 |
| publish-content | 20 | 15 | 5,298 -> 1,018 |
| **lane total** | **82** | **72** | **13,817 -> 5,536** |

**Why the count barely moves while the LOC drops 60%.** The planner counts every Tovu file still present. Most moves left a Tovu **binding**: a file that only calls the new Jini factory with Tovu values such as limits, copy, `.tovu.zip`, AAD/vault literals and key patterns. Once the planner keep-rules list the STAYS-HOST files below, the remaining extraction work in these three areas is:
- **site-backup:** `backup-service`, `push-content` and `tool-registrations` (3 files);
- **publish-content:** 0 files;
- **contracts-core:** 0 files.

## Per file (Tovu `apps/website/src/`)

### Moved, Tovu file DELETED (13)
| tovu file | result |
|---|---|
| `contracts/core/tool-metadata/site-update.ts` | MOVED -> `@jini-ai/core/tool-metadata/site-update`. This is the one-line repoint in `features/site-update/tools.ts`, plus the aggregator import. |
| `features/publish-content/gated-hooks.ts` | MOVED -> `@jini-ai/cms/publish/content/gated-hooks` (W1, Opus). SEC seam:<br>- `planHashOf`, `resolveActorClassIdentity` and `catalog: { build }` are REQUIRED; the module is generic over ports `<P>`.<br>- Host binding: `server/runtime/composition/modules/publish-content-import.ts` and `tool-registrations.ts` (`pullHooks`).<br>- Test-first pin `gated-hooks.confirmed-report.test.ts` asserts sha256(JSON) identity and the same resolver function. It was green before and after.<br>- Mutations: `plan-hash-not-injected`, `actor-identity-hardcoded`. |
| `features/publish-content/peer-transport.ts` | MOVED -> `@jini-ai/cms/publish/content/peer-transport` (W2, Opus), as `createPeerTransport({ host })`.<br>- Injected: the redactor, the egress-refusal mapper, the dev-hosts setting name, the product name and the history kind.<br>- **B258:** the `tovu_ak_` rule stays in Tovu `redactSecretShapes`. Pin: "the Tovu binding redacts a Tovu API key shape".<br>- Mutations: `redact-not-applied`, `auth-header-dropped`, `tovu-redactor-not-bound`. |
| `features/publish-content/apply-report.ts` | MOVED -> `@jini-ai/cms/publish/content/apply-report` (W6).<br>- `host`: catalog, `readBackstopMetadata`, plugin-hook predicate and rebuilder. The binding lives in the existing `apply-port.ts`.<br>- Mutations: `catalog-injection-ignored`, `plugin-hook-predicate-ignored`, `backstop-metadata-ignored`. |
| `features/publish-content/file-tree-policy.ts` | MOVED -> `@jini-ai/cms/publish/content/file-tree-policy` (W8).<br>- `scanTextForSecrets` and `maxFileBytes` are REQUIRED (W17).<br>- Mutations: `drop-secret-scan`, `ignore-injected-cap`. |
| `features/publish-content/permissions.ts` | MOVED -> `@jini-ai/cms/publish/content/permissions` (W8).<br>- `registerPermission` and the grant copy are injected from `composition/app-permission-grants.ts`.<br>- Mutation: `drop-apply-grant`. |
| `features/publish-content/connect-destination.ts` | MOVED -> `@jini-ai/cms/publish/content/connect-destination` (W15).<br>- Its 7 compensation tests moved to vitest.<br>- Mutation: `drop-connect-compensation`. |
| `features/site-backup/static-copy.ts`, `static-download-layout.ts`, `static-download-landing.ts` | MOVED -> `@jini-ai/devops/backup/site/*` (W3). URL parsers are injected (W17).<br>- 10 mutations, among them `alias-ignored`, `path-policy-ignored`, `limits-ignored`, `source-edits-ignored` and `drop-outputFileForUrl`. |
| `features/site-backup/share-preparation-steps.ts` | MOVED -> `createShareSteps(deps)` (W7). The host values now live in the new binding `share-steps.ts`. |
| `features/site-backup/import-verifier-inventory.ts` | MOVED, with 12 host members (W14).<br>- Mutations: `drop-entry-cap`, `drop-hash-check`, `skip-roots-check` and others. |
| `features/site-backup/import-backend-steps.ts` | MOVED (W16).<br>- Mutations: `drop-redaction`, `drop-timeout-mapping`. |

### Moved to Jini, Tovu keeps a STAYS-HOST binding (only calls the Jini factory with Tovu values)
**Planner keep-rule candidates (33 files).**

publish-content (9):

| tovu file | notes |
|---|---|
| `features/publish-content/peer-transport-binding.ts` | new |
| `features/publish-content/destination-credential.ts` | |
| `features/publish-content/disconnect-tool.ts` | |
| `features/publish-content/peers.ts` | -> `peer-registry.ts`. At-rest vault kind `publish-peer` and owner key. Pinned by `peers.sealed-at-rest.pin.test.ts`, a frozen sealed record that still opens. W11 Opus. |
| `features/publish-content/publish-tool.ts` | |
| `features/publish-content/pull.ts` | |
| `features/publish-content/push-plan.ts` | |
| `features/publish-content/raw-file-contributor.ts` | |
| `features/publish-content/raw-row-contributor.ts` | |

site-backup (24):

| tovu file | notes |
|---|---|
| `features/site-backup/archive-extensions.ts` | |
| `features/site-backup/archive-manifest.ts` | |
| `features/site-backup/bundled-export-file-policy.ts` | |
| `features/site-backup/import-backend.ts` | |
| `features/site-backup/import-database.ts` | |
| `features/site-backup/import-keep-off.ts` | |
| `features/site-backup/import-plugin-state.ts` | |
| `features/site-backup/import-registry.ts` | Binds the platform fs functions only. No Tovu words; it keeps ~8 construct sites unchanged. |
| `features/site-backup/import-restore-placement.ts` | |
| `features/site-backup/import-restore.ts` | |
| `features/site-backup/import-verifier-projection.ts` | |
| `features/site-backup/import-verifier.ts` | |
| `features/site-backup/package-file-inventory.ts` | |
| `features/site-backup/share-backend.ts` | Share-password reveal pinned first in `share-password-reveal-pin.test.ts` with the real AES-GCM sealer and the historical AAD. Green 4/4 before the move and 5/5 after. W5 Opus. |
| `features/site-backup/share-file-policy.ts` | |
| `features/site-backup/share-hosting.ts` | |
| `features/site-backup/share-preparation.ts` | Stamps the `tovuVersion` wire field. |
| `features/site-backup/share-registry.ts` | `.tovu.zip` and the `.tovu` regex. |
| `features/site-backup/share-service.ts` | |
| `features/site-backup/share-zip.ts` | |
| `features/site-backup/sources.ts` | `tovu-backup.json`, limits. |
| `features/site-backup/static-site-packager.ts` | |
| `features/site-backup/share-steps.ts` | new |
| `features/site-backup/static-download-host.ts` | new |

### STAYS-HOST (no Jini move; host values, adapters or wiring)
| tovu file | reason |
|---|---|
| `contracts/core/{approval-i18n,consent-refusal,custom-credential-categories,runtime-mode,settings-vocabulary,theme-ids,tool-metadata/content-read,tool-metadata/index,gated-mutations/{ports,token,gateway,composition},rate-limit/rate-limit,page-html,events/{outbox-worker,outbox-retry-policies,outbox-drainer},assistant-run-events,entry-refs/unindexed-ref-warning,plugin-credential-card,tool-failure-diagnostics,agent-permission-mode,chat-delete-grant,human-confirm}.ts` (24) | The x6 reasons were re-checked and still hold: Tovu copy/literals/env, the SEC gated-mutations host bindings, the host aggregator, schedulers and sinks. No new shared wire type was found that is not already in a Core owner (`core-run-events` and `gated-mutations` are already in Core). `assistant-run-events` is an adapter plus `RUN_NOTICES` copy; callers could later call `@jini-ai/chat/core/run-events` directly. |
| `features/publish-content/{tool-deps,tool-registrations,backstop-service,publish-content-peer-repo,publish-content-peer-repo.sqlite,publish-backstop-row.sqlite}.ts` | Host wiring and SQLite/content-kernel adapters. `backstop-service` is the x6 binding. |
| `features/site-backup/plan-content.ts` | Holds the persisted `tovuVersion` plan wire field and the process-wide plan store. Renaming the field would be an unpinnable wire change. |
| `features/site-backup/{archive-media,static-export-selection,share-policy,download-html-source-edits}.ts` | Thin bindings and host limits/copy. `download-html-source-edits` would otherwise be a pure re-export, so its edits are injected instead. |
| `features/site-backup/share-database/repo.sqlite.ts` | SQLite adapter. |

### STOPPED
| tovu file | reason |
|---|---|
| `features/site-backup/backup-service.ts` | About 25 collaborators would need injecting:<br>- custom-credentials, source-control repo/registry, the site-key keyring, cms authorize, runtime mode, `buildAuthorizationHeader`, the plan store, ...<br>- It also has a `PushResult` import cycle with `push-content`.<br>Recommendation: a `SiteBackupServiceHost` factory after `PushResult` moves to Jini. |
| `features/site-backup/push-content.ts` | Blocked by the `backup-service` `PushResult` cycle and by `plan-content` (STAYS-HOST wire field). |
| `features/site-backup/tool-registrations.ts` | Not reached. |

## Gates (branch vs base, same machine, Node 24)

| gate | base (x6 tip) | branch |
|---|---|---|
| Jini `pnpm -r build` | 0 | 0 |
| Jini `pnpm typecheck` | 0 | 0 |
| Jini `pnpm guard` | 1 violation (HW3 `admin/shell-failure-log.ts`) | The same single violation. The mid-run violations were fixed: 11 SI-domain, 3 HW3, 4 HW1/HW9 env. |
| Jini `pnpm api:check` (after `api:update`: cms, core, devops) | 0 | 0 |
| Jini `check:hooks` | ok | ok |
| Jini `check:why-comments --base origin/codex/x6-server-jini` | – | 0 lost |
| Jini vitest on the changed test files | – | cms 16 files / 130 tests pass; devops 24 files / 255 tests pass |
| Tovu `tsc -p tsconfig.json --noEmit` | 0 | 0 |
| Tovu admin `tsc --noEmit` | 0 | 0 |
| Tovu `check:hooks` | ok ("debt shrank 1") | ok (same) |
| Tovu `check:why-comments --base origin/codex/x6-server-tovu` | – | 27 found, now 0 open, exit 0. 1 was restored verbatim in `import-plugin-state.ts`, and 26 debt entries each cite the Jini file and line where the block now lives. |
| Tovu `check:errors` | WARN, 7 new | WARN, the same 7. 16 debt rows for violations that moved out were removed. |
| Tovu `check:architecture` | red (3 hard regressions) | red, the same 3. The renamed edge `share-hosting -> peer-transport-binding` replaces the old `-> peer-transport` row. |
| Tovu node tests (438 files: changed tests plus importers of changed or deleted sources, `--test-concurrency=2`) | TOVUBASE | TOVUBRANCH |

Reds that are red at base too and unrelated: `publish-zero-setup-end-to-end` (`deployConfigGenerators`), `library-share.integration` (`features/members/index.js`), `L131-characterization`/`fetch-live-url` (`RESERVED_SEGMENTS`), and `import-restore.unit` "starter radio" (`fieldKinds`).

## Self-check
- **No re-export or forwarding files.** Every Tovu file that remains in these areas holds host values, or is an adapter or wiring.
- **Inject everything.**
  - No new `dependencies` edges were added.
  - `@jini-ai/devops` still imports only `@jini-ai/core`; `@jini-ai/cms` adds no new edges.
  - Cross-domain reaches inside a package were injected (W17). The single exception is `src/media/blob-key.ts`, a pure leaf added to cms `isolation.shared` (precedent `d5adf5ad9`).
- **No product words in Jini.** `rg -i tovu` on every new Jini file is empty. The Tovu key rule, `.tovu.zip`, `tovuVersion`, `tovu-backup.json`, the AAD and vault literals, and `TOVU_*` env all stay host and are injected.
- **Object args** use `fn(required, _optional = {})`. No new size or complexity exception rows were added.
- **Behaviour changes are test-first, with named mutations.** The workers report about 110 named mutations, each shown red and then reverted.
- **Existing-data pins:**
  - share-password reveal: `share-password-reveal-pin.test.ts`;
  - sealed peer credentials: `peers.sealed-at-rest.pin.test.ts`;
  - the archive-manifest byte pin;
  - the saved-keys AAD pin from x6, which is still green through the share-backend binding.
- **Deviation (rule 6, `jini-*` classes).** The moved `static-download-landing` page keeps its unprefixed CSS classes (`card`, `badge`, ...). This is the exported static-site HTML, and renaming the classes would break the byte pins. **Owner decision needed:** keep the classes as they are, or rename them with a pinned output change.
- `apps/desktop` was not touched, so the pre-push hook skipped the desktop gates on every push.

## Caps
- **Wall clock:** about 2 h 20 min (01:34 to about 03:55 UTC).
- **Coordinator:** about 135 tool calls; context stayed under the cap.
- **Subagents:** 19 in total, at most 4 at once.
- **CAP DEVIATION (token):** many workers went over the 120k-token budget, for example W5 168k, W14 175k, W16 166k, W2 163k, W18 162k and W7 158k. All stayed at or under 50 tool calls (the maximum was 49: W16 and W17). Their returns were verified by the coordinator's gates.

## Left / recommendations
1. Update the planner keep-rules with the 33 STAYS-HOST binding files and the STAYS-HOST lists above.
2. `backup-service` / `push-content` / `tool-registrations`: first move `PushResult` to Jini to break the cycle, then add a `SiteBackupServiceHost` factory.
3. Decide the `static-download-landing` CSS class question (rule 6).
4. Stale prose path references to moved files remain in `development/parity/tool-guides.json` and `development/assistant-prompts/capability-prompts.md`. They are documentation only.
