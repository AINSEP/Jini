---
"@jini-ai/devops": patch
---

`createNodeRuntimeResolver` accepts an optional `importResolve` seam (defaults to `import.meta.resolve`) so the ESM resolution path can be tested in-process. No behaviour change.
