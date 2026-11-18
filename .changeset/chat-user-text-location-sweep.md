---
"@jini-ai/chat": patch
---

Chat's user-text redaction checks each opaque-token candidate against the detected paths and URLs in one sorted sweep instead of a scan over all of them, so a long message with many paths, URLs and tokens no longer takes quadratic time.
