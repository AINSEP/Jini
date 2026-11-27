# w3b-ext-w2a — Jini working-tree delivery

Spec: supplied w3b-ext-w2a plus approved round-2 fixes; Y1/Y3 override older P0/duplicate text.
HEAD: 7ccdb01e97c9192b3bf076b76a5a054eb9ffa267 (codex/r2-ext-w2aj).
Source: Tovu 724ddc31a; named source lengths match all reviewed anchors.
No subagents, Git writes, installs, tests, builds, typechecks, linters, or generators.
Pattern: approved sheet object signatures and existing package implementations; no separate seed approval required by this complete dispatch.
Tests are authored before each implementation; execution/mutation verification and API baseline generation belong to Opus.

## Completed design commits (in order)
1. J10 — media credential set/vault/memory writer. Created packages/cms/src/media/site/provider-credential-{store,vault,store.memory}.ts, four named test files in media/site/__tests__, .changeset/w3b-w2a-j10.md; changed packages/cms/package.json. API baseline: Opus regenerates api-baseline/jini-ai__cms.json. Mutations: compare-revision-before-writer; fallback-after-canonical-open-fails; copy-legacy-envelope; unlock-before-batch; trust-row-owner-key. Host must supply vaultPolicy, withWrite, builtInProviderIds, sha256Hex, credentialPolicy, credentialInputMessage, storageMessage, createVault. J10/T10b precede ext-w1 J23/T19.

2. J11 — daemon owner-scoped attachment reader. Created packages/daemon/src/http/attachment-owner-read.ts and http/__tests__/attachment-owner-read.test.ts; changed http/index.ts; created .changeset/w3b-w2a-j11.md. Existing ./http export/runtime stays Node; baseline: Opus regenerates daemon. Mutations: treat-missing-owner-as-unscoped, skip-open-handle-identity, skip-pre-open-observation. Placement is the approved daemon override; only filesystem ports are injected. No CMS reader export.

3. J12 — promotion/Library. Created cms/src/media/site/{promote-chat-attachment,library-save-attachment}.ts and __tests__/attachment-tools.test.ts; changed cms/package.json; .changeset/w3b-w2a-j12.md. Baseline: CMS, Opus. Mutations: trust-declared-mime; accept-any-run-attachment-ref; encode-before-byte-check. Host must bind the original Library description, canonical attachment rejection, encoding, lazy store, per-message refs, registered upload handler and deps.refuseUnexpectedKeys (Y1 positional ABI).

4. J13 — video catalog/preview. Created cms/src/media/site/view-video-tool.ts and __tests__/view-video-tool.test.ts; cms/package.json; .changeset/w3b-w2a-j13.md. CMS baseline pending Opus. Mutations: authorize-by-blob-creator; skip-sheet-byte-ceiling. Host binds catalog({ mediaAssetReadToolId }), extractor, readAttachment and prepareImages; no daemon dependency.

5. J17 — newsletter lifecycle. Created user-management/src/newsletter/{confirmation,subscriptions}.ts and __tests__/{confirmation,subscriptions}.test.ts; user-management/package.json; .changeset/w3b-w2a-j17.md. Baseline pending Opus. Mutations: supersede-before-resolving-sender; save-subscribed-before-consent; persist-unsubscribe-before-revoke; accept-weak-minted-token. Host binds resolveFrom, mintRawToken and hashToken; fixed sender→supersede→mint ordering retained, 64-lowercase-hex validation added exactly as approved.

6. J19 — HTML store. Extended core/src/contracts/site/page-html-store.ts with PageHtmlInverse/restore only. Created cms/src/pages/html-document-store{,.memory}.ts, __tests__/html-document-store{,.memory}.test.ts; cms/package.json and .changeset/w3b-w2a-j19.md. Existing core subpath unchanged. Baselines: core/CMS, Opus. Mutations: check-equality-before-version; record-pre-conversion-outside-transaction; normalize-restore-body; drop-workspace-from-memory-query. Host supplies PageHtmlStatements plus reportUnindexedRef/restoredEntryRefs to both compositions.
7. J20 — page catalog/handlers and region/recording contracts. Extended core page-html-store; created core html-region-ports; moved vibecoding public types (html/{regions,edit,index}.ts and html/node/{index,parse5-region-parser}.ts and html/__tests__/regions.test.ts type import). Created cms pages/{agent-tools,tool-registrations}.ts plus the explicitly authorized read/full-write/region-write splits tool-registrations.{read,write,regions,shared}.ts, and __tests__/tool-registrations.test.ts. Updated core/CMS exports; .changeset/w3b-w2a-j20.md covers core/CMS/vibecoding. Baselines all three pending Opus. Mutations: use-content-write-for-region, skip-permission-on-full-write, read-again-before-cas, always-return-change-set-id. Host supplies catalog, editHtmlPermission, regions, readTheme and recordWrite. Recorder/gateway/theme implementation stays host-owned.

8. J21 — plugin install sources. Created core/src/contracts/headless/plugin-install-source.ts and plugins/src/runtime/install-source.ts, runtime/__tests__/install-source.test.ts; both package manifests; .changeset/w3b-w2a-j21.md. Baselines: core/plugins, Opus. Mutations: try-local-path-after-attachment-refusal; skip-post-read-ceiling; skip-absolute-path-check; allow-attachment-for-folder; skip-pre-read-ceiling. Host owns filesystem/default test overrides and exact messages; no archive extraction added.

9. J22 — word-count hook. Created plugins/src/runtime/built-ins/word-count/plugin.ts and __tests__/plugin.test.ts; plugins/package.json; .changeset/w3b-w2a-j22.md. Baseline: plugins, Opus. Mutation use-module-default-hook-id. Host binds its existing SDK definePlugin/beforeSaveHook; manifest and runtime source remain Tovu-owned.

