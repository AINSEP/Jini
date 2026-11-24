---
"@jini-ai/db": patch
---

`@jini-ai/db/tools` gains a "this site" wording profile, `SITE_DATABASE_MESSAGES` and `SITE_TRANSFER_MESSAGES`, moved from a host so single-site hosts no longer carry their own copy of the database and transfer tool prose. The profile carries no specification ids; a host that cites its own documents spreads it and overrides those fields.
