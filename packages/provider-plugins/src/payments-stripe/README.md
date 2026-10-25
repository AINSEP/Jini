# `payments-stripe` (moved; not activated)

Moved unchanged on 2026-10-25 from `@jini-ai/capability-providers/adapters/stripe`. It implements the
legacy `@jini-ai/capability-providers` `PaymentsProvider` port (`charge` / `getCharge` / `refund`).

**Commerce's payment contract (`@jini-ai/commerce` `payments/contract`) is canonical.** This adapter does
not satisfy it: it has no idempotency keys, no verified webhooks, no evidence, no `unknown` outcome, it
throws instead of returning outcomes, and it reports a pending refund as `refunded`. Conversion to the
commerce contract is **deferred by the owner**. Until then no host selects, registers or activates this
provider, and it must not be wired to move money. When converted, payments select one provider per
account; they never fan out money-moving calls.
