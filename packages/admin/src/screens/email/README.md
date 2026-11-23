# screens/email

Leaves of the host admin's Email screen that carry no host transport: the screen's copy
(`email-i18n.ts` + `email-tabs-i18n.ts`), the mail-status client wire shape, the tab-label and
editor-toolbar translator factories, and the shared tab read-state hook. The screen, its tabs,
its data hooks and its HTTP client still live in the host.

## Wiring

- `email-i18n.ts` (+ `email-tabs-i18n.ts`) — falls back to `ADMIN_COMMON_I18N`; nothing injected.
- `api/mail-status-api.types.ts` — type-only shape of the host's `GET /system/mail-status` answer
  (`AdminMailStatus`, `ProviderDomainVerification`); the host's mail-status client returns it.
- `Email.hooks.ts` — `createEmailTabLabel` resolves through `email-i18n`; nothing injected.
- `EmailTemplateEditor.hooks.ts` — `createEmailPageTranslator` takes the host's page-editor
  dictionary lookup as the required `pageEditorT` field. In the reference host it is bound at the
  call site in `apps/admin/src/features/email/EmailTemplateEditor.tsx`.
- `hooks/email-load.hooks.ts` — `errorMessage`, `isForbidden` and `useLoad` take the host's
  transport error class as the required `ApiError` field (read for `message` and `status`). In the
  reference host every Email data hook passes its `ApiError` from `@/lib/admin-http/request`
  (`apps/admin/src/features/email/hooks/use-email-*.hooks.ts`).
- `email-api.types.ts` — the Email page client's wire shapes (`MailProviderConfiguration`,
  `MailDnsStatus`, `MailActivityPage`, `EmailTemplateDetail`, …) and the `EmailApi` port the data
  hooks call. Type-only; the host implements `EmailApi` with its own transport. In the reference
  host: `apps/admin/src/features/email/email-api.ts` (`emailApi: EmailApi`).
- `hooks/use-email.hooks.ts` (`useEmail`, `emailSummary`), `hooks/use-email-overview.hooks.ts`,
  `hooks/use-email-sender.hooks.ts`, `hooks/use-email-templates.hooks.ts` and
  `hooks/use-email-template-editor.hooks.ts` — the tab data hooks. Each takes on `required` the
  host's API port (`api` / `port`) and its transport error class (`ApiError`); `useEmailOverview`
  also takes the idempotency-key factory (`requestId`) and `useEmailTemplates` the editor opener
  (`open`). In the reference host all are bound by the `useWired*` hooks in
  `apps/admin/src/features/email/email-hooks-host.ts` (`emailApi`, `mailStatusApi`, `ApiError` from
  `@/lib/admin-http/request`, `navigate` from the router, `newRequestId` over `uniqueId`).
- Still host-owned: the activity and provider data hooks (`use-email-activity.hooks.ts` has an
  84-line hook body; `use-email-provider.hooks.ts` reads the host's agent-plugin wire type), the
  template-view hook (shell DevicePreview hooks) and every Email component.
