Software Architect(Direct): Loaded `/Users/la/Programming/Tovu/AI-Dev-Shop/agents/software-architect/skills.md` and acted as Software Architect.

**1. Goal**

Ship plugin-controlled, one-time Stripe checkout through Jini’s existing commerce kernel, retire Tovu’s dormant legacy runtime, and defer geo + fraud until that path works.

**2. Findings**

Both clones are on `merge-1029`. This was static inspection only; no files changed and no tests, builds, installs or servers ran. Graph tools were unavailable.

- **Commerce is currently off.** Tovu explicitly mounts no store, product or payment routes. The follow-through audit overstates the remaining “live legacy” problem. [app.ts:2478](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/app.ts:2478)
- **LiPay is already a dormant kernel adapter**, absent from boot/routes/tools. Its header incorrectly mentions importing old data; the actual migration history explicitly forbids that import. [lipay-plugin.ts:60](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/plugins/lipay/lipay-plugin.ts:60), [payments migrations:38](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/payments/ledger/migrations/index.ts:38)
- **Phase 1 exists, with a recovery gap.** Reusing an intent key returns the stored unknown payment without redispatch; reconciliation cannot retrieve it without a provider reference. The current test expects this unresolved state. That contradicts the settled lost-response recovery requirement. [intent.ts:83](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/payments/ops/intent.ts:83), [reconcile-snapshot.ts:25](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/payments/ops/reconcile-snapshot.ts:25), [lost-response test:27](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/payments/ops/__tests__/lost-response.vitest.test.ts:27)
- **Reuse the existing attachment mechanisms.** Stripe registers a `payments` provider; its agent face already links to that provider’s single activation switch. Tovu’s current provider validators cover telemetry only. [Stripe setup:19](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/provider-plugins/src/payments-stripe/index.ts:19), [stripe/plugin.json:12](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/stripe/plugin.json:12), [provider-contracts.ts:8](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/provider-contracts.ts:8)
- **Catalog DDL is missing from Tovu.** Jini borrows eight host-owned tables; its tests create them explicitly. Migration `0011` currently throws when old core commerce tables contain rows. A later migration alone cannot repair that blocked upgrade. [database.ts:3](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/catalog/database.ts:3), [borrowed-schema fixture:37](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/catalog/__tests__/unit/repo.vitest.test.ts:37), [0011:202](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/platform/db/migrations/0011_drop_empty_core_commerce_tables.ts:202)
- **Settlement safeguards already exist:** durable order/payment reservation, stable `order:<id>` payment keys, exact scope/amount/currency checks, and an outbox projector. Reuse them. [pay-order.ts:25](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/catalog/pay-order.ts:25), [settle-order-payment.ts:54](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/catalog/settle-order-payment.ts:54)
- **The duplicate catalog inbox still exists** in the database contract and repository port. Do not treat the audit’s “gone” claim as verified; leave retirement in Phase 2. [ports.ts:98](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/catalog/ports.ts:98)
- **Geo/FraudGraph ports were not found.** The existing risk port accepts payment scope, amount and party identity, but no location. Stripe currently advertises automatic capture only; wiring `review` now would reject payments requiring manual capture. [risk.ts:25](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/payments/contract/risk.ts:25), [Stripe capabilities:9](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/provider-plugins/src/payments-stripe/provider.ts:9)
- **UNVERIFIED:** runtime correctness, actual database contents, sandbox credentials, deployed webhook reachability and measured payload sizes. Existing PostgreSQL ledger contract tests are present, but were not executed. [ledger-contract.ts:10](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/payments/ledger/__tests__/ledger-contract.ts:10)

**3. Ordered delivery plan**

Paths below: **T** = Tovu `apps/website/src`; **J** = Jini `packages`. Line estimates include tests and exclude generated output.

1. **Ship upgrade safety while commerce stays off — +250–400 / −20–40 lines.**
   Files: `T/platform/db/migrations/{0011_archive_legacy_commerce.ts,index.ts,checksums.ts}`, existing commerce-retention tests.
   Add a checksummed preservation step immediately before unchanged `0011_drop_empty_core_commerce_tables`. When populated historical core tables exist, archive their complete related table set, preserving rows, references and index identities; warn clearly. Leave `p_lipay__*` and `p_store__*` intact and never import them into the kernel.
   This narrowly inserted compatibility step uses the runner’s existing pending-ID handling; do not rewrite applied checksums or fabricate migration success. [runner.ts:131](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/db/src/migrate/runner.ts:131)
   **Tests first:** populated pre-0011 upgrade boots with warning; empty/fresh/already-upgraded databases; repeated and concurrent boots; archive retention through backup/restore, on SQLite and PostgreSQL.

