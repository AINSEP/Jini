---
"@jini-ai/platform": patch
---

`SecretsVaultService.copyToSite` with `overwrite: true` now opens its fresh seal again with the service's own sealer before replacing the existing target row, as `rotate` does. A seal that cannot be read back is refused as `invalid-record` for that row and the stored target row is unchanged. Only rotate and copy-overwrite add this open: `put`, `prepare` and a copy that creates a new row open nothing extra, so hosts that pin how many times a save opens an envelope are unaffected.
