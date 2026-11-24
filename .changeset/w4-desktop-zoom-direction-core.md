---
"@jini-ai/core": patch
"@jini-ai/desktop-host": patch
"@jini-ai/ui": patch
---

New `@jini-ai/core/contracts/desktop-zoom` owns `ZoomDirection`; desktop-host `ZoomCommandDirection` and `@jini-ai/ui/zoom` use it instead of duplicate unions.
