# Commerce branch review (Opus)

Reviewed: Tovu `e327c07c8..origin/cloud/commerce`, Jini `6f507852d..origin/cloud/commerce`, read-only. Nothing was run. Line numbers are in the branch versions of the files.

Coverage limit: I stopped at the context budget. All non-test production diffs were read, plus the Jini order, ledger, ingest and reconcile paths. Test files were checked only by their test names (one settlement, composition and integration file each), so finding M9 is limited to what those names show. Not read: `repo.sql.ts` beyond the scans listed, `apply-evidence.ts`, Stripe `session-reading.ts`/`http.ts`, the worker/drain unit tests and the browser tests.

Counts: 0 critical, 6 high, 10 medium.

## High

### H1. `/products` returns 404 on every commerce-off site, overriding real CMS pages
- Where: `apps/website/src/server/runtime/composition/commerce-http.ts:22-36`, mounted at `composition/app.ts:2482`, before `registerSiteRoutes` (`/:slug` catch-all) at `app.ts:2566`. `composition/deps.ts` always sets `routeDeps.commerce`. `platform/routing/reserved-paths.ts:59` reserves only `admin` and `api`.
- Failure: a site with commerce off (the default) and a published page with slug `products`, or a nested `/products/x`, now gets `404 "This shop is not accepting purchases."` from the `app.use` guard. Base mounted no product route, so that page rendered before. The same 404 appears whenever an active shop is briefly not ready. No commerce-off test requests `/products` with a CMS page present (from test names and a file grep).
- Fix: in the guard, call `next()` when `!status.active`, so off commerce falls through to the catch-all. Keep the 404 only for active but unready shops, or fall through there too.

### H2. One "blocked" order stops settlement for all later orders, indefinitely
- Where: `composition/commerce.ts:1355-1358` (diff lines; the `createOutboxRelay` publish callback) throws on `blocked` and `not_succeeded`. `payments/ingest/outbox-relay.ts:69-76` stops the batch on a throw and leaves the rest pending, in order. `catalog/settle-order-payment.ts:18` documents blocked as an "acknowledged" mismatch that stays visible to operators.
- Failure: a single `payment.succeeded` message whose settlement returns `blocked` (amount differs from the order, second payment, `association missing`) or `not_succeeded` (for example a refund landing before the relay ran, since `payment.status` derives to `refunded`) is retried every 5 s and never published. Every later buyer's message sits behind it, so they are charged and their orders stay `pending`. The operator sees one deduped warning (`alerted` set, `delayed` flag). There is no operator tool to clear it (see H4).
- Fix: throw only on real storage failures. `blocked` already raised its alert, so acknowledge it and let the message publish. Treat `not_succeeded` the same, or park it per message. Add a test with one blocked message followed by one good message, asserting the second order is paid.

### H3. A paid order stays unpaid if the webhook is missed; nothing asks the provider
- Where: `payments/ledger/repo.sql.ts:366-372` (`listUnknownPayments` selects only `intent_status = 'unknown'`); `ops/intent.ts:84-98` (replay returns stored state, no retrieve); `readOwnedCommerceOrder` is ledger-only; Stripe `retrieve` exists but is never called for `requires_action`.
- Failure: webhook setup is manual (skill step 3), and `ready` does not prove delivery. With a wrong signing secret, an unregistered endpoint, or an outage longer than Stripe's retry period, the buyer pays, a `requires_action` payment never changes, the order never becomes paid, and neither the return page, a pay retry nor the reconciler ever checks Stripe. The same gap applies when `checkout.session.expired` is missed: a pay retry keeps returning the dead session URL, and the row counts as pending forever (feeds H4).
- Fix: extend reconciliation to `requires_action`/`pending` rows older than a threshold (for example 15 min, using the existing bounded scan and cursor), through `retrieve` and the single writer.

### H4. Unresolved payments can permanently block merchant changes and keep the worker running, with no way to clear them
- Where: `ops/intent-recovery.ts:52-58` (`recoveryAttempts >= 3`, 23 h window); `composition/commerce-drain.ts:14-18` and `commerce.ts` `hasPending` (`intent_status NOT IN ('succeeded','failed','canceled')`); `commerce-drain.ts:27-29`. Only `reconcileUnknown` is used from the operator; `resolveUnknown` (`ops/operator.ts:79`) and the payments tools are not registered in Tovu.
- Failure: reconciliation runs once a minute and a failed replay releases its claim immediately, so a Stripe outage of about 3 minutes uses all three recovery attempts, far short of the 23 h window. Also, Stripe replays a cached 5xx for the same key. The row then stays `unknown` forever. Results:
  - the buyer sees "still updating" indefinitely, because `paymentRefusal` offers a new order only on terminal status;
  - any later change of account, mode or origin makes `selectCommerceDrain` return a problem, so checkout and the storefront are off permanently;
  - with commerce disabled, `hasPending` stays true, so the 5 s worker never stops and holds one pool connection on PostgreSQL.
  The owner has no tool to resolve any of this.
