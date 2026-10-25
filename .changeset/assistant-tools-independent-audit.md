---
"@jini-ai/core": patch
"@jini-ai/mcp": patch
"@jini-ai/agent-plugins": patch
---

Tighten diagnostic identifier exemptions and ignore ordinary header values shorter than eight characters during exact-secret masking (credential headers are masked at any length; exact secrets match anywhere as plain substrings and run after every other rule, so a short secret can no longer split a label before its value is masked, while secrets of 16+ characters or containing whitespace, `.`, `;`, `,` or quotes are also masked before the lexical rules so a rule that stops partway cannot leave the rest visible; only markers redaction itself generated, in their exact case, are protected or treated as already masked, so echoed look-alike markers stay masked; URL schemes and email local parts are length-bounded so large inputs stay linear). Keep null tool schemas informational. Preserve safe reader refusals for explicit plugin skill/file requests and use host-formatted plugin tool pointers for relevance, deferred instructions, and supporting files (optional for automatic use; omitted when the host supplies none).
