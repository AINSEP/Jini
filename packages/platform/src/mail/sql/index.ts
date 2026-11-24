/** @file `@jini-ai/platform/mail/sql`: Kysely SQL adapters for the mail ports (ledgers, suppression,
 * capture, activity, feedback inbox, retention). Opt-in: importing this subpath needs `kysely`. */
export { createMailSendLedgerRepo, type MailRepoDeps, type MailRepoOptions, type MailSqlKernel } from "./ledger.repo.js";
export { createMailSuppressionRepo } from "./suppression.repo.js";
export { createMailSuppressionAdminRepo } from "./suppression-admin.repo.js";
export { createMailFeedbackInboxRepo } from "./feedback-inbox.repo.js";
export { createMailCaptureRepo, DEFAULT_CAPTURE_LIST, MAX_CAPTURE_LIST, type CapturedMail, type MailCaptureRepo } from "./capture.repo.js";
export { createMailActivityRepo, mailActivityUse } from "./activity.repo.js";
export { createMailAttemptObserver, type MailAttemptObserver } from "./attempts.repo.js";
export { purgeExpiredMail, startMailRetention, type MailRetentionOptions, MAIL_ACTIVITY_RETENTION_MS, MAIL_CAPTURE_RETENTION_MS, MAIL_RETENTION_INTERVAL_MS } from "./retention.js";
export { createSiteMailFeedbackRoute } from "./site-feedback-route.js";
