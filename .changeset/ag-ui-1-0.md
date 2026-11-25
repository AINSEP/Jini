---
"@jini-ai/chat": minor
---

Upgrade the optional `@ag-ui/core` peer to exactly 1.0.4. Validators now load from `@ag-ui/core/schemas` (which needs `zod` 3.25.18+ or 4.x beside it); the main entry is zod-free. Extra wire fields on tool events are read as passthrough fields, as before.
