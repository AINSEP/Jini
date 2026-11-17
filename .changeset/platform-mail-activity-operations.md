---
"@jini-ai/platform": minor
---

`@jini-ai/platform/mail` gains the mail activity and suppression operations a host's tools and admin routes sit on: `listMailActivity` / `getMailActivity` (two access tiers: full, or masked recipients with no id), `listMailSuppressions`, `planMailSuppressionRemoval` / `runMailSuppressionRemoval` (the permission and an independent owner gate; an absent owner refuses everyone), the input readers, `maskRecipient`, the paging cursor helpers, the closed `MAIL_ACTIVITY_OUTCOMES` / `MAIL_ACTIVITY_USES` vocabularies and the record/port types a SQL repo implements (`MailActivityRepo`, `MailSuppressionAdminRepo`, ...). The host passes its permission ids as `permissions: { activityRead, status, suppressionsManage }` in the deps object; nothing here names an id. Additive; no existing export changes.
