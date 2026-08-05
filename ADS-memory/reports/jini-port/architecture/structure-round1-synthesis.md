# Round 1 Structure Debate — Convergent Conclusions (input to round 2)

Three independent seats (codex gpt-5.6-sol, agy Gemini 3.1 Pro, Claude Fable 5) critiqued the proposed Jini structure. They converged strongly. Summary of what they agreed on (this is the CURRENT best direction — round 2 must harden it OR beat it):

## Unanimous conclusions

1. **Eject `foundry/integrations/open-design` from the engine repo.** Publish `@jini/*`; every consumer (OD, Open-Marketing, Zana, Tovu) is its own repo consuming versioned/packed packages. An in-tree favored consumer guarantees the engine boundary warps to serve it. Test consumers against `pnpm pack` tarballs, never embed one.

2. **Drop `workspace-react`.** The app shell IS product identity → per-product. Engine ships headless hooks (`chat-react`) + dumb primitives (`components`) only.

3. **The `createDaemon({10 ports})` spine is a hidden OD tilt** — a de-branded OD `ServerContext` (verified ~40 mostly-`any` fields; ports encode WorkspaceStore-with-projects, listDesignSystems, artifact rendering, marketplace). `PortsCoverRoutes<>` is a vacuous type check. FIX: minimal kernel = lifecycle + run store + event sink + agent executor + **tool registry + provider registry**; each route pack brings its own deps; OD's ports become one product's injected bundle. Build the spine from the ZERO-OD consumer (Zana's ProviderRegistry/ToolRegistry), then prove OD fits.

4. **Merge ~19-23 packages → ~8.** sidecar-proto→sidecar; registry-protocol→plugin-runtime; release/metatool/download/diagnostics→parked tooling; persistence interfaces→core (+ `sqlite` adapter); defer `desktop-host` until a 2nd host exists; `agui` stays optional/consumer-side (its API is literally `encodeOdEventForAgui(OdNativeEvent)` — OD-bound, needs a neutral wire contract not a rename).

5. **Automation OUT of the engine repo** (separate repo). AI-Dev-Shop = pipeline defs (HOW); project-runner = execution service (WHICH/WHO/WHAT — queue/lease/sandbox/run-events); ADS-memory = durable decisions/knowledge. One canonical job state machine. (Verified: ADS-memory's specs_as_built/architecture.md is a placeholder, dependency-graph.yaml empty, two duplicate ADS-memory dirs — NOT adopt-as-is.)

6. **Provider/tool registry + capability descriptor = v1 core** (2 consumers re-derived it). **PARK code-exec + terminal impls** — Zana's capability packages are still stubs (built slice = core+db+ai+daemon only), so their isolation/lifecycle/security contract isn't real yet. Ship the port design doc, not the impl.

7. **Prove neutrality, don't infer it.** String-scans + zero-import moves ≠ semantic neutrality. Gate on a **Zana-shaped fixture booting the daemon with no project/artifact/design assumptions**, compiled against packed tarballs + API-snapshot review. Acceptance = zero-OD boot, NOT OD parity.

## Verified corrections to the original proposal

- agentic's Vite path is DEV-ONLY (vite.config says Next remains the production build) — production Vite is real unstarted work.
- Open-Marketing's product-neutrality.test.ts is weak (orchestrator-copy check, not OD-noun/route-semantics).
- ADS-memory is aspirational/duplicated, not adopt-as-is.

## Missing pieces the seats flagged (add to plan)

first-class CLI package + shared app-service layer used by BOTH http+cli · protocol versioning/replay-cursors/cancellation/idempotency · real tool-execution security boundary (authz/confirmation/audit/timeouts/result-limits) · auth/principals/tenancy (not just credential store) · plugin trust policy (signature/permissions/isolation) · production-Vite acceptance (Electron assets, deep links, CSP, offline) · threat models for imported workspaces/symlinks/PTY/srcDoc.

## Corrected consumer-fixture model (user correction)

NO consumer-shaped folders inside the engine. In-repo = only a tiny synthetic `examples/minimal-host` (imports ONLY @jini/*, the lint target + CI smoke). Real neutrality gate = each REAL external consumer repo (Zana/Tovu/OD/OM) consuming packed/published @jini/* in its own cross-repo CI.
