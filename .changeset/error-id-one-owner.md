---
"@jini-ai/core": patch
"@jini-ai/daemon": patch
---

`mintToolErrorId` moved from `@jini-ai/daemon/tool-recovery` to the new `@jini-ai/core/errors/error-id` entry, so a host and the daemon share one owner of the `ERR-XXXX-XXXX-XXXX-XXXX` format. The daemon no longer exports it: import it from core. `TOOL_ERROR_ID_PATTERN` stays in the daemon.
