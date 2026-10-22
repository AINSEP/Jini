# OAuth client extraction contract

Approved scope: independent OAuth 2.x protocol client, Node runtime, shared core kernel dependency.
Discovery, registration, PKCE, authorization-code, device-code, refresh, errors, registry and ports each have a separate module. HTTP, time, entropy, outbound policy and persistence are injected. Application identity is required; registries are instances.

Preserve bounded JSON, no automatic grant retries, single-use owner-bound pending grants, token normalization, three client authentication methods, device deadlines and refresh single-flight/lease ordering. Add RFC 8707 indicators to authorization, code exchange, device and refresh requests. Validate extra parameters before persisting state.

Store adapters are replaceable and asynchronous. Memory stores are only exported from ./testing; file registration cache uses a required file path. No transport protocol integration belongs in source. Consumers wire bearer suppliers and challenges themselves.

Verification: ported characterization suites plus direct contracts for required identity, injected ports, resource binding, registry isolation, cache persistence and package boundaries. Real port-binding cases are retained separately for an unrestricted runner. The second consumer has not adopted this package yet, so extensibility remains INCONCLUSIVE.

Public functions, factories, constructors and port methods use a required input object and, when needed, a separate optional settings object. `OAuthRequiredArgs<T>` and `OAuthOptionalArgs<T>` partition each existing request/dependency type without changing domain records. Operations without inputs take `{}`. The `api.ts` module re-exports the protocol operations directly; no legacy signature adapters remain. HTTP uses `fetchFn({ url }, requestInit)`, entropy uses `randomBytesFn({ byteLength })`, and sleep uses `sleep({ ms })`. Consumers adapt native facilities at their own composition root.

This is an owner-approved breaking conversion of the existing exports. The original argument-object conversion retained defaults; the canonicalization changes and their replacement contracts are documented in API.md and CHANGELOG.md. Package version stays the same; the redundant provider-primitives subpath is removed. Verification is deferred by the owner's no-test directive; see `conv-oauth-report.md` for the inventory, caller ledger and exact commands.

Integration exposes Node discovery-policy and DNS-pinned transport entries. Issuer binding defaults on; path-scoped discovery exhausts path candidates and fails unless `allowOriginFallback: true` explicitly allows root metadata. The host URL guard and dispatcher still own connection-time policy. Fixed-issuer adapters now use the main normalized token parser, and callback payload storage shares the main pending store implementation. Kernel clocks and timestamp formatting come from core; this package no longer claims zero dependencies. URL redaction preserves provider-owned pattern/replacement data. See API.md for the complete surviving surface.
