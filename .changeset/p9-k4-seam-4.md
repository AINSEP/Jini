---
"@jini-ai/core": patch
---

Add `./contracts/site/platform-mail`: an additive copy of the mail activity-ledger, suppression-admin, feedback-inbox and sender-identity types from `@jini-ai/platform/mail` (`MailActivityRecord`, `MailActivityRepo`, `MailSuppressionAdminRepo`, `MailActivityDeps`, `MailSuppressionDeps`, `MailFeedbackInboxPort`, `MailSenderIdentityPort`, and their closure). The rest of that entry's types already live in `./contracts/mail` and are not duplicated. Platform keeps its identical declarations and exports until the paired cutover.
