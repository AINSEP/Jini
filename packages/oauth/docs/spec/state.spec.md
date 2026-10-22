Spec ID: SPEC-JINI-OAUTH-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d2b48dbabd598d508d9f8d40fd078e0b9bdf958761643c1103061f6b938546d0
spec_mode: reverse_spec


# OAuth state and persistence

## Pending browser authorization

Lifecycle: absent → issued → consumed or expired/evicted. The memory testing adapter prunes on `put`, `take` and `size`; expiry is `expiresAt <= now`. At capacity, issuance evicts the oldest inserted entry. Entries and results are cloned. Entropy collisions overwrite an existing state; adapters must supply cryptographic randomness.

`take` deletes state before checking owner with constant-time byte equality after a length check. Unknown, expiry, replay and wrong owner share `OAUTH_INVALID_STATE`. Provider mismatch, callback denial, bad stored verifier or exchange failure after redemption do not restore state. Callback shape failures checked before redemption leave state unconsumed.

Production `PendingAuthorizationStore` adapters own durable TTL, capacity and atomic consumption across processes. Persist `ownerKey`, `providerId`, secret `codeVerifier`, redirect URI, scopes, resource binding and timestamps together. Construction has no background timer and no shutdown method.

## Registration cache and registrar

Lifecycle per identity: cache miss/expired secret → single in-flight registration → persisted registration; registration or persistence failure → no returned client. A valid cache hit performs no provider request, but current URL policy is checked before reading the cache.

Cache key is an ordered JSON tuple of issuer, registration endpoint, product/client/software identity plus redirect URIs, scopes, grants, response types, requested auth method and advertised auth methods. Array order affects identity. Initial access token and request timeout are excluded. Identity options are cloned at registrar construction.

Secret expiry `null` or `0` is nonexpiring; other values are epoch seconds and must be later than the clock. Calls coalesce only within a registrar instance. Returned clients are clones. `invalidate` waits for the currently observed in-flight registration to settle, then deletes that identity; it does not perform grant retries. There is no cross-instance registration lock.

The memory cache has no TTL logic itself and disappears on process exit. The file cache stores a JSON array of `[key, RegisteredOAuthClient]` pairs; a missing file means an empty cache. Every mutation rereads the file and writes a complete snapshot. Mutations serialize within one instance, and reads wait for its preceding mutations. Failed writes reject their caller without poisoning later operations. Multiple writers require host coordination.

The Node file adapter creates parent directories with requested mode `0700`, an exclusive temporary file with mode `0600`, writes and fsyncs it, closes it, and renames it atomically. It attempts temporary-file cleanup. It does not encrypt secrets, tighten pre-existing parent-directory permissions, lock writers or fsync the parent directory after rename.

## Token refresh coordinator

Lifecycle per key: load → return current token if outside skew → reuse in-flight refresh or create one → acquire optional lease → refresh → persist rotation → return token → remove in-flight entry. Missing token immediately rejects as invalid grant. Null expiry always returns current access token.

If lease acquisition loses, reload after each injected sleep until fresh tokens appear or the wait deadline is reached. At deadline, a not-hard-expired token is returned; an expired token fails unreachable. The coordinator does not reacquire a lost lease. The supplied clock must progress with waiting.

Lease holders release in `finally` after refresh/persistence; release errors are ignored. Without lease methods, single flight is process-local. Durable adapters own atomic acquisition, crash recovery and lease expiry. `markNeedsReauth` is best effort for no-refresh-token and terminal refresh rejection; transient failures do not mark status. Persistence failure prevents returning the rotated access token even though the provider already consumed the old refresh token.

`createMemoryTokenStore` clones tokens, deletes them on `markNeedsReauth`, and holds per-key leases in a set until release. It does not retain the reason, expire leases or encrypt data. Neither the coordinator nor these stores start background refresh; `getAccessToken` drives work.

## Provider registry

Each registry starts empty. Register validates and clones, then replaces the descriptor under its provider id. `list` returns clones in Map insertion order; replacing an existing id retains its position. `get` returns a clone or throws invalid request. No unregister, persistence, global singleton or built-in providers exist.

## Low-level pending cache and transport

`createPendingAuthorizationStore({ clock }, { expiry, scheduler?, ttlMs?, maxEntries?, exclusiveExpiry? })` returns a synchronous host-payload cache. The default capacity is 256 and pruning is shared with the async owner-bound store. Consumption deletes before returning, preserving single use. Expiry is inclusive unless exclusiveExpiry is explicitly selected. Values remain host-owned references; no durable storage is supplied. Scheduler ownership and stop belong to the returned cache; owner-bound storage uses the same implementation and explicit 24-byte state generation.

DNS-pinned transport owns one dispatcher from construction until `close({})`; close delegates directly. Idempotent close and post-close fetch behavior depend on the dispatcher/fetch adapters. No global pool or implicit shutdown is supplied.

Evidence: `src/testing/`, `src/registration-cache.ts`, `src/file-registration-cache.ts`, `src/node-file-cache.ts`, `src/refresh.ts`, `src/registry.ts`, `src/pending-authorizations.ts`; `tests/file-cache.test.ts`, `tests/token-refresh.test.ts`, `tests/pkce-and-state.test.ts`, `tests/pkce-and-state.test.ts` (read only).
