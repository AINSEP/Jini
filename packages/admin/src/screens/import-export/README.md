# screens/import-export

Rules, dictionary and hooks behind an Import & Export panel: the tab labels and card copy, and the
Git backup flow (pick a default Source Control connection, plan, push with polling, plain-language
refusals). The export-run wire types (`AdminExportRunSnapshot`, `AdminExportRunStatus`) are owned by
`@jini-ai/admin/core` (`../../core/ports/import-export.ts`); the connection rows are the Source Control
model (`../../source-control/models.ts`). Neither is redeclared here.

- `import-export-i18n.ts` — the panel's dictionary (`t`, composed over `ADMIN_COMMON_I18N`); the
  per-locale blocks live in `import-export-i18n/` (size ratchet).
- `git-backup-rules.ts` — pure decisions: offered connections, form readiness, the plan request,
  result guards and the one-line refusal wording.
- `hooks/git-backup-port.hooks.ts` — `GitBackupPort` (list connections, plan, push) and
  `createFakeGitBackupPort` for tests.
- `hooks/use-git-backup.hooks.ts` — `useGitBackup({ port, t, host })`: idle → planning → planned →
  pushing → done, or refused; each push POST is the poll, bounded by `maxPushPolls`.
- `hooks/use-import-export.hooks.ts` — `useImportExportTranslate({ host })` (the dictionary bound to
  the host's locale) and `useSitesSectionAvailable({ host })` (whether the Import tab may make a new
  site: never in a desktop shell, otherwise the cached sites read's `switchingEnabled`).

## Wiring

- The host implements `GitBackupPort` against its own admin HTTP client (the site-backup plan/push
  routes and its Source Control credentials list) and keeps the zero-argument `useWiredGitBackup`
  binding beside it (the `useX(dependencies)` / `useWiredX()` pair).
- `useGitBackup` takes a REQUIRED `host`: `describeError` (its API-error wording). It reads the
  connections through the admin kit's `useFetchQuery`, so it runs under `AdminKitProvider`.
- `useImportExportTranslate` takes a REQUIRED `host` with `useLocale` (hook);
  `useSitesSectionAvailable` one with `isDesktop` and `useSitesSnapshot` (hook; the host's shared,
  cached sites read, which must not request when `enabled` is false). Pass module-level host
  objects: the hook fields are called every render.
- The panel, tab strip and Git backup card markup stay in the host, which owns their stylesheet,
  icons and the Sites screen's Export/Import tabs they embed; so does the export API module.
