# backup/site

Host-neutral pieces of a site's backup / share-archive feature, moved out of a host product.

## Wiring

- `share-export-failure.ts` (`@jini-ai/devops/backup/site/share-export-failure`, universal): the unexpected-export failure carrying its stage and versions. **Needs injected**: nothing.
- `saved-keys-port.ts` (`.../saved-keys-port`, universal): `SiteSavedKeysPort` (capture / reveal / restore of a share's saved keys), `SAVED_KEYS_PATH` and `ENCRYPTED_KEYS_DESCRIPTOR`. **Needs injected**: nothing; the host implements the port (encryption, vault capture, recipient re-sealing) and passes it to its archive orchestrator. `SealedSecret` comes from `@jini-ai/core/contracts/vault`.
- `static-download-html.ts` (`.../static-download-html`, universal): `downloadForms` (disables backend-dependent forms in a downloaded static copy and reports removed actions / retained sign-in links) and `downloadDocumentBase` (drops `<base>` and rewrites refresh targets). **Needs injected**: `sourceEdits: DownloadHtmlSourceEdits` — the host's source-located HTML editor (`elements`, `attribute`, `editedHtml`, parse5 with source locations). Every read and write of the HTML goes through it, so offsets and untouched bytes stay the host's.
- `share-refusal.ts` (`.../share-refusal`, universal): `SiteShareRefusal` (code + safe message), `archiveRefusalName` (bounds and strips an archive-controlled name before it is quoted) and the two private import-worker exit codes. **Needs injected**: nothing.
- `share-policy.ts` (`.../share-policy`, universal): `createSharePolicy({ limits, versionMismatchMessage }, { uncappedFilePaths? })` returning `{ limits, versionMismatchMessage, checkShareLimits }`, plus the share database projection types (`ShareDatabaseProjection`, `ShareDatabaseSanitizer`, `ArchiveMediaSource`, `CredentialWarning`). **Needs injected**: the host's numeric limits (the numbers in refusal copy are derived from them) and its version-mismatch copy. The host keeps the limits table, the share/legacy-private table names and the copy.
- **Must never import**: a host HTML owner, a credential store or vault implementation.
