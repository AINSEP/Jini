---
"@jini-ai/cms": patch
---

Move host-neutral trash code from the host: the removal ports and helpers and the native trash scheduler (`./trash/site/*`). The trash registry stays in the host: its table names, permission ids, restore defaults and purge cascades are host policy.
