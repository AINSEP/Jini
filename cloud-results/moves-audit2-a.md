# moves/audit2-a — rows A01, A10, A66, B07, B23, B29

Base: `integ/wave-b` in both repos. Branch `moves/audit2-a` (Jini and Tovu). Node 24.11.1, pnpm 10.33.2.
Tests: Jini `npm run test` per package; Tovu admin `npx vitest run --maxWorkers=2` (vitest 4 has no `--minWorkers`); Tovu website `node --test --test-concurrency=1` (needs `packages/{contracts,sdk}` built with `tsc`). Tovu linked to this Jini checkout with `link-jini.mjs` (untracked).

Baseline noise on the unmodified base, same before and after my commits: Jini `pnpm -r build` fails in http-kit, admin, capability-providers, chat, cms and others (test-file type errors; `dist` still emits). Tovu admin: 83 failed tests in 19 files for A01's scope and 231 failed in 27 files for A66's scope, all `@jini-ai/admin screens need <AdminKitProvider>`. Identical failing-file lists on the parent commit (worktree run) and on mine. Jini: `platform/exports.test`, `cms analyzeEntry` and `ui` tsc test errors fail on the base.

| Row | Status | Jini | Tovu |
|---|---|---|---|
| A01 | DONE (partial, per-file skips below) | none needed | 7756ba36 |
| A10 | DONE (3 of 5 formatters; 2 skipped) | 6f8dc8c2 | c15b046d |
| A66 | DONE for the admin glyphs; desktop SKIPPED | 070ba2cd | 68d52de7 |
| B07 | DONE (Jini only) | ab0ef93c | none |
| B23 | DONE | adbfa96c | 3af84dcc |
| B29 | DONE | dc1059c8 | c434690b |

## A01 sheet (Tovu wrappers to existing Jini exports)
Census per file (rg over `apps`, ts/tsx/json/md; no baseline json lists these paths):
- `hooks/use-focus-trap.hooks.ts` (forwarder to `@jini-ai/ui/panel-kit` `useFocusTrap`, same signature): 5 importers + 1 test. Deleted; importers and the test import `@jini-ai/ui/panel-kit`.
- `features/database-transfer/sqlite-source.ts` (forwarder; `{ bytes, open }` became `({ bytes }, { open })`): 3 type/value importers, 5 test files, 1 composition file, `parity-harness.ts` (loads the file by path for the current tree; now `import("@jini-ai/db/transfer")` when `root === CURRENT_SRC`, still loads the old-snapshot path otherwise). Deleted; every call converted to the two-argument form.
- `agent-plugins/service-ports.ts`: dropped the pure type re-exports (`AgentPluginMcpRecord|Save|View|Repo|AccessSnapshot|Projections|ProjectionPorts`, `AgentPluginCardsPort|CardBuilders`). The two `ToolAccessChange`-bound aliases stay (they are bindings). 8 importers rewritten to `@jini-ai/agent-plugins/connect`.
- `use-site-confirm.hooks.ts`: now a binding over `useConfirmRequest` (copy and tone per action); returns `{ confirm, dialog }`. `LocalSiteConfirmDialog` spreads `dialog.dialog`. Two test files updated to the `dialog.*` shape. Behaviour: a newer request or unmount denies the pending one (Jini guarantees both).
SKIPPED (premise false at this base):
- `viewer-time-zone.ts`, `translation-entry.ts`: no Jini export of that behaviour (rg in `packages/*/src`).
- `desktop/app/Spinner.tsx`: Jini `Spinner` renders different markup and props (`size`, `label`, no `.spinner` class); swapping changes the look.
- `StaticSiteTab.hooks.ts` `useCopyLine`: Jini's `useCopyToClipboard` takes an injected clipboard dependency and a different result shape; not drop-in.
- `use-edit-media-modal.hooks.ts`: Jini has only `openLightboxDialog/closeLightboxDialog`, no dialog-lifecycle hook.
- `widget-picker-port.hooks.ts`: its header records a deliberate decision not to reuse `AdminWidgetsPort` (components/ must not import a feature port); signatures differ.
- `UserInterfaceSettingsPanel.tsx`, desktop `use-import-website.hooks.ts` (`copyableDetails`), `use-workspace-chat-pane.hooks.ts` (`captureFolderDrop`): no Jini export (rg).
- `ConfirmActionDialog`: waits for C2, as instructed.
Verify: admin vitest on `sites hooks plugins skills settings` = same 83 baseline failures, my hook tests pass; website node:test (database-transfer unit, secrets-vault-step, cards-port, projection-seam, hosted-mcp-error-identity, vault-boundary-parity) 133 pass, 1 baseline failure (`mcp-projection-seam.distinct-ports`, fails identically on the parent). eslint on touched files: 0 errors.

