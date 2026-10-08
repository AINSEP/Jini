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
