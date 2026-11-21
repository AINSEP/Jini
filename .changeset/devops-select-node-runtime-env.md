---
"@jini-ai/devops": minor
---

BREAKING: `@jini-ai/devops/local-dev` `selectNodeRuntime` takes `env` in its required argument (`{ searchFrom, nodePath, env }`) and no longer defaults to `process.env`; the `env` option is removed. Both candidate probes receive that env object.