2. **Ship automatic lost-response recovery in Jini — +350–550 / −40–80 lines.**
   Files: `J/commerce/src/payments/{ops/intent.ts,ops/reconcile-snapshot.ts,ledger/rows.ts,ledger/repo*,ledger/migrations/*}` and Stripe recovery tests.
   Persist the credential-free dispatch snapshot before sending money. Recover only eligible unknown intents using the original request, correlation ID and idempotency key, with bounded attempts and provider-defined replay eligibility. Concurrent recovery must claim one attempt; never invent a fresh charge key.
   Add an ADR-066 TS ledger migration only for the missing durable recovery fields. Legacy unknown rows without a snapshot remain visibly unresolved.
   **Tests first:** lost response before/after provider acceptance, restart, concurrent retries, parameter mismatch, late webhook and exhausted recovery. Preserve existing completed≠paid and zero-decimal-currency tests.

3. **Ship the dormant commerce plugin and host composition — +450–700 / −20–50 lines.**
   Files: new `J/agent-plugins/commerce/{plugin.json,skills/commerce/SKILL.md,server/*}`, package exports; `T/features/agent-plugins/bundled-catalog.ts`; new `T/server/runtime/composition/commerce.ts`; catalog TS migration plus type/checksum fixtures.
   Publish as `@jini-ai/agent-plugins/commerce` with a Node server subpath. Inject Jini commerce services, provider leases, configuration, HTTP, clocks and authorization. The commerce plugin never imports the Stripe plugin.
   Reuse `createPluginProviderHost`, `paymentsProviderContract`, `createKernelProviderRegistry`, `createProviderContexts`, sealed provider settings and the versioned activation reader. Add no second registry, credential store or activation poll. [activation-effects.ts:21](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/agent-plugins/activation-effects.ts:21)
   Apply host catalog DDL and existing ledger migrations automatically on activation. Missing settings or activation failure produces a specific warning and unavailable checkout; the CMS continues running.
   **Tests:** plugin isolation, disabled/default state, manifest validation, wrong account/mode, duplicate provider claim, detach/quarantine, migration idempotency and database parity.

4. **Ship one complete purchase path — +650–950 / −80–150 lines.**
   Files: plugin server/tool adapters; `J/commerce/src/{tools.ts,catalog/status.ts}`; `T/server/runtime/composition/{commerce.ts,app.ts,deps.ts}`; public commerce routes; existing `routes/site/products.ts`, admin status adapter and site render mapper.
   Add only catalog setup/status tools and authenticated one-price purchasing. Reuse existing tool registration/approval contracts, member sessions and request-origin/rate checks. Obtain member, site, account and mode from trusted host context.
   Create a pending order separately; pay/resume that owned order through `payOrder`. Repeated payment requests reuse its ID. Return/cancel pages read ledger truth and never mark an order paid.
   Reuse the raw-body webhook adapter before JSON parsing, inbox worker, outbox relay and order projector. Run one serialized worker owner per database, never a duplicate daemon loop. Relay acknowledgment must await durable projection. [webhook route:123](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/http/payments-webhook.ts:123), [relay:59](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/commerce/src/payments/ingest/outbox-relay.ts:59)
   Replace the store-backed product resolver with a bounded Jini catalog projection; reuse the existing storefront mapper and add bulk price reads rather than per-product queries. Correct currency display before exposing supported currencies—the current renderer hardcodes dollars and `/100`. [render.ts:2843](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/http/site/render.ts:2843)
   **Tests:** HTTP purchase through signed webhook to paid order; foreign member/workspace/account/mode; duplicate clicks/events; forged return URL; unpaid completion; process crash at each acknowledgment boundary; worker ownership; specific recoverable errors.
   **Rollback:** disable new purchases through the plugin switch; retain all data and an explicitly disclosed settlement drain for payments already started.

5. **Ship legacy runtime retirement — +80–150 / −500–850 lines.**
   Files: `T/features/plugins/{lipay,store}/` runtime and obsolete tests; product/status imports; `server/runtime/composition/data-modules.ts`.
   Remove dormant activation/demo code and the `lipay` runtime naming. Retain only historical declarations needed for namespace protection and portability; they must never activate or seed tables.
   **Tests:** no production legacy imports, no fresh legacy tables, preserved historical rows/claims, backup/share/duplicate parity, and commerce-off route behavior.

6. **Later: ship geo enrichment independently — +450–700 / −0–20 lines.**
   Files: new `J/commerce/src/risk/{contracts,geo,storage}`; commerce-plugin context adapter; host-owned risk TS migrations.
   Add `GeoPort` with SQLite and PostgreSQL/PostGIS adapters behind one contract. Record purchase-location provenance separately from buyer-declared location; missing location means unknown. Feed enrichment from durable events, outside the money transaction. Extension absence warns and leaves checkout usable.
   **Tests:** unavailable location, coordinate validity, distance boundaries, adapter parity, tenant isolation, retention and event replay.