## A10 sheet (byte-size formatter to core/text)
Jini: new `@jini-ai/core/text` `formatByteSize({ bytes }, { locale?, megabyteLabel? })` (the admin/media algorithm, moved with its cases to `core/src/text/__tests__/format-byte-size.unit.test.ts`). `admin/media` no longer exports `formatByteSize`; `MediaCard.hooks` imports the core one. Changeset `core-format-byte-size.md` (minor core and admin; the admin export removal is intentional, the only external importer was a Tovu test).
Tovu: `install-archive-size.ts` deleted; both install hooks call `formatByteSize(..., { megabyteLabel: "MiB" })`. A 1 GiB or larger archive would now read "1.0 GB" (uploads are capped at 32 MiB). `formatTransferBytes` keeps only its `—` guard and delegates. Media card test imports from core/text. README e2e path list updated.
SKIPPED, outputs differ and tests pin them: `ui` `formatSkillFileSize` (one-decimal KB), `admin/forms/html-rules` private `formatByteSize` (rounds to `5 MB`), website `site-backup/sources.ts` `formatByteSize` (KiB/MiB/GiB, drops `.0`).
Verify: core text tests 197 pass; admin/media non-React tests 252 pass; Tovu `formatTransferBytes` cases pass. eslint: only a pre-existing sonarjs error at `use-plugin-install.hooks.ts:67` (not my line).

