---
"@jini-ai/cli": minor
---

BREAKING: `resolveDaemonUrl` takes the environment as a required first argument, `resolveDaemonUrl({ env }, options)`, and no longer reads `process.env` itself; the `env` option is removed. The `discover` probe receives that same env object.
