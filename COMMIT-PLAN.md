# WMZ Jini working-tree handoff — NOT A COMMIT

Jini only. No Tovu file was changed or deleted; no end-to-end MOVE is claimed. `.git` was read only. No agents, installs, builds, tests, typechecks, linters, migrations, mounts, schedules or feature activation ran. Tests below are authored/unexecuted; mutation sensitivity is a design claim for Opus to execute, not a green result.

Pinned source: Tovu `a96020e1e7` via `/Users/la/Programming/Tovu`; pinned destination comparison: `0718702bbc`; working Jini HEAD: `0ba3fd793eb87315504e1b6137ff7a9bf723d596`. The missing local AI-Dev-Shop was expected; the dispatched programmer skills were read from the supplied absolute Tovu path.

Each numbered unit below is the design commit order for the coordinator, not a list of created commits. Characterization cases were written before the corresponding production moves; existing owner pins were reused where specified. Follow-up test additions precede the related follow-up production edits. `COMMIT-PLAN.md` itself must stay uncommitted.

## Stops and dependent work

- WMZ10: pinned `post/repo.rows.ts:221–237` reconstructs `actorId` but omits `actorKind`; `toRevisionRow:239–255` writes `actor_kind`. Pinned `repo.memory.ts:204–230` also omits `actorKind` from the appended revision. Required actor-column round-trip cannot be characterized as preserved behavior on that source. Held: `cms/posts/sql/repo.rows`, its dependent SQL `repo`, and `posts/repo.memory`. No schema or actor behavior was silently repaired. Mutation `drop-actor-id-from-revision-row` remains unauthored with the held codec. Other WMZ10 files continued independently.

- WMZ23: `packages/cms/src/taxonomy/agent-tools.ts:105` exports a static `taxonomyAgentToolCatalog` array. The host appends get-term and assigned-term definitions using that array’s assignment schema. The sheet requires injected permission/read references while preserving existing exported-array behavior, but gives no additive factory/binding API name. Under the hard no-new-named-helpers rule, the catalog extension is NEEDS-OPUS. The publish move is built independently.

- Tovu halves and exhaustive scanner importer/keep ledger are coordinator work. No source is considered DONE/MOVE until its Tovu DELETE/BIND cutover is complete. Package intake/lockfile synchronization and all execution checks remain Opus work. No rejected WMZ sheet or other slice was implemented.

## 01. WMZ01 — Project keys

Built; reuse existing attachment/service owners; add shared disconnect.

Characterization: attached alias resolution and duplicate-grant refusal; changed reviewed grants cause no CAS, grant removal or token/provider access. Mutation(s): `skip-reviewed-grant-digest`. Not run.

Files in this unit:

- `packages/user-management/src/project-keys/__tests__/attachments.test.ts`

- `.changeset/wmz01-project-keys.md`

- `packages/user-management/src/project-keys/__tests__/shared-oauth-disconnect.test.ts`

- `packages/user-management/src/project-keys/shared-oauth-disconnect.ts`

- `packages/user-management/package.json`

## 02. WMZ02 — Mail status

Built.

Characterization: token rotation with omitted username; saved-key callback before invalidation; captured test-send envelope; changed capture revision refuses fresh clear. Mutation(s): `clear-reviewed-capture-without-reread`. Not run.

Files in this unit:

- `.changeset/wmz02-mail-status.md`

- `packages/user-management/src/mail/status/__tests__/registrations.test.ts`

- `packages/user-management/src/mail/status/delivery-tool-registrations.ts`

- `packages/user-management/src/mail/status/provider-operations.ts`

- `packages/user-management/src/mail/status/provider-tool-registrations.ts`

- `packages/user-management/src/mail/status/tool-registrations.ts`

- `packages/user-management/package.json`

## 03. WMZ03 — Media

Built; existing credential/vault/memory/video owners reused.

Characterization: unordered duplicate fence keys; equal-length wrong-hash stored blob; conversion fails after successful persistence; stale private search hit; fixed legacy AAD envelope; video envelope; missing staged bytes. Mutation(s): `omit-stored-hash-check; serve-indexed-private-image`. Not run.

Files in this unit:

