# `@jini/capability-providers` — provenance

**No OD source.** This is not a port — it is a greenfield capability-provider
port/interface design, built per an explicit project-owner scope constraint
(see the dispatch brief): abstract ports only, plus one trivial in-memory
reference stub per interface, zero wiring into any other package.

## Why this exists (the gap it names)

`foundry/docs/jini-port/recon/r5b-consumers-matrix.md` §2 (the capability matrix) and
§3.3 identify a **capability-provider registry with auth / storage /
payments / db / realtime as Zana + a fleet orchestrator convergent** — both consumers
independently built an explicit port+provider layer (Zana: `app-chassis`'s
"rigid core, flexible edges" thesis, `packages/{core,ai,db,auth,storage,
payments}` + `providers/supabase` declaring which capabilities it
implements; the fleet orchestrator: "ports+sqlite/memory"), while Open Design itself
only models these capabilities thinly. §3.3 states this "should be an engine
primitive... so products swap Supabase/SQLite/Stripe without touching core"
— that is the shape this package builds: 5 independent ports (not one
umbrella "CapabilityProvider" interface — see "Design decisions" below) each
with a typed DI token (`packages/core/src/token.ts`'s pattern) and a minimal
in-memory reference implementation proving the port is genuinely
implementable.

## Package map

Two entry points (mirroring the `@jini/core` `"."` / `"./internal"` and
`@jini/desktop-host` `"."` / `"./bridge-testing"` multi-export pattern) —
see "Public export split" below for why.

**`@jini/capability-providers` (normal entry point, `src/index.ts`) — port interfaces/types and DI tokens only:**

| File | Contents |
|---|---|
| `src/auth.ts` | `AuthProvider` (signUp/signIn/signOut/verifySession) interface/types only. |
| `src/storage.ts` | `StorageProvider` (put/get/delete/list, key-prefix listing) interface/types only. |
| `src/payments.ts` | `PaymentsProvider` (charge/getCharge/refund) interface/types only. |
| `src/db.ts` | `DbProvider` (insert/get/update/delete/query, collection + record id, exact-match `where` filter only — deliberately not a query language) interface/types only. |
| `src/realtime.ts` | `RealtimeProvider` (publish/subscribe, in-process synchronous fan-out) interface/types only. |
| `src/tokens.ts` | `AuthProviderToken`/`StorageProviderToken`/`PaymentsProviderToken`/`DbProviderToken`/`RealtimeProviderToken` via `@jini/core`'s `token()`, namespaced `jini.capabilityProviders.*`, following the same bare-interface-name-suffixed-`Token` convention `@jini/daemon`/`@jini/media` already established. |
| `src/index.ts` | Barrel re-exporting all of the above. |

**`@jini/capability-providers/unsafe-reference` (separate entry point, `src/unsafe-reference/index.ts`) — UNSAFE, non-production in-memory reference implementations:**

| File | Contents |
|---|---|
| `src/unsafe-reference/auth.ts` | `createInMemoryAuthProvider`. Plaintext password storage, predictable non-cryptographic `user-N`/`session-N` identifiers — explicitly not a security reference (documented in the file's header comment). |
| `src/unsafe-reference/storage.ts` | `createInMemoryStorageProvider`. Copies bytes in/out so callers can't mutate internal state through a returned/passed `Uint8Array`; no principal/tenant/ACL/quota dimension. |
| `src/unsafe-reference/payments.ts` | `createInMemoryPaymentsProvider`. Every charge deterministically succeeds — no real money moves, no idempotency, no async settlement delay modeled. |
| `src/unsafe-reference/db.ts` | `createInMemoryDbProvider`. No principal/tenant/ACL dimension; unbounded in-memory collections. |
| `src/unsafe-reference/realtime.ts` | `createInMemoryRealtimeProvider`. No channel-authorization dimension; unbounded in-memory subscriber sets. |
| `src/unsafe-reference/index.ts` | Barrel re-exporting all five factories, with a prominent top-of-file warning that these are non-cryptographic, non-production stubs never to be wired into anything handling real credentials/payments/user data. |

### Public export split (SEC-RB-006 remediation, 2026-07-21)

`ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md`
finding SEC-RB-006 flagged that the five `createInMemory*Provider` factories
were exported from the normal `@jini/capability-providers` barrel —
indistinguishable, from an importer's perspective, from a real production
adapter. Per explicit human direction, the fix is visibility/naming only
(the stubs' logic is intentionally insecure and out of scope for
hardening): the concrete implementations moved to `src/unsafe-reference/`
and are now reachable only via the separate
`@jini/capability-providers/unsafe-reference` subpath declared in
`package.json`'s `exports` map. The normal `@jini/capability-providers`
entry point now exports only the stable port interfaces/types and the DI
tokens — importing it can never accidentally pull in a plaintext-password
auth stub or an always-succeeds payments stub. Tests for the five factories
moved alongside their implementations to
`src/unsafe-reference/__tests__/`; `src/__tests__/index.test.ts` now asserts
the normal barrel does *not* export the factories, and a new
`src/unsafe-reference/__tests__/index.test.ts` asserts the unsafe-reference
barrel does.

## Design decisions

**Five separate port interfaces, not one `CapabilityProvider` union.** Zana's
own model has a single adapter (Supabase) implementing multiple capabilities
at once, which might suggest one umbrella interface with optional methods.
Rejected: extraction-plan.md §2.2's core lesson (the reason typed tokens beat
a structural dependency object in the first place) is that a union/bag
interface is exactly the shape that decays into an OD-`ServerContext`-style
god-object as capabilities accrete. Five independently bindable tokens means
a consumer wiring only `DbProviderToken` + `StorageProviderToken` never sees
`AuthProvider`/`PaymentsProvider`/`RealtimeProvider` in its type surface. A
real adapter that happens to implement several (a future `SupabaseAdapter`)
is free to be one class satisfying multiple interfaces and bound to multiple
tokens — that composition happens at the binding site, not in this package.

**No registry/discovery module.** The task brief's scope constraint says
"abstract port/interface definitions... plus at minimum one trivial
reference/stub implementation" and explicitly forbids wiring this into any
other package. `@jini/core`'s existing typed-token + `bindings()` mechanism
already *is* the registration/discovery layer (extraction-plan.md §2.2) —
building a second, parallel registry inside this package would duplicate
that machinery for no reason and blur the "zero other package depends on
this" boundary the brief asked for. A consumer registers these tokens in its
own `createDaemon({ bindings: bindings().bind(AuthProviderToken, ...) })`
call; this package supplies only the tokens and the interfaces they carry.

**In-memory reference stubs, not "the obvious real adapter."** The brief is
explicit: interfaces + minimal stubs only, no full per-provider-type
implementations (no real Stripe/Auth0/Supabase integration). Every stub here
optimizes for proving the port's shape is satisfiable and unit-testable, not
for production use — see each file's header comment for the specific corners
cut (plaintext passwords, deterministic always-succeeding charges, no
cross-process realtime fan-out, no query language beyond exact-match
`where`).

## Scope / sign-off status (required note per the dispatch brief)

**Built speculatively as port-design exploration, no current consumer, not
wired into any other package — per an explicit human decision.** Not in
`extraction-plan.md`'s locked §3 package set, needs sign-off like
`@jini/deploy`/`@jini/diagnostics`/`@jini/metatool` before being folded in,
and unlike those, may never gain a real consumer — that's an accepted,
deliberate risk for this module specifically.

Caveat found while researching this dispatch: the brief's own framing cites
`@jini/desktop-host`, `@jini/diagnostics`, and `@jini/metatool` as
already-built same-day precedent packages to model this note on. None of the
three exist anywhere in this repository's git history as of this dispatch
(`git log --all -- packages/desktop-host packages/diagnostics
packages/metatool` returns nothing on any branch reachable from this
session, and `packages/` on `main` has no such directories). `@jini/deploy`
*is* real — it exists on a separate, unmerged branch this session found and
pushed as `preserved/detached-ui-work` (see the top-level task report) — so
this note follows `@jini/deploy`'s actual `source-map.md` precedent directly
rather than the two/three packages that could not be located. This
discrepancy is flagged here rather than silently worked around, per this
package's own "verify, don't assume" precedent for citing sources.

## Confirmed: zero other package imports this one

```
$ grep -rl "@jini/capability-providers" packages/*/src packages/*/package.json 2>/dev/null | grep -v "^packages/capability-providers/"
(no output)
```

## Dependencies

As of the 2026-07-21 real-adapter pass below, this is no longer accurate as
written — see that section's "Dependencies (updated)" for the current list.
Kept here unedited as the historical record of this package's original,
interfaces-plus-stubs-only dependency footprint: `@jini/core` (workspace) for
`token()` — see `src/tokens.ts`. No other dependencies; no Node builtins
beyond what TypeScript itself needs.

## Coverage

`pnpm --filter @jini/capability-providers exec vitest run --coverage`
(json-summary + json reporters per
`foundry/docs/jini-port/skills/fixing-open-design.md` Phase 6.5): **100%
statements/branches/functions/lines**, aggregate and per file (7 covered
source files). No `/* v8 ignore */` or equivalent suppression comment
anywhere in this package. One dead branch found during the coverage loop
(`auth.ts`'s `verifySession` — a `find()` result that can never be
`undefined` given this port surface has no `deleteUser`) was resolved with a
documented non-null assertion (Phase 6.5's "TS-required fallback with no
real runtime path" classification), not a contrived test or a suppression
comment.

(Coverage figures above are pre-2026-07-21, for the interfaces-plus-stubs
snapshot only — see the new section below for post-real-adapter numbers.)

## Real production adapters (2026-07-21)

Per an explicit session-lead decision, this package grew one real,
production-quality adapter per port — built *alongside*, not replacing, the
`src/unsafe-reference/` stubs above, which stay exactly as they were (still
non-production, still only reachable from the separate
`@jini/capability-providers/unsafe-reference` entry point). Unlike the
stubs, every real adapter below lives in the *same* file as the port
interface it implements (`src/storage.ts`, `src/db.ts`, `src/auth.ts`,
`src/payments.ts`, `src/realtime.ts`) and is exported from the normal
`@jini/capability-providers` entry point — these are safe-by-default,
production-grade code, not the SEC-RB-006-flagged "indistinguishable from a
real adapter" stub shape that motivated the unsafe-reference split. No port
interface required a breaking change; each real adapter implements the
existing interface as-is.

| Port | Real adapter | File | Backing dependency |
|---|---|---|---|
| `StorageProvider` | `BlobStorageProvider` | `src/storage.ts` | An injected `@jini/platform` `BlobStorage` (`LocalBlobStorage`/`S3BlobStorage`) — thin field-mapping delegation (`path`→`key`, `mtimeMs`→`updatedAt`), not a reimplementation. Known gap: `BlobFileMeta` has no `contentType` field, so `put()`'s `contentType` option is echoed back once but can't be durably recovered by a later `list()` — documented in the class doc, not an interface change (`StorageObjectMeta.contentType` was already optional). |
| `DbProvider` | `SqliteDbProvider` | `src/db.ts` | An injected, already-open `better-sqlite3` `Database` handle — one physical table (`collection`, `id`, JSON `data`), primary-keyed `(collection, id)`, following `@jini/sqlite`'s `createSqliteEventLog` DI/schema conventions (idempotent `CREATE TABLE IF NOT EXISTS`, `db.transaction()` around multi-statement writes). `query()`'s exact-match `where` filter stays client-side (not compiled to SQL predicates), matching `DbQuery`'s "not a query language" framing and the in-memory reference adapter's identical semantics byte-for-byte. |
| `AuthProvider` | `JwtAuthProvider` | `src/auth.ts` | Self-contained: `node:crypto` only, no external auth-service call. Self-signed HS256 session JWTs (`sub`/`jti`/`iat`/`exp`) over a host-supplied `secret`; `scrypt` password hashing with a random per-user salt and `timingSafeEqual` comparison (replacing the in-memory reference adapter's plaintext storage). `signOut` revokes by `jti` via a process-local deny-list, since JWTs are otherwise stateless. Two documented, tested scope limits: user storage and revocation are both in-process memory only, not durable across a restart (a session JWT from a prior process instance still verifies its *signature* against a fresh instance sharing the same secret, but `verifySession` returns `null` because the user is no longer known in memory). |
| `PaymentsProvider` | `StripePaymentsProvider` | `src/payments.ts` | Stripe's real, documented Charges/Refunds REST API (`https://docs.stripe.com/api/charges`, `.../refunds`) — endpoint shapes verified against Stripe's own docs while building this (WebFetch), not guessed from memory, matching `netlify.ts`/`github-pages.ts`'s real-contract-fidelity precedent. HTTP Basic auth over the secret key, form-encoded bodies (not JSON), errors mapped into `StripePaymentsProviderError` (`status`/`stripeType`/`stripeCode`) from Stripe's documented error envelope. `ChargeInput.customerRef` maps to Stripe's `customer` parameter (charges an existing Stripe Customer with an attached payment method) — `ChargeInput` has no raw-card-token field, so a one-off `source` charge is out of scope. `refund()` treats a `'pending'` Stripe refund status as accepted (this port's `ChargeStatus` has no in-flight-refund state) and only `'failed'`/`'canceled'` reject. |
| `RealtimeProvider` | `WebSocketRealtimeProvider` + `createWebSocketRealtimeProvider` | `src/realtime.ts` | Self-contained pub/sub server over the `ws` package, no external hosted-realtime-service dependency (no Pusher/Ably/Supabase Realtime). One `publish()` fans out to both in-process `subscribe()` handlers (same semantics as the in-memory reference adapter) and connected WebSocket clients that opted into a channel via `{type:"subscribe"/"unsubscribe",channel}` JSON messages. The core class (`WebSocketRealtimeProvider`) depends only on a small structural `RealtimeWebSocketServerLike`/`RealtimeWebSocketLike` shape — a real `ws.WebSocket(Server)` satisfies it with zero adaptation, and tests inject a fake (`EventEmitter`-backed, no real socket/port). `createWebSocketRealtimeProvider` is the real production entry point, constructing an actual `ws.WebSocketServer`. |

### Dependencies (updated)

`@jini/core` (unchanged, for `token()`), plus, added for the real adapters:
`@jini/platform` (workspace, for `BlobStorage`), `better-sqlite3` (already
this repo's established sqlite driver — see `@jini/sqlite`) +
`@types/better-sqlite3`, `ws` + `@types/ws`. `StripePaymentsProvider` and
`JwtAuthProvider` add no new package dependency — `payments.ts` uses the
injectable `fetch` global (matching `netlify.ts`'s precedent) and `auth.ts`
uses only `node:crypto`.

### Testing approach

Every real adapter's tests inject a fake rather than performing real
network/database/filesystem I/O, per this repo's established convention
(`agent-executor.test.ts`'s DI-fake harness, `netlify.test.ts`'s
fetch-mocking):

- `storage.test.ts` — a hand-written in-memory fake `BlobStorage` (no real disk).
- `db.test.ts` — a real `better-sqlite3` `:memory:` handle: genuine SQL
  semantics (the actual thing under test) with zero filesystem footprint,
  the same "real engine, no disk" tradeoff `@jini/sqlite`'s own
  `event-log.ts` accepts (that package's tests use a real tmp-dir file
  instead, since its focus includes durability-across-restart; this
  adapter's interface has no such durability contract to prove, so
  `:memory:` is the tighter no-I/O choice here).
- `auth.test.ts` — no I/O at all (pure `node:crypto` + in-memory maps); a
  hand-signed-token test helper exercises `verifySessionJwt`'s
  malformed/tampered-token branches without needing to export internal JWT
  helpers.
- `payments.test.ts` — `fetchFn` is injected directly (constructor DI) and
  mocked with `Response` objects shaped like Stripe's real documented
  Charge/Refund/error-envelope objects; one test uses `vi.stubGlobal` to
  prove the `globalThis.fetch` default path.
- `realtime.test.ts` — `EventEmitter`-backed fake
  `RealtimeWebSocketServerLike`/`RealtimeWebSocketLike` objects cover all
  channel-routing/subscription-bookkeeping branches with zero real sockets;
  one deliberate exception — `createWebSocketRealtimeProvider` (the real
  `ws.WebSocketServer` wiring) gets one true end-to-end smoke test over a
  real loopback socket on an OS-assigned ephemeral port (`port: 0`), the
  only way to prove the actual `ws` integration seam works, mirroring how
  `@jini/sqlite`'s tests accept real I/O specifically where a fake can't
  prove the real seam.

### Coverage (post-real-adapters)

`pnpm --dir packages/capability-providers exec vitest run --coverage`:
**100% statements/branches/functions/lines**, aggregate and per file, across
all 12 source files (7 original + the 5 real adapters, which live in the
same files as their interfaces rather than adding new ones) and both entry
points. No `/* v8 ignore */` or equivalent suppression comment was needed
for any of the five new adapters — every branch, including Stripe's
documented-but-defensive `Charge.status` fallback and every JWT
signature/claim-tampering path, is exercised by a real test rather than
asserted away.

### Sign-off status (unchanged)

This addition does not change the package's sign-off status from the
"Scope / sign-off status" section above: still zero consumers, still not in
`extraction-plan.md`'s locked §3 set, still needs Coordinator/Software
Architect sign-off before promotion. Adding real adapters closes the "only
interfaces + toy stubs" gap the original scope constraint left open, but
does not by itself create a consumer or grant lock-in.

## 2026-07-22 note — first wiring-level consumer

Wired by `@jini/http`'s new `connectors.ts` route pack as of 2026-07-22 — still zero *bound*
provider instances by default (`@jini/node-host`'s zero-config default leaves all 5 slots
unconfigured), so this doesn't change the sign-off/promotion status above, but the package is no
longer completely unwired from the rest of the codebase. See `packages/http/source-map.md`'s own
2026-07-22 dated section for the full route inventory and the boundary-checker mechanism that lets
a locked package (`@jini/http`) `import type` from this still-`"incubating"` one today.
