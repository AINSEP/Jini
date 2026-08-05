# `@jini/core` — provenance

Unlike `@jini/protocol`/`@jini/platform`/`@jini/sidecar`, `@jini/core` is **not lifted from
OD** — OD's `ServerContext` (`apps/daemon/src/server-context.ts`) is exactly the
structural-dependency-bag anti-pattern the locked architecture rejects (round-1 finding,
reaffirmed in extraction-plan.md §1: "a structural intersection decays exactly like OD's
`ServerContext` did — 40 `any` fields"). There is nothing to port; this package is a
from-scratch implementation of the typed composition contract specified in
`ADS-memory/reports/jini-port/extraction-plan.md` §2.2 and §8 task 3.

| file | implements |
|---|---|
| `src/token.ts` | `token<T>(id)` / `manyToken<T>(id)` — nominal, versioned, cardinality-typed identity. `const Id extends string` type params (TS 5's `const` type parameter inference) so a token's id is a literal type, not just `string` — required for the compile-time check below. |
| `src/pack.ts` | `definePack({ deps, services, http?, cli? })` and the `PackContainer` a pack's `services` factory receives — scoped to that pack's own declared `deps`; resolving an undeclared token throws (no ambient resolver escape, per §2.2 "Kernel exports only kernel-service tokens... No ambient resolver escapes setup"). |
| `src/bindings.ts` | `bindings().bind(token, impl).bindMany(manyToken, impl)` — a typed builder that accumulates the literal union of bound token ids in its own type parameter (`Bindings<BoundIds>`), and rejects a duplicate singleton binding or a version-incompatible resolution at the point it happens, with the exact token id and (for version) both version numbers in the message. |
| `src/daemon.ts` | `createDaemon({ packs, bindings, transports? })` — the compile-time gate (`Exclude<RequiredTokenIds<Packs>, BoundIds>` must be `never`, enforced via a config property that only becomes satisfiable when the exclusion is empty) plus the runtime resolution pass that calls each pack's `services()` against a container scoped to its own deps. |
| `src/index.test.ts` | Runtime proof: successful compose + resolve, `bindMany` ordering, and the three "legible error" cases from the gate (missing / duplicate-singleton / version-incompatible), each asserting the exact message. |
| `src/compose.typecheck.ts` | Compile-time proof: an under-bound `createDaemon` call is expected to fail typecheck (`@ts-expect-error`); if the gate regresses, the unused directive itself fails `pnpm typecheck`. |

Not yet implemented (later tasks per extraction-plan §8): kernel service tokens themselves
(`RunLifecycle`, `EventLog`/`EventSink`, `AgentExecutor`, `ToolRegistry`/`ToolExecutor`,
`ProviderRegistry`, `Principal`/`Authorizer` — task 5/6/7), `@jini/node-host`'s zero-interface
preset (task 9), and the startup diagnostics wording in §8 task 3 beyond what's here (today's
diagnostics are thrown `Error`s with legible messages; a structured startup report — e.g. all
violations collected before exit rather than fail-fast on the first — is a reasonable
follow-up once a real host has more than one or two packs to compose).

## Flat daemon primitives (2026-07-18, port continuation task — Part 2)

Three of the seven top-level files identified as "not yet ported" in OD's
`apps/daemon/src/` (`agents.ts`, `sandbox-mode.ts`, `terminals.ts`,
`daemon-paths.ts`, `origin-validation.ts`, `api-token-auth.ts`, `redact.ts`)
landed here — the pure, no-filesystem/no-OS-process security/auth/telemetry
primitives. The other four (`sandbox-mode.ts`, `terminals.ts`,
`daemon-paths.ts`, plus `home-expansion.ts`, a shared helper both of the
latter two need) landed in `@jini/platform` instead — see that package's own
`source-map.md` for the split rationale. `agents.ts` was **not ported** at
all in this pass — see "Deferred: `agents.ts`" below.

| Jini file | Origin file | Home rationale |
|---|---|---|
| `src/redact.ts` | `apps/daemon/src/redact.ts` | Verbatim port (no product-identity strings or hardcoded env vars in the origin — nothing to genericize). One deviation: `isLuhnValid`'s length (`digits.length < 13 \|\| > 19`) and per-digit (`d < 0 \|\| d > 9`) defensive guards were dropped. Both are provably dead — `isLuhnValid` is private with exactly one call site (the `CARD_CANDIDATE.replace` callbacks), `CARD_CANDIDATE`'s own regex (`\b(?:\d[ -]?){12,18}\d\b`) guarantees any string reaching it is 13-19 characters, and the preceding `match.replace(/\D/g, '')` strip guarantees every character is an ASCII digit. Classified per `ADS-memory/reports/jini-port/skills/fixing-open-design.md` Phase 6.5's "dead branch" bucket (a defensive check the surrounding code already makes unreachable) rather than written as a coverage-gaming contrived test — same discipline the agent-protocol port (Part 1) already established for this codebase. Documented inline at the call site too. |
| `src/api-token-auth.ts` | `apps/daemon/src/api-token-auth.ts` | Genericized: the origin hardcoded its host product's disable/token env-var names as module-level constants; both are now fields on `ApiTokenAuthEnvConfig`, threaded through every function. Pure security-gate logic (no filesystem/process I/O) — fits `@jini/core`'s "pure interfaces, Principal/Authorizer-adjacent" scope, not `@jini/platform`'s OS-primitive scope. |
| `src/origin-validation.ts` | `apps/daemon/src/origin-validation.ts` | Genericized: the origin hardcoded its host product's allowed-origins/web-port/bind-host env-var names as module-level constants; all three are now fields on `OriginValidationEnvConfig`. One function, `isZeroConfigClipperLibraryRequest`, was **not ported** — it's a bypass for one specific product's own browser-extension-driven library-ingest route (hardcoded route paths `/library/clipper-probe` and `/library/ingest`, a specific browser-extension integration), not a generic same-origin primitive; porting it would smuggle a product feature into the engine kernel. Same category of exclusion as `library-curator` in the agent-runtime skills port (Part 1's `source-map.md`) — a product-specific capability with no portable technique underneath. Everything else (host/origin parsing, private-IP/loopback classification, the same-origin decision tree) is generic and ported with only the env-var names parameterized. |