- `packages/cms/src/media/site/__tests__/provider-credential-store.test.ts`

- `packages/cms/src/media/site/__tests__/view-video-tool.test.ts`

- `.changeset/wmz03-media.md`

- `packages/cms/src/media/site/__tests__/blob-write-bindings.test.ts`

- `packages/cms/src/media/site/__tests__/import-video-conversion.test.ts`

- `packages/cms/src/media/site/__tests__/publish-content.test.ts`

- `packages/cms/src/media/site/blob-write-bindings.ts`

- `packages/cms/src/media/site/derived-media-link.ts`

- `packages/cms/src/media/site/import-video-conversion.ts`

- `packages/cms/src/media/site/publish-content.ts`

- `packages/search/src/site/__tests__/media-search-source.test.ts`

- `packages/search/src/site/media-search-source.ts`

- `packages/cms/package.json`

- `packages/search/package.json`

## 04. WMZ04 — Media generation

Built; existing CMS generation registrar reused without changing its seam.

Characterization: first eligible default model order; saved credential wins over environment; duplicate alias and credential-bearing URL do not escape catalog. Mutation(s): `env-wins-over-valid-saved-key`. Not run.

Files in this unit:

- `.changeset/wmz04-generation.md`

- `packages/integrations/src/media-providers/__tests__/generation-credentials.test.ts`

- `packages/integrations/src/media-providers/catalog-projection.ts`

- `packages/integrations/src/media-providers/generation-credentials.ts`

- `packages/integrations/package.json`

## 05. WMZ05 — Media import

Reuse only; no package production change, entry or changeset.

Characterization: existing permission-before-I/O and caller-safe egress pins retained; mutually exclusive replacement case added; persistence-before-conversion pin in WMZ03. Mutation(s): `open-local-file-before-authorize`. Not run.

Files in this unit:

- `packages/cms/src/media/site-import/__tests__/tool-registrations.test.ts`

## 06. WMZ06 — Member login

Built on existing providers entry.

Characterization: bundled then installed admission; descriptor fingerprint changes; absent installed candidate. Mutation(s): `hash-manifest-instead-of-descriptor`. Not run.

Files in this unit:

- `packages/user-management/src/member-login/providers.ts`

- `.changeset/wmz06-member-login.md`

- `packages/user-management/src/member-login/__tests__/bundled-providers.test.ts`

- `packages/user-management/package.json`

## 07. WMZ07 — Members

Built.

Characterization: safe read projection; authorization refusal without read/write; challenge token never returned. Mutation(s): `include-challenge-token-in-tool-result`. Not run.

Files in this unit:

- `.changeset/wmz07-members.md`

- `packages/user-management/src/members/__tests__/tool-registrations.test.ts`

- `packages/user-management/src/members/tool-registrations.ts`

- `packages/user-management/package.json`

## 08. WMZ08 — Navigation

Built.

Characterization: nested reference repoint retries an optimistic conflict; final change-set IDs/notUpdated; unrelated menu unchanged. Mutation(s): `skip-expected-version-on-repoint`. Not run.

Files in this unit:

- `.changeset/wmz08-navigation.md`

- `packages/cms/src/navigation/site/__tests__/publish-content.test.ts`

- `packages/cms/src/navigation/site/publish-content.ts`

- `packages/cms/package.json`

## 09. WMZ09 — Newsletter

Built, including named private read/write split; sending remains disabled by existing host policy.

Characterization: scheduled launch rereads; transaction commits before freeze/fan-out; changed reviewed campaign refuses; unchanged mail-off result and launch-gate refusal. Mutation(s): `fan-out-reviewed-campaign-without-recheck`. Not run.

Files in this unit:

- `.changeset/wmz09-newsletter.md`

- `packages/user-management/src/newsletter/delivery/__tests__/tool-registrations.test.ts`

- `packages/user-management/src/newsletter/delivery/tool-registrations.ts`

- `packages/user-management/src/newsletter/tool-registrations.read.ts`

- `packages/user-management/src/newsletter/tool-registrations.ts`

- `packages/user-management/src/newsletter/tool-registrations.write.ts`

- `packages/user-management/package.json`

## 10. WMZ10 — Post

