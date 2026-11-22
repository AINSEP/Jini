---
"@jini-ai/integrations": patch
---

Move the host-neutral webhook SQL repositories from the host. `./webhooks/sql` exports `SqlWebhookSubscriptionRepo` and `SqlWebhookDeliveryRepo` (one Kysely query body for SQLite, PGlite and Postgres), constructed as `({ kernel, tables: { webhookSubscriptions, webhookDeliveries } }, {})` with host-owned table names, plus the stored row types. `kysely` is a new optional peer. SQLite and PGlite characterization tests cover lost update, conditional save, topic matching, claim, lease, fencing and envelope storage.
