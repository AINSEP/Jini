---
"@jini-ai/core": patch
"@jini-ai/cms": patch
---

The sites wire DTOs (sites home set, token sign-in plugins, site create) are declared in neutral Core at `@jini-ai/core/contracts/site/cms-sites`; the cms sites specs import them and their helpers take object arguments.
