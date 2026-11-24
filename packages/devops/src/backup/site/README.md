# `backup/site`

Site backup/share helpers that stay neutral about the host's archive layout, limits and copy.

## Wiring

- `./backup/site/credential-warnings` — `warnCredentialContent` and `addCredentialWarning` take the
  host's secret-shape scanner as the required `redactSecretShapes` field (a `CredentialRedactor`:
  `({ text }, { codeAware?, vendorOnly? }) => { text, redactions }`, emitting `[REDACTED:<kind>]`
  markers). The host binds its own redaction policy (its key patterns) there; this module only reads
  the fixed markers and never sees a pattern.
