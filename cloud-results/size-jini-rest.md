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
