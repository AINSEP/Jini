---
"@jini-ai/db": patch
---

A failed snapshot removal now propagates from `discardCommittedSnapshot` (its caller already treats it as housekeeping); cleanup after a failed PGlite start and the rollback of a closed socket connection log their cause at debug instead of vanishing; an invalid database connection string now says why the URL parser rejected it (never the string itself, which holds the password).
