/** Email delivery visibility tools (email phases 4-5, 2026-10-22): what uses email, recent sends with
 *  provider feedback, the suppression list and its owner-only removal, feedback setup. Each calls the
 *  same shared operation as its admin route. */
export const mailDeliveryAgentToolCatalog = [{
  name: "mail_get_readiness",
  description: "Reports, per use of this site's email, whether it can send right now: sign-in links, subscription confirmations, form notifications and newsletter. Returns {checkedAt, uses: [{use, label, sendLane (interactive|notification), mailLane (transactional|bulk), state, reasons, sender, owner, formsConfigured?, evidence}]}. state is ready, blocked (reasons say why, e.g. sender_not_configured, durable_outbox_not_ready, origin_not_verified, consent_capability_unbound), disabled (e.g. newsletter sending switched off), not_configured (e.g. mail_delivery_unavailable, no_form_notifications) or unknown (that use's own check failed; other rows stand). evidence is the last observed send outcome {outcome, at} or null, separate from state: a passing test email does not make a blocked use ready. Uses each owning feature's own checks. Read-only. Requires admin.forms.manage.",
  sideEffects: "none" as const,
  authorization: { permission: "admin.forms.manage" },
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
}, {
  name: "mail_list_activity",
  description: "Lists this site's recent email sends, newest first, 25 per page by default. Returns {access (full|masked), items: [{id?, recipient, use (sign_in|newsletter_confirmation|form_notification|newsletter|test|unknown), outcome, lane, providerId, providerMessageId?, errorCode, createdAt, updatedAt}], nextCursor, empty (none_recorded|no_matches|null)}. outcome is accepted (the provider took it; not proof of delivery), delivered, bounced or complained (from provider feedback), suppressed, deferred (rate limited), failed or unknown (the provider may have taken it; never resend blindly). With mail.activity.read recipients are full and each item has an id for mail_get_activity; with only admin.forms.manage recipients are masked and there are no ids. Never returns message bodies or sign-in links. Filter with outcome, use and recipient (exact address; needs mail.activity.read); pass nextCursor as cursor for the next page.",
  sideEffects: "none" as const,
  authorization: { permission: "mail.activity.read" },
  inputSchema: { type: "object", additionalProperties: false, properties: {
    outcome: { type: "string", enum: ["accepted", "delivered", "bounced", "complained", "suppressed", "deferred", "failed", "unknown"] },
    use: { type: "string", enum: ["sign_in", "newsletter_confirmation", "form_notification", "newsletter", "test", "unknown"] },
    recipient: { type: "string", maxLength: 254, description: "One exact address." },
    limit: { type: "integer", minimum: 1, maximum: 100, clamp: true, description: "Page size; default 25." },
    cursor: { type: "string", description: "nextCursor from the previous page." },
  } },
}, {
  name: "mail_get_activity",
  description: "Shows one email send from mail_list_activity with its provider feedback timeline: {activity: {id, recipient, use, outcome, lane, providerId, providerMessageId, errorCode, createdAt, updatedAt}, feedback: [{kind (delivered|bounced|complained), hardBounce, providerId, occurredAt, receivedAt}]}. An empty feedback list means none received yet, not that it was delivered. Never returns the message body or links. Requires mail.activity.read.",
  sideEffects: "none" as const,
  authorization: { permission: "mail.activity.read" },
  inputSchema: { type: "object", additionalProperties: false, required: ["activityId"], properties: { activityId: { type: "string", description: "An id from mail_list_activity." } } },
}, {
  name: "mail_list_suppressions",
  description: "Lists addresses this site will not email (the do-not-send list), newest first, 25 per page by default: {items: [{address, scope, reason, createdAt}], nextCursor, empty (none_recorded|no_matches|null)}. scope all blocks every email (hard bounces, manual blocks); scope bulk blocks only newsletters (complaints), so that person still gets sign-in links. reason is bounced, complained or manual. The list is kept per address, not per provider, so it survives a provider switch. Filter with search (part of an address), scope and reason; pass nextCursor as cursor for the next page. Requires mail.activity.read.",
  sideEffects: "none" as const,
  authorization: { permission: "mail.activity.read" },
  inputSchema: { type: "object", additionalProperties: false, properties: {
    search: { type: "string", maxLength: 254, description: "Part of an address, e.g. a domain." },
    scope: { type: "string", enum: ["all", "bulk"] },
    reason: { type: "string", enum: ["bounced", "complained", "manual"] },
    limit: { type: "integer", minimum: 1, maximum: 100, clamp: true, description: "Page size; default 25." },
    cursor: { type: "string", description: "nextCursor from the previous page." },
  } },
}, {
  name: "mail_remove_suppression",
  description: "Removes one address from the do-not-send list for one scope (all or bulk, as mail_list_suppressions shows it) so this site may email it again. Needs a written reason, which is recorded with who removed it and when. Shows the person a confirmation card every time (approval cannot be remembered), including why the address was blocked. Removal only lifts the block: it does not subscribe anyone or restore newsletter consent, and a complained or hard-bounced address can be blocked again by the provider's next report. Returns {removed, removal: {id, address, scope, suppressionReason, suppressedAt, removalReason, removedBy, removedAt}}. Requires mail.suppressions.manage (owner only by default).",
  sideEffects: "mutates-durable-state" as const,
  authorization: { permission: "mail.suppressions.manage" },
  inputSchema: { type: "object", additionalProperties: false, required: ["address", "scope", "reason"], properties: {
    address: { type: "string", maxLength: 254, description: "The suppressed address." },
    scope: { type: "string", enum: ["all", "bulk"] },
    reason: { type: "string", minLength: 3, maxLength: 500, description: "Why this address may be mailed again; recorded." },
  } },
}, {
  name: "mail_get_feedback_setup",
  description: "Shows whether each active mail provider reports deliveries, bounces and complaints back to this site, and what is still needed: {available, providers: [{providerId, label, lanes, supported, webhookPath, webhookUrl (paste into the provider; null until the site's address is verified), signingSecret {current, previous: {label, configured, updatedAt}} (presence only, never the secret; save one with credential_save under that label), lastVerifiedEvent {kind, receivedAt} | null, state (unsupported|secret_missing|no_events_yet|receiving)}]}. no_events_yet means set up but nothing received so far, which is not the same as working. Read-only. Requires admin.forms.manage.",
  sideEffects: "none" as const,
  authorization: { permission: "admin.forms.manage" },
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
}];
