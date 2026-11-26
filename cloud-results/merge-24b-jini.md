__FIRSTLINE__

# MERGE-24b — Jini continuation (items 1, 2, 4 + Jini leftovers), 2026-11-26

Unattended cloud run on Jini `integ/merge-24-2026-11-25`. Opus coordinated (high effort) and read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5) first. 5 Opus-high subagents in total, at most 4 alive at once: test sweep part 1, J10 Email views, `fs-files/agent-tools`, J1a/J1c, and test sweep part 2. Tovu was read-only (the parallel Tovu run owns the Tovu gates). No codebase-memory tools, no RemoteTrigger, no `--no-verify`, no force-push, no tag or publish. `main`, `release/*` and merge-23 untouched.

**Start:** merged `origin/integ/merge-23-2026-11-25` (incl. `2c2961d56`, rename upgrade verifies only the ledgered current revision) into merge-24: `0ba3fd793`, no conflicts.

**Environment:** Node 22.23.5 (repo pins `~24`, so `RegExp.escape` tests are ENV), `pnpm install --frozen-lockfile` + `pnpm -r build` green on the merged tip. The machine ran at load ~10 with concurrent agents, so a few DB-dialect tests hit the 5 s default timeout; each passed alone or with `--testTimeout 30000` (classed ENV).

## Gates

| gate | before (merge-24 tip `1838a01ed` + merge-23) | after |
|---|---|---|
| `pnpm install --frozen-lockfile` + `pnpm -r build` | green | green |
| `pnpm guard` | **red, 55** (49 SI-domain + 6 from the content-analyzer phantom `@jini-ai/plugin-sdk` import: SI-resolution, L0, L1, L3, L5, HW2). The previous report counted 56; the merge-23 merge already removed one. | **0** (`[guard] ok`, self-test passed) |
| strict typecheck (`pnpm typecheck`: every package + scripts) | 0 | **0** |

## 1. Guard (continuation item 1)

**Content-analyzer (6 rows).** `cms/seo/content-analyzer-plugin/plugin.ts` now exports `createContentAnalyzerPlugin({ definePlugin, beforeSaveHook }, _optional = {})`, the same shape as `createWordCountPlugin`, plus a `readAnalyzerDraft` narrowing helper (a draft without a string title scores as untitled). It names no SDK module and no hook string. The ambient `plugin-sdk.d.ts` and the test's `fixtures/sdk.mjs` are deleted. Its types come only from `@jini-ai/core/contracts/plugin-sdk`, so cms gains no plugins edge. Test first (red: cannot load `@jini-ai/plugin-sdk`), 4 pins green. Mutations: `hardcode-before-save-hook` → red; `drop-title-narrowing` → red. The built output imports exactly one bare specifier, `@jini-ai/cms/seo/content-analysis`. Commit `72d41e833`.

**SI-domain (49 rows).** Each row was fixed by making an entry import the exact leaf it needs, or by classifying a pure leaf/flow where it belongs. Nothing was hidden with `$aggregate`, and no checker or baseline changed. Commit `d0d8f3928`.

