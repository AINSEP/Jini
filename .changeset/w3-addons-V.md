---
"@jini-ai/admin": patch
---

Admin: add `screens/email/hooks/use-email-activity.hooks` (the Email Activity tab data hook: recent sends, blocked addresses with the two-step removal, feedback setup), taking the host's API port and transport error class on `required`. `MailActivityFilter` fields and `EmailApi.listSuppressions`'s `search` now accept an explicit `undefined`.
