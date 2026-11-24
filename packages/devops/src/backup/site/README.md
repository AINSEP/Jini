# `backup/site`

Site backup/share helpers that stay neutral about the host's archive layout, limits and copy.

## Wiring

- `./backup/site/share-refusal` — the one `SiteShareRefusal` class and `archiveRefusalName`; hosts import it from here so `instanceof` has a single class. `./backup/site/archive-media` (`bufferArchiveMedia`) takes the required `host` field (`operations`, `paths`, `sharePolicy`: media sniffing/sanitizing/keys, portable-path policy, and the capped ledger/blob reads that carry the host's limits). `./backup/site/static-export-selection` takes the required `policy` field (`validateSharePath`, `sharePathAlias`, and the host's `invalidInput` refusal that owns the message).
- `./backup/site/credential-warnings` — `warnCredentialContent` and `addCredentialWarning` take the
  host's secret-shape scanner as the required `redactSecretShapes` field (a `CredentialRedactor`:
  `({ text }, { codeAware?, vendorOnly? }) => { text, redactions }`, emitting `[REDACTED:<kind>]`
  markers). The host binds its own redaction policy (its key patterns) there; this module only reads
  the fixed markers and never sees a pattern.
