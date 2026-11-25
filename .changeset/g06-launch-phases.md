---
"@jini-ai/daemon": patch
---

Split executor launch into admission, preparation, staging and handoff phases while preserving resource cleanup and child lifecycle registration order.
