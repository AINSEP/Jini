---
"@jini-ai/devops": minor
---

Add HW13-env-undeclared-entry to the env-access rules: a process entry may read only the environment names its host declares for it (`EnvAccessSource.declaredEnvNames`), with direct, literal-bracket and destructured reads checked by source key and computed or rest reads rejected. Add `readDeclaredEnvKey`, the checked accessor for a computed key. HW9/HW12 and the NODE_ENV build define are unchanged.
