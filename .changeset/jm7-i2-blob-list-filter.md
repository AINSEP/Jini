---
"@jini-ai/cms": patch
---

AssetBlobRepoPort.list takes an optional { sha256s } filter, so a host reads many blob rows in one query instead of one per hash.
