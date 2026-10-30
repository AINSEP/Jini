# @jini-ai/commerce

Opt-in catalog contracts, checkout and webhook-inbox services, SQL repositories, payment providers,
payment/refund state machines, the sample store runtime, and a read-only React Payments overview.
Moved from Tovu for future reuse; Tovu keeps commerce off.

Importing this package never activates a provider, registers a route/tool/panel, seeds products, or
creates/reconciles tables. Payment and store activation require an injected `kernel` and an awaited
`prepareStorage` port. The host owns schema declarations, provenance, snapshots and recovery.
Catalog repositories borrow the six original `commerce_*` tables plus the two Phase 1 tables
below. The host owns their DDL.

| Export | Ownership |
| --- | --- |
| `@jini-ai/commerce` | Catalog contracts, checkout, inbox, status and storefront mapping |
| `@jini-ai/commerce/repo` | Shared Kysely queries and row mapping |
| `@jini-ai/commerce/payments/kernel` | Payments kernel: provider contract, `createPaymentsService` (`PaymentsPort`), reconciler/operator, grants, ledger port |
| `@jini-ai/commerce/payments/client` | Browser `openCheckout`: safe redirect or injected client-action handler |
| `@jini-ai/commerce/payments/ledger/sql` | SQL ledger adapter + migrations (needs `kysely`, `@jini-ai/db`) |
| `@jini-ai/commerce/payments/testkit` | Provider conformance cases and the deterministic LiPay fake |
| `@jini-ai/commerce/http` | Explicit raw-body payment webhook registrar |
| `@jini-ai/commerce/tools` | Explicit read-only status contributor |
| `@jini-ai/commerce/react` | Unregistered, read-only Payments overview; locale injected as a prop |

The package is separate because commerce owns financial domain invariants rather than database,
HTTP, UI or agent infrastructure. It reuses `@jini-ai/db/kernel`, `@jini-ai/core/primitives`, the
core tool registration builder, CMS authorization and UI dictionary translation.

Public runtime helpers use object inputs and an options object. A host constructing environment
credentials can pass `{ prefix: "TOVU_PAYMENT" }` to preserve its existing namespace; the generic
default is `JINI_PAYMENT`. Credentials remain outside portable databases.

An opting-in HTTP host must register the webhook handler before a blanket JSON parser: signatures
cover original bytes, not reserialized JSON. Provider errors are returned through typed results;
unexpected exceptions receive a fixed 500 response without logging credential-bearing errors.

## Phase 1: one-time hosted checkout

`checkout()` snapshots one active one-time price into a pending order. `payOrder()` reserves its
workspace/site/provider/account/mode and exact amount **before dispatch**, calls the payments
kernel with key `order:<id>`, then binds the returned payment. The kernel owns payment
idempotency; the provider receives the persisted attempt's id as its HTTP idempotency key.
The order becomes paid only through `settleOrderPayment`, after its association, scope,
reference, amount, currency and captured total match verified payment truth. A return-page visit
never establishes payment success.

Before enabling `payOrder`, the host must migrate its catalog schema. For Tovu this is an
ADR-066 TypeScript host migration; this package does not ship or run that host migration.
The two required tables, in addition to the original six, are:

```sql
CREATE TABLE commerce_price_provider_refs (
  workspace_id TEXT NOT NULL, price_id TEXT NOT NULL,
  provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test','live')),
  provider_price_ref TEXT NOT NULL CHECK (length(provider_price_ref) > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, price_id, provider_id, provider_account_id, mode));

CREATE TABLE commerce_order_payments (
  workspace_id TEXT NOT NULL, order_id TEXT NOT NULL,
  site_id TEXT NOT NULL, provider_id TEXT NOT NULL, provider_account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test','live')),
  amount_minor BIGINT NOT NULL, currency TEXT NOT NULL,
  payment_id TEXT NULL, -- reserved before dispatch; bound once afterward
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, order_id), -- arbitrates concurrent scopes/double clicks
  UNIQUE (workspace_id, mode, payment_id));
```

`commerce_orders` and `commerce_products` need no Phase 1 column changes. Payment ledger
migrations remain separate (`./payments/ledger/sql`); Phase 1 adds no ledger migration. The
success outbox JSON now includes `reference`; older payloads remain readable and the order
projector ignores payloads without a string reference.

The existing plugin host is the attachment authority. Install and integrity-verify the
`payments-stripe` artifact with its normal loader, supply `paymentsProviderContract` to the
provider host, and initialize with `{}`. Its factory receives no credentials. Wrap each lease
with `leasedProviderItem` before building the commerce registry; pin the binding explicitly.
The following composition assumes host-owned `contributions`, migrated `catalogKernel`,
`ledger`, `grants`, `alerts`, endpoint/configuration readers, a guarded `httpClient`, clock and
id ports. Authentication supplies `scope` and `memberId`; the browser does not select them.