PARTIAL: independent operations/tools/publish/revision probes built; codec and repository moves STOPPED.

Characterization: trashed slug creation; stale update without effects; no-op without revision churn; HTML duplication; replacement retirement and forward restore; unreadable inverse retains revision. Mutation(s): `omit-update-version-check; unreadable-inverse-is-unreferenced; drop-actor-id-from-revision-row (NOT AUTHORED: held codec)`. Not run.

Files in this unit:

- `.changeset/wmz10-posts.md`

- `packages/cms/src/posts/__tests__/content-duplicate.post-page.test.ts`

- `packages/cms/src/posts/__tests__/post.trashed-slug-release.test.ts`

- `packages/cms/src/posts/post-create.ts`

- `packages/cms/src/posts/post-retire.ts`

- `packages/cms/src/posts/post-tool-delete.ts`

- `packages/cms/src/posts/post-tool-deps.ts`

- `packages/cms/src/posts/post-tool-duplicate.ts`

- `packages/cms/src/posts/post-tool-input.ts`

- `packages/cms/src/posts/post-tool-list.ts`

- `packages/cms/src/posts/post-tool-policy.ts`

- `packages/cms/src/posts/post-tool-update.ts`

- `packages/cms/src/posts/post-trash.ts`

- `packages/cms/src/posts/post-update.ts`

- `packages/cms/src/posts/preview-tool.ts`

- `packages/cms/src/posts/publish-content.retire.ts`

- `packages/cms/src/posts/publish-content.ts`

- `packages/cms/src/posts/reverters.ts`

- `packages/cms/src/posts/sql/__tests__/revision-refs.test.ts`

- `packages/cms/src/posts/sql/revision-refs.ts`

- `packages/cms/src/posts/sql/revision-thinning.ts`

- `packages/cms/src/posts/tool-registrations.handlers.ts`

- `packages/cms/src/posts/tool-registrations.ts`

- `packages/cms/src/posts/tool-registrations.update.ts`

- `packages/cms/package.json`


The registrar’s contiguous command is in private `tool-registrations.update.ts`; map construction is in private `.handlers.ts`. Existing deferred capture reads, merge/CAS basis, error wrappers, outbox order and why-comments stay with their operations. The search why-comment is immediately above the map constructor to keep the constructor below 80 physical lines without deleting it. STOP 6 remains dark.

## 11. WMZ11 — Pages

Built.

Characterization: HTML/change-set rollback on recording failure; HTML vs document inverse round-trip; conflicting undo preserves newer row and disallows force. Mutation(s): `commit-html-when-recording-fails`. Not run.

Files in this unit:

- `.changeset/wmz11-pages.md`

- `packages/cms/src/pages/__tests__/html-recording-revert.test.ts`

- `packages/cms/src/pages/html-change-recording.ts`

- `packages/cms/src/pages/html-inverse.ts`

- `packages/cms/src/pages/html-reverter.ts`

- `packages/cms/package.json`

## 12. WMZ12 — Permanent delete

Built.

Characterization: dismissal, stale selection and declined fresh row authorization never delete. Mutation(s): `use-preview-selection-without-fresh-authorization`. Not run.

Files in this unit:

- `.changeset/wmz12-permanent-delete.md`

- `packages/cms/src/trash/permanent/__tests__/tool-registrations.test.ts`

- `packages/cms/src/trash/permanent/tool-registrations.ts`

- `packages/cms/package.json`

## 13. WMZ13 — Plugin runtime

Built on existing lifecycle/yauzl entry; optional explicit early special-entry rejection only.

Characterization: special Unix entry and trailing-slash special entry keep exact code/message and refuse before counting/yielding. Mutation(s): `count-or-yield-before-special-refusal`. Not run.

Files in this unit:

- `packages/agent-plugins/src/lifecycle/yauzl-archive-reader.ts`

- `.changeset/wmz13-archive.md`

- `packages/agent-plugins/src/lifecycle/__tests__/yauzl-special-refusal.test.ts`

- `packages/agent-plugins/package.json`

## 14. WMZ14 — Publish content

Built.

Characterization: explicit vs inferred destination; no-destination readiness; pull changed after approval never executes. Mutation(s): `run-pull-before-approval`. Not run.

