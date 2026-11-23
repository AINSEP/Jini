---
"@jini-ai/cms": patch
---

Move the media import-entity writer from the host (K5-media-1 slice): `@jini-ai/cms/media/site/import-media-entity`.

`ImportMediaEntityDeps` gains a required `sha256` field (`isValidSha256Hex` / `bytesMatchSha256`) that the host binds to the publish transfer's digest rule, so the media module does not reach the publish domain.
