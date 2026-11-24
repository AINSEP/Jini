---
"@jini-ai/integrations": patch
---

Move the in-memory webhook adapters from the host: `InMemoryWebhookSubscriptionRepo`, `InMemoryWebhookDeliveryRepo` and `InMemoryDeliveryEnvelopeStore` (`./webhooks/site/repo.memory`). The subscription repo takes the versioned-write collaborator injected (`{ assertVersionedWrite }`), like `SqlWebhookSubscriptionRepo`.