Files in this unit:

- `.changeset/wmz14-publish-tools.md`

- `packages/cms/src/publish/content/__tests__/tool-registrations.test.ts`

- `packages/cms/src/publish/content/tool-registrations.ts`

- `packages/cms/package.json`

## 15. WMZ15 — Publish trust

KEEP; host-only; no Jini edit, export, new test or changeset.

Characterization: existing candidate-policy provisioning pin with only TOVU_PUBLIC_URL remains authoritative. Mutation(s): `read-alternate-public-origin-key (existing host pin)`. Not run.


No new test file was needed for this unchanged host binding.

## 16. WMZ16 — Recovery

Built export/entry only; existing registrar reused.

Characterization: deep-link malformed/denied order pin added; existing restore approval/protected disclosure/unwired-backup registration pins retained. Mutation(s): `register-unwired-backup-entry`. Not run.

Files in this unit:

- `packages/db/src/recovery/__tests__/tool-registrations.test.ts`

- `.changeset/wmz16-recovery.md`

- `packages/db/package.json`

## 17. WMZ17 — Vendor credentials

Reuse only; no new production file/entry/changeset.

Characterization: distinct source-control/vendor kinds share owner-bound adapter; literal prior sealed fixture refuses changed owner; seal/verify precede persistence; existing protected transaction pins retained. Mutation(s): `change-vault-owner-key`. Not run.

Files in this unit:

- `packages/integrations/src/vendor-credentials/__tests__/vault-adapter.test.ts`

## 18. WMZ18 — Source control

Built store, named private validation, secure-card setup and registrar. The loader contract retains the pinned full module/plugin identity, typed credential form and descriptor i18n, so the injected provider builders accept the same registry.

Characterization: blank-token patch preserves envelope without probe; failed probe leaves saved row intact; abort before secure-card persistence; dry-run without provider construction/write. Mutation(s): `save-after-card-abort; commit-during-dry-run`. Not run.

Files in this unit:

- `.changeset/wmz18-source-control.md`

- `packages/devops/src/source-control/site/__tests__/credential-setup.test.ts`

- `packages/devops/src/source-control/site/__tests__/store.test.ts`

- `packages/devops/src/source-control/site/__tests__/tool-registrations.dry-run.test.ts`

- `packages/devops/src/source-control/site/credential-setup.ts`

- `packages/devops/src/source-control/site/store.ts`

- `packages/devops/src/source-control/site/store.validation.ts`

- `packages/devops/src/source-control/site/tool-registrations.ts`

- `packages/devops/package.json`

## 19. WMZ19 — Webhooks/root keys/guard readers

Built; existing keyring/reconcile primitives reused; no real-secret scan.

Characterization: first-present invalid key/read ordering; existing stamped-key recovery/data-bearing refusal; exclusive-create winner bytes; install race refuses stamp; synthetic scanner finding/no-finding and missing AAD; prior sealed fixtures retained. Mutation(s): `skip-first-present-invalid-key; restamp-with-key-dependent-data; ignore-missing-aad`. Not run.

Files in this unit:

- `packages/platform/src/secrets/root-key/__tests__/reconcile.test.ts`

- `.changeset/wmz19-root-key-readers.md`

- `packages/diagnostics/src/redaction/__tests__/repo-secret-scan.node.test.ts`

- `packages/diagnostics/src/redaction/repo-secret-scan.node.ts`

- `packages/integrations/src/webhooks/site/__tests__/seal-aad-invariant.node.test.ts`

- `packages/integrations/src/webhooks/site/seal-aad-invariant.node.ts`

- `packages/platform/src/secrets/root-key/__tests__/files.test.ts`

- `packages/platform/src/secrets/root-key/__tests__/material.test.ts`

- `packages/platform/src/secrets/root-key/files.ts`

- `packages/platform/src/secrets/root-key/material.ts`

- `packages/platform/package.json`

- `packages/integrations/package.json`

- `packages/diagnostics/package.json`

## 20. WMZ20 — Site export

Built; node orchestration entry; themes untouched.

