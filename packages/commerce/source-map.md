# Phase 12 commerce extraction

Owner authorization: commerce stays off but remains planned. This package is its reusable owner;
Tovu contains CMS-specific adapters and unchanged historical storage declarations only.

| Original Tovu source | Jini source |
| --- | --- |
| `apps/website/src/features/commerce/{contracts,types,ports,errors,checkout,webhook-inbox,storefront,status}.ts` | `src/catalog/` (same filenames) |
| `apps/website/src/features/commerce/{repo,repo.rows}.ts` | `src/catalog/` plus borrowed query types in `database.ts` |
| `apps/website/src/features/commerce/status-tool.ts` | `src/tools.ts` |
| `apps/website/src/features/plugins/lipay/` reusable runtime | `src/payments/` |
| `apps/website/src/features/plugins/store/store-plugin.ts` reusable runtime | `src/store/store-plugin.ts` |
| `apps/admin/src/features/commerce/` | `src/react/` |
| `apps/website/src/server/inbound/public-http/routes/site/payments-webhook.ts` | `src/http/payments-webhook.ts` |

## Phase 1 additions (2026-10-29)

Source implementation follows [PLAN-phase1.md](PLAN-phase1.md), revision 3. Runtime verification
and coverage measurement are pending; this inventory is not a validation result. Tovu still
keeps commerce off and must ship its host catalog migration before enabling `payOrder`.

| Ownership | Source |
| --- | --- |
| Pending order → reserved scope → intent → binding | `src/catalog/{load-payable-order,pay-order}.ts` |
| Scoped price mapping and atomic association repositories | `src/catalog/repo.{price-refs,order-payments}.ts`, exported from `./repo` |
| Evidence-verified, idempotent paid projection | `src/catalog/{settle-order-payment,order-projection}.ts` |
| Host artifact validator, lease guard and site credential adapter | `src/payments/{provider-contract,provider-contexts}.ts`, exported from `./payments/kernel` |
| Browser action handling | `src/payments/contract/checkout-client.ts`, exported from `./payments/client` |
| Stripe REST/session/signature translation and artifact setup | `../provider-plugins/src/payments-stripe/`; vendor code stays in that plugin |
| Cross-package E2E specification (P34–P35) | `../provider-plugins/src/payments-stripe/__tests__/payments-stripe-kernel.test.ts` |

The unused commerce `payments/plugin-contribution.ts` and the legacy plugin `stripe.ts` path
were removed in P11/P30. Provider attachment belongs to the existing plugin host; commerce
validates and guards its leases. The host owns the new `commerce_price_provider_refs` and
`commerce_order_payments` tables and constraints documented in the README. The payments ledger
has no Phase 1 schema change: only the success outbox payload gains the order reference.

Open SaaS adaptations (price mapping, session form, paid-session interpretation, ignored events
and browser checkout) derive from MIT-licensed `wasp-lang/open-saas` at
`c2c6285bdb14b040584505372ad9bb062a0bca11`; see both packages' `NOTICE`. User-row billing,
inline fulfillment/email effects and the portal were not copied. Lost responses stay unknown
without automatic redispatch; existing reconciliation, operator resolution and late webhooks
own recovery. The sections below retain the original extraction record.

Moved tests accompany their owners: catalog units, payment credentials/registry/state machines,
payment/refund/replay/webhook suites, HTTP raw-byte verification, stock checkout and React readiness/
locale suites. Refused-preparation tests use injected fakes and assert that SQL/HTTP never starts.
There are no module mocks in the new package.

Tovu keeps `features/commerce/repo.sqlite.ts` and its real CMS-schema/dialect integrations;
`features/plugins/{lipay,store}/{manifest,*-plugin}.ts` adapt the existing declaration/recovery engine;
unmounted store/product/status HTTP adapters keep CMS theme/authentication boundaries. Their future
transport tests explicitly opt in, independently of production composition. The old generic
implementations are removed, not re-exported through a parallel Tovu path.

Production composition no longer mounts commerce routes or installs its tool contributor. The
Payments panel, source-screen inventory, search/approval entries and store capability inventory entry
are removed. Both boot modes omit store/payment activation; catalog repositories are absent from
the production dependency bag. Orders/Products/Subscriptions/Billing placeholders remain planned.

`commerce_*`, `p_lipay__*`, `p_store__*`, publisher/provenance and namespace claims stay unchanged.
No migration, schema declaration change, schema drop or reconciliation-to-empty behavior was added.
The file-backed retention suite seeds all eleven historical tables and compares complete row values,
SQLite schema definitions and commerce declaration bookkeeping across two real boot compositions
and their data-related serve lifecycle. Fresh boot must not declare or seed store/payment storage.

Divergence from the original (commerce design §6, lot L8): catalog records carry `Money`
(`src/money/money.ts`: integer minor units + UPPERCASE ISO-4217) instead of `*Cents` + lowercase
currency — `unitAmount`, `compareAtAmount`, `totalAmount`. The host-owned `*_cents` columns keep
their names; `repo.rows.ts` maps them and normalizes legacy lowercase rows to UPPERCASE on read.

Current behavior explanations stay with the implementation. Removed composition explanations are
retained in `src/catalog/{host-adapter,module}-rationale.md`, `src/store/{bootstrap,capability}-rationale.md`
and `src/react/panel-rationale.md`; these records are not executable registrations.

## NEEDS-JINI-BUILD

New package and exports: `@jini-ai/commerce`, `/repo`, `/payments`, `/store`, `/http`, `/tools`, `/react`.
The coordinator must resolve/build this source package and its workspace dependencies before the
combined validation batch. Tovu declares the future registry range `^0.1.0`; no registry publication,
lockfile regeneration, dependency installation or dist build occurred in this dispatch. Local
validation needs the coordinator's normal source/build resolution until the owner publishes.

Tovu source consumers needing these exports are enumerated in the phase's `CHANGED-FILES.txt`.
Exact test paths are in `RERUN-TESTS.txt` under
`Tovu/ADS-memory/.local-artifacts/cleanup-program/phase-12-commerce/`.
Static source inventory: the four requested production source groups decrease from 3,842 to 271
lines (3,571 fewer), including retained adapters and manifests, excluding tests and external wiring.
