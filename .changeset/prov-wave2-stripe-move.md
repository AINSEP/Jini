---
"@jini-ai/capability-providers": patch
"@jini-ai/provider-plugins": patch
"@jini-ai/devops": patch
---

The Stripe `PaymentsProvider` adapter moved unchanged out of `@jini-ai/capability-providers` into the `payments-stripe` provider plugin (move only: commerce's payment contract is canonical, conversion is deferred, and no host selects or activates it). Removed: the `@jini-ai/capability-providers/adapters/stripe` subpath. The hardwiring check treats `provider-plugins/` sources as provider adapters.
