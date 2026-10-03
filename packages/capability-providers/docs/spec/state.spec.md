Spec ID: SPEC-JINI-CAPABILITY-PROVIDERS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:db69bc02e09fc377158c11853bff91562580df8d2de0eda4b39fd2926d1cecdc
spec_mode: reverse_spec


# Capability providers state contract

| Module | State and lifetime | Persistence / ownership |
| --- | --- | --- |
| Reference auth | Email/user/password and session maps, incrementing ids, TTL checked on verification | Lost when factory instance is discarded; no background expiry sweep |
| Reference storage | Key → copied bytes and metadata | In memory only; replacement overwrites a key; no quota |
| Reference payments | Incrementing charge ids and charge map; succeeded → refunded | Simulated state only; no durable or financial transaction |
| Reference database | Collection maps and record references | In memory only; insertion-order query results; returned objects are not isolated copies |
| Reference realtime | Channel sets of handlers | Unsubscribe removes a handler; no replay or durable queue |
| JWT auth | Local users/password hashes and revoked token ids | In memory; stateless signed token bytes still depend on local user/revocation state; no injected user-store port |
| Blob storage | Backing namespace files | Durability follows the injected `BlobStorage`; namespace/key mapping is the adapter boundary |
| SQLite | `jini_capability_db_records` table with `(collection, id)` primary key and JSON data | Table created if absent; insert/update use transactions; host owns open/close and database configuration |
| WebSocket realtime | Local subscriptions and connected socket/channel memberships | Connection-scoped; close clears memberships; empty channel sets can remain allocated |
| Stripe | Remote charge/refund state | No local cache; remote service is authoritative |
| Visitor registry | Append-only normalized frozen definitions in a map | Instance-local, no persistence or unregister |

## Visitor authorization transaction lifecycle

The host resolves provider/server/client configuration, generates fresh artifacts, plans authorization, then saves the transaction before redirecting. The transaction contains the PKCE verifier and browser/tenant binding; the host must store it with appropriate protection and expiry.

On callback, `VisitorAuthTransactionStorePort.consume({ tenantId, state })` must atomically remove and return the transaction at most once. Evaluation follows consumption. Rejected callbacks still consume it. A successful callback produces a token-exchange request; OIDC ID tokens then require the verifier port and identity-claims evaluator before host session creation.

The package supplies transaction types and pure decisions, not a transaction-store implementation, refresh-token store, expiry worker or session lifecycle. Refresh/revoke are host-provided exchange-port methods. No adapter exposes a general reset/dispose API.

For WebSocket factory instances, the consumer closes the returned server. The provider class does not remove its connection listener through a disposal method. Consumers must manage subscription cleanup and avoid retaining abandoned provider instances.
