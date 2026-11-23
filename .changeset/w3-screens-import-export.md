---
"@jini-ai/admin": patch
---

Move the Import & Export screen into `@jini-ai/admin/screens/import-export`. New subpaths: `./screens/import-export/ImportExport` (the screen), `./screens/import-export/import-export-i18n` (its dictionary, over `ADMIN_COMMON_I18N`), `./screens/import-export/hooks/use-git-backup.hooks` (`useGitBackup`, the Git backup card's state) and `./screens/import-export/hooks/git-backup-port.hooks` (the `GitBackupPort` contract and `createFakeGitBackupPort`). `ImportExport` takes required host props: `useTranslate`, `useGitBackup`, `useTransferTranslate`, `useSitesAvailable`, the host's `SiteExportTab`/`SiteImportTab` components and the Export/Import tabs' agent `handleLabels`; `useGitBackup` takes the live `port` and a `describeApiError` describer on its required args. Rendered classes are `jini-*` (generic page/card/button/field/notice plus `jini-import-export-*`).