| package | rows | change |
|---|---|---|
| admin | 3 | `screens/settings/rules.ts`, `AssistantDock/local-cli-selection-echo.ts` and `screens/plugins/resolve-composer-discovery-outcome.ts` are pure rules and join the existing `shared` list, next to their siblings `plugins/rules.ts` and `chat-package-kind.ts`. |
| plugins | 1 | `./runtime/widget-partials` renders through the host contribution registry, so its domain is `host`. |
| user-management | 1 | `./member-login/oidc-login` and `oidc-request` move from `server` to `members`, the same domain as `link-service` and `unlink-identity`: this is the member login flow. |
| db | 1 | `recovery/tool-registrations` imports `tools/restore-points.ts` directly instead of the transfer `tools` barrel. That leaf has only node:crypto and core messages as dependencies and is shared by recovery and transfer. |
| cookie-consent | 2 | `site/http` imports `contracts/policy.js` (already shared) and `server/receipt.js`, the universal receipt leaf, which is now shared, instead of the `policy` and `server` barrels. |
| cms pages + content-stats | 23 | Each module imports the exact leaf: `markers/marker`, `entry-refs-extractor`, `widget-slug-normalization` (now off the markers barrel), `entries/go-live` (already shared), `posts/post` (post model + port, only core deps), `media/content-type-sniffer`, `seo/html-plain-text` (already shared), and core `VERSION_CONFLICT_CODE` instead of the posts copy. The pure leaves joined `shared`. |
| cms site render | 18 | `content-html`, `page-body` and `components/marketing` move from `presentation` to `public-http`, the domain of their own directory and siblings. These pure render leaves are shared: `navigation/menu-render`, `taxonomy/render-entry`, `widgets/document-markers`, `media-attributes`, `markers/html-attributes`, `page-embed-types` and `forms/result-flash`. The server embed pipeline (`widgets/html/{html-embeds,plugin-export,legacy-widget-markers,server-fragment}`) is shared too: its closure is parse5 plus core. **`page-body` is reclassified `universal` → `node`**, because it really does reach parse5 through embed substitution; the 4 "forbidden runtime import parse5" rows were a true runtime misdeclaration. |
| cms media | 1 | The pure widget payload envelope (`WIDGET_PAYLOAD_FIELD`, `build/parse` for both instance and area) moves from `widgets/entry-payload.ts` into a new leaf, `widgets/payload-fields.ts`. The `@jini-ai/cms/widgets` barrel still exports it, and every importer was repointed. No shell is left behind. |

Verification: cms `tsc` is 0. The widgets/pages/posts/media-site/render tests ran 1094: 1091 pass plus 3 ENV (one `RegExp.escape`, two pglite 5 s cold-start timeouts under load ~10, which pass with `--testTimeout 30000`). cms `subpath-isolation.contract` (NEW red in merge-24) now passes.

## 2. agent-plugins R03 identity tests (continuation item 2)

The 3 tests were `manifest-extensions` "projects declared companion names…", `commerce-manifest` and `log-safety-c` "retains precise declaration refusals…". All three now pass the host read policy (`legacyIdentity: { namespace, warning }`) explicitly. The manifest-extensions test gained a pin: without a policy, the legacy key is not portable metadata. Mutation `legacy-read-by-default` (an implicit legacy namespace in `resolveAgentPluginIdentityNamespace`) turns that pin red. Commit `34eb182ff`.

## 4. `vitest --changed origin/integ/merge-23-2026-11-25` sweep (continuation item 4)

Per package, one heavy job at a time. ENV means Node 22 `RegExp.escape`, load timeouts that pass alone, or sandbox networking. OLD means the test and the code it covers are unchanged since merge-23.

| package | files | pass | fail | ENV | OLD | NEW | NEW fixed (sha) |
|---|---|---|---|---|---|---|---|
__CMSROWS__
| daemon (merge-24 run, no change since) | – | 4892 | 0 | – | – | – | – |
| ui | 681 | 9017 | 8 | 0 | 0 | 8 | 8 (`79621e229`, `220d05075`) |
| admin | 618 | 6479 | 8 | 0 | 2 | 6 | 6 (`8f3650de6`, `e283e2112`) |
| user-management | 218 | 2027 | 6 | 0 | 2 | 4 | 4 (`db0782a78`, `5d0f50c93`, `56aa28fa6`, `b517e376d`) + runtime-entry drift (`efc9539e7`) |
| devops | 179 | 1981 | 5 | 4 | 0 | 1 | 1 (`45e2de6e7`) |
| integrations | 139 | 2332 | 2 | 1 | 0 | 1 | 1 (`01c374e02`) |
| db | 133 | 1115 | 1 | 0 | 0 | 1 | 1 (`b2446baf0`) |
| core | 267 | 3223 | 3 | 0 | 3 | 0 | – |
| plugins | 96 | 1116 | 0 | – | – | – | – |
| cookie-consent | 38 | 287 | 0 | – | – | – | – |
| chat | 350 | 4769 | 7 | 0 | 0 | 7 | 7 (`2a2853e42`) |
| agentic | 75 | 1238 | 2 | 0 | 0 | 2 | 2 (`e54ce0fe7`) |
| mcp | 125 | 1982 | 0 | – | – | – | – |
| commerce (+ kernel config) | 4 + 75 | 12 + 1428 | 0 | – | – | – | – |
| platform | 203 | 3522 | 3 | 0 | 1 | 2 | 2 (`cf692ff30`), plus the OLD one (`26a17bf62`) |
| vibecoding | 24 | 364 | 0 | – | – | – | – |
| http-kit | 57 | 877 | 2 | 0 | 2 | 0 | – |
| diagnostics | 91 | 1280 | 11 | 11 | 0 | 0 | – |
| desktop-host | 123 | 1043 | 0 | – | – | – | – |
| analytics | 26 | 294 | 0 | – | – | – | – |
| infra | 22 | 185 | 0 | – | – | – | – |
| agent-runtime | 218 | 4733 | 12 | 0 | 12 | 0 | – |

