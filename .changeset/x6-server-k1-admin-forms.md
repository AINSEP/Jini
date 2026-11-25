---
"@jini-ai/cms": minor
---

Add the admin forms `create`, `authoring` and `delete-submission` route specs (`@jini-ai/cms/admin-http/routes/forms/{create,authoring,delete-submission}`), completing the forms route family. Each takes its host write as a required injected function (`createFormDefinition`, the authoring `updateFormDefinition`, `removeFormSubmission`) plus the host's outward error copy; `create` and `authoring` read the `Idempotency-Key` header via `readHeaders: ["idempotency-key"]`, and `delete-submission` answers a bare 204.