7. **Later: ship advisory fraud graph independently — +600–950 / −0–20 lines.**
   Files: new `J/commerce/src/risk/{graph,projector,assessment}`; commerce-plugin read/report tool; risk TS migrations.
   Add `FraudGraphPort` with bounded SQL-backed graph projections; reuse existing outbox delivery and dedupe by event ID. PostgreSQL-specific JSONB/GIN belongs in its adapter. No separate graph service initially.
   Persist the risk delivery before acknowledging the commerce event; perform enrichment/graph work afterward, so its service failures cannot delay order settlement.
   **Tests:** duplicate/out-of-order events, crash replay, cross-tenant edges, bounded traversal, stale signals, explainable reasons and checkout continuity during risk failure.

All new public boundaries take `(requiredObj, optionalObj)`. Complexity ceiling: 10; 9 for any desktop change. No desktop change is currently needed. Generic behavior stays in Jini; Tovu supplies adapters only.

**4. Added I/O cost**

These are **proposed frequencies and payload budgets, UNVERIFIED measurements**. Logical row traffic excludes indexes, WAL and transport overhead.

| Added operation | Frequency × payload |
|---|---|
| Preservation/DDL | Once per affected database: ≤6 table probes/counts + fixed metadata writes; one existing backup reads/writes database size **D** |
| Plugin loading | Once per activation/version change × approximately 10–30 KiB manifest/guidance/modules |
| Activation guard | One filesystem stat per entry/tick; activation file **A** bytes read only when its version changes |
| Provider configuration | One sealed settings read per provider operation × approximately 1–4 KiB; one same-sized write per settings save |
| Catalog setup tools | Per edit: bounded product/price reads and 1–2 row writes × approximately 1–4 KiB each |
| Storefront | Per uncached page: ≤2 bounded queries × ≤24 product/price summaries, target ≤48 KiB total |
| Order creation | Per submitted order: session/product/price reads × ≤2 KiB each; order + item writes × ≤2 KiB each |
| Pay/resume | Per request: O(1) catalog/ledger transactions, approximately 10–40 KiB logical traffic; one Stripe request/response approximately 2–20 KiB |
| Recovery | At most 3 automatic redispatches per eligible unknown intent, original key; same network budget plus snapshot/attempt updates |
| Webhook | Per delivery: ≤1 MiB raw input; per fact, deduplicated inbox write approximately 1–8 KiB; no provider HTTP call |
| Inbox + relay | While active/draining: one serialized cycle/5 s, batch ≤25; two empty scans/cycle; populated batch ≤200 KiB inbox + ≤25 KiB events, plus ledger/projection writes |
| Reconciliation | Once/60 s while active/draining: three bounded scans, limit 10 each; ≤30 eligible provider calls/pass × approximately 2–20 KiB |
| Status/alerts | On demand, no UI poll: ≤4 KiB response; state-transition diagnostics approximately 0.5–2 KiB each, without secrets |
| Later geo/graph | Per event: one durable queue record + dedupe update, ≤1 KiB context read, bounded ≤5 KiB projection writes; local geo lookup, no external lookup by default |
| Later risk reports | On demand: ≤100 nodes/200 edges × target ≤64 KiB; retention once/day in batches of 100 |

Stop commerce polling when neither active commerce nor unsettled work remains. Reuse existing activation polling and outbox scheduling.

**5. What this will NOT do**

No legacy payment import or data deletion; no PayPal, donations, subscriptions, cart, tax/subtotal redesign, entitlements, customer portal, refunds or manual capture. No third-party plugin trust expansion or duplicate-inbox retirement.

**CUT-CANDIDATES:** dedicated commerce admin screens, product-image workflow, inventory, automatic webhook provisioning, new graph infrastructure, collecting location before geo ships, and synchronous risk holds/bans. Keep these parked.

**Recommendation: geo + fraud should wait.** First establish reliable checkout and settlement. Ship geo next, then advisory graph reports. Do not connect custom scores to the synchronous risk gate until capture/review operations have their own approved design.

**6. Effort and dependencies**

| Stage | Codex work, including implementation and focused verification |
|---|---:|
| 1. Upgrade safety | 5–8 hours |
| 2. Lost-response recovery | 8–14 hours |
| 3. Dormant plugin/composition | 8–12 hours |
| 4. Complete purchase path | 14–22 hours |
| 5. Legacy retirement | 4–6 hours |
| **Commerce total** | **39–62 hours** |
| 6. Geo | 12–18 hours |
| 7. Advisory fraud graph | 18–28 hours |

Dependency chain: **1 → 3; 2 + 3 → 4 → 5**. Each release remains usable without later stages. Geo follows stable stage 4; graph follows the durable event/context contract. Estimates exclude waiting for credentials and deployment access.

**7. Owner questions**

- **Can commerce receive Stripe callbacks at a public website address?** Recommendation: use a deployed HTTPS site for payment acceptance; desktop remains the management interface. Reachability is unverified and must be demonstrated before live payments.
- **How much location information should the later fraud feature retain?** Recommendation: country/region and pseudonymous customer links for 30 days initially; no precise address or stored raw IP. Keep location collection off until that policy is approved.