---
"@jini-ai/platform": patch
---

Carry the host's rationale comment for `resolvePathWithin` (the two containment checks and the root-normalization edge case) onto the implementation, so the host's re-export shell can be deleted without losing it.