Characterization: destination URL overrides explicit base path; absent public origin omits and removes stale sitemap/feed; report warning order. Mutation(s): `prefer-explicit-base-path-over-destination; leave-stale-feed-without-public-origin`. Not run.

Files in this unit:

- `.changeset/wmz20-site-exporter.md`

- `packages/devops/src/static-export/site/__tests__/site-exporter.test.ts`

- `packages/devops/src/static-export/site/site-exporter.ts`

- `packages/devops/package.json`

## 21. WMZ21 — Site backup

Built service and named private groups, tool registrar, fresh-database projection/private groups and share retention.

Characterization: private-target and fresh parent-SHA refusal before writes; existing snapshot/deferred-file/manifest ordering and upload cancellation pins retained; unknown populated table refuses; only proven local links expire; tombstone precedes unlink; missing/invalid/remote links survive. Mutation(s): `commit-after-parent-changes; skip-unknown-populated-table-refusal; unlink-before-expiry-tombstone`. Not run.

Files in this unit:

- `.changeset/wmz21-share-retention.md`

- `packages/devops/src/backup/site/__tests__/backup-service.test.ts`

- `packages/devops/src/backup/site/__tests__/share-retention.test.ts`

- `packages/devops/src/backup/site/backup-service.credentials.ts`

- `packages/devops/src/backup/site/backup-service.plan.ts`

- `packages/devops/src/backup/site/backup-service.push.ts`

- `packages/devops/src/backup/site/backup-service.ts`

- `packages/devops/src/backup/site/share-database/__tests__/projection.test.ts`

- `packages/devops/src/backup/site/share-database/projection.media.ts`

- `packages/devops/src/backup/site/share-database/projection.tables.ts`

- `packages/devops/src/backup/site/share-database/projection.ts`

- `packages/devops/src/backup/site/share-retention.ts`

- `packages/devops/src/backup/site/tool-registrations.ts`

- `packages/devops/package.json`


Tovu must supply the same source helpers, push-content functions, scope order, database path, private plan store/jobs, labels/copy, key-status and credential/provider readers. The bound plan store must retain the original product version metadata when saving; the bound upload policy must keep its existing manifest path/version/cancellation bytes. Kernel/schema boot stays host-owned.

## 22. WMZ22 — Site inspection

Built.

Characterization: caller context rejects and denied live URL performs no fetch; existing profile section ordering/capability visibility pins retained. Mutation(s): `accept-caller-context-override`. Not run.

Files in this unit:

- `.changeset/wmz22-site-inspection.md`

- `packages/cms/src/site-inspection/__tests__/tool-registrations.test.ts`

- `packages/cms/src/site-inspection/tool-registrations.ts`

- `packages/cms/package.json`

## 23. WMZ23 — Taxonomy

PARTIAL: publish contributors built; catalog extension STOPPED pending a named additive seam.

Characterization: child-first input applies parent-first; existing catalog/read-schema behavior retained unchanged pending extension. Mutation(s): `apply-child-before-parent`. Not run.

Files in this unit:

- `.changeset/wmz23-taxonomy.md`

- `packages/cms/src/taxonomy/site/__tests__/publish-content.test.ts`

- `packages/cms/src/taxonomy/site/publish-content.ts`

- `packages/cms/package.json`

## 24. WMZ24 — Trash

Built; user SQL binding reuses existing user-management transition owner; generic trash_item/registrar owners reused.

Characterization: redirect marker vs independently disabled row; revision-before-hit purge; blocked user purge leaves identity/sessions intact; failed credential revoke rolls marker/fence back; denied visibility returns no row; existing trash_item dispatch/result pins retained. Mutation(s): `advance-credential-fence-outside-marker-transaction`. Not run.

Files in this unit:

- `packages/cms/src/trash/site/__tests__/marker-adapters.test.ts`

- `.changeset/wmz24-trash.md`

- `packages/cms/src/trash/site/__tests__/permissions.test.ts`

- `packages/cms/src/trash/site/adapters/member-credential-sql.ts`

- `packages/cms/src/trash/site/adapters/redirect.ts`

- `packages/cms/src/trash/site/adapters/user.ts`

- `packages/cms/src/trash/site/permissions.ts`

- `packages/cms/package.json`

## 25. WMZ25 — Web

