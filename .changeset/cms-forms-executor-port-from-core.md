---
"@jini-ai/cms-forms": patch
---

`FormCommandExecutorPort` is now the neutral `ExecuteCommandFn` from `@jini-ai/core/contracts/events` instead of a type-import of the cms gateway, so `@jini-ai/cms` is no longer a production dependency of the package (it stays a devDependency for tests). The type is unchanged; a compile-time pin in cms asserts the gateway and the core signature are mutually assignable.
