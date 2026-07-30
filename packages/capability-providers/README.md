# `@jini-ai/capability-providers`

Five swappable "capability" ports an application-shaped host tends to need — authentication, blob
storage, payments, a document store, and realtime pub/sub — expressed as narrow TypeScript
interfaces plus typed `@jini-ai/core` DI tokens. The root entry point is **interfaces and tokens
only**: no concrete implementation, no vendor SDK, nothing to install beyond the two workspace
dependencies. Concrete adapters live behind explicit `./adapters/*` subpaths so that importing a
port never drags in a vendor client or a native binary.

Be honest with yourself about maturity before adopting: this is deliberate port-design exploration,
built without a current in-repo consumer. The interfaces are small and stable-shaped, but they have
not been pressure-tested by a real product yet. See [source-map.md](./source-map.md) for the full
scope note.

## Install

```sh
npm install @jini-ai/capability-providers

# only if you import ./adapters/ws
npm install ws

# only if you import ./adapters/sqlite  (native compiled addon)
npm install better-sqlite3
```

`ws` and `better-sqlite3` are **optional peer dependencies**. Nothing on the root barrel references
either one, in code or in the emitted `.d.ts`, so installing this package for its ports costs you
nothing extra. `@jini-ai/core` and `@jini-ai/platform` are regular dependencies.

## What you get

**The five ports** (root entry point):
- `AuthProvider` with `AuthCredentials`, `AuthUser`, `AuthSession`
- `StorageProvider` with `StorageObjectMeta`, `StoragePutOptions`
- `PaymentsProvider` with `ChargeInput`, `Charge`, `ChargeStatus`
- `DbProvider` with `DbRecord`, `DbQuery`
- `RealtimeProvider` with `RealtimeHandler`, `RealtimeUnsubscribe`

**The DI tokens** (root entry point) — `AuthProviderToken`, `StorageProviderToken`,
`PaymentsProviderToken`, `DbProviderToken`, `RealtimeProviderToken`. Bind whichever implementation
you want at composition time; a pack declaring one of these in its `deps` gets it typed.

**Real adapters** (each behind its own subpath):
- `./adapters/jwt-auth` — `JwtAuthProvider` / `JwtAuthProviderOptions`. Self-signed HS256 session
  tokens using only `node:crypto` — no external auth service. Real `scrypt` password hashing with a
  per-user salt and constant-time comparison. **User storage is in-process memory, not durable**;
  pair it with a real store at the binding site.
- `./adapters/blob-storage` — `BlobStorageProvider` / `BlobStorageProviderOptions`. Delegates to an
  injected `@jini-ai/platform` `BlobStorage` (`LocalBlobStorage` or `S3BlobStorage`), scoped to one
  namespace. `StoragePutOptions.contentType` is echoed back but not durably persisted.
- `./adapters/stripe` — `StripePaymentsProvider` / `StripePaymentsProviderOptions` /
  `StripePaymentsProviderError`. Real Stripe REST calls; the secret key is an explicit constructor
  argument, never read from an environment variable inside the adapter.
- `./adapters/sqlite` — `SqliteDbProvider`, constructed from a `better-sqlite3` `Database` you own
  and open. Creates its own `jini_capability_db_records` table.
- `./adapters/ws` — `WebSocketRealtimeProvider`, `createWebSocketRealtimeProvider`, and the
  `RealtimeWebSocketLike` / `RealtimeWebSocketServerLike` seams for injecting a fake server in tests.

**`./unsafe-reference` — read this before importing it.** Five in-memory stubs
(`createInMemoryAuthProvider`, `createInMemoryStorageProvider`, `createInMemoryPaymentsProvider`,
`createInMemoryDbProvider`, `createInMemoryRealtimeProvider`) whose only purpose is proving each port
is genuinely implementable and unit-testable. They are **not production adapters and are not meant to
become them**: the auth stub stores passwords in plaintext and issues predictable incrementing
`user-N`/`session-N` ids; the payments stub deterministically succeeds every charge; none of them has
a tenant/ACL dimension, a quota, or a size bound. Do not wire them into anything touching real
credentials, payments, or user data — not behind a feature flag, not "just for now", not in a demo
that might get deployed. They live at a separate import path precisely so they cannot arrive by
accident alongside the ports.