**What the NEW reds were:**
- **jsdom asset URLs (ui ×8, admin ×3).** Vite rewrites `new URL('x.css', import.meta.url)` to `http://localhost`, so the tests now read by path.
- **Stale class selectors** after the `jini-*` rename (admin, user-management, chat). The old negative assertions passed vacuously; they now query the real classes.
- **Untyped `_optional = {}` args** (user-management public-args, ~18 files plus react/mail).
- **A hosting-vendor name in a devops comment.**
- **An integrations vault test** that seeded an attempt row without the payload the store always writes.
- **db:** 4 new subpaths had no import-alone probe, and 3 lacked `typesVersions` (37 → 40 tests).
- **agentic:** the react/skills test JSX compiled to the classic runtime, fixed with `esbuild.jsx: automatic`, as db and integrations already do.
- **platform:** a duplicated `./secrets/root-key/reconcile` export, and 3 new subpaths missing from the export pins.
- **user-management:** the runtime-entry drift is fixed. kysely SQL repos and the node-reaching member-login entries are pinned `node`. `identity/sql/user-trash-adapter` uses only contracts, so it is now `universal`. Mutation `sql-repo-declared-universal` turns the pin red.

**Remaining reds (none NEW):**
- **admin `theme-boundaries` (OLD):** the `email.css:72` `#fff` fallback.
- **admin `AlwaysAllowPanel` (OLD):** the accessible name is only "Revoke".
- **user-management `user-management-rename.contract` (OLD):** an exhaustive entry snapshot frozen at 95 entries; 139 exist now.
- **core `provider-neutral` ×3 (OLD):** a vendor keyword in tool metadata, and a wrong factory-probe shape.
- **http-kit `http-error-log-redaction` ×2 (OLD):** daemon scheduler, server shutdown, mcp federation.
- **diagnostics web-evidence ×11 (ENV):** `RegExp.escape`.
- **agent-runtime `loads-without-integrations` ×11 (OLD):** the fixture omits `smol-toml`.
- **agent-runtime `connection-guard` ×1 (OLD/ENV):** sandbox socket hang up.
- **cms:** see the cms row above.

## 8. Jini leftovers

