/**
 * `@jini-ai/capability-providers` — abstract, swappable capability-provider
 * ports (auth/storage/payments/db/realtime): stable interfaces and typed DI
 * tokens only. Speculative port-design exploration, built with no current
 * consumer — see `archived provenance ledger` for the full scope note and sign-off
 * status.
 *
 * This entry point intentionally does NOT export any concrete
 * implementation. The non-cryptographic, non-production in-memory
 * reference stubs that prove each port is genuinely implementable
 * (`createInMemoryAuthProvider` and friends) live under
 * `src/unsafe-reference/` and are exported only from the separate
 * `@jini-ai/capability-providers/unsafe-reference` entry point — see that
 * directory's `index.ts` header before importing anything from it.

 * Archived provenance rationale:
 * ## Why this exists (the gap it names)
 *
 * `ADS-memory/reports/jini-port/recon/r5b-consumers-matrix.md` §2 (the capability matrix) and
 * §3.3 identify a **capability-provider registry with auth / storage /
 * payments / db / realtime as Zana + a fleet orchestrator convergent** — both consumers
 * independently built an explicit port+provider layer (Zana: `app-chassis`'s
 * "rigid core, flexible edges" thesis, `packages/{core,ai,db,auth,storage,
 * payments}` + `providers/supabase` declaring which capabilities it
 * implements; the fleet orchestrator: "ports+sqlite/memory"), while Open Design itself
 * only models these capabilities thinly. §3.3 states this "should be an engine
 * primitive... so products swap Supabase/SQLite/Stripe without touching core"
 * — that is the shape this package builds: 5 independent ports (not one
 * umbrella "CapabilityProvider" interface — see "Design decisions" below) each
 * with a typed DI token (`packages/core/src/token.ts`'s pattern) and a minimal
 * in-memory reference implementation proving the port is genuinely
 * implementable.
 *
 * ## Design decisions
 *
 * **Five separate port interfaces, not one `CapabilityProvider` union.** Zana's
 * own model has a single adapter (Supabase) implementing multiple capabilities
 * at once, which might suggest one umbrella interface with optional methods.
 * Rejected: extraction-plan.md §2.2's core lesson (the reason typed tokens beat
 * a structural dependency object in the first place) is that a union/bag
 * interface is exactly the shape that decays into an OD-`ServerContext`-style
 * god-object as capabilities accrete. Five independently bindable tokens means
 * a consumer wiring only `DbProviderToken` + `StorageProviderToken` never sees
 * `AuthProvider`/`PaymentsProvider`/`RealtimeProvider` in its type surface. A
 * real adapter that happens to implement several (a future `SupabaseAdapter`)
 * is free to be one class satisfying multiple interfaces and bound to multiple
 * tokens — that composition happens at the binding site, not in this package.
 *
 * **No registry/discovery module.** The task brief's scope constraint says
 * "abstract port/interface definitions... plus at minimum one trivial
 * reference/stub implementation" and explicitly forbids wiring this into any
 * other package. `@jini/core`'s existing typed-token + `bindings()` mechanism
 * already *is* the registration/discovery layer (extraction-plan.md §2.2) —
 * building a second, parallel registry inside this package would duplicate
 * that machinery for no reason and blur the "zero other package depends on
 * this" boundary the brief asked for. A consumer registers these tokens in its
 * own `createDaemon({ bindings: bindings().bind(AuthProviderToken, ...) })`
 * call; this package supplies only the tokens and the interfaces they carry.
 *
 * **In-memory reference stubs, not "the obvious real adapter."** The brief is
 * explicit: interfaces + minimal stubs only, no full per-provider-type
 * implementations (no real Stripe/Auth0/Supabase integration). Every stub here
 * optimizes for proving the port's shape is satisfiable and unit-testable, not
 * for production use — see each file's header comment for the specific corners
 * cut (plaintext passwords, deterministic always-succeeding charges, no
 * cross-process realtime fan-out, no query language beyond exact-match
 * `where`).
 */
export * from './auth.js';
export * from './storage.js';
export * from './payments.js';
export * from './db.js';
export * from './realtime.js';
export * from './tokens.js';
