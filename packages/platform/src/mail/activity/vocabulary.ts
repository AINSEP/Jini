/**
 * @file The closed vocabularies of a mail activity ledger's derived columns: what happened to a
 * send (`outcome`) and which owner sent it (`use`). They are runtime values because the activity
 * operation validates caller input against them; a SQL repo only needs their types.
 */

export const MAIL_ACTIVITY_OUTCOMES = ["accepted", "delivered", "bounced", "complained", "suppressed", "deferred", "failed", "unknown", "captured"] as const;
export type MailActivityOutcome = (typeof MAIL_ACTIVITY_OUTCOMES)[number];
export const MAIL_ACTIVITY_USES = ["sign_in", "newsletter_confirmation", "form_notification", "newsletter", "test", "unknown"] as const;
export type MailActivityUse = (typeof MAIL_ACTIVITY_USES)[number];
