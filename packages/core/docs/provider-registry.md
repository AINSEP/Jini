# Provider registry — frozen contract (2026-10-21)

`@jini-ai/core/provider-registry` (also re-exported from `@jini-ai/core`) and
`@jini-ai/agent-plugins/lifecycle` (`defineProviderContribution`, `contributeProviders`).
Other cloud builds depend on these names and semantics. **Change only additively**; a breaking
change needs an owner decision and a migration of every consumer in the same change.

## Why

Four registry shapes grew independently (provider audit 2026-10-21, cross-cutting point 2). New
provider seams (mail, DNS, object storage, analytics sinks, search) use this one; the four existing
ones migrate later (below). The audit's provider discipline applies: open string id, typed
never-thrown call results, pre-resolved per-provider credentials, guarded outbound HTTP.

## Contract

| Export | Semantics |
|---|---|
| `PROVIDER_ID_PATTERN` | `^[a-z][a-z0-9_]{0,63}$` — the plugin-tool name grammar (agent-plugins `lifecycle/tools/manifest.ts`). |
| `createProviderRegistry<T>({ contract }, { defaultProviderId?, validate?, seed? })` | Independent registry per contract. `defaultProviderId` is validated eagerly (throws) but need not be registered yet. |
| `register({ definition })` | Core/built-in. **Throws** `ProviderRegistryError` (`invalid_id` / `invalid_provider` / `duplicate`). Core wins an id: an earlier plugin entry is displaced and a `displaced_by_core` refusal recorded, so plugin load order can never turn a core registration into a boot crash. |
| `contribute({ definition, pluginId, contract? })` | Plugin. **Never throws**; returns `false` and appends to `refusals()` (`contract_mismatch` / `invalid_id` / `invalid_provider` / `duplicate`). First plugin to claim an id keeps it. |
| `get` / `has` / `list` / `getDefault` / `refusals` | `get` returns `undefined` on a miss. Entries and snapshots are frozen; `provider` keeps its identity (not deep-frozen, so stateful adapters still work). `list` is registration order. |
| `ProviderResult<T>` | `{status:'ok',value}` · `{status:'rejected',error}` (definitively refused; nothing happened) · `{status:'unknown',error}` (indeterminate — reconcile, never blind-retry). Error codes are the named unions `ProviderRejectedCode` / `ProviderUnknownCode`; `message` is caller-safe. Constructors: `providerOk`, `providerRejected`, `providerUnknown`. |
| `ProviderContext` | `{ workspaceId, siteId?, providerAccountId?, mode: 'test'\|'live' }`. Credentials are never carried here — the host pre-resolves them per provider. Seams extend it (commerce adds `credentials`, `httpClient`, …). |
| `DomainRequirement` | `{ purpose: 'mail'\|'site'\|'tls', domain, providerId, records: DomainRecordRequirement[] }`. Lives in core, **not** devops/dns: mail/site/TLS providers declare needs; a DNS provider or the operator satisfies them. |
| `defineProviderContribution({ contract, filename, parse, validate }, { onReadError?, importRefusalReason?, importErrorReason? })` | Wraps `defineExecutablePluginContribution` (same trust gates: active plugin, bundled digest, contained `.mjs`). Descriptor minimum `{ id, module, label? }`. A bad id is refused **before** the module is imported. Items are `{ contract, pluginId, definition }`. Lives in agent-plugins because core cannot import agent-plugins (it already depends on core). |
| `contributeProviders({ registry, loaded })` | Offers loaded items to the registry; returns `{ accepted, refusals }` with loader refusals first, then registry refusals. Never throws. |

## Migration of the four existing registries (not done in this build)

All four use **hyphenated** ids today; the frozen grammar has underscores and no hyphens. Each
migration therefore needs an id decision first (owner question): map `-`→`_` with a read-side alias
for persisted ids, or keep the seam's legacy grammar behind a seam-local alias table.

1. **media `VendorAdapterRegistry`** (integrations `media-providers/dispatch/vendor-registry{,-core}.ts`).
   Keyed by `(providerId, routeKey)`, so either one registry per route key (`image`, `video`, …) or
   `T = Record<routeKey, VendorAdapter>` per provider id. Builtins via `seed`; drop the lazy
   `BuiltinVendorAdapterRegistry` singleton (already deprecated) and build once at composition;
   plugin vendors via `defineProviderContribution` with `contract: 'media'`. Ids today: `openai`,
   `custom-image`, `imagerouter`, `tavily-search` … → needs the hyphen decision.
2. **visitor-auth** (capability-providers `visitor-auth/registry.ts`). Closest shape already
   (register/get/has/list, append-only, throws on duplicate). `T = VisitorAuthProviderDefinition`
   minus `id` (moves to `definition.id`), `validatedCopy` becomes `validate` + a deep-freeze the seam
   keeps; `VisitorAuthRegistryError` codes map 1:1 (`duplicate-provider`→`duplicate`). Grammar today
   `^[a-z0-9][a-z0-9._-]*$` (dots and hyphens).
3. **`OAuthProviderRegistry`** (oauth `registry.ts`). Behaviour changes: today `register` silently
   **replaces** a duplicate and `get` **throws** `OAuthError` on a miss. Migrate as: descriptors via
   `seed`/`register` (`assertValidOAuthProvider` as `validate`), keep a thin seam wrapper whose `get`
   throws the existing `OAuthError` on `undefined`, keep `structuredClone` on read in the wrapper.
   Descriptor-only plugin providers (data, not code) stay on a data contribution, then `contribute`.
   Grammar today `^[a-z0-9][a-z0-9-]{0,63}$`.
4. **commerce `createPaymentProviderRegistry`** (commerce `payments/registry.ts`). Same throwing
   policy; `refund`/capabilities check becomes `validate`; `get` miss changes `null`→`undefined`
   (wrapper or caller update). Its local `ProviderContext` extends core's (`credentials`,
   `httpClient`, `now`, `webhookUrl`, `returnUrl`); its `PaymentError` result maps onto
   `ProviderResult`. **Blocker:** commerce ids are also URL segments and env-var fragments
   (ADR-026 grammar `^[a-z0-9]+(-[a-z0-9]+)*$`), so the hyphen→underscore change touches webhook
   routes and env names. Another cloud build edits commerce today — migrate after it lands.
