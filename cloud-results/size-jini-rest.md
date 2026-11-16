# size-jini-rest — function-size refactor (PARTIAL)

Branch: refactor/size-jini-rest (from origin/integ/wave-b). Stopped early on the tool-call budget.

## DONE (all new functions <= 50 lines, eslint clean on the file, tsc clean for the file)
- admin/comments/controllers/comment-queue.controller.ts createCommentQueueController (146) — shared `QueueCtx`, module-level actions
- admin/media/adapters/memory.ts createMemoryMediaApi (98) — store + upload-builder helpers
- admin/media/controllers/library.controller.ts createLibraryController (169) — shared `LibraryCtx`, module-level actions
- admin/media/conformance/media-api.conformance.ts runMediaApiConformance (84) — checker + per-phase checks
- admin/media/react/hooks/EditMediaPanel.hooks.ts useEditMediaPanel (84) — buildEditFields, useAutofocusTitle, useCopyRows
- admin/react/components/RowMenu/RowMenu.hooks.tsx useRowMenu (87) — useMenuRef, useFocusActiveItem, handleMenuKey
- core/settings/express/http.ts registerSettingsRoutes (112) — RouteKit + per-route registrars
(commit hashes: `git log --oneline origin/integ/wave-b..refactor/size-jini-rest`)

## NOT REACHED
Every other entry in size-lanes/jini-rest.txt (cms, commerce, cookie-consent, core tool-registrations/write-service, desktop-host, devops, diagnostics, integrations, mcp, memory, oauth, platform, plugins, sandbox, search, sidecar, user-management, vibecoding, rest of admin).

## size-debt entries now removable
- packages/admin/src/comments/controllers/comment-queue.controller.ts createCommentQueueController
- packages/admin/src/media/adapters/memory.ts createMemoryMediaApi
- packages/admin/src/media/controllers/library.controller.ts createLibraryController
- packages/admin/src/media/conformance/media-api.conformance.ts runMediaApiConformance
- packages/admin/src/media/react/hooks/EditMediaPanel.hooks.ts useEditMediaPanel
- packages/admin/src/react/components/RowMenu/RowMenu.hooks.tsx useRowMenu
- packages/core/src/settings/express/http.ts registerSettingsRegistrars (registerSettingsRoutes)
Also stale on the base already: diagnostics/observability/otel.ts createOtelObservabilityPort, plus "lower debt value" notes for SeoPage.tsx and cms taxonomy/write-service.ts (check-size output).

## Pre-existing failures (on unmodified origin/integ/wave-b)
- `pnpm -r build` fails in desktop-host, capability-providers, http-kit, ui (test-file type errors); @jini-ai/ui has no dist, so packages/admin tsc reports unresolved `@jini-ai/ui/fetch-query` etc.
- packages/admin vitest: src/comments 63 failed/123 passed, src/media 108 failed/308 passed — identical counts before and after my changes (React tests can't resolve unbuilt ui). So React-hook refactors (useEditMediaPanel) are NOT covered by a passing test run here.
- RowMenu tests 35/35 pass; core src/settings 524/524 pass.
- RowMenu.hooks.tsx trackOpenMenu is 51 lines (warning, not on my list, pre-existing).

---

# Continuation run 2 (2026-11-16)

Setup: Node 24, `pnpm install --frozen-lockfile`, `pnpm -r build` (same pre-existing build failures as above). Per file: eslint (clean for the split function), package `tsc --noEmit`, package/file vitest. Commit hashes: `git log --oneline` on this branch (subject `refactor(size): split <function> under 50 lines`).

## DONE (this run)
- oauth/src/refresh.ts createTokenRefresher — 5e318b3f
- cookie-consent/src/node/index.ts createNodeConsentFiles — 9f194580
- core/src/settings/write-service.ts renameDefinition — f3c132a9
- core/src/settings/tool-registrations.ts buildSettingsRegistrations — efd13133
- desktop-host/src/electron/updates/auto-update-controller.ts createAutoUpdateController — cae6a2d2
- devops/src/packaging/electron/typescript.ts runtimeImportReferences — 95f0eed0
- devops/src/checks/hardwiring.ts createHardwiringInspector — a0af0015
- integrations/src/api-connections/host.ts createApiConnectionHost — e2b3fdcf
- integrations/.../token-store/vault-token-store.ts createVaultOAuthTokenStore — 034d141c
- integrations/.../dispatch/async-operation-store.ts createInMemoryAsyncOperationStore — 779a99df
- integrations/.../tools/tool-registrations.ts createCredentialToolRegistrations — ac769698
- mcp/src/server/http-tool-server.adapter.ts startMcpHttpToolServer — c0318d93
- mcp/src/server/stdio-hosting.ts createStdioHosting — d2650ec8
- mcp/src/server/tool-server.ts createMcpToolServer — ce54173b
- memory/src/extraction-log.ts createExtractionLog — 962a653f
- memory/src/note-store.ts createNoteStore — a342294b
- platform/src/asset-cache.ts createAssetCache — 8dfe2061
- vibecoding/src/core/history.ts createEditHistory — 9d514166
- search/src/testkit/memory-provider.ts createInMemorySearchProvider — f1b070aa
- user-management/src/admin/adapters/memory.ts createMemoryRolesApi — 105d061e

## SKIPPED (with reason)
- cookie-consent/src/client/runtime.ts createCookieConsent — closes over mutable consent state and is the browser bundle (dist/client.min.js) with a hard 4608 B gzip budget that already fails by 9 B on the base (see pre-existing failures); hoisting state into a context object risks growing the bundle. Needs a size-budget decision first.
- diagnostics/src/web-evidence/page-structure-script.ts collectPageStructure (and its nested helpers) — serialized into the browser by `page.evaluate`; the file header forbids hoisting any helper out of the function (ReferenceError at runtime). Cannot be split without changing the evaluate contract (e.g. several evaluate calls) = behaviour change.

## NOT REACHED (context budget)
cms routing createRouting, cms trash createTrashService, commerce checkout (installCommerceCheckout + forEach callback), platform directory-user-config / directory-workspace / guarded-reader, plugins capability-tools / declarative-content-types, sandbox wrapE2bSandbox, search createSearchIndexer, sidecar json-ipc (createJsonIpcServer + callbacks, requestJsonIpc) and supervisor, integrations hosted-mcp shared-sign-in / sign-in, user-management (createMemoryUsersApi, members/roles/users controllers, useMembers, createFakeRolesPort, useUsers, buildIdentityRegistrations), vibecoding session / regions / project / store, core/settings none left.
Tip for the next run: for closure-heavy factories, the pattern used here is a `State`/`Ctx` interface + module-level helpers taking it first, and the factory returns thin wrappers.

## size-debt entries now removable (in addition to the earlier list)
All 20 functions listed under DONE above (file + function name).

## Pre-existing failures (also on unmodified base)
- cookie-consent bundle.smoke.test: client.min.js 4585 B gzipped, only 23 B headroom (needs >= 32) — failing before my changes (client runtime untouched).
- mcp src/federation/__tests__/mcp-federation.registrations.test.ts: 2 failures (identical with my tool-server changes stashed).
- user-management tsc: src/admin/__tests__/members.list-cursor.test.ts(28,12) TS2532 (test file, untouched).
- Remaining warnings (not on the list): createCredentialSaveHandlers 74 lines, createMcpHttpToolServerRuntime 68, core write-service registerDefinitions/set/clear/retypeDefinition, createMemoryUsersApi 87 (on list, not reached).
