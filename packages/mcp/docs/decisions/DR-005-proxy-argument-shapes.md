# Proxy argument recovery

`describe_tool` callers reuse the delegated gateways' `toolId` spelling. The descriptor
therefore advertises `toolId` and `name` as aliases of `id`. One shared dispatcher helper
canonicalizes aliases and, for both delegated gateways, folds top-level tool arguments
into `input` before strict schema validation. Duplicate input keys are rejected even when
the values match: silently choosing a location would conceal an ambiguous call.

`search_tools` and `get_run` have flat contracts, so their arguments are not folded.
Unknown wrapper keys on flat tools remain errors naming the key to remove; nested flat
arguments produce a move instruction. Delegated tool-specific fields still pass through
the daemon's existing tool validation and authorization boundary. Normalization never
changes the gateway's closed-over run id, generated tool-use id, or read-only constraint.

Validation uses the already-installed `@cfworker/json-schema` engine directly, with the
same draft and short-circuit settings as the SDK provider. The SDK adapter discards
structured field locations when it flattens errors into a string; retaining them permits
field-specific recovery instructions. The cached validators and strict schemas remain.
The normalizer and validator share an error boundary because schema compilation and
validation of non-JSON JavaScript values can throw. Such a failure must remain an MCP
`isError` result and must never reach the handler or reject the request.
