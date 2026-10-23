---
"@jini-ai/integrations": minor
---

Add `@jini-ai/integrations/saved-requests`: a declarative fixed-target HTTPS interpreter
with closed bounded input schemas, query/JSON-body value bindings, host-resolved credential
IDs and revision/origin binding, and typed positive output selection marked as untrusted.
Reuse credentialed HTTP authentication, redaction and audit over platform guarded egress
with no redirects, private-address denial, 64 KiB response/decompression caps and a 10s
deadline. Requires the existing optional platform and JSON-schema peers for this subpath.

Add the opt-in `makeCredentialedRequest` option `responseFormat: "json"` for decoded JSON
secret redaction, including refusal of credential-bearing keys/numbers and incomplete JSON.
