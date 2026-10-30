Software Architect(Review): **REPLAN before cloud dispatch.** The existing ledger is the correct foundation, but plugin attachment, order settlement, recovery, and shard boundaries need concrete decisions first.

Reviewed the plan, commerce source, provider plugin host/build, OpenSaaS reference at `c2c6285bdb14b040584505372ad9bb062a0bca11`, and relevant git history. Production files checked match the plan’s base; test/configuration differences are identified below.

1. **CHANGE — §0.2, §0.3, D12: use a working plugin attachment path.**  
   Three parts of the proposed recipe conflict with existing machinery:

   - The build emits `server/index.mjs`, not `./provider.js`.
   - The standard artifact loader requires a plugin definition with `setup`.
   - Manifest validation accepts only `contractVersion: 1`; version 2 is refused.

   Evidence: [build.ts:97](packages/provider-plugins/scripts/build.ts:97), [loader.ts:184](packages/plugins/src/host/node/loader.ts:184), [provider-contributions.ts:23](packages/plugins/src/host/provider-contributions.ts:23).

   Prefer extending the existing artifact registration/factory mechanism so its port implements commerce’s canonical `PaymentProvider`. Any alternative needs an explicit host-owned bridge, packaged entry point, and lifecycle contract before shards are dispatched.

2. **CHANGE — §0.2: distinguish the two plugin systems.**  
   `@jini-ai/agent-plugins`’ trusted contribution loader and `@jini-ai/plugins/host`’s provider artifact loader are separate mechanisms. Commerce’s contribution spec defaults to `plugin.json`; this distribution ships `jini.plugin.json`. Agent-plugin trust also depends on its own installation, activation, and bundled-digest records. Merely installing a provider artifact does not establish those records.

   Evidence: [plugin-contribution.ts:125](packages/commerce/src/payments/plugin-contribution.ts:125), [trusted-plugin-files.ts:85](packages/agent-plugins/src/lifecycle/trusted-plugin-files.ts:85), [provider-artifact.ts:16](packages/plugins/src/host/node/provider-artifact.ts:16).

   Name one attachment authority and show installation → activation → validation → commerce registration → detach. Do not introduce a parallel plugin lifecycle.

3. **ADD — §0.3: a concrete credential adapter with account/mode isolation.**  
   Plugin-owned field declarations are appropriate, but the plan treats scoped credential storage as already implemented. The existing settings port reads by `pluginId`; it has no provider-account or mode argument. Commerce’s `ProviderContextPort` is an injected host contract, not an implementation that supplies those guarantees.

   Evidence: [provider-config-source.ts:26](packages/plugins/src/host/provider-config-source.ts:26), [provider-registry.ts:76](packages/commerce/src/payments/provider-registry.ts:76).

   Name the adapter and storage mapping; require missing-slot, wrong-account, wrong-mode, and cross-site tests. Resolve signing secrets for the configured webhook endpoint, with an explicit Phase 1 constraint if only one endpoint per scope is supported. Also show `{ stripe: "payments-stripe" }` being passed as registry bindings: that pinning is optional today.

4. **CHANGE — §2.10–2.11, §4, D8: bind settlement to the intended order and payment scope.**  
   **D8 cannot be accepted.** A string `reference` is caller-supplied correlation, not proof that a payment settles that order. An unrelated smaller payment can use an order’s reference; the proposed projector would mark the full order paid. Test payments can also settle orders lacking a mode boundary.

   Evidence: [payments-port.ts:54](packages/commerce/src/payments/contract/payments-port.ts:54), [types.ts:88](packages/commerce/src/catalog/types.ts:88), [scope.ts:1](packages/commerce/src/payments/contract/scope.ts:1).

   Define a durable order/payment association and expected scope. Before `markPaid`, verify association, workspace, site, account, provider, mode, amount, and currency against authoritative records. Add negative tests for each mismatch.

