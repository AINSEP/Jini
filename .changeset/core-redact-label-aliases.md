---
"@jini-ai/core": minor
---

The shared engine now masks the value of `passwd`, `pwd`, `id_token`, `auth_token`, `signing_secret` and `webhook_secret` at any length, and of env-style prefixed names (`DB_PASSWORD`, `app_secret`, `STRIPE_WEBHOOK_SECRET`), in assignment, quoted JSON/inspect and long-colon forms. A prose colon (`pwd: ok`) stays readable.
