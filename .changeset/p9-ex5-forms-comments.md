---
"@jini-ai/cms": patch
---

Move form and comment helpers from the host: `./forms/site/form-destination-manifest` (node), `./forms/site/import-remote-submissions`, `./forms/site/mail-outbox-readiness` (X-forms-1), `./forms/destinations/pull`, `./forms/destinations/select` (X-form-destinations-1), `./comments/site/comment-targets`, `./comments/site/ip-hash-salt` (node; X-comments-1, its runtime-mode type from `@jini-ai/core/contracts/site/core-runtime-mode` and its warning sink a required host port) and `./admin-http/http/forms` (node; the Forms slice of R-admin-http-1), with their tests.
