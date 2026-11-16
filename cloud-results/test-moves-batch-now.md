# Test run: moves/batch-now (Tovu + Jini), merged with origin/integ/wave-b

Setup: both branches `git merge origin/integ/wave-b` (clean, no conflicts). Node 24.22.3, Jini `pnpm install --frozen-lockfile` OK,
`pnpm -r --no-bail build` has failures (all in files NOT touched by the branch: desktop-host logging.ts, http-kit tests, plugins host,
capability-providers test, admin seo hooks, cms forms tests, ui panel-kit tests). Tovu `npm ci` (root, apps/admin, apps/site-chat),
`link-jini.mjs` against this checkout, `packages/sdk` built (needed by website tests; dist missing in a fresh clone).

**Result: no CAUSED failures. No fix commits were needed.** Pre-existing failures below were verified by running the same
tests on a worktree of origin/integ/wave-b (Tovu base, linked to the same merged Jini build — Jini changes are additive).

## Jini (vitest --maxWorkers=2; tsc --noEmit per package; eslint; guard)
| slice / commit | tests | result |
|---|---|---|
| cms selectMediaBlobStore | cms blob-store.selection.test.ts (5) | pass |
| cms seo/content-analysis | content-analysis.test.ts (2) | pass |
| admin media-html-attribute types / createHttpMediaProvidersPort | http-providers.test.ts (3) | pass |
| agentic createLiveToolRegistration | tool-registry-live-registration.test.ts (3) | pass |
| agentic skills/tools | installed-skill-tools.test.ts (4) | pass |
| integrations image-model ids | catalog.test.ts (5), image-model-ids.test.ts (2) | pass |
| ui useCursorPages | use-cursor-pages.hooks.test.tsx (3) | pass |

- tsc --noEmit admin/agentic/cms/integrations/ui: only errors in untouched files (admin seo/react hooks, cms forms tests, ui panel-kit hook tests, ui charts test). None in touched files.
- eslint on all touched Jini .ts/.tsx: 0 errors; 1 warning `packages/admin/src/media/adapters/http.ts:14` max-lines-per-function on pre-existing `createHttpMediaApi` (59 lines).
- guard (153 violations repo-wide): 0 in touched files.

## Tovu
- apps/admin vitest (features media/members/users/sites/database/roles, components MediaEditDialog/WidgetConfigFields, integrations): 177 failed / 1675 passed on branch; 177 failed / 1695 passed on base. **Identical failing set (189 FAIL lines, diff empty).** 20 fewer tests on branch = tests moved to Jini.
  Cause: tests render Jini admin screens without `<AdminKitProvider>`/`<UiKitProvider>` ("@jini-ai/admin screens need <AdminKitProvider kit=…>", e.g. Jini/packages/admin/src/react/kit.tsx:213) — pre-existing. Affects Members.unit, Users.*, users-agent-drive, account-protections, users-reset-password-info, Roles, Sites*, media (Media.unit etc., load error), jini-admin/*-swap, recharts-bundle-integer-ticks.
  **Consequence: the members/users/media panel slices (DD-admin-members/users/media) are NOT verified by tests here; a UI check must look at Members, Users and Media panels.**
- Tests added/changed by the branch that pass: media-html-attributes.unit.test.tsx, media-rules.unit.test.ts, members-dependencies, use-members.hooks, use-users, change-username, sites-home-setting, and the other non-failing files in those dirs.
- apps/admin `tsc --noEmit`: 67 lines, none in touched files.
- website node:test (touched + sibling tests: object-storage, skills, media-generation, content-analyzer, db/postgres, db-ops integration, blob-share): 349 tests, 345 pass first run; 3 failures were a missing `@tovu/sdk` dist (built it) → all content-analyzer + skill-tool-search-ranking pass. Remaining: see pre-existing.
- 40 additional test files importing touched modules (object-storage, skills, db/postgres, media-generation…): 654 tests, 642 pass, 11 fail — all in one file (below).
- root `tsc -p tsconfig.json`: 125 error lines, none in touched files. biome lint on touched files: 0 errors, 37 warnings, 1 info.

## Pre-existing failures (also fail on origin/integ/wave-b)
- apps/website/src/features/media-generation/__tests__/providers-tools.test.ts:72 — `t10 media callback delivers a human key only to its parked call…` (got 200, expected 409 SURFACE_NOT_PENDING). Same on base. Note: media-generation/agent-tools.ts + tool-registrations.ts were touched by this branch, so a UI/agent check of media-generation tool callbacks is worthwhile.
- content/agent-plugin-overlays/s3-compatible/__tests__/media-store.integration.test.mjs — fails on base too (0 pass); log shows `[plugin-runtime] bundled initialization failed for 'charts-recharts'`. object-storage was touched, so eyeball the S3 media store path.
- apps/admin: the 34 failing files above (missing kit provider in tests).
- Jini build/tsc errors listed in Setup (untouched files).

## UI check should look at
Admin Members, Users, Media (edit dialog, HTML attributes, provider settings), Database timeline paging (useCursorPages), Sites home, Plugin content analyzer scoring, object-storage media store selection, skills tool registration.
