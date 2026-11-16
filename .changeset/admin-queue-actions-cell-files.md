---
"@jini-ai/admin": patch
---

The comment queue's actions cell and its hook move to their own files, which removes a runtime import cycle between `QueueSection.tsx` and `QueueSection.hooks.ts`. The public surface and behaviour are unchanged.
