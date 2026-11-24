/** Mail configuration has no existing feature owner; this diagnostic and its two approval-gated
 *  controls share one catalog. */
export const mailStatusAgentToolCatalog = [{
  name: "system_get_mail_status",
  description: "Reports whether this site can send real email, the current mail driver, and a setup note. Use when email is not arriving, a magic link did not arrive, or to check whether sending is configured. Returns {mailDeliveryAvailable, driver, note} plus, when available, state (ready|unconfigured|degraded), lanes (transactional/bulk provider and state), warnings (sender_unverified, sender_unknown) and providers; console means messages are printed locally and never sent, unconfigured means no provider is chosen. This checks configuration, not whether a particular message reached an inbox. The providers list contains active adapters only. Before saying a mail provider is missing, call mail_list_providers to discover installed plugins that are switched off, then load_agent_plugin for setup guidance. Each providers entry is the safe configuration (lanes it sends for, capabilities, credential {required, saved, label}, selectable/refusal, setup fields), as mail_list_providers returns it. Also returns checkedAt and, after a provider failure, lastError {at, providerId, source (send|check), code, message}. The result is cached for about 30 seconds; pass refresh: true after changing a key or provider to check again now. Does not expose credentials or send mail. Requires admin.forms.manage, like the admin mail-status route. Immediately after startup it can still show the unresolved console fallback.",
  sideEffects: "none" as const,
  authorization: { permission: "admin.forms.manage" },
  inputSchema: { type: "object", additionalProperties: false, properties: { refresh: { type: "boolean", description: "Re-run the provider checks instead of using the briefly cached result." } } },
}, {
  name: "mail_set_provider",
  description: "Chooses which installed mail provider sends ALL of this site's email (sign-in links, confirmations, form notifications and newsletters), for both the transactional and bulk lanes. Pass providerId from system_get_mail_status's providers list. The provider must be installed and its key saved (mail_configure_provider shows how); its availability is checked again at the moment of the switch, and nothing is changed if it fails. Shows the person a confirmation card every time (approval cannot be remembered). Does not send mail; follow with mail_send_test. Requires settings.workspace.write.",
  sideEffects: "mutates-durable-state" as const,
  authorization: { permission: "settings.workspace.write" },
  inputSchema: { type: "object", additionalProperties: false, required: ["providerId"], properties: { providerId: { type: "string", description: "An installed provider id from system_get_mail_status." } } },
}, {
  name: "mail_send_test",
  description: "Sends one test email through the active provider and the site's delivery rules (suppression, test mode, rate limits), after a confirmation card that shows the actual destination. Sends to the signed-in operator's own account address unless to names one other address. Use after mail_set_provider or when checking delivery end to end. Returns {sent, outcome, to, from, driver, at} where outcome is accepted (the provider took it; providerMessageId), captured (kept locally by test mode or the console driver; nothing left the server), redirected (test mode sent it to redirectedTo instead) or failed (errorCode, message, retryable, retryAfterMs). accepted is not delivered: inbox delivery is only known from later provider feedback. Repeated sends are throttled (MAIL_TEST_DUPLICATE, MAIL_TEST_RATE_LIMITED). Requires admin.forms.manage.",
  sideEffects: "mutates-durable-state" as const,
  authorization: { permission: "admin.forms.manage" },
  inputSchema: { type: "object", additionalProperties: false, properties: { to: { type: "string", maxLength: 254, description: "One recipient address; omit to use your own account address." } } },
}];
