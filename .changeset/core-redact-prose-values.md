---
"@jini-ai/core": minor
---

After a credential word and a colon, an unquoted value that is a placeholder (`(skipped)`, `none`, `n/a`, `******`), the start of a sentence (`password: must be at least 8 characters`), or on the next line is no longer masked. A single token that does not read as prose (`API key: abc`, `password: hunter2`) is still masked, and the `=` form is unchanged.
