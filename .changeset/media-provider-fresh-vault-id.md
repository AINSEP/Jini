---
"@jini-ai/cms": patch
---

Allocate a fresh vault ID when inserting media-provider credentials so a same-tick deletion and recreation invalidates the previous ETag. Hosts must inject the required ID generator into credential stores, vault adapters and credential tools.
