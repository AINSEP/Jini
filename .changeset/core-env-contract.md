---
"@jini-ai/core": patch
---

New environment-variable contract for hosts. `@jini-ai/core/contracts/env` holds the types (`EnvVarSpec`, `EnvSchema`, `EnvIssue`, `EnvValueEcho`, `HostEnvironment`). `@jini-ai/core/env/parse-env` exports `parseEnv`, a pure parser that turns a host's schema and an environment map into a frozen config plus issues and never stops a boot. `@jini-ai/core/env/format-env-issue` exports `formatEnvIssue`, which writes an issue in plain words. An issue never carries a secret or an unlisted value.
