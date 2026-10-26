---
"@jini-ai/ui": patch
"@jini-ai/chat": patch
"@jini-ai/user-management": patch
---

Share accessible eye toggles across React credential fields, including multiline question answers,
CLI overrides, provider keys, login, new users, password resets, and source configuration. Preserve
autofill protection, translated toggle names, agent handles, and secret-answer redaction. Hidden
source environment blocks keep names visible and stored values masked until explicitly revealed.

Chat and user-management require `@jini-ai/ui ^0.5.7` for the new `SecretInput` and `SecretTextarea`
exports. Release UI 0.5.7 (or adjust those peer floors to the actual release containing these exports)
with these consumers; older UI versions cannot satisfy their imports. Hosts supply `.jini-secret`,
`.jini-secret-toggle`, and `.jini-secret--multiline` visual rules.
