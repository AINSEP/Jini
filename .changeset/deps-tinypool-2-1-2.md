---
"@jini-ai/sandbox": patch
"@jini-ai/vibecoding": patch
---

Pin the dev-time `tinypool` (pulled in by vitest) to `2.1.2` via a workspace override, clearing the critical prototype-pollution-to-RCE advisory (`<2.1.2`). Dev-only; no runtime change.
