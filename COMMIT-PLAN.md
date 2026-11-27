# Y5 API — Jini half

Base: `7b30ee0920ac8c2c4f10ccaeca23aaad1a4ae6b0` (`codex/y5-apij`, `origin/codex/m25-tipj`). Initial working tree was clean. Everything remains in the working tree; this file must not be committed.

## Ordered coordinator commit plan

1. **Sheet A — agent-plugins:** Jini implementation written for all seven anchors. Automatic guidance state remains per factory; the connect implementation was split into owning leaves, preserving the existing `/connect` names. Shared upload effects and identity hooks are required. Memory containment remains a required per-operation input to avoid a host memory/lifecycle value-import cycle. Exports/source already owns the required behavior and is reused unchanged. Verification is pending Opus.
2. **Sheet W — webhooks:** source binding, live ordered keyring core, exclusive generation, and both configured scanners written. The constructor-binding ABI and ensure orchestration are stopped below; this is not a complete keyring replacement. Verification is pending Opus.
3. **Sheet H — admin-http:** eleven anchors implemented, including the structural overwrite reply port; preview rendering is stopped below. CMS uses structural publish ports and has no new devops import. Verification is pending Opus.

### A — agent-plugins files

- `.changeset/y5-api-agent-plugins.md` (created)
- `packages/agent-plugins/package.json` (changed)
- `packages/agent-plugins/src/connect/__tests__/host-deps.test.ts` (created)
- `packages/agent-plugins/src/connect/access-token-tool.ts` (changed)
- `packages/agent-plugins/src/connect/catalog.ts` (created)
- `packages/agent-plugins/src/connect/connect-tool.ts` (changed)
- `packages/agent-plugins/src/connect/contracts.ts` (created)
- `packages/agent-plugins/src/connect/grant-signed-in-defaults.ts` (changed)
- `packages/agent-plugins/src/connect/host-deps.ts` (created)
- `packages/agent-plugins/src/connect/import-access-token.ts` (changed)
- `packages/agent-plugins/src/connect/index.ts` (changed)
- `packages/agent-plugins/src/connect/installed-plugin.ts` (created)
- `packages/agent-plugins/src/connect/token-sign-in.ts` (changed)
- `packages/agent-plugins/src/site/__tests__/install-upload-update.unit.test.ts` (changed)
- `packages/agent-plugins/src/site/__tests__/y5-automatic-agent-plugins.test.ts` (created)
- `packages/agent-plugins/src/site/__tests__/y5-host-bindings.test.ts` (created)
- `packages/agent-plugins/src/site/__tests__/y5-install-upload.test.ts` (created)
- `packages/agent-plugins/src/site/automatic-agent-plugins.ts` (created)
- `packages/agent-plugins/src/site/install-tool.ts` (changed)
- `packages/agent-plugins/src/site/install-upload.ts` (changed)
- `packages/agent-plugins/src/site/memory.ts` (changed)
- `packages/agent-plugins/src/site/set-enabled.ts` (changed)

### W — webhooks files

- `.changeset/y5-api-webhooks.md` (created)
- `packages/diagnostics/src/redaction/__tests__/repo-secret-check.test.ts` (created)
- `packages/diagnostics/src/redaction/repo-secret-scan.node.ts` (changed)
- `packages/integrations/src/webhooks/site/__tests__/seal-aad-check.test.ts` (created)
- `packages/integrations/src/webhooks/site/seal-aad-invariant.node.ts` (changed)
- `packages/platform/package.json` (changed)
- `packages/platform/src/secrets/__tests__/exports.test.ts` (changed)
- `packages/platform/src/secrets/root-key/__tests__/y5-ordered-keyring.test.ts` (created)
- `packages/platform/src/secrets/root-key/__tests__/y5-sources.test.ts` (created)
- `packages/platform/src/secrets/root-key/material.ts` (changed)
- `packages/platform/src/secrets/root-key/ordered-keyring.ts` (created)
- `packages/platform/src/secrets/root-key/sources.ts` (created)

### H — admin-http files

