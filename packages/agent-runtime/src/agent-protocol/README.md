# agent-protocol

`@jini-ai/agent-runtime` module providing the ACP and pi RPC subprocess protocol
adapters used to drive external AI agent CLIs.

---

## What this is

Ported from an upstream product's `agent-protocol/` capability barrel (see
`source-map.md` for the exact origin fork/branch/commit and file-by-file
transform table — this file intentionally stays free of that product's name;
provenance lives in source-map.md instead). The module was already split
into a `core/` foundation kernel plus `acp/` and `pi-rpc/` concern
subdirectories at the source, each with a barrel `index.ts` and `@module`
docblocks — this port keeps that internal shape identical (path-mirrored,
not flattened or re-clustered), per this repo's patch-routing convention for
high-churn upstream zones (see `foundry/docs/jini-port/extraction-plan.md` §4).

```
core/  ←  acp/
core/  ←  pi-rpc/
```

Neither `acp/` nor `pi-rpc/` imports the other. Any future shared primitive
belongs in `core/`.

---

## Import conventions

- All relative imports use `.js` extensions (Node ESM).
- **`core/` is the foundation kernel.** Both `acp/` and `pi-rpc/` may import
  from `core/` directly; `core/` itself imports no sibling.
- **`acp/` and `pi-rpc/` must not import each other.** If a new shared
  primitive is needed, add it to `core/`.
- **The root barrel uses explicit named re-exports** — never `export *` — so
  the public surface is enumerable and free of silent name collisions.
- **External code imports from `'./agent-protocol/index.js'`** (or the
  package root barrel, `@jini-ai/agent-runtime`) — never from a subdirectory
  path directly.

## Public surface

```
createJsonLineStream          // core/
AcpMcpServerInput              // acp/ (type)
ModelOption                    // acp/ (type)
AttachAcpSessionOptions        // acp/ (type)
AccountFailure                 // acp/ (type)
AccountFailureClassifier       // acp/ (type)
buildAcpSessionNewParams       // acp/
normalizeModels                // acp/
detectAcpModels                // acp/
attachAcpSession               // acp/
noopAccountFailureClassifier   // acp/
mapPiRpcEvent                  // pi-rpc/
attachPiRpcSession             // pi-rpc/
parsePiModels                  // pi-rpc/
```

The first 10 names reproduce the origin module's exact public surface. The
`AttachAcpSessionOptions` type export and the three `AccountFailureClassifier`
seam exports (`AccountFailure`, `AccountFailureClassifier`,
`noopAccountFailureClassifier`) are new — see "Product-neutral seams" below.

---

## Product-neutral seams (Jini-specific — not in the upstream origin)

Porting this module out of its origin product required de-branding a handful
of real coupling points, each turned into an explicit, documented seam
rather than silently dropped. Full reasoning in `source-map.md` § Design
decisions; summary:

1. **`AccountFailureClassifier`** (`acp/account-failure.ts`) — a small
   injectable port replacing a direct import of the origin's
   vendor-branded account-failure text classifier. `promotedAmrRetryStatusPayload`
   and `promotedAmrStderrPayload` (`acp/updates.ts`) now take a classifier
   argument; `attachAcpSession` threads it through as the optional
   `accountFailureClassifier` field on `AttachAcpSessionOptions`, defaulting
   to `noopAccountFailureClassifier` (always returns `null` — identical
   behavior to not having the feature at all). A product adapter injects its
   own real classifier.
2. **`ExecutionProfile`** (`acp/types.ts`) — inlined locally instead of
   importing the origin's external contracts package; the upstream type is a
   trivial `'filesystem' | 'text_artifact'` literal union with no product
   branding.
3. **Client-name defaults** — `attachAcpSession`'s `clientName` default is
   `'agent-runtime'` (was the origin product's own lowercase-hyphenated
   name); `detectAcpModels`'s is `'agent-runtime-detect'` (same pattern,
   `-detect` suffixed). Both are ACP handshake `clientInfo.name` values;
   harmless to rename.
4. **ACP timeout env var** — `resolveAcpTimeoutMs` (`acp/json.ts`) takes an
   optional third `envVarName` parameter (default
   `'AGENT_RUNTIME_ACP_TIMEOUT_MS'`) instead of hardcoding a product-branded
   variable name.
5. **`text-suppression.ts`** (`acp/text-suppression.ts`) — ported from the
   origin's `apps/daemon/src/artifacts/text-suppression.ts` (already
   product-neutral, zero product imports) and relocated to live alongside
   its sole consumer, `acp/session.ts`, rather than a package-wide
   `artifacts/` module with only one real caller.

---

## Directory structure

```
agent-protocol/
├── index.ts            Root barrel — named re-exports from core/, acp/, and pi-rpc/
├── core/
│   ├── index.ts        core/ barrel
│   └── json-line-stream.ts  createJsonLineStream: shared JSON-line transport
├── acp/
│   ├── index.ts        acp/ barrel
│   ├── types.ts        Shared ACP types (incl. the inlined ExecutionProfile)
│   ├── constants.ts    Protocol constants (method names, timeouts)
│   ├── json.ts          JSON-line parsing helpers + resolveAcpTimeoutMs
│   ├── models.ts        normalizeModels, detectAcpModels
│   ├── rpc.ts            Low-level RPC send/receive helpers
│   ├── session-params.ts  buildAcpSessionNewParams
│   ├── account-failure.ts  AccountFailureClassifier port + no-op default
│   ├── text-suppression.ts  DSML/tool-call text suppressors
│   ├── session.ts        attachAcpSession: session lifecycle
│   └── updates.ts        ACP update-event handling
└── pi-rpc/
    ├── index.ts         pi-rpc/ barrel
    ├── internal.ts      Shared primitives: JsonRecord, SendAgentEvent, TokenUsage, guards
    ├── events.ts         mapPiRpcEvent: pure pi RPC → daemon event mapper
    ├── models.ts         parsePiModels: `pi --list-models` parser
    └── session.ts        attachPiRpcSession: session lifecycle, image forwarding, abort
```

---

## Known limitations and staged migration

**Guard registration is deferred**, same as at the origin: the capability
barrel structure (`core/` + concern subdirs, per-file docblocks, this
README) is in place; a `check-barrel-imports`-style registration for this
domain is future work once that guard infra exists in this repo (see
`scripts/guard.ts`).

**`core/` currently contains one file.** `json-line-stream.ts` is the only
member — the shared transport primitive both adapters depend on.

**No product-adapter wiring in this task.** This package ships the
port-injection seams (the classifier port, the de-branded defaults) but does
not itself implement a real, product-specific `AccountFailureClassifier` —
that belongs to a future product-adapter package, per `AGENTS.md`'s boundary
that `packages/@jini-ai/**` must contain zero product-identity strings.

See `source-map.md` for the full origin commit, file-by-file transform
table, and the documented discrepancy about which upstream branch this module
actually lives on.
