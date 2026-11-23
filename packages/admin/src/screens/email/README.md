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
