---
"@jini-ai/devops": patch
---

New entry `@jini-ai/devops/checks/env-access`: `createEnvAccessInspector` reports code that touches `process.env` or `import.meta.env` outside a declared process entry (`HW9-env-access`) and reads that run while a module is imported (`HW12-env-import-time`). It uses the hardwiring inspector's violation shape and debt ratchet. `runHardwiring` accepts `rules` so a host can keep a separate debt file for this rule family.