- `.changeset/y5-api-admin-http.md` (created)
- `packages/cms/src/admin-http/routes/__tests__/y5-external-mcp.test.ts` (created)
- `packages/cms/src/admin-http/routes/__tests__/y5-peer-push.test.ts` (created)
- `packages/cms/src/admin-http/routes/__tests__/y5-plugin-install.test.ts` (created)
- `packages/cms/src/admin-http/routes/__tests__/y5-publish.test.ts` (created)
- `packages/cms/src/admin-http/routes/__tests__/y5-saved-keys.test.ts` (created)
- `packages/cms/src/admin-http/routes/__tests__/y5-settings-feed.test.ts` (created)
- `packages/cms/src/admin-http/routes/__tests__/y5-site-imports.test.ts` (created)
- `packages/cms/src/admin-http/routes/external-mcp/oauth.ts` (changed)
- `packages/cms/src/admin-http/routes/external-mcp/probe.ts` (changed)
- `packages/cms/src/admin-http/routes/external-mcp/route-helpers.ts` (changed)
- `packages/cms/src/admin-http/routes/plugins/install.ts` (changed)
- `packages/cms/src/admin-http/routes/publish-content/peer-transport.ts` (changed)
- `packages/cms/src/admin-http/routes/publish-content/route-helpers.ts` (changed)
- `packages/cms/src/admin-http/routes/settings/events.ts` (changed)
- `packages/cms/src/admin-http/routes/system/publish-credentials/list.ts` (changed)
- `packages/cms/src/admin-http/routes/system/publish-site/destinations.ts` (changed)
- `packages/cms/src/admin-http/routes/system/publish-site/trigger.ts` (changed)
- `packages/cms/src/admin-http/routes/system/site-imports.ts` (changed)
- `packages/cms/src/admin-http/routes/system/site-share-password.ts` (changed)
- `packages/devops/src/deploy/site/static-publish/__tests__/y5-admin-publish-bindings.test.ts` (created)
- `packages/devops/src/deploy/site/static-publish/admin-publish-read.ts` (changed)
- `packages/devops/src/deploy/site/static-publish/publish-run.ts` (changed)
- `packages/user-management/src/admin-http/owner/__tests__/y5-passkey-admission.test.ts` (created)
- `packages/user-management/src/admin-http/owner/passkey-routes.ts` (changed)

## Stopped steps and exact reasons

- **G0 / W ensure and H preview — NEEDS-OPUS source prerequisite.** The local Tovu `codex/m25-tip` and `origin/integ/merge-25-2026-11-25` both still resolve to `48f6802924`, which G0 expressly excludes. The connected GitHub read of merge-25's ensure file also returned the old `acbe363b2cff78ca308488f89c8fb51fb243a22b` blob. A final repaired source revision was not identifiable. No alternate type fix was invented. `root-key/ensure.ts`, its export, `y5-ensure.test.ts`, and the new preview renderer/test are therefore not built. No unrelated sheet was stopped.
- **W-keyring-ABI — NEEDS-OPUS contract clarification.** The mandated `bindSiteKeyrings({ hkdfSalt, readSourceMaterial, defaultEnv }, _optional = {})` has no input for the separately mandated host source descriptions, invalid-material refusal copy/error mapping, or default key ID. The constructor signatures must stay exact, and the host binding may only swap importer specifiers. Adding more factory inputs, attaching hidden properties to the reader, or hard-coding host wording would violate the dispatch. The lower-level `createOrderedSiteKeyring` and `createExclusiveSiteKeyGenerator` expose the specified injected effects; `bindSiteKeyrings` and its three constructors are not built. Keep the old host reader until the ABI is resolved.

## New direct export paths

- `@jini-ai/agent-plugins/site/automatic-agent-plugins` — node
- `@jini-ai/agent-plugins/connect/host-deps` — universal
- `@jini-ai/agent-plugins/connect/installed-plugin` — universal; use `resolveInstalledAgentPlugin` for the required parser hook; the existing `/connect` default resolver retains its old shape.
- `@jini-ai/platform/secrets/root-key/ordered-keyring` — node, lower-level operations only (constructor ABI incomplete)
- `@jini-ai/platform/secrets/root-key/sources` — node

Each has `types`, `import`, `default`, and a matching `jini.entries` entry. Existing scanner and admin route subpaths remain the owners. There is no ensure export pointing at a missing implementation.

## Tests written first; execution deliberately deferred

17 new named test files, 38 cases including the two `it.each` secret-history variants. Existing tests: no cases removed or weakened; the upload-update fixture now supplies the required injected effects. The platform export enumeration retains exact equality and now includes already-published baseline entries plus the two added root-key leaves.

- A: simultaneous attempts on one turn; late consent consumed once across a retry; after-answer revision refusal; stale preference CAS; disposed/cross-principal attempts; denied connect with an unread MCP getter; injected legacy credential-card reader; bad digest with zero streams; failed replacement cleanup before restoration; inactive trusted exports; sibling/active migration lock order; durable OFF before notification.
- W: frozen host HKDF vector (neutral test-local `HOST_SALT`); on-disk reread; first-invalid-source refusal; no raw key in status/failure; source order and safe IDs; blank env vs blank file; readers do not import ensure; scanner statuses, synthetic finding redaction, history-only finding, dirty-tip scan ordering, exact AAD pair and secret exemption triple.
- H: passkey mount/admission; early rate refusal; denied ZIP/form reads; close-triggered upload lane release; session-only owner gates; no secret lookup on saved-key denial; unavailable backend without incident; credential JSON before nonawaited heal; missing-consent publish refusal before start; selected credential projection to the injected run owner; settings cursor/preview revision isolation; live-site peer preflight; one safe unknown-error incident using the registered route template.

Named mutations (NOT executed):

