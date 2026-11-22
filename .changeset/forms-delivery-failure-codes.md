---
"@jini-ai/cms": patch
---

Form delivery: `formDeliveryRetryPolicy` now declares `failureCodes` (the nine ledger codes, and `codeOf`, which answers only for a `FormDeliveryError`). With the outbox worker's matching option, a failed delivery's `lastError` holds its real code again (`rate-limited`, `authorization-required`, …) instead of the class label that the status view read as `delivery-failed`.
