---
"@jini-ai/cms": patch
---

New `@jini-ai/cms/admin-http/http/plugin-hook-error`: `createPluginHookErrorEnvelope` binds the shared `PLUGIN_HOOK_FAILED` 500 envelope (fixed public text, redacted log line, a `rejectPluginHookFailure` rung for route specs) to a host's hook-failure class, refusal copy and redaction.
