---
"@jini-ai/core": patch
"@jini-ai/cms": patch
---

The admin settings wire DTOs (value, cleared, reset and register-definitions bodies, the scope union and a generic list envelope) are declared in neutral Core at `@jini-ai/core/contracts/site/cms-settings`; the cms settings specs type their output with them, pinned by a compile-time parity test.