1. `A-remove-choice-revision-recheck`: delete the after-answer `current.mode`/`current.revisionSeq` check in `site/automatic-agent-plugins.ts`. `y5-automatic-agent-plugins.test.ts`'s stale-consent case must reject before `saveAuto` or plugin-state publication; with the mutation it should fail.
2. `W-skip-invalid-first-source`: change `root-key/material.ts:firstPresentSiteKey` to continue after present invalid material. `y5-ordered-keyring.test.ts`'s invalid-first/valid-second case must fail (it asserts refusal and that the second source was never read).
3. `H-release-upload-only-on-success`: delete the `request.onClose` release in `createSiteImportUploadLane`. `y5-site-imports.test.ts`'s interrupted-upload case must fail when the next authorized request remains busy.

No tests, builds, installs, typechecks, linters, counter runs, or mutation runs were executed, per dispatch. No passing or mutation-killed claim is made. G0-dependent ensure/preview cases remain unwritten, rather than testing an invented replacement.

## Host integration contract and remaining work

No Tovu files were changed. All 24 host paths remain for the host half: 23 deletions and the reviewed preview binding. The host coordinator must do all named importer repoints, bindings, source/copy injection, launchers, G3 keeps, and the counter run. No −24 result is claimed.

- A: bind automatic list/rank/resolve/pointer/catalog/metadata/copy/warning effects and its existing consent adapter; rank receives `{ automatic: true }`. Connect binds required activation, installed resolution, MCP projection and host policy through `createAgentPluginConnectDeps`. Upload effects now include `parseManifest`, `readInstallIdentity`, `sha256`; supply the same identity policy to those and the lifecycle. `createAgentPluginUpload` binds required effects once; install registration requires `catalogModule`. Memory factory binds FS/lock/parser/warning ports, while each returned operation still requires containment. Use the persistent-state lock primitives directly. Bind `createSetAgentPluginEnabled` once per activation owner.
- W: use the configured source reader and scanners, preserving host source/path/metadata policy and reporting/exemption literals. Supply live reads and explicit directory/file modes to ordered operations. Do not cut over constructor importers until the stopped ABI is resolved; do not cut over ensure before G0.
- H: bind the neutral mount descriptors to existing JSON/raw/request adapters. OAuth mounts accept real request-dependency factories and early-gate continuations; browser headers precede the limiter/session gate, shared list has no mutation limiter. Plugin raw descriptors carry `{ type: "application/zip", limit, inflate: false }` and an admitted `readZipUpload` closure. The import registrar accepts request facts and socket/parser effects; its lane is per mount. Publish destinations builds real request-scoped specs/deps without placeholders, and resolves trust inside `mayReadPeers` after the registry read. Pass operation/step/log-prefix literals verbatim from the host. Preview stays blocked.

## Static review and function quality

Architecture audit: **INCONCLUSIVE** pending the forbidden executable checks and the three stopped steps. Manual diff/source review checked package dependency direction, direct export ownership, host-string neutrality in touched implementation, required effects, reader/writer separation, no framework import in the changed peer leaf, instance-owned maps, and the existing ordering contracts. No dependencies, intake flags, fallback layers, or suppression directives were added. The touched implementation files named by the size override remain below 500 lines (connect tool 457; automatic guidance 284; settings 338; peer transport 323; import routes 356; publish run 319).

| assessment unit | disposition | evidence / remaining limitation |
| --- | --- | --- |
| Automatic guidance and preference commit | INCONCLUSIVE | Source order retained; named mutation test written; no execution |
| Connect and installed reader | INCONCLUSIVE | Lazy descriptor-preserving binding and owning leaves reviewed; no typecheck |
| Upload, memory, enable binding | INCONCLUSIVE | Digest/lock/OFF/rollback cases written; no execution |
| Source/keyring/scanner operations | INCONCLUSIVE | First-present/reuse inspected; constructor ABI and ensure stopped |
| Admin request orchestration | INCONCLUSIVE | Admission/lifetime/incident cases written; preview source stopped |

Runtime self-validation and coverage measurement were not run because the dispatch prohibits execution. No quality or coverage success is inferred. Settings retains the same three timers and close cleanup; automatic maps retain the original explicit forget/late-answer lifecycle.

## Diff cleanup / deletions

- Moved the existing connect contracts/catalog/credential projection and installed resolver out of `connect-tool.ts`; removed their old definitions and obsolete imports, and repointed the four affected internal importers. No implementation was duplicated at the old path.
- Removed direct SHA-256 construction from the two upload/install-tool leaves in favor of the required effect.
- Removed the framework `Response` import and replaced its two overwrite-helper type uses with the required structural reply shape.
- Removed an initial duplicate metadata-ID projection and reused `material.readSiteMetaId` instead; removed unused split-stage destructures and an unnecessary guidance type assertion.
- Preserved the list admission principal read before query parsing and both directory-creation calls from the existing exclusive-generation composition.
- Corrected the source factory's local resolver binding to call the owning projection, restored eager capture of upload effects/actor before deferred publication, and preserved the default installed reader's input descriptors.
- Only necessary host-path wording in existing why-comments was made neutral. Existing why-comments moved with the extracted behavior. No test cases or source files were deleted.

## Resume

Coordinator: resolve the two source prerequisites and constructor ABI, then run the 17 new files, the existing touched package tests, the three mutations, package checks, and the Tovu cutover. No commit or push was performed; `.git` remained read-only.
