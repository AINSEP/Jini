---
"@jini-ai/chat": minor
"@jini-ai/infra": minor
---

Add `@jini-ai/chat/core/assistant-tool-metadata` (assistant tool discovery and approval declarations, built on the generic history tools) and `trackOutboxDelivery` in `@jini-ai/infra/events/domain-outbox` (wraps an outbox bus so each background delivery is one traced `outbox.deliver` operation).