## A66 sheet (glyph geometry to the Icon catalog)
Jini `@jini-ai/ui` `Icon`: 18 new names with exact geometry copied from Tovu (24-unit grid): compass, timeline, migrate-forward, folder-outline, folder-plus, tray-export, tray-import, tray-upload, document-lines, document-marked, tiles-four, picture-frame, video-frame, cloud-outline, bin-lidded, flag-triangle, more-horizontal-outline, star-filled. 18 new markup snapshots written; existing snapshots unchanged. Changeset `ui-icon-catalog-admin-glyphs.md`.
Tovu: deleted `database-visuals.tsx`, `themes-visuals.tsx`, `sites-visuals.tsx`, the Library tab icons, the five Media tab icons, `OtherIcon`, `SkillDocumentIcon`, and `sites/index.ts`' two icon exports. Callers render `<Icon name=".." size={N} strokeWidth={1.5} />` (Tovu draws at 1.5, the catalog default is 1.6). Importers: Database.tsx, Themes.tsx, Sites.hooks.tsx, AllSitesTab.tsx, CredentialWarnings.tsx, import-export-tabs.tsx, Library.hooks.tsx, Library.tsx, Media.hooks.tsx, SkillRow.tsx, Skills.tsx. Two tests deleted (`database-visuals`, `sites-visuals`): they asserted only `Icon`-style size/aria-hidden/viewBox, now covered by Icon's tests and snapshots.
SKIPPED: desktop `icons.tsx`, `tool-icons.tsx`, `icon-frame.tsx` (20-unit grid; the catalog is 24, so a move would redraw every glyph), `nav-availability.ts` (not a glyph), the local `UploadIcon` in `Media.tsx` and `agent-plugins-visuals` (different grids, outside the row's files).
Verify: admin vitest over `database themes sites library media skills import-export`: failing set identical to baseline (231), 5 fewer passing tests = the two deleted files. eslint 0 errors.

## B07 sheet (vault rotate verifies before persisting) — SECURITY
Jini `packages/platform/src/secrets/credential-sets/vault.service.ts`: `rotate` now calls new private `assertOpensTo({ record, sealed, payload })` between `seal` and the CAS `repo.put`. It opens the fresh envelope with `sealer.open({ sealed }, { aad: buildVaultAad(record) })` and requires `=== JSON.stringify(payload)`. Open failure or mismatch throws `VaultError("invalid-record")` (fixed code, no envelope or plaintext in the message). `sealed === null` (metadata-only row) skips the check and never opens, as before. Pattern: Tovu `vault-boot.ts` `sealNormalizedRecord`. No new error code, no contract change.
RED/GREEN (`src/secrets/__tests__/vault.service.test.ts`, tests written first, same service code as the parent):
- RED on parent: `rotation refuses a re-seal that does not open...` and `...whose plaintext differs...` both fail with "Missing expected rejection" (rotate persisted the bad seal, revision 2). 2 failed, 26 passed.
- GREEN on ab0ef93c: 28 of 28 pass; whole `src/secrets` 472 pass, 1 baseline failure (`exports.test`).
- Third test pins that a no-payload row is rotated without any `open` call.
Opus security reviewer must check:
1. The verify AAD is the persisted row's (`record`), the same one `open()` uses on read; the new seal used `input`'s (`find` already proved equal context). Confirm no path where seal and read AAD can diverge.
2. Comparison is the exact sealed plaintext string, not a re-parse; key order or whitespace cannot differ because both sides come from `JSON.stringify` of the same object.
3. Error path leaks nothing and the old row is untouched (tests assert revision 1 and the same `sealed` object). Check the thrown `VaultError` can never carry the sealer's native error (it is caught and replaced).
4. A mock-only seal fault is simulated; confirm a real keyring failure (rotated key not yet usable for open) also lands on `invalid-record` rather than persisting.
5. Not done, same gap: `put()`/`prepare()` also seals without an open-back. Say whether it needs the same guard.
6. TOCTOU: the CAS `put` still enforces `expectedRevision`; the extra open happens before it, so a concurrent writer still wins (existing test passes).

## B23 sheet (OAuth popup callback page MOVE)
Census: importers of `routes/oauth/callback-page.ts`: `external-mcp/oauth-callback.ts`, `api-connections/oauth-callback.ts`, `admin-http/.../agent-plugins/connection-sign-in.ts`, tests `oauth/__tests__/callback-page.test.ts`, `external-mcp/__tests__/oauth-callback.test.ts`, `desktop/src/window-navigation-policy.test.ts`; the admin app keeps its own copy of `EXTERNAL_MCP_CALLBACK_MESSAGE_TYPE` (unchanged).
Jini: new subpath `@jini-ai/oauth/callback-page` (`exports`, `jini.entries` = `node` to match the package's contract test, README and API.md lines, changeset minor): `renderOAuthCallbackPage({ ok, messageType, reason, copy }, { lang?, successCloseMs?, failureCloseMs? })`. Imports only `@jini-ai/core/text` (`escapeHtml`). All copy and the reason vocabulary are host-supplied; copy is HTML-escaped; payload JSON escapes `<`, U+2028, U+2029; an unknown reason (including `constructor`/`__proto__`) falls back to the default reason. New tests: the script/opener matrix ported from Tovu plus escaping cases. Oauth package: 822 pass, build ok.
Tovu: `callback-page.ts` keeps Tovu copy, the message type and `OAuthCallbackFailureReason`; `renderOAuthCallbackPage` keeps its call shape, so no caller changed. Verified: 77 node tests across website callback tests, api-connections/sign-in tests and desktop `window-navigation-policy`.

## B29 sheet (sitemap + llms.txt serializers SPLIT)
Jini `@jini-ai/cms/seo`: `serializeSitemapXml({ entries })`, `renderLlmsTxt({ entries, title }, { description? })` in `sitemap-documents.ts` (exports via the seo barrel; `entry.test.ts` binding list updated; changeset minor). Tests: empty urlset, escaping, sorted/no-description llms. Cms seo tests: 248 pass, 1 baseline failure (`analyzeEntry`).
Tovu: `routes/site/sitemap.ts` and `llms.ts` call them; routes keep fetching, headers and error handling. Verified: llms, sitemap, robots, seo-site-serving, seo-artifact-origin route tests, 30 pass.

## Not done / follow-ups
- A01 skipped files above need either Jini additions or an owner call.
- A10/A66 leave the Jini-side duplicates named above for a unified-output decision.
- `pnpm guard` and Tovu `tsc` were not run repo-wide (slow); touched files are eslint-clean and typechecked per package where noted.
