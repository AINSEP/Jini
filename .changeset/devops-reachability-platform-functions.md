---
"@jini-ai/devops": minor
---

`createNodeReachabilityPorts`, `createReachabilityLookup` and `createReachabilityDispatcher` take platform's `assertSafePublicUrl` and `createValidatingLookup` as a required first argument instead of importing `@jini-ai/platform`. The address validation at connection time is unchanged; `@jini-ai/platform` is no longer a peer dependency of devops.
