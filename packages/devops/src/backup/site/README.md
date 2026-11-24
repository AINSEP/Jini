# `backup/site`

Site backup/share helpers that stay neutral about the host's archive layout, limits and copy.

## Wiring

- `./backup/site/share-refusal` — the one `SiteShareRefusal` class and `archiveRefusalName`; hosts import it from here so `instanceof` has a single class. `./backup/site/archive-media` (`bufferArchiveMedia`) takes the required `host` field (`operations`, `paths`, `sharePolicy`: media sniffing/sanitizing/keys, portable-path policy, and the capped ledger/blob reads that carry the host's limits). `./backup/site/static-export-selection` takes the required `policy` field (`validateSharePath`, `sharePathAlias`, and the host's `invalidInput` refusal that owns the message).
- `./backup/site/credential-warnings` — `warnCredentialContent` and `addCredentialWarning` take the
  host's secret-shape scanner as the required `redactSecretShapes` field (a `CredentialRedactor`:
  `({ text }, { codeAware?, vendorOnly? }) => { text, redactions }`, emitting `[REDACTED:<kind>]`
  markers). The host binds its own redaction policy (its key patterns) there; this module only reads
  the fixed markers and never sees a pattern.
# backup/site

Host-neutral pieces of a site's backup / share-archive feature, moved out of a host product.

## Wiring

- `share-export-failure.ts` (`@jini-ai/devops/backup/site/share-export-failure`, universal): the unexpected-export failure carrying its stage and versions. **Needs injected**: nothing.
- `saved-keys-port.ts` (`.../saved-keys-port`, universal): `SiteSavedKeysPort` (capture / reveal / restore of a share's saved keys), `SAVED_KEYS_PATH` and `ENCRYPTED_KEYS_DESCRIPTOR`. **Needs injected**: nothing; the host implements the port (encryption, vault capture, recipient re-sealing) and passes it to its archive orchestrator. `SealedSecret` comes from `@jini-ai/core/contracts/vault`.
- `static-download-html.ts` (`.../static-download-html`, universal): `downloadForms` (disables backend-dependent forms in a downloaded static copy and reports removed actions / retained sign-in links) and `downloadDocumentBase` (drops `<base>` and rewrites refresh targets). **Needs injected**: `sourceEdits: DownloadHtmlSourceEdits` — the host's source-located HTML editor (`elements`, `attribute`, `editedHtml`, parse5 with source locations). Every read and write of the HTML goes through it, so offsets and untouched bytes stay the host's.
- **Must never import**: a host HTML owner, a credential store or vault implementation.