- Fix: back off recovery attempts across the window (time-based, not a count burned in minutes). When the window ends for a reference-less row, move it to a terminal state or expose `resolveUnknown` as an owner tool. For a reference-less Stripe Checkout row no redirect URL ever reached the buyer, so no money could have moved. Confirm that rule per provider. Offer "Start a new order" for aged unknown orders.

### H5. Prices cannot be corrected: the lowest active price is sold forever
- Where: `catalog/repo.storefront.ts:28-33` (`row_number() ... order by unit_amount_cents asc`); `catalog-tools.ts` has only `commerce_create_product` and `commerce_create_price`; the description calls prices immutable.
- Failure: the owner mistypes 1000 as 100 and then creates the correct price. The storefront still picks the cheapest, so it keeps showing and selling 100. No tool archives a price or product, so the only fix is direct SQL. A 0.01 typo costs real money on every sale. `POST /orders` also accepts any active `priceId`, so an old price remains buyable even after a UI fix unless the price is archived.
- Fix: add `commerce_archive_price` and `commerce_archive_product` (status writes; repos already filter on `active`), or make a new price supersede older active prices of the product in one transaction. The second is smaller and removes the choice.

### H6. Config saved before provider keys leaves checkout broken until restart
- Where: `composition/commerce.ts` `providerContexts` (line ~1291 of `tovu.diff`) snapshots `bindings` once from `providers.paymentProviders({})` when the binding is built. `reusable()` keeps that binding while the configuration is unchanged. `payments/provider-contexts.ts:49` refuses when the provider is missing from `bindings`. `provider-plugins.ts` `paymentProviders` lists only slots with a current lease, which exists only after keys are saved.
- Failure: the owner saves `core.commerce.configuration` first, or boots with commerce configured while Stripe keys are absent, then saves the keys. `apply` creates a live lease, but the binding still has empty `bindings`. Every context resolve refuses with "settings do not match ... or required keys are unavailable", so checkout stays unavailable and webhooks return 503 until a restart or a configuration edit. The skill's order avoids this; a reversed order or a provider plugin enabled later does not.
- Fix: compute `bindings` per resolve. `createProviderContexts` takes a record, so accept a function, or wrap resolve so it rebuilds. The result is one small lookup.

## Medium

### M1. Lost relocation leaves the guard unfinished: off commerce creates catalog tables
- Where: `composition/commerce.ts` worker `run` calls `ensureSchema()`, which runs `migrateCommerceDatabase`. `warm()` off-path sets `storageReady` from table metadata and kicks the worker.
- Failure: a DB with `commerce_payments` and pending rows, commerce off, and no catalog gets all eight catalog tables created at boot. That contradicts `migrations/index.ts` ("dormant commerce never creates catalog tables"). The report names exactly this guard as being tightened when the environment died.
- Fix: while off, run only `migrateCommercePayments`, and skip order projection if the catalog is absent, leaving messages pending.

