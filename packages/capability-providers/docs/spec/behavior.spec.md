Spec ID: SPEC-JINI-CAPABILITY-PROVIDERS-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:f4d7af1e0f13fb21d50dbaee2f7d04b5944f0ff4265679253fea545822c0e104
spec_mode: reverse_spec


# Capability providers behavior contract

## Storage, database and realtime

- When storage objects are listed, storage providers shall filter by literal key prefix and sort keys. The in-memory provider copies bytes on write/read; metadata objects are not deep-frozen.
- When a blob is absent, `BlobStorageProvider.get` shall translate backing `StorageError` with `NOT_FOUND` to `null`. Other backing errors propagate. `put` echoes content type in its result; listing does not preserve that content type.
- When inserting a duplicate collection/id pair, database providers shall reject. Update shall preserve the original id, return `null` for missing records, and replace only patched fields. Delete of an absent record succeeds.
- When querying, database providers shall apply strict equality to each `where` field. In-memory records retain references; SQLite uses JSON serialization, so object identity, unsupported JSON values and persistence semantics differ. SQLite query order is unspecified.
- When publishing realtime events, providers shall invoke a snapshot of local handlers in insertion order. A handler exception rejects publication and stops remaining delivery. Unsubscription is idempotent.
- When WebSocket clients send valid `subscribe`/`unsubscribe` messages with a string channel, the adapter shall update socket membership. Malformed JSON and unsupported messages are ignored. Close removes membership.
- When publishing to WebSocket subscribers, the adapter shall notify local handlers first, then send JSON `{ type: 'event', channel, event }` to open sockets. Send/serialization exceptions propagate. There are no acknowledgments, history, retries, backpressure or delivery guarantees.

## Auth and payments adapters

- When using the JWT adapter, signup shall keep exact email strings in local memory and hash passwords using salted scrypt. Signin shall issue HMAC-SHA256 tokens with a random token id. The default session TTL is one hour; a custom TTL is not range-validated.
- When verifying JWT sessions, malformed signatures/payloads, unknown users, expired tokens and revoked token ids shall return `null`. Expiry is encoded in whole seconds, so validity may end before the millisecond `expiresAt` returned by signin. JWT headers are not independently validated.
- When signing out, the JWT adapter shall revoke a valid signed token id in its local revocation set. Repeated signout has no additional effect. User/session state is not made durable by binding a separate database provider.
- When constructing Stripe payments, the default base URL shall be `https://api.stripe.com/v1`; the adapter uses Basic authentication and native fetch unless supplied. There is no configured timeout, retry or idempotency key.
- When charging, amounts at or below zero shall fail locally. Other numeric/currency/customer constraints are delegated to the remote service; nonfinite and fractional amounts are not comprehensively guarded locally.
- When requesting a missing remote charge, a 404 shall return `null`. Refund requires a succeeded charge. An accepted refund is reported as `refunded` even when its remote status is pending; the shared charge type cannot express pending refund processing.
- When using reference auth/payments, credentials and simulated transactions shall remain in process memory. Auth uses plaintext passwords and predictable credentials; payments performs no money movement. These implementations are development references.

## Visitor-auth planning and evaluation

- When registering provider metadata, the registry shall validate lowercase URL-safe ids, nonempty labels and credential labels/keys, unique credential keys, and normalized nonempty unique scopes. Runtime protocol/implementation validation is not exhaustive.
- When planning authorization, the planner shall require matching provider ids, tenant/client/browser bindings, a finite clock, S256 support, and an issuer for OIDC or issuer-bound callbacks. Endpoint URLs shall use HTTPS without userinfo or fragments. Redirects may additionally use HTTP on loopback hosts.
- When planning authorization, state/nonce shall be URL-safe strings of 32–512 characters; PKCE verifier/challenge shall be 43–128 characters. The planner checks shape, not entropy or challenge derivation. The security port owns those guarantees.
- When no transaction TTL is supplied, the planner shall use ten minutes. Supplied TTL shall be an integer from 1 to 900,000 milliseconds. Reserved authorization parameters shall be rejected in both endpoint query strings and extras.
- When evaluating a callback, rejection shall prioritize tenant mismatch, flow mismatch, expiry, state mismatch, issuer mismatch, provider error, then missing code. Exact expiry is expired. Provider errors are reduced to a short safe code; descriptions are not forwarded.
- When evaluating identity claims, the evaluator shall require nonempty subject, matching expected issuer/nonce, client audience, and authorized party for multiple audiences. Default skew is 60 seconds; custom skew must be finite and between zero and 300 seconds. Claims expiring at the adjusted boundary are rejected.
- When handling any callback, the consumer shall atomically consume the tenant-scoped transaction before evaluation, including callbacks that will be rejected. The package does not itself prevent replay, persist transactions, exchange tokens or verify signatures.

## Deliberate boundaries

The root is a set of ports, not automatic provider selection. These modules do not implement tenancy/authorization for generic storage, database or realtime operations, resource quotas, channel authentication, distributed events, account linking, HTTP routes, durable JWT user storage, secret management or a complete OAuth client. Email claims are identity attributes, not authority to link an existing account.