```ts
import { checkout, payOrder, createOrderPaymentProjector } from "@jini-ai/commerce";
import { commerceProductRepoFor, commercePriceRepoFor, commerceOrderRepoFor,
  commercePriceProviderRefRepoFor, commerceOrderPaymentRepoFor } from "@jini-ai/commerce/repo";
import { createPaymentsService, createPaymentsOperator, createKernelProviderRegistry,
  createProviderContexts, leasedProviderItem, paymentsProviderContract,
  createWebhookReceiver, createInboxWorker, createOutboxRelay,
  type OutboxPublisherPort } from "@jini-ai/commerce/payments/kernel";
import { createPluginProviderHost } from "@jini-ai/plugins/host";

const bindings = { stripe: "payments-stripe" };
const providerHost = createPluginProviderHost({ contributions, contracts: [paymentsProviderContract] });
const lease = await providerHost.initialize({ contract: "payments", id: "stripe", input: {} });
if (!lease) throw new Error("selected payment provider unavailable");
const item = leasedProviderItem({ pluginId: "payments-stripe", lease });
if ("problem" in item) throw new Error(item.problem);
const providers = createKernelProviderRegistry({ items: [item] }, { bindings });
const contexts = createProviderContexts({ bindings, configFor, urlsFor, httpClient, now });
const kernelDeps = { ledger, grants, providers, contexts, now, newId };
const payments = createPaymentsService(kernelDeps, { alerts });
const operator = createPaymentsOperator(kernelDeps, { alerts });
const products = commerceProductRepoFor({ kernel: catalogKernel });
const prices = commercePriceRepoFor({ kernel: catalogKernel });
const orders = commerceOrderRepoFor({ kernel: catalogKernel });
const priceRefs = commercePriceProviderRefRepoFor({ kernel: catalogKernel });
const orderPayments = commerceOrderPaymentRepoFor({ kernel: catalogKernel });
const clock = { nowMs: now };
const settle = { orders, orderPayments, payments, alerts, clock };
const projector = createOrderPaymentProjector({ deps: settle });
const receiver = createWebhookReceiver({ ...kernelDeps, endpoints });
const worker = createInboxWorker(kernelDeps, { alerts });
// Minimal awaited publisher; a host bus must also await its projector subscriber.
const publish: OutboxPublisherPort = { publish: async ({ message }) => { await projector.handle({ message }); } };
const relay = createOutboxRelay({ ledger, now, publish });

const placed = await checkout({ deps: { products, prices, orders, clock, idGen },
  input: { workspaceId: scope.workspaceId, memberId, priceId, quantity: 1, provider: scope.providerId } });
const result = await payOrder({ deps: { orders, prices, priceRefs, orderPayments, payments, settle },
  input: { workspaceId: scope.workspaceId, orderId: placed.order.id, scope } });
// Return result to the browser; keep credentials, the provider port and ledger on the server.
```

Use `receiver` behind `registerPaymentsWebhookRoute` before JSON parsing. Endpoint configuration
pins the workspace, site, provider account and mode. Run one inbox worker and one outbox relay
per database; schedule their `runOnce({ limit })` calls and `operator.reconcileUnknown` in the
host. These queues currently read pending rows without multi-worker claims. A host bus must
propagate subscriber storage failures so the relay can redeliver. `fulfillment-blocked` alerts
acknowledge mismatches for operator repair; storage failures propagate. After repair, operators
can invoke the exported `settleOrderPayment` with the original payment and order reference.

In the browser, import `openCheckout` from `@jini-ai/commerce/payments/client` and call
`openCheckout({ next: result.payment?.next ?? null, navigate })`. Supply `navigate({ url })`;
only HTTPS and localhost/127.0.0.1 HTTP redirects are accepted. A null action means pending.
An embedded client action needs an injected `clientAction` handler.

The plugin owns `accountId` plus `test_secretKey`, `test_webhookSecret`, `live_secretKey` and
`live_webhookSecret` settings. `configFor({ siteId })` returns that site's configuration reader;
`urlsFor({ scope })` supplies webhook, return and cancel URLs. Missing or mismatched account/mode
credentials fail before a payment row is written. Unreadable configuration returns a fixed,
retryable refusal without exposing the reader's error. Phase 1 supports one account per site
and plugin, and one signed webhook endpoint per (site, account, mode).

A retired lease rejects new dispatch and returns unknown for reads/webhook verification;
webhooks receive 503 for redelivery. After detach, rebuild the registry without the provider.
A lost create-session response stays `unknown`: retrying the same order replays its payment,
without another dispatch. The reconciler raises `unknown-aged`; operator resolution or a late
signed webhook can settle it. An unbound reservation also survives a crash after dispatch.

Stripe Phase 1 supports automatic capture and hosted Checkout for AUD, BRL, CAD, CHF, CZK, DKK,
EUR, GBP, HKD, JPY, KRW, MXN, NOK, NZD, PLN, SEK, SGD and USD. Its adapter declares no refunds,
manual capture, void or disputes. LiPay is a test fake and rejects live-mode calls. Subscriptions,
purchase effects/entitlements, credits, the customer portal, taxes, coupons and invoices remain
deferred, as does retiring the older catalog webhook inbox in Phase 2. Automatic lost-response
redispatch and failed/canceled order projection are outside Phase 1.

The implementation adapts Open SaaS at `c2c6285bdb14b040584505372ad9bb062a0bca11` (MIT).
See [NOTICE](NOTICE); both commerce and the provider artifact retain attribution.

Runtime tests use real kernels and fixed test-only schemas. CMS schema, snapshots and cross-table
foreign-key integration tests remain in Tovu. See [source-map.md](source-map.md) for the extraction
boundary and coordinator build requirements. Phase 1's cross-package E2E specification is
`../provider-plugins/src/payments-stripe/__tests__/payments-stripe-kernel.test.ts`. Tests, builds, typechecks and
coverage were not run during this dispatch; validation and measured coverage remain pending.
