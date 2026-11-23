---
"@jini-ai/ui": patch
---

BYOK model discovery no longer sends the provider key to a half-typed Base URL: a typed Base URL is probed only after it stays unchanged for 600 ms and is a complete allowed URL; a preset or protocol pick still probes at once (B216).