KEEP; host-only; no Jini edit, export, new test or changeset.

Characterization: existing per-host budget tuple remains authoritative. Mutation(s): `change-per-host-window (existing host pin)`. Not run.


No new test file was needed for this unchanged host binding.

## 26. WMZ26 — Web screenshot

Built binder plus node capture-root file lock; existing capture-retention entry retained.

Characterization: authorization refusal performs no fs access; preview/apply root scope; capture writer and cleanup use identical resolved lock/name/options. Mutation(s): `authorize-after-listing-captures`. Not run.

Files in this unit:

- `packages/integrations/src/web-screenshot/__tests__/capture-retention.test.ts`

- `packages/integrations/src/web-screenshot/capture-retention.ts`

- `.changeset/wmz26-capture-retention.md`

- `packages/integrations/src/web-screenshot/capture-root-file-lock.ts`

- `packages/integrations/package.json`

## 27. WMZ27 — Widgets

Built.

Characterization: repeated area projection; form swap only for matching type; unknown destination schema refuses before write. Mutation(s): `write-widget-before-destination-schema-check`. Not run.

Files in this unit:

- `.changeset/wmz27-widgets.md`

- `packages/cms/src/widgets/site/__tests__/publish-content.test.ts`

- `packages/cms/src/widgets/site/publish-content.ts`

- `packages/cms/package.json`

## New public subpaths — Tovu imports

Every line below has both `exports` and `jini.entries`; existing entries remain. Private split modules are not new subpaths. Reuse sheets keep their existing imports.

- `@jini-ai/cms/media/site/blob-write-bindings` — `universal`

- `@jini-ai/cms/media/site/derived-media-link` — `universal`

- `@jini-ai/cms/media/site/import-video-conversion` — `universal`

- `@jini-ai/cms/media/site/publish-content` — `universal`

- `@jini-ai/cms/navigation/site/publish-content` — `universal`

- `@jini-ai/cms/pages/html-inverse` — `universal`

- `@jini-ai/cms/pages/html-change-recording` — `universal`

- `@jini-ai/cms/pages/html-reverter` — `universal`

- `@jini-ai/cms/trash/permanent/tool-registrations` — `universal`

- `@jini-ai/cms/site-inspection/tool-registrations` — `universal`

- `@jini-ai/cms/taxonomy/site/publish-content` — `universal`

- `@jini-ai/cms/trash/site/permissions` — `universal`

- `@jini-ai/cms/trash/site/adapters/redirect` — `node`

- `@jini-ai/cms/trash/site/adapters/member-credential-sql` — `node`

- `@jini-ai/cms/widgets/site/publish-content` — `universal`

- `@jini-ai/cms/publish/content/tool-registrations` — `universal`

- `@jini-ai/cms/trash/site/adapters/user` — `node`

- `@jini-ai/cms/posts/post-create` — `universal`

- `@jini-ai/cms/posts/post-update` — `universal`

- `@jini-ai/cms/posts/post-retire` — `universal`

- `@jini-ai/cms/posts/post-trash` — `universal`

- `@jini-ai/cms/posts/reverters` — `universal`

- `@jini-ai/cms/posts/sql/revision-refs` — `node`

- `@jini-ai/cms/posts/sql/revision-thinning` — `node`

- `@jini-ai/cms/posts/post-tool-delete` — `universal`

- `@jini-ai/cms/posts/post-tool-deps` — `universal`

- `@jini-ai/cms/posts/post-tool-duplicate` — `universal`

- `@jini-ai/cms/posts/post-tool-input` — `universal`

- `@jini-ai/cms/posts/post-tool-list` — `universal`

- `@jini-ai/cms/posts/post-tool-policy` — `universal`

- `@jini-ai/cms/posts/post-tool-update` — `universal`

- `@jini-ai/cms/posts/preview-tool` — `universal`

- `@jini-ai/cms/posts/publish-content` — `universal`

- `@jini-ai/cms/posts/tool-registrations` — `universal`

- `@jini-ai/db/recovery/tool-registrations` — `universal`

- `@jini-ai/devops/backup/site/share-retention` — `universal`

- `@jini-ai/devops/static-export/site/site-exporter` — `node`

