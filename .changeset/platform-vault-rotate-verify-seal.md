---
"@jini-ai/platform": patch
---

`SecretsVaultService.rotate` opens the fresh envelope under the row's own binding and compares it with the stored payload before persisting; a re-seal that does not open is refused with `invalid-record` and the stored row stays untouched.
