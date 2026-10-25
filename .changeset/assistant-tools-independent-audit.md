---
"@jini-ai/core": patch
"@jini-ai/mcp": patch
"@jini-ai/agent-plugins": patch
---

Tighten diagnostic identifier exemptions and ignore ordinary header values shorter than eight characters during exact-secret masking (credential headers are masked at any length; every rule and every exact secret, including its JSON-escaped spelling, now matches the original text and overlapping or adjacent matches merge into one marker, so no rule can split another's value or leave part of a known secret visible; marker text in the input gets no protection, and only markers redaction itself generated count as already masked; the JWT, URL-userinfo, email and sanitizer marker rules stay linear on multi-megabyte inputs). Keep null tool schemas informational. Preserve safe reader refusals for explicit plugin skill/file requests and use host-formatted plugin tool pointers for relevance, deferred instructions, and supporting files (optional for automatic use; omitted when the host supplies none).
