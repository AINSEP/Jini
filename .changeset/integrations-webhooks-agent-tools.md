---
"@jini-ai/integrations": minor
---

Add the webhook agent tools as `@jini-ai/integrations/webhooks/tools`: `getWebhooksAgentToolCatalog` (the six-tool catalog), `buildWebhooksToolRegistrations` over `WebhooksPackageToolDeps` (the host passes its repositories, origin registry, authorizer, an epoch-millisecond clock and the delete-confirmation port), the authored `webhooksDerivedRisk` map and the `toWebhookDeliveryView` mapper. Host metadata and dialog wording are bound by the host.