10. J23 — analyzer worker entry. Created cms/src/seo/content-analyzer-plugin/{plugin.ts,plugin-sdk.d.ts,__tests__/patch.test.ts,__tests__/fixtures/sdk.mjs}; cms/package.json; .changeset/w3b-w2a-j23.md. CMS baseline pending Opus. Mutation synthesize-empty-meta-description. Built-output witness asserts exactly @jini-ai/plugin-sdk and @jini-ai/cms/seo/content-analysis; isolated child registers the existing virtual-SDK resolver before importing the built worker. No runtime SDK package/dependency added. Host T23 must realpath the installed entry once and use that exact path for sourceDir/entry/trust.

11. J25 — post catalog. Created cms/src/posts/agent-tools.ts and __tests__/agent-tools.test.ts; cms/package.json; .changeset/w3b-w2a-j25.md. CMS baseline pending Opus. Mutation hardcode-host-tool-reference. Six definitions preserve order; factory takes editGuidance, featuredImageSchema, postIdSchema, tiptapDocSchema, copy. copy fields: contentPostRead, navigate, menuRead, updateMenuTree, fetchPublishedPage, postPreview, trashRestoreItem. Build before w2b 64.

12. J26 — content statistics. Created cms/src/posts/content-stats-tool.ts and __tests__/content-stats-tool.test.ts; cms/package.json; .changeset/w3b-w2a-j26.md. Baseline: CMS, Opus. Mutations count-family-before-auth; always-sniff-stored-media. Host uses buildContentStatsRegistrations({ deps }) / contributeContentStatsTools() directly, preserving route authorization and separate contributor.

## Verification limitation
- J23 undeclared-dependency check deferred to Opus under dispatch command ban; add a narrow virtual-SDK allowlist entry only if that check flags cms.
- J11 skip-sidecar-dirname-containment cannot be killed by ordinary input: CHAT_ATTACHMENT_REF_PATTERN excludes path separators and chatAttachmentSidecarFileName replaces every non-alphanumeric/hyphen before resolve. The second containment guard is retained verbatim. No fabricated path mock/static source assertion was added to pretend that this mutation is reachable; Opus must resolve that pin.

## Stopped
- J24: literal approved fix says actor stays on CreatePostOptional, citing source :52; pinned source has actor?: MutationActor | undefined on CreatePostInput at :52 and CreatePostOptional is empty (:103). Applying that literally would relocate/change the existing ABI. Stopped rather than redesigning; original actor check also remains input.actor.
- J18: required ext-crp CRP-02 has not landed in this checkout: packages/daemon/src/surface-exchanges/human-confirm.ts is absent. Core HumanConfirmSpec exists, but the required lifecycle prerequisite is not present. No partial registrar exported.
- J16: prerequisite w3b-arch #33 is absent. packages/cms/src/publish/content/repo-handler.ts ends at createRepoPublishHandler and has no applyRunActor. packages/cms/src/core/mutation-actor.ts has checkedMutationActor only, no requiredMutationActor. Do not invent the missing actor seam or move the pre-actor contributor.

## Left
- J14/J15 (and T14/T15): REJECT (w3b-ext-w1 owns import/generation); preserve mutations read-source-before-permission, return-raw-egress-message, ignore-content-type-write; catch-open-as-absent, use-built-in-only-model-list, skip-post-dispatch-abort in that owner.
- All T sheets: Tovu-only, outside this dispatch.

## Boundaries / audit checklist
- CMS depends on core contracts; host vault, locking, entropy, validation, vocabulary, filesystem and confirmation binding are injected as specified.
- J11 owns reader in daemon/http and reuses the sidecar constant and identity matcher directly.
- Existing core page-html-store is extended, never redeclared.
- J23 virtual SDK and bare CMS self-reference remain exact.
- No existing tests weakened/deleted; no coverage/config exclusions.

## Final diff deletions
Removed incidental manifest reserialization changes (Unicode escapes, unrelated indentation, and collapsed pre-existing duplicate keys). Removed copied unused split imports; shared existing page functions moved into tool-registrations.shared.ts to avoid runtime cycles and unintended public exports. No existing behavior/tests deleted.


## Review handoff
- Authored 36 new test declarations in the named witnesses (before implementation); existing assertions unchanged. No executions, mutation runs, generators or pass/coverage claims.
- 12 additive minor changesets; no release versions changed. API baselines are deliberately untouched for Opus.
- Architecture audit: WARNING — implementation is reviewable but compilation, runtime witnesses, dependency guards and API surface validation remain unverified under dispatch restrictions. The J11 unreachable mutation is explicitly unresolved above.
- Test seam / behavior review: vault policy + synchronous replacement planner + serialized publication; descriptor observation and final identity; delegation/membership/encoding guards; video creator ownership and output limits; newsletter sender/consent/revoke ordering; scoped HTML statement transactions/CAS/verbatim restore and injected writer permission/recorder; bounded source reads; injected SDK hooks; analyzer scalar patch; post vocabulary; permission-scoped stats.
- Function review: existing statement/effect order retained except explicit injected ports and approved hex checks. No new wrappers, fallback behavior, dependency installation, approval transport, SQL implementation or theme runtime added. No quality-gate pass is claimed without execution.
- Self-validation not run: dispatch expressly prohibits tests/builds/typechecks/linters. Opus owns that verification checkout and all named mutation runs.
- Final scope review: Jini only; .git read-only; no subagents; all requested Jini sheet IDs accounted for as built, stopped or rejected. H2 actor/migration work has no executable Jini sheet in this supplied set; J16 waits for the named arch prerequisite rather than inventing it here.
