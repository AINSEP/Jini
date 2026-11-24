---
"@jini-ai/admin": patch
---

Move the collections `NewContentTypeDialog`, `EditFieldsDialog` and their shared `ContentTypeFieldsSection` into `@jini-ai/admin/screens/collections/*`, with each dialog hook injected as a required prop and only `jini-*` classes emitted.
