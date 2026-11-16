---
"@jini-ai/provider-plugins": patch
---

`@jini-ai/core` is declared as a build-time devDependency (its imports are type-only and bundled at build), so the packed provider distributions again ship with no runtime dependencies.
