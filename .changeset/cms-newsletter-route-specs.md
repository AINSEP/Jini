---
"@jini-ai/cms": patch
---

The admin newsletter routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/newsletter/*`: get/list/create/update/schedule/send/send-test/pause/resume/cancel campaign, list-send-log, list/create/archive list, list/create/import/remove subscription, resend-confirmation) with `@jini-ai/cms/admin-http/http/newsletter` (DTO types, `toDataResponse`, the `NewsletterErrorMapper` port). The newsletter domain's services, records and error table are the host's and are injected per route. Wire bodies and statuses are unchanged.
