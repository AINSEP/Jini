---
"@jini-ai/core": minor
"@jini-ai/infra": minor
"@jini-ai/daemon": patch
"@jini-ai/provider-plugins": patch
---

Add optional provider-reported agent-run usage and an injected durable outbox queue-depth gauge. Classify tool failure counters as input, refused or internal while preserving span and incident behavior. Export only valid reported usage, preserving zero without estimating cost.