| item | status | details |
|---|---|---|
| p11rest **J1a** (journal-eligibility writer binding) | **built (dark, optional ports)** | Core `contracts/blob-gc`: `BlobJournalRole`, `BlobJournalIdentity`, `BlobJournalEligibility.clearForKeys({ workspaceId, storageKeys })`. Every writer clears eligibility for the key it claims, after the owner row is active: upload, dedup hit, tombstone resurrection, rendition save, import (existing and new row) and file replacement. Commits `01ac2d61e`, `8075007ee`, `6221bd2fe` (design note in `cms/src/media/site/README.md`). |
| p11rest **J1c** (rendition digest + journal/provenance contract) | **built (dark)** | `AssetRenditionRecord.sha256?` is the rendition's own digest (the passthrough row gets the source digest). The cleanup journal input adds an explicit `reason` (never inferred), `renditions` (derived keys, each with its own digest, minus the original's key) and `unverifiedRenditionKeys` (reported, never journaled). The pure rules `planRenditionJournal` and `classifyJournalEntry({ entry, storageKeyFor }, { allowTrashTtl = false })` keep by default. Keep reasons are legacy-no-reason, unknown-reason/role, invalid-digest, key-digest-mismatch, upload-rollback and trash-ttl-disabled. 13 named mutations, all red: M11-journal-stamps-original-for-rendition, -no-passthrough-dedup, -unverified-journaled, -legacy-reason-eligible, -trash-ttl-default-on, -rollback-as-owner-purge, -key-digest-unchecked, -no-eligibility-clear-on-dedup, -clear-before-ownership, -rendition-digest-dropped, -rendition-no-eligibility-clear, -import-no-eligibility-clear-on-new-row, -replace-no-eligibility-clear. cms media is 748/748 (13 new). |
| J1 **remaining** | **left** | (1) Making `journalEligibility` and `cleanupJournal` REQUIRED on durable bindings: a major change that needs fakes in every fixture. (2) `kind`/`reason` on cms `BlobGcJournalEntry`, which must land together with Tovu T1 (Tovu's `HostBlobGcJournalEntry` uses `"manual"`). (3) Original provenance at the tombstone transition (`AssetBlobRecord` has no `purgeReason`). (4) `createBlobGc` (delete/unlink/`unlinkIfUnowned` passes, probes, retry state), `withAsset` around purge with the generation re-check, fencing the rendition, replacement and upload writers (they still use the process-only `withSha256Lock`), and `verifyStoredBlob` on them. (5) **Open owner decision OQ-11a:** a durable rendition digest via a new nullable `sha256` rendition column (new migration, not an edit to 0048), or derive it from the canonical key. Until then, persisted legacy rows report as unverified. |
| p4mounts **J3a/J3b** | **listed, not built** | Both are breaking Jini sheets whose prerequisite is the reviewed **Tovu T-GATE** (`errors` becomes mandatory in the 42 Tovu wrappers). Applying them first would reject still-unbound Tovu mounts, so the gate is needed for the Jini code itself. |
| ext-a **J10** Email views → `@jini-ai/user-management/react/mail` | **built** | `email-view.types.ts`, `Email.tsx`, `EmailProviderTab.tsx`, `EmailSegments.tsx` (internal) and `EmailTemplateEditor.tsx`. Ports are injected and hooks are required props; `useEditorKeysHook` is an optional prop that defaults to the built-in one, because a direct call failed hook-injection. 4 `browser` leaves, changeset `admin-extraction-10.md` (minor). 16/16 tests. Mutations, all red: M-reveal-provider-key-in-status, M-preview-marks-unsaved-template-saved, M-ignore-part-prop, M-navigate-drops-part, M-unknown-tab-navigates, M-eager-tab-hooks, M-drop-status-facts. Sheet deviations: `shownProviderId({ providers, selectedId, isFullyActive })`; the template editor is generic over the device type `D`; editor port types are narrowed to the real admin shapes; `EmailLoadedProps.retry?: () => void`. Commits `9ea261c50`, `929b2d55b`, `27ac4864a`. |
| ext-w1 **`@jini-ai/cms/fs-files/agent-tools`** (for T18/T19) | **built** | Universal. Exports the tool IDs, canonical `FS_FILES_READ_PERMISSION`, `FS_WRITE_LIMITS` (moved here from the node `write-files`, which imports and still exports it) and `getFsFilesAgentToolCatalog({ rootIds, rootDescriptors, maxFileBytes }, _optional = {})`; the root enum and descriptions are built per call. Pin "root enum and descriptions come from the selected host"; mutation `hardcode-roots` → red. Commit `e3aa865f0`. J12's second bullet (`cms:trash/permanent/tool-registrations`) does **not** exist on the branch and is **left**. |
| API baselines | **done once at the end** | `pnpm api:update`: __APISHA__ |
| changesets | added | `merge-24b-content-analyzer-factory.md` (cms **major**: the content-analyzer default export is gone), `merge-24b-blob-journal-provenance.md` (core + cms minor), `merge-24b-isolation-domains.md` (patches). Commit `700dbd51f`. |

## Tovu-side changes the Tovu run must make (exact)

**T-a. Content-analyzer worker entry (guard item 1).** The cms plugin is now a factory, so Tovu owns the tier-2 worker entry.
1. New file `apps/website/src/features/plugin-runtime/built-ins/content-analyzer/plugin.ts`:
   ```ts
   import { definePlugin, HOOK_CONTENT_ENTRY_BEFORE_SAVE } from "@tovu/sdk"; // resolved inside the worker by the tier-2 SDK resolver
   import { createContentAnalyzerPlugin } from "@jini-ai/cms/seo/content-analyzer-plugin/plugin";
   export default createContentAnalyzerPlugin({ definePlugin, beforeSaveHook: HOOK_CONTENT_ENTRY_BEFORE_SAVE });
   ```
   Do not import `pluginHostBinding`: it pulls server modules into the worker.
2. In `.../content-analyzer/index.ts:92`, replace `import.meta.resolve("@jini-ai/cms/seo/content-analyzer-plugin/plugin")` with this folder's own entry: `realpathSync(fileURLToPath(new URL(\`./plugin${path.extname(fileURLToPath(import.meta.url))}\`, import.meta.url)))`. That is `plugin.ts` under tsx and `plugin.js` in dist. Keep `importModule` refusing.
3. In `.../content-analyzer/__tests__/unit/plugin.unit.test.ts:33`, load `default` from the new local entry, after `registerPluginSdkResolver()`. Load `buildContentAnalyzerPatch` and `readMetaDescription` from `@jini-ai/cms/seo/content-analyzer-plugin/plugin`; both are still exported. The hook-name assertion stays `content.entry.beforeSave`.
4. Make sure the Tovu packaging/size gates include the new entry file in the built `dist`.

**T-b. R03 read policy (item 2; verify).** Jini reads a legacy manifest key only when the host passes `legacyIdentity`. Tovu passes none today (`git grep legacyIdentity` is empty). Define one host constant, `{ legacyIdentity: { namespace: "tovu", warning: "<existing deprecation copy>" } }`, and pass it as the options to:
- `parseAgentPluginManifest` in `features/agent-plugins/exports/source.ts:35`, `install-upload.ts:137` and `memory.ts:26`
- the `parsePluginCredentialCards` / `readAgentPluginPortableExtension` callers

Do this wherever installed manifests that only carry `extensions.tovu` must keep loading.

**T-c. fs-files catalog (T18/T19 prerequisite).**
- Delete `apps/website/src/features/fs-files/agent-tools.ts`.
- `features/fs-files/tool-registrations.ts:16-21,44`: import the IDs and `getFsFilesAgentToolCatalog` from `@jini-ai/cms/fs-files/agent-tools`. Add one host binding, `getFsFilesAgentToolCatalog({ rootIds: FS_ROOT_IDS, rootDescriptors: FS_ROOT_DESCRIPTORS, maxFileBytes: MAX_FS_FILE_BYTES })`, with the first two from `./layout.js` and the last from `./fs-files.js`, and use it for `CATALOG_BY_ID`.
- Repoint `FS_FILES_READ_PERMISSION` to the new subpath in `asset-transfer/asset-sources.ts:10`, `asset-transfer/copy-tool.ts:15`, `image-transform/tool.ts:6` and `server/inbound/admin-http/routes/fs-files/custom-root.ts:3`.
- Tests: `fs-files/__tests__/tool-registrations.test.ts:9` (calls at :62, :63, :78, :85) and `assistant/__tests__/tool-registrations.contracts.test.ts:42` (:360) call the host binding instead of the argument-less catalog.
- Docs: `tool-registrations.ts:217` `catalogModule`, and the comment at `composition/tool-catalog-manifest.ts:370`.

**T-d. T10 Email mount (consumes J10)**, in `apps/admin/src/features/email/`:
- New file `email-panel.tsx`:
  - `HostEmailTypes` = `{ status: AdminMailStatus; provider: MailProviderConfiguration; choice: AdminAgentPluginRow; overview/sender/templates/activity controllers }`.
  - `TAB_HOOKS` = the five `useWiredEmail*` hooks.
  - `PARTS` = `{ Overview, Sender, Activity, Templates }` tabs.
  - `KIT` = `{ TabBar, Segmented: ChatSettingsSegmented, Chip, Section, Loaded, StatusFacts }`, where `StatusFacts` renders `SenderDomain` from `status.senderDomainVerification`.
  - `RULES` = `{ summarize: emailSummary, isFullyActive, when, providerLabel: createEmailProviderLabel, displayName: agentPluginDisplayName }`.
  - `COPY` = `{ t, navLabel: translateAdminNavLabel }`.
  - `navigateEmail({ tabId, part })` → ``navigate({ routePath: part === null ? `/email?tab=${tabId}` : `/email?tab=${tabId}&p=${encodeURIComponent(part)}` }, { replace: true })``.
  - `EmailPanel` = `<Email<HostEmailTypes> … useEmailHook={useWiredEmail} tabHooks parts kit copy rules navigate useAdminThemeBoundaryHook />`.
  - `EmailTemplateEditorPanel` = `<EmailTemplateEditor hooks={{ useEditorHook: useWiredEmailTemplateEditor, useAdminLocaleHook, useEmailTemplateViewHook, useTabBarKeyboardHook, useDirtyGuardHook }} kit={{ Icon, Chip, Loaded, DevicePreviewFrame, DevicePreviewToggle, devicePreviewWidths: DEVICE_PREVIEW_WIDTHS, previewSandbox: PAGE_PREVIEW_IFRAME_SANDBOX, adminBase: ADMIN_BASE, adminHref }} copy={{ t, pageEditorT }} resolveTabIndex={resolveTabBarTabIndex} />`.
  - Keep the CSS side-effect imports in this file.
- `index.ts` re-exports `EmailPanel as Email` and `EmailTemplateEditorPanel as EmailTemplateEditor`.
- Tests:
  - `EmailTabs.unit.test.tsx`: add `isFullyActive` to every `shownProviderId(...)` call.
  - `EmailTemplateEditor` and `email-controller` helpers: switch to the Jini types.
  - New `email-panel.binding.unit.test.tsx`: navigate gets `/email?tab=sender&p=a%20b` with `{ replace: true }`. Mutation: drop `encodeURIComponent`.
- Delete Tovu `Email.tsx`, `EmailProviderTab.tsx`, `EmailSegments.tsx` and `EmailTemplateEditor.tsx` once `git grep` is empty. `/email` must be inside `UserManagementKitProvider` (`SecretInput`, `ConfirmDialog`).

**T-e. T1 blob journal binding (consumes J1a/J1c; keep sweeps off).**
1. Build `journalEligibility.clearForKeys({ workspaceId, storageKeys })` on the content-kernel transaction: `DELETE FROM blob_gc_journal WHERE workspace_id=? AND storage_key IN (…)` and `UPDATE asset_blobs SET purge_reason=NULL` for those keys. Return it from `bindSiteBlobWritePorts` and pass it to:
   - `uploadMedia` (every writer)
   - `resolveMediaRendition` (`server/inbound/public-http/routes/site/media-rendition.ts:509`)
   - `importMediaEntity`
   - `replaceMediaFile`
2. Persist and read `AssetRenditionRecord.sha256`. This needs a **new** migration after OQ-11a is decided; never edit 0048.
3. Change the `cleanupJournal` bindings (`permanent-delete-deps.ts:229`, `trash-adapters.ts:84`, `features/forms/form-file-purge.ts:56`):
   - Journal one entry per `input.renditions[i]` with `kind="rendition"`, its own `sha256` and `input.reason`.
   - Skip the entry when there is no reason.
   - Report `unverifiedRenditionKeys`.
   - Forms keeps using `storageKeys`.
4. Pass `reason: "owner-purge"` (confirmed permanent delete) and `"trash-ttl"` (trash expiry) into `purgeMedia`.
5. `platform/db/repos/blob-gc-journal.ts`:
   - Map persisted `manual` to `owner-purge`.
   - Accept `upload-rollback` as not eligible.
   - Remove the hash-wide `UPDATE asset_blobs SET purge_reason` at `:60`.
   - Classify with `classifyJournalEntry` (default `allowTrashTtl: false`) before any unlink; unlinking stays report-only.

**T-f. No action, for awareness.**
- `@jini-ai/cms/public-http/http/site/render/page-body` is now runtime `node`. Tovu imports `renderHtmlPageBody` only from its own server path.
- `@jini-ai/cms/widgets` still exports the widget payload helpers; Tovu imports no `widgets/entry-payload` subpath.
- `@jini-ai/user-management/identity/sql/user-trash-adapter` is now `universal`.
- `@jini-ai/user-management/member-login/{oidc-login,oidc-request}` isolation domain is `members`; runtime is unchanged (`node`).

## Continuation (exact)
__CONT__

