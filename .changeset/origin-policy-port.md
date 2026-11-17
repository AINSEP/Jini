---
"@jini-ai/core": patch
"@jini-ai/server": patch
---

The same-origin decision is an injected port. `OriginContext` now carries `originPolicy: SameOriginPolicyPort` instead of the resolved-port ref and environment fields; `createLocalSameOriginPolicy` builds the standard local policy (the port is read on every call) and `@jini-ai/core/contracts/server/testing` exports `allowAllOrigins`, `denyAllOrigins`, `createRecordingOriginPolicy` and `createTestRouteHost`. `composeJiniKernel` takes the bound port as its own `resolvedPortRef` option.
