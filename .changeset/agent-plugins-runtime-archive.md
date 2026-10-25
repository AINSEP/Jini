---
"@jini-ai/agent-plugins": patch
---

Exclude `__tests__` directories and `.test.`/`.spec.` files from bundled plugin archives so installed runtime contents and their digest are unaffected by test-only changes.
