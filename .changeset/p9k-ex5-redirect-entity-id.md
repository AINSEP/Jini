---
"@jini-ai/core": minor
"@jini-ai/http-kit": minor
"@jini-ai/cms": patch
---

`JsonRouteAuthorize` and the `JsonRoutePorts.authorize` host port take an optional second argument, `JsonRouteAuthorizeScope` (`{ entityId? }`), so a by-id route can name the entity it acts on. Both adapters (`jsonRoute`, `mountJsonRoute`) forward a supplied scope to the host port and call it with the required arguments alone otherwise, so id-free routes are unchanged. The redirects get-by-id, hits, update and tombstone specs pass the requested `id` again (the host authorizer received it before the move); list and import stay id-free.
