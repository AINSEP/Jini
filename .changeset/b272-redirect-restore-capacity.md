---
"@jini-ai/cms": patch
---

Restoring a trashed wildcard redirect through `updateRedirect` now runs the same active-wildcard capacity check as create and
update, so a 501st active wildcard rule stays in Trash with a plain refusal instead of being re-activated.
