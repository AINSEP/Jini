---
"@jini-ai/core": minor
"@jini-ai/mcp": patch
---

Export async WebCrypto `canonicalArgumentDigest` from `@jini-ai/core/records`, reusing
`canonicalJson` for identical plugin and host SHA-256 hex digests. Canonical JSON now
sorts keys recursively by Unicode code point and throws `CanonicalJsonError` for
non-JSON values and cycles; undefined object properties remain omitted.

MCP approval fingerprints reuse the core serializer. Existing ordinary JSON
fingerprints retain their bytes; non-JSON schemas now fail instead of colliding
with valid JSON, and astral object keys follow the shared code-point ordering.
