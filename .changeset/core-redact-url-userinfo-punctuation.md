---
"@jini-ai/core": patch
---

URL userinfo no longer runs across URL-ending punctuation (`,` `;` `)` `>` or a quote) to a later `@`, so a contact address written right after a URL does not pull the real host into the credential span. A password holding unencoded `@` signs is still masked whole.