- `@jini-ai/devops/source-control/site/store` — `universal`

- `@jini-ai/devops/source-control/site/credential-setup` — `universal`

- `@jini-ai/devops/source-control/site/tool-registrations` — `universal`

- `@jini-ai/devops/backup/site/share-database/projection` — `node`

- `@jini-ai/devops/backup/site/backup-service` — `universal`

- `@jini-ai/devops/backup/site/tool-registrations` — `universal`

- `@jini-ai/diagnostics/redaction/repo-secret-scan.node` — `node`

- `@jini-ai/integrations/media-providers/catalog-projection` — `universal`

- `@jini-ai/integrations/media-providers/generation-credentials` — `universal`

- `@jini-ai/integrations/webhooks/site/seal-aad-invariant.node` — `node`

- `@jini-ai/integrations/web-screenshot/capture-root-file-lock` — `node`

- `@jini-ai/platform/secrets/root-key/decide` — `node`

- `@jini-ai/platform/secrets/root-key/files` — `node`

- `@jini-ai/platform/secrets/root-key/material` — `node`

- `@jini-ai/search/site/media-search-source` — `universal`

- `@jini-ai/user-management/project-keys/shared-oauth-disconnect` — `node`

- `@jini-ai/user-management/mail/status/provider-operations` — `universal`

- `@jini-ai/user-management/mail/status/provider-tool-registrations` — `universal`

- `@jini-ai/user-management/mail/status/delivery-tool-registrations` — `universal`

- `@jini-ai/user-management/mail/status/tool-registrations` — `universal`

- `@jini-ai/user-management/members/tool-registrations` — `universal`

- `@jini-ai/user-management/newsletter/tool-registrations` — `universal`

- `@jini-ai/user-management/newsletter/delivery/tool-registrations` — `universal`

## Dependency and intake handoff

- `@jini-ai/cms`: `@jini-ai/diagnostics`, `@jini-ai/user-management`.

- `@jini-ai/devops`: `@jini-ai/platform`, `@jini-ai/integrations`, `@jini-ai/ui`, `@jini-ai/agent-plugins`, `@jini-ai/cms`, `@jini-ai/db`.

- `@jini-ai/user-management`: `@jini-ai/integrations`, `@jini-ai/platform`.

No intake, lockfile or install was performed. Several dependencies are type-only seams; provider/card/diagnostic implementations are passed by the host. No runtime Tovu or concrete daemon/server implementation import was added.

## Test declaration ledger

Across the 42 touched test files: **44 → 115 case declarations (+71), zero removed declarations**. This counts source `it`/`test` calls with callbacks, including each parameterized declaration once; it is not an executed or expanded runtime test count. Existing suite cases outside the touched files are unchanged.

| File | Before | After |
|---|---:|---:|

| `packages/cms/src/media/site-import/__tests__/tool-registrations.test.ts` | 5 | 6 |

| `packages/cms/src/media/site/__tests__/provider-credential-store.test.ts` | 3 | 4 |

| `packages/cms/src/media/site/__tests__/view-video-tool.test.ts` | 2 | 3 |

| `packages/cms/src/trash/site/__tests__/marker-adapters.test.ts` | 4 | 7 |

| `packages/db/src/recovery/__tests__/tool-registrations.test.ts` | 6 | 7 |

| `packages/integrations/src/vendor-credentials/__tests__/vault-adapter.test.ts` | 3 | 5 |

| `packages/integrations/src/web-screenshot/__tests__/capture-retention.test.ts` | 8 | 10 |

| `packages/platform/src/secrets/root-key/__tests__/reconcile.test.ts` | 9 | 11 |

| `packages/user-management/src/project-keys/__tests__/attachments.test.ts` | 4 | 5 |

| `packages/agent-plugins/src/lifecycle/__tests__/yauzl-special-refusal.test.ts` | 0 | 1 |

| `packages/cms/src/media/site/__tests__/blob-write-bindings.test.ts` | 0 | 2 |

| `packages/cms/src/media/site/__tests__/import-video-conversion.test.ts` | 0 | 1 |

| `packages/cms/src/media/site/__tests__/publish-content.test.ts` | 0 | 1 |

