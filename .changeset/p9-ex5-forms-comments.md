---
"@jini-ai/cms": patch
---

Move form and comment helpers from the host: `./forms/site/form-destination-manifest` (node), `./forms/site/import-remote-submissions`, `./forms/site/mail-outbox-readiness` (X-forms-1), `./forms/destinations/pull`, `./forms/destinations/select` (X-form-destinations-1), `./comments/site/comment-targets` (X-comments-1, 1 of 2 files) and `./admin-http/http/forms` (node; the Forms slice of R-admin-http-1), with their tests.
