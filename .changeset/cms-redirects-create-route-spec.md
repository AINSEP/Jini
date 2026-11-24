---
"@jini-ai/cms": patch
---

The admin redirects `create` route ships as a server-neutral `defineJsonRoute` spec (`@jini-ai/cms/admin-http/routes/redirects/create`), completing the redirects family alongside the six specs already published. Body refusals keep their flat `{ error, code: "VALIDATION_ERROR" }` answer before authorization, and the write-chokepoint errors reuse the shared mapping table. Wire bodies and statuses are unchanged.
