---
"@jini-ai/mcp": patch
---

`createPinnedCapabilityRuntime` no longer has a `capability()` accessor: `endpointUrl({})` returns the pinned URL only, and the token is reachable only through `bearerToken` for that exact URL. The pin is a detached frozen copy of `url` and `token`, so a later change to the environment object or to a delivered object cannot move it. The runtime reports the environment names it deleted as `scrubbed`. `startCapabilityDelivery` passes `{ error }` to `onUnavailable` and a refused delivery names the HTTP status.
