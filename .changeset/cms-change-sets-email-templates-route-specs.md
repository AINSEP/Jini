---
"@jini-ai/cms": patch
---

New admin route specs `@jini-ai/cms/admin-http/routes/change-sets/{list,get,revert}` and `@jini-ai/cms/admin-http/routes/email-templates/{list,create,preview,get,edit-html,rename,render}` (K1). Change-set specs call cms's own `revertChangeSet`; the host injects its DTO mappers and revert registry. Email-template specs take the template operations, their error predicates and the raw-HTML edit permission as deps.
