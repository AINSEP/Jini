# Jini extraction commit plan

Base: `b7e79e4033db8ce1e019ad5c4094d09edd61193b` (`codex/x9restj`). Tovu source: read-only `origin/integ/merge-21-2026-11-24`.

1. **S01.J — LEFT (OPUS-CLOUD).** No files touched.
2. **S02.J — LEFT (OPUS-CLOUD).** No files touched.
3. **TH01.J — LEFT (OPUS-CLOUD).** No files touched.
4. **TH02.J — COMPLETED: theme open-file predicates and card preview.**
   - Tests copied first, preserving all 13 cases and assertions; only production import specifiers gain `.js`.
   - Files: `packages/cms/src/react/themes/__tests__/theme-explore-open-file.hooks.unit.test.ts`, `packages/cms/src/react/themes/__tests__/use-theme-card-preview.hooks.unit.test.ts`, `packages/cms/src/react/themes/hooks/theme-explore-open-file.hooks.ts`, `packages/cms/src/react/themes/hooks/use-theme-card-preview.hooks.ts`, `packages/cms/package.json`, `COMMIT-PLAN.md`.
   - Sources copied verbatim except the specified defaulted second empty object on `keepsOpenFileSelected`. Existing why-comments retained.
   - Public subpaths: `@jini-ai/cms/react/themes/hooks/theme-explore-open-file.hooks` (universal), `@jini-ai/cms/react/themes/hooks/use-theme-card-preview.hooks` (browser). No `typesVersions` exists in this manifest.
   - Mutation `OPEN-FILE-OTHER-THEME`: remove the loaded-theme equality check; the existing other-theme cases must fail. Mutation `ADVERTISED-PNG`: force legacy JPEG lookup for advertised artwork; the existing advertised-PNG case must fail. Mutations not executed.
   - TH02.T must repoint `hooks/use-theme-explore.hooks.ts` and `Themes.tsx` to these subpaths, then delete the two original sources and their suites. No Tovu files changed here.
   - No anchor mismatch. No deletions or unrelated cleanup.
5. **TH03.J — COMPLETED: injected preview reload button.**
   - Created `packages/cms/src/react/themes/__tests__/ThemePreviewReloadButton.test.tsx` first (2 cases): supplied label, disabled state and click forwarding; null-to-error transition changes only the alert. The tests supply both required collaborators and preserve the reload override.
   - Files: `packages/cms/src/react/themes/__tests__/ThemePreviewReloadButton.test.tsx`, `packages/cms/src/react/themes/ThemePreviewReloadButton.tsx`, `packages/cms/package.json`, `COMMIT-PLAN.md`.
   - Preserved `WiredThemePreviewReloadButton`, hook invocation order, explicit first `{}`, conditional reload override and alert. The control and hook are required props; `disabled` is passed only when defined. Updated the existing default-reload why-comment as specified.
   - Public subpath: `@jini-ai/cms/react/themes/ThemePreviewReloadButton` (browser), with the same forbidden imports as `./react/media`.
   - Mutation `PREVIEW-RELOAD-ERROR`: replace the hook double's null error with `Preview unavailable`; only the alert must change. Removing or suppressing the alert must make this test fail. Mutation not executed.
   - TH03.T must repoint the imports in `ThemeExplore.tsx`, `pages/PageEditor.tsx`, `posts/editor/header/PostEditorToolbarEnd.tsx`, `theme-preview-refresh.unit.test.tsx`, and `themes-localization.unit.test.tsx`; pass `ThemePreviewReloadControl` and the real host `useThemePreviewReloadButton` at all six mounts, retaining existing overrides; delete only the old button source. No Tovu files changed here.
   - No anchor mismatch. No deletions or unrelated cleanup.
6. **PT01.J — LEFT (OPUS-CLOUD).** No files touched.
7. **PT02.J — LEFT (OPUS-CLOUD).** No files touched.
8. **PT03.J — LEFT (OPUS-CLOUD).** No files touched.

M00 has no executable sheet and requires no change. No sheets stopped. No Jini callers required repointing: the implementations and listed callers originate in Tovu, whose half is deferred. Final diff review retains only sheet-required changes; no extra code needed removal. No original Tovu files were deleted in this Jini-only checkout. Source test count: 13 copied unchanged; 2 new TH03 cases; 15 Jini cases added, with no existing Jini tests deleted.

Tests, builds, installs, type-checks and linters are intentionally unrun per dispatch. Cloud verification owns the tests and `pnpm api:update`, reviewing only the expected `jini-ai__cms.json` additions. No commits made; `.git` remains unchanged.
