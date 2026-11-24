# Newsletter

The newsletter domain for `@jini-ai/user-management`: types, typed errors, repository ports, the campaign state machine, send hooks, list and campaign write services, the launch gate, unsubscribe tokens, and in-memory repositories. For why this package exists and how its entries are laid out, see the [package README](../../README.md).

Every module is a leaf subpath. There is no `newsletter` barrel, so import each module from its own subpath, for example `@jini-ai/user-management/newsletter/errors`.

| Subpath | Runtime | Provides |
|---|---|---|
| `newsletter/types` | universal | Row and record shapes, `NEWSLETTER_CAMPAIGN_TYPE`, `NEWSLETTER_PERMISSIONS` |
| `newsletter/errors` | universal | One typed error per failure. The host maps them to HTTP status codes. |
| `newsletter/ports` | universal | Repository ports, `MembersConsentCapability`, `SubscriberDirectoryPort`, `SendBatchJob`, and `MailerPort` (an alias of core's `PositionalMailer`) |
| `newsletter/campaign` | universal | `transitionCampaignStatus`, the campaign status state machine |
| `newsletter/hooks` | universal | `createHookRegistry`, the fail-closed `recipient.filter` and `beforeSend` chain |
| `newsletter/lists` | universal | `saveList`, `archiveList`, `ensureDefaultList` |
| `newsletter/campaign-write-service` | universal | `saveCampaign`, `cancelCampaign`, `scheduleCampaign`, subject and preheader limits |
| `newsletter/launch-gate` | universal | `evaluateLaunchGate` |
| `newsletter/unsubscribe` | node | `buildUnsubscribeLink`, `processUnsubscribe` (signed tokens, `node:crypto`) |
| `newsletter/repo.memory` | universal | In-memory adapters for all six repository ports |
| `newsletter/repo` | universal | `SqlNewsletterCampaignRepo`: the campaign pair's Kysely query body for every dialect |
| `newsletter/repo-subscribers` | universal | `SqlNewsletterListRepo`, `SqlNewsletterSubscriptionRepo`, `SqlNewsletterConfirmationTokenRepo`, `DEFAULT_LIST_LIMIT` |
| `newsletter/repo-sends` | universal | `SqlNewsletterAudienceSnapshotRepo`, `SqlNewsletterSendRepo` |
| `newsletter/repo.rows` | universal | Row types and mappers, `NewsletterSqlTables`, `NewsletterSqlRequired`, `CampaignBodyReporter` |
| `newsletter/data-module-manifest` | universal | `NEWSLETTER_TABLE_NAMES`, `createNewsletterDataModule` (the 5-table `p_newsletter__*` declaration), `installNewsletterDataModule` |

## Wiring

Everything host-specific reaches these modules through the deps objects their functions already take. Nothing here imports host code, a database driver, or a mail transport.

- **`CampaignWriteServiceDeps`** and **`ListsDeps`**: `campaignRepo` and `listRepo` (any adapter implementing the ports), plus `clock.nowIso()` and `ids.newId()`.
- **`LaunchGateDeps`**: `isSendingEnabled(workspaceId)`, `consentCapability` (the members feature's consent capability, or `null` when the host has not bound one), `originRegistry` (`OriginRegistryPort` from `@jini-ai/core/contracts/server/verified-origin`), and `mailer` (`PositionalMailer` from `@jini-ai/core/contracts/mail`).
- **`UnsubscribeDeps`**: `subscriptionRepo`, `keyring` (`KeyringPort` from `@jini-ai/core/contracts/vault`; only `derive` is called), `originRegistry`, `consentCapability`, and `clock`.
- **Repository adapters:** `newsletter/repo.memory` supplies the in-memory set. The SQL adapters (`newsletter/repo`, `repo-subscribers`, `repo-sends`) take `{ kernel, tables }`: a schema-free `StorageKernel<Kysely<unknown>, unknown>` from `@jini-ai/core/contracts/storage` and the host's table names (`NewsletterSqlTables`; no defaults here, though `NEWSLETTER_TABLE_NAMES` covers the five dataModule tables). `SqlNewsletterCampaignRepo` also requires `onUnreadableBody`, the host's reporter for an unreadable stored revision; it receives the campaign id and revision sequence only, never document text. `kysely` is an optional peer that only these subpaths need.
- **Data module:** `createNewsletterDataModule({ publisher })` takes the host's stored provenance publisher. It is compared with the stored identity row on every boot, so the host must pass the same value every release. `installNewsletterDataModule` also takes `declareDataModule`, which the host binds from `@jini-ai/db/data-modules`, so this package does not depend on the DDL engine.
- **Product copy and identifiers:** none are needed by these modules, apart from the data-module publisher above.

```ts
import { saveList } from "@jini-ai/user-management/newsletter/lists";
import { InMemoryNewsletterListRepo } from "@jini-ai/user-management/newsletter/repo.memory";

const deps = { listRepo: new InMemoryNewsletterListRepo(), clock: { nowIso: () => new Date().toISOString() }, ids: { newId: () => crypto.randomUUID() } };
const { list } = await saveList({ deps, input: { workspaceId, name: "Weekly", slug: "weekly" } });
```