5. **CHANGE — §2.12: specify payment-state mapping for every supported Checkout event.**  
   The webhook table’s `completed`, `async_payment_succeeded` → `succeeded` wording is unsafe. Checkout completion can precede payment settlement. A completion webhook also need not contain an expanded PaymentIntent.

   OpenSaaS fulfills from `invoice.paid` and requires `paid_at`; its guard must survive adaptation to Checkout events: [OpenSaaS webhook.ts:106](open-saas/ (clone c2c6285b) template/app/src/payment/stripe/webhook.ts:106), [webhook.ts:266](open-saas/ (clone c2c6285b) template/app/src/payment/stripe/webhook.ts:266).

   Define unpaid completion as nonterminal, paid completion as success, and async success/failure explicitly. Specify behavior when the PaymentIntent is only an ID; reuse worker retrieval where needed. Stripe documents the distinction between session completion and payment status. [Stripe Session reference](https://docs.stripe.com/api/checkout/sessions/object)

6. **ADD — §2.12: separate unsupported events from malformed supported events.**  
   `sessionEvidence(): null` currently combines “foreign session” and “malformed session.” Combined with `ok([])`, this can acknowledge and discard a supported payment event.

   Ignore authenticated unsupported event types and deliberately foreign sessions. A supported event with our correlation metadata but missing required evidence must produce a defined failure or an id-only fact for retrieval. Validate event/session identity, `mode=payment`, timestamps, and `livemode` against trusted context before producing facts.

   Evidence: [evidence.ts:83](packages/commerce/src/payments/contract/evidence.ts:83), [receive.ts:84](packages/commerce/src/payments/ingest/receive.ts:84). Current receiver validation checks only the two fact IDs; it cannot supply the omitted Stripe validation.

7. **CHANGE — §2.1, §2.12: make unit pricing and currency translation exact.**  
   The request carries the **order total**, while Stripe’s inline `unit_amount` is multiplied by quantity. Specify checked division or carry the snapshotted unit amount; never send the total as unit price when quantity exceeds one. Reject inconsistent totals before returning a redirect.

   Evidence: [checkout.ts:161](packages/commerce/src/catalog/checkout.ts:161), [checkout.ts:179](packages/commerce/src/catalog/checkout.ts:179).

   Also replace `currencies: "any"` with supported behavior. Core uses ISO minor units, including zero-decimal ISK/UGX; Stripe represents those two currencies differently. Implement reversible plugin-local conversion or refuse them. Test USD, JPY, quantity >1, overflow, and currency exceptions. [money.ts:24](packages/commerce/src/money/money.ts:24), [Stripe currency rules](https://docs.stripe.com/currencies)

8. **CHANGE — §2.10, D9: describe replay behavior accurately.**  
   A same-key retry does not dispatch another create request. `lookupIntent` returns the existing payment immediately—even a previously rejected intent currently returns `ok: true, replayed: true`. Therefore D9’s “replay of the failed payment” is not a replay of the original error.

   Evidence: [intent.ts:58](packages/commerce/src/payments/ops/intent.ts:58), [intent.ts:147](packages/commerce/src/payments/ops/intent.ts:147).

   Decide and test rejected-intent replay explicitly. Commit `a624c16709a0ddcf78f3af9e5b7da9305939ba65` establishes the analogous stored-rejection behavior for refund/capture/void; it did not fix intents. Do not imply that retrying `payOrder` creates a fresh session.

9. **ADD — §2.12, §5: recovery for a lost create-session response.**  
   A timeout leaves `providerRef=null`. The reconciler refuses retrieval without that reference, and ordinary replay will not resend the create request. If the browser never received a checkout URL, no shopper payment webhook may arrive to repair this.

   Evidence: [intent.ts:93](packages/commerce/src/payments/ops/intent.ts:93), [reconcile-snapshot.ts:20](packages/commerce/src/payments/ops/reconcile-snapshot.ts:20).

   Specify bounded recovery using the original persisted provider idempotency key and unchanged request, or an explicit operator-only outcome. Do not add a blind new-key retry. Distinguish concurrent same-key `409` from parameter conflict; Stripe advises preserving the original key for unresolved operations. [Stripe error handling](https://docs.stripe.com/error-low-level)

10. **CUT — §1, §2.8, D4: unused purchase effects from Phase 1.**  
    The plan explicitly says nothing consumes the effect. Adding credits data, validation, a new cap, and a product column does not help a one-time payment become paid. Defer those changes to the credit-ledger phase.

    Existing `kind` and `grantsMemberTierId` already express part of this domain: [types.ts:32](packages/commerce/src/catalog/types.ts:32). When effects arrive, define purchase-time snapshots and reconcile ownership with `grantsMemberTierId`; the proposed future subscription effect duplicates that field’s purpose.

11. **CUT — §2.1–2.4, D5: customer portal from this minimal purchase phase.**  
    Without customer creation/mapping, this checkout produces no trusted customer reference for the new portal operation. OpenSaaS resolves the customer from the authenticated user; the proposed API instead accepts a caller-supplied reference.

    Evidence: [OpenSaaS paymentProcessor.ts:57](open-saas/ (clone c2c6285b) template/app/src/payment/stripe/paymentProcessor.ts:57), [operations.ts:58](open-saas/ (clone c2c6285b) template/app/src/payment/operations.ts:58).

    Defer portal support with customer identity. If retained by explicit scope choice, require host authorization of customer ownership. Also preserve separate checkout-success and portal-return destinations: OpenSaaS distinguishes them in [paths.ts:19](open-saas/ (clone c2c6285b) template/app/src/payment/paths.ts:19).

12. **CHANGE — §0.6, D13: narrow the cross-vendor compatibility claim.**  
    The proposed field names are vendor-neutral; no new core field is inherently Stripe-only. However, quantity cannot be “ignorable” unless the adapter still charges the exact requested aggregate amount. Quarantine after duplicate or incorrect charges is detection, not prevention. Current same-key kernel replay also does not perform the “kernel retry” described in that table.

    Preserve `PaymentEvidence.amount` as authorized/charged money. Do not preapprove D13’s change to compare pre-tax amounts: capture/refund arithmetic relies on its existing meaning. [evidence.ts:61](packages/commerce/src/payments/contract/evidence.ts:61), [plan-evidence.ts:295](packages/commerce/src/payments/accounting/plan-evidence.ts:295).

    Keep subscription facts and gross/subtotal/tax modeling as explicit later designs, without Stripe fields in core.

13. **CHANGE — §2.10–2.11: define failure and acknowledgement behavior.**  
    `payOrder` must require exactly one valid order item and preserve its snapshot rather than silently taking the first item. Define missing-price and malformed-item outcomes.

    For projection, distinguish harmless redelivery from missing orders, storage failures, and canceled orders receiving money. A successful return from the publisher causes the relay to mark the message published; returning `not_found` without an escalation policy can permanently lose fulfillment.

    Evidence: [ports.ts:42](packages/commerce/src/catalog/ports.ts:42), [outbox-relay.ts:69](packages/commerce/src/payments/ingest/outbox-relay.ts:69). Reuse existing alert/recovery ports; no new inbox is needed.

14. **CHANGE — §2, §3: correct the contract and file map.**  
    Concrete omissions:

    - `providerSummary` lives in `ops/view.ts`, not `ops/service.ts`.
    - `IntentRequest` has no `reference`; D10 cannot use it. Use the correlation ID or a neutral label.
    - `PaymentView.next` is nullable; `openCheckout` must handle that direct input.
    - Product deserialization is `toProductRecord`, not `fromProductRow`.
    - Provider types are exported from `@jini-ai/commerce/payments/kernel`, not the root.

    Evidence: [view.ts:40](packages/commerce/src/payments/ops/view.ts:40), [provider.ts:79](packages/commerce/src/payments/contract/provider.ts:79), [payments-port.ts:29](packages/commerce/src/payments/contract/payments-port.ts:29), [repo.rows.ts:45](packages/commerce/src/catalog/repo.rows.ts:45).

    Keep `(requiredObj, optionalObj = {})`, injected ports, and complexity ≤10.

15. **CUT / CHANGE — §2.12, §0.5: remove unnecessary options; implement the promised fake restriction.**  
    `apiBase` is unnecessary for fake HTTP tests because `ctx.httpClient` already supplies the seam. Timestamp-boundary tests can use `ctx.now`; configurable tolerance is unnecessary for this phase.

    Conversely, “LiPay must never be selectable live” is currently only prose. The fake’s `createIntent` does not inspect context mode, and the common provider check has no such restriction: [lipay-fake.ts:105](packages/commerce/src/payments/testkit/lipay-fake.ts:105), [common.ts:40](packages/commerce/src/payments/ops/common.ts:40). Assign a test-only composition or fake-local guard; do not add LiPay-specific policy to generic core.

16. **CHANGE — §4, §6: make schema and fixture dependencies executable.**  
    Keeping catalog schema host-owned is consistent with [database.ts:3](packages/commerce/src/catalog/database.ts:3). README DDL alone does not migrate a host.

    Name the host migration owner and rollout prerequisite for retained schema changes. Update existing borrowed-schema fixtures in the same dependency step: [repo.vitest.test.ts:37](packages/commerce/src/catalog/__tests__/unit/repo.vitest.test.ts:37). New required `markPaid` and capability fields also affect existing fake ports outside the proposed file sets; for example [checkout.unit.test.ts:26](packages/commerce/src/catalog/__tests__/unit/checkout.unit.test.ts:26).

17. **CHANGE — §6: rebuild the shard schedule around actual dependencies and the hard cap.**  
    The current schedule cannot meet its stated guarantees:

    - S10 excludes roughly 480 deleted lines from a cap that includes changed lines.
    - S1’s required capability changes invalidate fixtures omitted from S1.
    - S2 omits `ops/view.ts` and provider-list assertion updates.
    - S7 requires redirect-capable LiPay scripting, but S1 exclusively owns that file.
    - Splitting tests into a later shard conflicts with independently verified behavior and failing-test-first.

    Evidence: [plugin-contribution.vitest.test.ts:25](packages/commerce/src/payments/__tests__/kernel/plugin-contribution.vitest.test.ts:25), [read-tools.vitest.test.ts:50](packages/commerce/src/payments/tools/__tests__/read-tools.vitest.test.ts:50).

    Re-estimate additions **and deletions**, keep each behavior with its tests, and schedule shared-file changes sequentially. Route any conflict between absolute file disjointness and green contract migrations through Coordinator before dispatch.

18. **ADD — §5: tests that prove the actual Stripe flow and failure boundaries.**  
    The LiPay fake currently succeeds synchronously during `createIntent`; it can let an E2E test pass before webhook processing matters: [lipay-fake.ts:105](packages/commerce/src/payments/testkit/lipay-fake.ts:105).

    Add a full kernel test using the actual Stripe adapter with injected HTTP responses and independently signed webhook bytes. Prove unpaid completion stays pending, later success settles exactly once, reordered events do not regress, mismatched amounts/scopes never settle, and lost responses follow the defined recovery policy. Signature cases must include malformed digest lengths and exact-byte preservation. Extend the existing packed-artifact test rather than replacing it with parser-only assertions: [artifact.integration.test.ts:70](packages/provider-plugins/src/__tests__/artifact.integration.test.ts:70).

19. **CHANGE — §5: specify a real coverage gate across both runners.**  
    On pinned commit `32226f0e`, `test:coverage` exists, but `vitest.coverage.config.ts:10` includes only `.vitest.test.ts` and React tests. Catalog `.unit.test.ts` files use `node:test`. The proposed new tests must declare their runner; the root catalog glob also selects filenames ending `.vitest.test.ts`.

    Evidence: [package.json:90](packages/commerce/package.json:90), [checkout.unit.test.ts:1](packages/commerce/src/catalog/__tests__/unit/checkout.unit.test.ts:1).

    Define measurement for both runners, machine-readable reports, denominator, and explicit thresholds. Preserve existing coverage scope and assertions; report baseline and final test counts. The current checkout’s missing coverage command is checkout drift, not an original-plan defect.

20. **CHANGE — §7, S10: package attribution and record the adaptation accurately.**  
    Copyright and MIT identification are correct: [OpenSaaS LICENSE:1](open-saas/ (clone c2c6285b) LICENSE:1). But the build does not copy a plugin-local source `NOTICE`; it retains license files from owning package roots. Commerce’s published file list also omits `NOTICE`.

    Evidence: [build.ts:49](packages/provider-plugins/scripts/build.ts:49), [build.ts:97](packages/provider-plugins/scripts/build.ts:97), [package.json:76](packages/commerce/package.json:76).

    Ship the full notice/license in both relevant distributions and test packed contents. Pin the reference commit in provenance. The effect and price-map attributions are accurate; client navigation and ignored-event adaptations are appropriate. Explicitly record the changed fulfillment trigger and omission of customer-dependent `customer_update`. Taxes, promotion codes, invoices, user counters, and inline billing emails can remain outside Phase 1.

21. **CHANGE — §0.4: make the boundary check inspect executable behavior.**  
    A blanket “no `api.stripe.com` outside the plugin folder” check also catches legitimate test expectations and its own test fixture. Existing occurrences already include [payments-stripe.test.ts:52](packages/provider-plugins/src/__tests__/payments-stripe.test.ts:52).

    Check production request destinations/imports with explicit test handling, and enforce no sibling-plugin imports. Preserve the existing SDK boundary scanner. Describe it as a test gate: the distribution build itself does not invoke that test.

The smallest Phase 1 retains `checkout`, `PaymentsPort.createIntent`, `NextAction`, existing provider options where appropriate, the scoped ledger, inbox/worker, single writer, outbox, and storefront. Add only the necessary purchase description/mapping, safe order association/projection, redirect handling, and the converted **existing** Stripe plugin.

**Files changed:** Jini none; Tovu none. **Production lines:** +0 / −0. No tests, builds, installs, or servers run.

**Verdict: REPLAN.**
