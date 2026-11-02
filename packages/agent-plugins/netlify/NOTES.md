# Netlify — implementation notes

Host-specific notes moved out of the first host's core comments (2026-10-22, vendor-to-plugins). Core describes these
behaviours generically; the vendor detail lives here.

- **Stored `siteId`.** Accepted and stored with a credential although, when written, the deploy target
  took only `{token}` and always found-or-created its site from the publish call's `projectName` label.
  Stored anyway so the credential contract stays stable whichever side ships second.
- **Account label.** Netlify's verify response has no reviewed account field, so no label is read and
  the account-label heal skips these credentials.
- **Security headers.** A root `_headers` file (two-space-indented `Name: value` lines under `/*`),
  rendered by `targets/netlify.mjs`; core keeps the same format as a drift oracle in
  `site-export/static-security-headers.ts`. Its 404 convention is `404.html` at the output root.
