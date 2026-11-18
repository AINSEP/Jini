# moves-b1 (Jini side; the full report is Tovu `cloud-results/moves-b1.md` on `wave3/moves-b1`)

Base origin/refactor/terra = 4c1892368. Branch `wave3/moves-b1`.

- 973c07777 feat(admin): `consentPreviewScale` + `CONSENT_PREVIEW_DESKTOP_WIDTH` in `@jini-ai/admin/consent/react` (changeset `admin-consent-preview-scale.md`, minor).
- 30954d12c docs(cms): entry-refs index rationale onto `EntryRefRow`.
- 7412f1dbd feat(cms): `InMemoryEntryRefsRepo` in `@jini-ai/cms/widgets` (changeset `cms-entry-refs-memory.md`, minor).
- 06cc2bb48 docs(cms): entry-refs port method rationale onto `EntryRefsRepoPort`.

Gates: `pnpm install --frozen-lockfile` + `pnpm --no-bail -r build` clean on the base; `packages/admin` vitest `src/consent` 32/32; `npm --prefix packages/cms run test` 4085/4085 (338 files, includes the subpath-isolation contract); `pnpm guard` ok; cms and admin `tsc` clean; eslint clean on changed files; rule-2 grep (tovu/site-chat/apps paths) prints nothing on every created or edited file.
