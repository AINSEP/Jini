# `@jini-ai/platform/mail`

Mail contracts, delivery policy and provider plumbing. The opt-in `sql/` subpath
(`@jini-ai/platform/mail/sql`, needs the optional `kysely` peer) holds one Kysely query body per
mail port for SQLite and Postgres: send ledger, suppression (send-time and operator), capture,
activity projection and attempt observer, feedback inbox, retention, and the site feedback route.

## Wiring

- `sql/*` repos take `({ db }, optional)` where `db` is a `MailSqlKernel` (core `StorageKernel`
  over a Kysely handle plus raw `query`/`execute`); the host passes its content kernel. Table and
  column names are the host's persisted schema (`mail_send_ledger`, `mail_suppression`,
  `mail_suppression_removals`, `mail_capture`, `mail_activity_attempts`, `mail_feedback_inbox`) and
  are used verbatim. The host owns the migrations and their dialect tests.
- `feedback-sources.ts` / `sql/site-feedback-route.ts`: the host injects `resolveByLabel` (its
  custom-credentials vault reader), its opaque `credentials`, and `labelPrefix` (the product label
  of its persisted vault labels, `<prefix> — <Provider> Webhook Secret`). The host's composition root
  binds them where it builds the mail feedback route; the HTTP mount (raw body parser) is the host's.
- `sql/retention.ts`: `startMailRetention(required, { onError })` — the host passes `onError` (its own log line for a
  failed purge pass); without it a failed pass is silent. The host binds it where its store's owner opens.
- `purpose-gate-probe.ts` and `positional-purpose-gate.ts`: the host passes the runtime `mode` and
  its `durableOutboxReady` predicate at composition, the same values its live mailer gate receives.
- `mail-status.ts` (`MailProviderControl`): implemented by the host's provider selection; consumed
  by its mail-status tools and routes.
- `email-template-agent-tools.ts` (`createEmailTemplatesAgentToolCatalog({ copy })`): the host binds its
  raw-HTML edit permission (`copy.editHtmlPermission`, named in the write tools' text and authorization)
  once, next to its email-template tool registrations, and reads the bound catalog from there.
- `test-send.ts` (`planMailTestSend`/`runMailTestSend`/`createMailTestSendLimiter`, at
  `@jini-ai/platform/mail/test-send`): the host passes its route/tool deps bag through. It injects
  `mailSenderIdentity` (its composed sender resolver, with its own refusal copy) and
  `mailTestFallbackSender` (its product-named placeholder From); both are bound in the host's site-mailer
  composition (`operations`). Without them the neutral resolver and a "Site"-named placeholder apply.
- `feedback-setup.ts` (`readMailFeedbackSetup`, at `@jini-ai/platform/mail/feedback-setup`): the host's
  route/tool deps bag carries `listCustomCredentials` (its credential-store lister, safe summaries only,
  handed back its opaque `customCredentialSetRepo`) and `mailWebhookSecretLabels` (its product-prefixed
  persisted signing-secret labels). Both are bound in the host's route-deps mail composition.
- `use-readiness.ts` (`readMailUseReadiness`/`mailUseReadinessDepsFrom`, at `@jini-ai/platform/mail/use-readiness`):
  the host's route/tool deps bag carries `evaluateNewsletterLaunchGate` (its Newsletter launch gate
  evaluator, the same one its send path runs; it returns the `MailUseLaunchGatePrecondition` codes over
  the `MailUseLaunchGateDeps` slice readiness builds) plus the optional sender, purpose-gate probe,
  form-definition repo and activity repo. Absent the evaluator, Newsletter's rows are
  `newsletter_gate_unavailable` unknown. Bound in the host's route-deps mail composition.
