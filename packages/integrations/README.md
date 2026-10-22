# `@jini-ai/integrations`

Third-party vendor integrations and outbound integration services with independent subpath
exports. Import the capability you need; each entry owns its dependencies and runtime boundary.

| Import subpath | Runtime | API |
|---|---|---|
| `./media-providers` | Node | Image/video/audio gateway, policy, staging and task stores |
| `./media-providers/catalog` | Universal | Browser-safe provider/model catalog |
| `./credentialed-http` | Node | Credential-origin binding, authentication, redacted responses and audit ports |
| `./webhooks` | Node | Subscriptions, delivery/retries and signing through host ports |

## No root `.` export

There is deliberately no `.` export and no `main`/`types` field pointing at a barrel. No
subpath is "the default," and a root barrel re-exporting every capability would pull media
dispatch code into a credentialed-HTTP or webhook consumer's bundle — exactly the coupling this
structure exists to avoid.
`typesVersions` covers legacy TypeScript `moduleResolution: "node"` (node10) consumers, which ignore
`package.json#exports` entirely and would otherwise fail to resolve a subpath's `.d.ts` even
though `exports` itself resolves fine at runtime — the same class of node10 gap several packages in
this workspace hit and fixed with a `main`/`types` pair (see their `CHANGELOG.md` 0.1.2 entries);
`typesVersions` is this package's equivalent fix for a package with no single default entry to point
`main`/`types` at.

## `./media-providers`

A gateway for generating images, video, and audio across many vendors behind one call — capability
registry, multi-vendor REST dispatch, policy and staging ports, and an optional SQLite task store.
See `src/media-providers/README.md` for the full feature list and the archived provenance ledger
for provenance.

`better-sqlite3` (a native compiled addon) is an **optional peer dependency**, not a regular one.
Everything in `./media-providers` works without it — `renderStub`, the dispatch engine, the
capability registry, the in-memory task store — because the only code that touches it,
`createSqliteMediaTaskStore`, reaches it through a dynamic `await import('better-sqlite3')` inside
that one function, never a static import. Only a consumer that actually calls
`createSqliteMediaTaskStore` needs to `npm install better-sqlite3` themselves. This is the same
convention `@jini-ai/admin`'s `react`/`react-dom` optional peers use (see its README's "Layers"
section) and `packages/README.md`'s "Optional peer dependencies" table documents workspace-wide.

## `./credentialed-http` and `./webhooks`

The HTTP service takes a workspace-scoped credential resolver, guarded HTTP client,
scheme registry, clock and audit sink. Plugin trust/loading, persistence and authorization
are bound by the host. See [Credentialed HTTP](src/credentialed-http/README.md).

Webhook services take subscription/delivery repositories, an envelope store, HTTP client,
signer, clock and IDs. Signature fields and delivery headers are required host vocabulary.
Key custody and durable claims remain behind ports. See [Webhooks](src/webhooks/README.md).

## Required and optional argument objects

Public calls take required arguments in object one and optional controls in object two.
Dependencies are fields of those objects or their typed `deps` records. DTO values such as
credentials, event records and execution contexts keep their existing wire fields.
The convention conversion is breaking: export names are retained, with no positional overloads.

```ts
import { makeCredentialedRequest } from '@jini-ai/integrations/credentialed-http';
import type { HttpClientPort } from '@jini-ai/core/primitives';

await makeCredentialedRequest(
  { deps: { resolver, httpClient, schemeRegistry, audit, clock },
    input: { workspaceId, label, method: 'POST', url } },
  { body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } },
);
```

Core's `HttpClientPort.send({ request }, { redirect? })` is shared by both services.
Import `HttpClientPort`, `HttpRequest` and `HttpResponse` directly from
`@jini-ai/core/primitives`. `HttpRequest` holds all request fields, including body;
the second argument contains redirect controls. A native transport adapter receives
the unwrapped request and forwards those controls separately.
The host transport must still validate each peer/redirect, cap response reads and strip credentials
on cross-origin redirects. Public validation errors take `{ message }` and optional `{ options }`
for an `ErrorOptions` cause.

## Verification and ownership

No tests, typechecks, builds or pack commands were run in this merge pass (owner directive).
Exact per-file commands are in [integrate-NOT-RUN.md](integrate-NOT-RUN.md).
The protected media-provider lane still owns the task-store conversion recorded in
[w10e-api-inventory.md](w10e-api-inventory.md). Its completion and the later host rewiring
are required before publishing the convention changes. No versions or dependencies changed.

Credentialed-request audit ports use `record({ entry })`. The console audit adapter receives
`{ prefix, log }` and calls `log({ line })`; memory entries and console line formats are preserved.

## Design decisions

- [Webhook endpoints have independent bounded retry state](docs/decisions/DR-001-independent-webhook-retries.md).

HTTP transports implement `send({ request }, { redirect? })`; the complete request includes its
optional body. Webhooks use core `Clock.nowMs()` and `IdGenerator.newId()`.
Media dispatch and async operations take an optional guarded `httpClient`; raw
`fetchImpl` injection is unsupported. Catalog lookup uses `findProvider({ id })`,
and `svgPlaceholder` receives the full required render context. Native Node
buffer writes retain their positional ABI.
