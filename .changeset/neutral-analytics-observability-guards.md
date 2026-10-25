---
"@jini-ai/analytics": patch
"@jini-ai/diagnostics": patch
---

Redact selected error codes before export, invalidate stale product-analytics consent approvals,
and share platform-neutral privacy validation between product analytics and visitor ingestion. Async product-analytics consent now
requires `consentRevision`: without it a promised approval is dropped (fail closed); synchronous
consent is unchanged.
