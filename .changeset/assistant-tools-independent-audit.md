---
"@jini-ai/core": patch
"@jini-ai/mcp": patch
"@jini-ai/agent-plugins": patch
---

Tighten diagnostic identifier exemptions and ignore ordinary header values shorter than eight characters during exact-secret masking (credential headers are masked at any length; exact secrets still match inside other text but never inside a credential label, URL scheme, secret-named query parameter or a marker redaction itself generated, so they cannot split another credential's label; echoed look-alike markers stay masked, and the check stays linear on large inputs). Keep null tool schemas informational. Preserve safe reader refusals for explicit plugin skill/file requests and use host-formatted plugin tool pointers for relevance, deferred instructions, and supporting files (optional for automatic use; omitted when the host supplies none).
