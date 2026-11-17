---
"@jini-ai/provider-plugins": minor
---

The Stripe payment provider no longer imports `@jini-ai/commerce`. Its provider-port types are a structural copy (`payments-stripe/contract.ts`, checked in both directions against commerce by a typecheck-only drift guard), and the two helpers it needs (`paymentError`, `moneyProblem`) arrive as `optional.context` from commerce's `paymentsProviderContract` through the host's `initialize` call. A host that registers the payments contract without those helpers now gets a plain-words `StripeProviderConfigError` (`payments_stripe_context_missing`) at initialize instead of a failure at the first payment.
