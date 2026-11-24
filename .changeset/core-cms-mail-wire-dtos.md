---
"@jini-ai/core": patch
"@jini-ai/cms": patch
---

The admin system mail wire DTOs (status, test send, suppression-removal preview, provider refusal) are declared in neutral Core at `@jini-ai/core/contracts/site/cms-mail`; the cms mail route specs import them from there and helpers take object arguments.
