---
"@jini-ai/admin": patch
---

Move the Import & Export screen into `@jini-ai/admin/screens/import-export`: new subpath `./screens/import-export/ImportExport` (the screen, with its Git backup card, tabs and links). `ImportExport` takes required host props: `useTranslate`, `useGitBackup`, `useTransferTranslate`, `useSitesAvailable`, the host's `SiteExportTab`/`SiteImportTab` components, `agentHandle` (Core's, injected) and the Export/Import tabs' agent `handleLabels`. The Git backup controller, port, rules and dictionary are owned by the Deployment lane (`screens/import-export/hooks/*`, `git-backup-rules`, `import-export-i18n`).
