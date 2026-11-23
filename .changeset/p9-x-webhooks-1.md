---
"@jini-ai/integrations": patch
---

Move host-neutral webhooks code from the host. `./webhooks/site/signing`, `./webhooks/site/signing.keyring` and `./webhooks/site/subscriptions` bind the `t`/`v1` signature vocabulary, the wall-clock default and the ISO-clock subscription deps onto the canonical `./webhooks` implementation. The host's repo-scanning `seal-aad-invariant` check stays with the host.