### M2. Lost relocation: generic logic sits in Tovu, and Tovu writes SQL against Jini's ledger
- Where: `composition/commerce-worker.ts` (entire file: a provider-neutral ownership and schedule state machine); `composition/commerce-drain.ts` (raw joins on Jini-owned `commerce_payments` and `commerce_payment_attempts`, parsing Jini's dispatch snapshot); `commerce.ts` `hasPending` (a second raw copy of the same status list); `commerce-origin.ts` hostname policy.
- Failure: a ledger status or column change breaks Tovu silently, and any other host has to rewrite the worker. The status list exists twice, and neither copy is typed against `IntentStatus`. The prepared Jini tests for the moved code were never persisted, so nothing tests this logic in Jini.
- Fix: redo the move: `payments/ingest/settlement-worker.ts` and `catalog/merchant-drain.ts` in Jini, with ledger methods `hasOpenPayment` and `findOpenPayment`. Tovu keeps only the timer and owner-lock adapter. Nothing else on the branch depends on the lost edits; the report's list is accurate.

### M3. Merchant drain reads an arbitrary row, and abandoned sessions block changes
- Where: `composition/commerce-drain.ts:14-18`: `LIMIT 1` with no `ORDER BY` and no scope filter.
- Failure: with open rows in two scopes, the row chosen is undefined and can change between reads, so the binding (and the one webhook endpoint it accepts, `path.endpointId === scope.mode`, `commerce.ts` coreReceiver) can switch modes between transitions. Webhooks for the unselected mode get 404. Separately, one abandoned test-mode checkout blocks going live until its session expires and that webhook arrives (about 24 h, or forever per H3).
- Fix: accept webhooks for every scope that has open rows, resolving the endpoint from `(siteId, providerId, mode)` against open-row scopes plus the configured one. Exclude `requires_action` rows from the block or age them out.

### M4. Storefront truncates at 24 products, and products past 24 return 404
- Where: `catalog/repo.storefront.ts:6,19` (`limit(24)`, alphabetical, before filtering for a price); `routes/site/products.ts:89-91` (`/products/:id` searches only that page).
- Failure: product 25 in name order is unreachable, even by direct link, and has no Buy button. Priceless products count toward the 24, so the page can show fewer while more exist. The setup tools give no warning. The static export manifest uses the same list.
- Fix: add a point lookup by id or slug for the detail route (one query; less read cost than today). Add a pagination cursor, or warn in the tool when more than 24 exist.

### M5. Public product pages repeat reads with no per-request reuse
- Where: `commerce-http.ts` guard, `commerce.ts` `status` / `commerceCatalog.listProducts`, `routes/site/product-checkout.ts:26-29`.
- Cost: one unauthenticated `GET /products/:id` does `commerce.status()` twice and `listProducts` once: about 4 settings reads (`checkoutOrigin` adds one), 5 or more activation reads, and 2 sealed provider-config reads, each decrypting the whole envelope, plus 2 catalog queries. There is no rate limit on this route. `POST /orders` does about 5 settings reads, 7 activation reads and 2 decrypts before its point writes. At 10 req/s that is about 20 AES opens/s on a public path.
- Fix: resolve once per request and pass the result down, or cache `problem()` for a few seconds, invalidated on provider apply. Drop `problem()` from the public `status` path by sharing a short TTL readiness value.

### M6. Saving configuration at runtime takes the shop offline until a tool call or restart
- Where: `commerce.ts` `resolve()` creates a new `createCommerceServer` with `prepared = false`; `plugin-server.ts` `status()` requires `prepared`; `commerce-http.ts` gates on `status()` and never calls `activate()`.
- Failure: changing `publicOrigin` or going test to live (with nothing open) makes `/products` return 404 and `commerce_get_status` report "Commerce has not been activated", with no Buy form to trigger `activate`. It recovers only after a `commerce_create_*` tool call or a restart. Enabling the plugin at runtime behaves the same way.
- Fix: in `resolve()`, carry `prepared` over when storage is ready, or call `activate()` once in the worker `run` / on binding creation.

### M7. Return and cancel "pages" are raw JSON
- Where: `routes/commerce/purchase.ts:678-680`: `GET /commerce/return` and `/commerce/cancel` use the same `read` handler, which calls `res.json`.
- Failure: after paying, the buyer lands on a JSON dump of order and payment, including `scope` (provider account id, site id, mode), `providerRef` and `next`. If signed out, they get a JSON 401. There is no confirmation page and no link back to the shop. The skill and the report both call these pages.
- Fix: render a small themed status page from the same read. Return a narrow view that omits scope and provider fields, to buyers on `/orders/:id` as well.

### M8. PostgreSQL settlement lock key is global to the database
- Where: `composition/commerce.ts` `withKernelSessionLock({ key: 'commerce:settlement-worker' })`; `packages/db/src/kernel/session-lock.ts:37` (`hashtextextended(key, 0)`).
- Failure: advisory locks are database-wide. Two sites in one PostgreSQL database with different `search_path` connection strings (the branch's own tests isolate this way) share one lock. Commerce active on site A holds it for the process lifetime, and site B's settlement never runs, with a single warning. It also holds 1 of the 10 default pool connections per active site, forever, and it breaks under a transaction-mode pooler. The contract "max >= 2" is documentation only: `openPostgresKernel` accepts `max: 1` and would deadlock.
- Fix: include the workspace or site id in the key. Fail clearly when the pool is under 2.

### M9. Test and status claims that do not cover the risky paths
- From test names only: `settlement.integration.test.ts` has one scenario (signed paid evidence plus relay redelivery). I found no test for a blocked message followed by a good one (H2), for `requires_action` with a lost webhook (H3), for exhausted recovery (H4), or for keys saved after configuration (H6). The report's "no live provider" limit also means Stripe replay parity (same key and params accepted) is proven only against a fake.
- `tools.ts` `commerce_get_status`: `buildCommerceStatusTools` is given no `lipay`, so a fully ready shop still reports `paymentRuntime` unavailable, `providers: []`, `capabilities.providerDiscovery: "unavailable"` and `webhookReconciliation: "unavailable"`, next to `checkout.ready: true`. The assistant gets contradictory facts. Fix: pass the provider list, and report `webhookReconciliation` from the checkout state.
- The report's "Full Tovu TypeScript check FAIL only at unchanged store.ts:410" and two open parity assertions mean the branch was never fully green. Re-run these on the merged result.

### M10. Excess code
- Remove `features/plugins/{lipay,store}/__tests__/fixtures/*` and `routes/site/__tests__/fixtures/legacy-store.ts`, with the tests that exercise only them. These are about 370 lines of retired runtime moved rather than deleted, and tests over dead fixtures prove nothing about production. Keep the historical manifests.
- `commerce_get_status`'s `lipay` port and `CONFIGURATION_UNAVAILABLE` block are now dead paths in this host.
- `contributeCommerceCatalogTools` in `catalog-tools.ts` has no caller in the diff (Tovu registers the tools directly).
- `checkout.ts` browser: the `recoveryButton` fallback for cached HTML duplicates server markup; 5-minute cache makes it near-pointless.
- `warm()` uses `db.introspection.getTables()` at every site boot, which reads metadata for all tables to test one name. Use a one-table existence query. This runs per site per boot, including commerce-off desktop sites.