| `packages/cms/src/navigation/site/__tests__/publish-content.test.ts` | 0 | 1 |

| `packages/cms/src/pages/__tests__/html-recording-revert.test.ts` | 0 | 3 |

| `packages/cms/src/posts/__tests__/content-duplicate.post-page.test.ts` | 0 | 1 |

| `packages/cms/src/posts/__tests__/post.trashed-slug-release.test.ts` | 0 | 4 |

| `packages/cms/src/posts/sql/__tests__/revision-refs.test.ts` | 0 | 1 |

| `packages/cms/src/publish/content/__tests__/tool-registrations.test.ts` | 0 | 3 |

| `packages/cms/src/site-inspection/__tests__/tool-registrations.test.ts` | 0 | 1 |

| `packages/cms/src/taxonomy/site/__tests__/publish-content.test.ts` | 0 | 1 |

| `packages/cms/src/trash/permanent/__tests__/tool-registrations.test.ts` | 0 | 1 |

| `packages/cms/src/trash/site/__tests__/permissions.test.ts` | 0 | 1 |

| `packages/cms/src/widgets/site/__tests__/publish-content.test.ts` | 0 | 3 |

| `packages/devops/src/backup/site/__tests__/backup-service.test.ts` | 0 | 2 |

| `packages/devops/src/backup/site/__tests__/share-retention.test.ts` | 0 | 1 |

| `packages/devops/src/backup/site/share-database/__tests__/projection.test.ts` | 0 | 1 |

| `packages/devops/src/source-control/site/__tests__/credential-setup.test.ts` | 0 | 1 |

| `packages/devops/src/source-control/site/__tests__/store.test.ts` | 0 | 2 |

| `packages/devops/src/source-control/site/__tests__/tool-registrations.dry-run.test.ts` | 0 | 1 |

| `packages/devops/src/static-export/site/__tests__/site-exporter.test.ts` | 0 | 2 |

| `packages/diagnostics/src/redaction/__tests__/repo-secret-scan.node.test.ts` | 0 | 1 |

| `packages/integrations/src/media-providers/__tests__/generation-credentials.test.ts` | 0 | 3 |

| `packages/integrations/src/webhooks/site/__tests__/seal-aad-invariant.node.test.ts` | 0 | 1 |

| `packages/platform/src/secrets/root-key/__tests__/files.test.ts` | 0 | 2 |

| `packages/platform/src/secrets/root-key/__tests__/material.test.ts` | 0 | 1 |

| `packages/search/src/site/__tests__/media-search-source.test.ts` | 0 | 1 |

| `packages/user-management/src/mail/status/__tests__/registrations.test.ts` | 0 | 3 |

| `packages/user-management/src/member-login/__tests__/bundled-providers.test.ts` | 0 | 2 |

| `packages/user-management/src/members/__tests__/tool-registrations.test.ts` | 0 | 3 |

| `packages/user-management/src/newsletter/delivery/__tests__/tool-registrations.test.ts` | 0 | 4 |

| `packages/user-management/src/project-keys/__tests__/shared-oauth-disconnect.test.ts` | 0 | 1 |


## Final diff review / removals

- No tracked source or test file was deleted. No assertions, thresholds, measurement exclusions, capabilities, parser policies, theme content or feature exposure were removed.

- Removed incidental package-JSON Unicode reformatting, an added alias-table filler comment, and unused generated imports/type aliases. Reused the existing `OwnedTempRootScope` contract instead of duplicating its alias.

- Removed unused conversion repo/clock wiring after the existing derived-link collaborator became injected; removed an introduced optional environment-credential guard because the original reader returns a value. Removed a shadowed unused publish-retirement import and private exports that had no cross-file consumer.

- Removed host-only catalogs, product metadata/copy defaults, compatibility forwarding lines and concrete filesystem/provider/card implementations from the new engine modules where the sheet assigns them to injected host bindings. Why-comments moved with retained operations. No old Tovu path was replaced by a Jini re-export shell.

- Restored the original `normalizePublishAt` import during the post input review, corrected the private validation export modifier order, and kept repository-path imports on the pure leaf. Source import paths and declared exported names were read mechanically; no test/typecheck/linter was run.