## Usage

```ts
import { bindings, definePack, createDaemon } from '@jini-ai/core';
import {
  AuthProviderToken,
  DbProviderToken,
  RealtimeProviderToken,
  type AuthProvider,
} from '@jini-ai/capability-providers';
import { JwtAuthProvider } from '@jini-ai/capability-providers/adapters/jwt-auth';
import { SqliteDbProvider } from '@jini-ai/capability-providers/adapters/sqlite';
import { createWebSocketRealtimeProvider } from '@jini-ai/capability-providers/adapters/ws';
import Database from 'better-sqlite3';

const auth: AuthProvider = new JwtAuthProvider({ secret: process.env.SESSION_SECRET! });
const db = new SqliteDbProvider(new Database('/var/lib/example/app.sqlite'));
const { provider: realtime } = createWebSocketRealtimeProvider({ wsOptions: { port: 8080 } });

const bound = bindings()
  .bind(AuthProviderToken, auth)
  .bind(DbProviderToken, db)
  .bind(RealtimeProviderToken, realtime);

const accountPack = definePack({
  name: 'account',
  deps: [AuthProviderToken],
  services: (c) => ({ auth: c.get(AuthProviderToken) }),
});

const daemon = createDaemon({ packs: [accountPack] as const, bindings: bound });
const session = await daemon.services.account.auth.signIn({
  email: 'a@example.com',
  password: 'hunter2',
});
```

## Entry points

| subpath | what's behind it | extra dep it pulls in |
|---|---|---|
| `.` | The five port interfaces, their data types, and the five DI tokens. No implementations. | none |
| `./unsafe-reference` | Non-production in-memory stubs. See the warning above. | none |
| `./adapters/jwt-auth` | `JwtAuthProvider` (HS256 sessions, `scrypt` hashing, in-memory users). | none (`node:crypto`) |
| `./adapters/blob-storage` | `BlobStorageProvider` over an injected `@jini-ai/platform` `BlobStorage`. | none |
| `./adapters/stripe` | `StripePaymentsProvider` (real Stripe REST). | none (`fetch`) |
| `./adapters/sqlite` | `SqliteDbProvider` over a caller-owned `Database` handle. | `better-sqlite3` (native) |
| `./adapters/ws` | `WebSocketRealtimeProvider` + `createWebSocketRealtimeProvider`. | `ws` |

## What's swappable

Everything, by design — that is the package's whole reason to exist. Each of the five interfaces is a
port you can implement against any vendor (Supabase, Auth0, S3, Postgres, Pusher) and bind through
the matching token with no change at the consumer. Within the shipped adapters, the injectable seams
are real too: `StripePaymentsProvider` takes `fetchFn`/`apiBase`, `JwtAuthProvider` takes `now` and
`sessionTtlMs`, `BlobStorageProvider` takes the `BlobStorage` instance, `SqliteDbProvider` takes the
open database handle, and `WebSocketRealtimeProvider` accepts an injected server object so tests need
no real socket. Composition — pairing, say, `JwtAuthProvider` with a durable user store — happens at
the binding site, deliberately not inside this package.

## Runtime

`jini.runtime: "universal"` for the root entry point and `./unsafe-reference`. Per-entry:
`./adapters/stripe` is universal (`fetch` only); `./adapters/ws`, `./adapters/sqlite`,
`./adapters/blob-storage`, and `./adapters/jwt-auth` are Node-only.
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance and scope decisions (note that it
predates the adapters/ports split described above; trust the exports map and this file for the
current layout). Apache-2.0, inherited from Open Design — see the repo `NOTICE`.
