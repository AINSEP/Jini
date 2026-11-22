---
"@jini-ai/devops": patch
---

`commitSiteToSourceControl` maps a provider failure code through an own-property check: an unknown code, or an inherited member name such as `constructor` or `__proto__`, becomes `PROVIDER_ERROR` instead of resolving to a non-code value.