## `ToolRegistry` half of the tool-execution boundary (2026-07-18, port continuation task — Part 3)

`principal.ts`, `tool-registry.ts`, `internal.ts`, `tool-tokens.ts` — the
`@jini/core` half of `ToolExecutor` (extraction-plan.md §2.5/§8 task 6).
**No upstream source; original design work**, per extraction-plan.md §3's
locked package table splitting `ToolRegistry` (here) from the stateful
`ToolExecutor` (`@jini/daemon`). Full design-decision writeup — including
why the split, and exactly how "handlers never publicly retrievable" is
enforced via `internal.ts`'s separate `package.json` `exports` entry — is
in `@jini/daemon/source-map.md`'s "`ToolExecutor` — the tool-execution
boundary" section, since that's where the more consequential half of the
design (the audit-trail state machine, resumable confirmation) actually
lives. This package's own three additions are deliberately small: a
`Principal` interface, the `ToolRegistry`/`ToolDescriptor`/`ToolPolicy`
registration types plus `createToolRegistry()`, and the DI token.

### Deferred: `agents.ts`

OD's `apps/daemon/src/agents.ts` is a 26-line `@ts-nocheck` re-export barrel
over `./runtimes/{registry,detection,executables,launch,resolution,env,mcp,
prompt-budget,models}.js` — it has no logic of its own. None of those nine
files exist in `@jini/agent-runtime` yet (Part 1 of this port only landed
`agent-protocol/` — the ACP + pi-rpc transport layer; the `runtimes/`
registry/detection/execution tree is `extraction-plan.md` §8 task 7 /
`r1b-daemon-design.md` §1's `@jini/agent-runtime` T2 scope, a separate,
much larger task). Porting `agents.ts` in isolation would produce a barrel
with nine dangling imports to modules that don't exist in this repo —
neither a real port nor a coverable unit. Left for whichever task actually
lifts the `runtimes/` tree; noting it here so it isn't mistaken for
"silently skipped."
