---
"@jini-ai/integrations": patch
---

Webhook subscription updates now compare-and-set on the version they read when the caller passes no expectedVersion, so an edit can no longer overwrite a concurrent pause or delete.
