# P9 breaks ledger (product literals renamed to the jini form)

| Literal (old) | Literal (new) | Where | Effect |
|---|---|---|---|
| `tovu.admin.mail-status-banner.dismissed` | `jini.admin.mail-status-banner.dismissed` | `packages/admin/src/shell/components/MailStatusBanner/hooks/use-mail-status-banner.hooks.ts` (`MAIL_BANNER_DISMISSED_KEY`) | A browser that dismissed the mail banner under the old key sees it once more. The banner is not mounted by the host today, so there is no visible effect yet. |
