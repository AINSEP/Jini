---
"@jini-ai/provider-plugins": patch
---

`ai-trace-langfuse`: a host-supplied (borrowed) client is never shut down by the provider; dispose and the sink's `shutdown` only flush it. A factory-built client is still shut down on dispose.
