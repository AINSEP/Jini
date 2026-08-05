# Jini Engine — Round 2: Architecture A Evaluation & Lock-in

The "A" architecture correctly identifies the physical boundary of a reusable engine: a neutral kernel driven by a pluggable composition contract, treating Open Design (OD) strictly as a consumer. However, its specific execution of the composition type system, the app-service boundary, and the OD-sync strategy contains critical structural flaws that will cause it to collapse at scale or fail its maintenance requirements. 

Here is the decisive evaluation of A-design, the sharpest flaws broken down, and the final locked configuration.

---

## 1. Scenario Evaluation (M1-M4)

**S1: Add a "deploy to Netlify" provider**
**Verdict: Pass (M1/M2).** The provider is built as an independent, additive module (`@jini/provider-netlify`) and injected into the `ProviderRegistry` at the composition root. Zero files in the kernel are touched.

**S2: Add a new coding-agent CLI**
**Verdict: Pass (M2).** The `AgentExecutor` delegates to `@jini/agent-runtime`, which uses a zero-switchboard "add-a-file" discovery pattern. Adding a CLI is a pure addition; the system discovers it without central registry edits.

**S3: Stand up a brand-new product wanting only chat+runs**
**Verdict: Strains (M4).** While conceptually minimal, the A-design forces the new consumer to satisfy a massive TS union of dependencies dictated by the chat and run route-packs. If those route-packs have complex or overlapping storage interfaces, the integration barrier is excessively high for a simple product. 

**S4: Swap a provider impl (e.g. sqlite persistence → postgres)**
**Verdict: Pass (M1).** Route-packs depend on abstract interfaces (ports), not concrete implementations. Swapping the provider injected at `createDaemon` has zero blast radius on the route-packs or kernel.

**S5: A consumer using NONE of OD's design/artifact concepts boots green?**
**Verdict: Pass (Neutrality).** The kernel noun set (`RunLifecycle`, `EventSink`, `AgentExecutor`) has been successfully purged of product concepts. An empty `minimal-host` fixture boots a pristine kernel without needing a mock "design system."

**S6: Scale to 30 providers / 50 tools / 5 route-packs**
**Verdict: Breaks (M3).** Deriving the daemon's host requirement via a TypeScript union/intersection of all route-pack dependencies (`Union<RoutePack['deps']>`) is mathematically sound but practically catastrophic. At scale, this causes opaque 100-line intersection errors and namespace collisions (e.g., two route-packs demanding a `db` object but expecting different drivers). 

**S7: Upstream OD security fix lands on OD's daemon**
**Verdict: Breaks (OD-Sync).** A-design claims that extracting core files to `@jini/kernel` allows upstream OD patches to still apply because OD stays "OD-shaped." This is a facade illusion. `git format-patch` operates on exact file paths. If Jini deletes `apps/daemon/src/kernel/EventSink.ts` by moving it to `@jini/kernel`, an upstream patch targeting that file will abort with a `No such file or directory` error, destroying OD-sync.

---

## 2. The Sharpest Flaws (and Concrete Fixes)

These are the 5 architectural weaknesses in A-design and their required lock-in fixes.

### Flaw 1: The Union-of-Deps Type Explosion (Composition Contract)
- **The Flaw:** `createDaemon` relies on a flat-object TS intersection to enforce dependencies across all route-packs.
- **Why it bites:** At 30 providers and 5 route-packs, overlapping property names (`store`, `auth`, `db`) silently collide or widen. If the host misses a single dependency, TypeScript emits an impenetrable wall of text (`Type X is not assignable to type A & B & C...`), halting developer velocity and breaking M3.
- **The Fix: Typed DI Tokens.** Replace the flat union with a Capability Token registry. Route-packs explicitly import and declare Token dependencies (e.g., `deps: [RunStoreToken, EventSinkToken]`). The host provides a list of `[Token, Implementation]` tuples. TypeScript type-checks each token individually, preventing namespace collisions and providing localized, legible errors (`"InjectionToken 'RunStore' missing"`).

### Flaw 2: The OD-Sync Facade Illusion (The First-Adapter Seam)
- **The Flaw:** Physically extracting core files from OD's adapter into `@jini/*` breaks git patch paths.
- **Why it bites:** OD-sync requires `git format-patch` to find the files it intends to patch. If the Jini extraction empties the directory tree, the patch tool fails.
- **The Fix: Hollow Re-exports.** The OD adapter (`apps/daemon/src/...`) **must retain its exact upstream file tree** for all lifted modules. The file `EventSink.ts` stays in the OD adapter, but its contents are gutted to a 1-line re-export: `export { EventSink } from '@jini/daemon'`. Upstream patches will now successfully hit the file and generate a clean merge conflict, alerting the maintainer to manually port the fix down into the engine.

### Flaw 3: Kernel Ownership of the App-Service Layer (Modularity)
- **The Flaw:** A-design places the "app-service layer" inside `@jini/kernel`.
- **Why it bites:** The kernel is supposed to be neutral. If the kernel owns the business logic (app-services) for Chat and Runs, adding a *new* domain (like a testing pipeline) requires modifying the kernel to add its app-service. This turns the kernel back into a monolith and violates M1/M2.
- **The Fix: Route-Packs Own Services.** The kernel provides ONLY the **transport bus** (HTTP router, CLI command bus). **Route-packs** own their own app-services. The `@jini/kernel` contains zero business logic.

### Flaw 4: Blind Tool-Execution Boundary (Security/Extensibility)
- **The Flaw:** The `ToolRegistry` sits in the headless kernel but claims to handle "authorization and confirmation."
- **Why it bites:** The kernel is transport-agnostic; it physically cannot prompt a user. It doesn't know if it's running via a CLI (needs a `stdin` prompt) or an HTTP API (needs to send an SSE to React). 
- **The Fix: Execution Delegates.** The `ToolRegistry` must define an `ExecutionDelegate` interface (`onAuthorize()`, `onConfirm(tool)`). The concrete *host transport* (`@jini/cli` or `@jini/http`) implements and injects this delegate, bridging the headless kernel to the actual user UI.

### Flaw 5: The Monolithic Kernel Package Cut (Minimal Integration)
- **The Flaw:** Grouping pure interfaces (`ToolRegistry`, `ProviderRegistry`) with stateful lifecycle managers (`RunLifecycle`, `EventSink`) inside a single `@jini/kernel`.
- **Why it bites:** A short-lived CLI script might want to consume the `ToolRegistry` to execute an action, but forcing it to pull in the entire long-running daemon lifecycle violates minimal integration (M4).
- **The Fix: Split Core from Daemon.** Split into `@jini/core` (Registries, DI Tokens, pure interfaces) and `@jini/daemon` (RunLifecycle, EventSink, stateful host).

---

## 3. The Locked Package Set + Composition Contract

### The Package Cut
```typescript
@jini/protocol        // Wire types, run events, error shapes (pure TS)
@jini/core            // ProviderRegistry, ToolRegistry, DI Tokens, Principal
@jini/daemon          // RunLifecycle, EventSink, AgentExecutor, DI Container
@jini/agent-runtime   // Runtimes registry, defs, stream parsers, discovery
@jini/persistence     // SQLite default impl + token interfaces
@jini/http            // HTTP transport + route-pack HTTP registrar
@jini/cli             // CLI transport + stdin/out
@jini/platform        // OS primitives
@jini/sidecar         // NDJSON-IPC
@jini/chat-core       // Chat route-pack + app-services
@jini/chat-react      // Headless hooks
@jini/components      // UI primitives
```

### The Composition Contract (DI Token Spine)
```typescript
import { Token, Container } from '@jini/core';

// 1. Core defines the physical contract
export const RunStoreToken = new Token<RunStore>('RunStore');
export const EventSinkToken = new Token<EventSink>('EventSink');

// 2. Route-packs declare their dependencies clearly
export const chatRoutePack = {
  deps: [RunStoreToken, EventSinkToken],
  registerHttp(app: Router, container: Container) {
     const store = container.get(RunStoreToken);
     app.post('/chat', ...); // Thin route over route-pack's own app-service
  }
};

// 3. createDaemon is completely type-safe and namespace-collision free
export function createDaemon(opts: {
  bindings: [Token<any>, any][], // Host injects implementations here
  routePacks: RoutePack[]
}) {
  const container = new Container(opts.bindings);
  // Validates all routePack deps are satisfied by bindings
}
```

---

## 4. First 10 Extraction Tasks

These tasks are dependency-ordered and resumable. **Crucially, every task touching an OD file replaces the file's contents with a re-export of the extracted `@jini/*` package.** This maintains the file tree for `git format-patch` while shifting the implementation.

1. **Extract `@jini/protocol`:** Lift wire types, run events, and error shapes from OD's types into a pure TS package.
   *Gate:* OD typechecks perfectly against the packed `@jini/protocol` tarball.
2. **Extract `@jini/core` (Registries & Tokens):** Lift `ToolRegistry` and `ProviderRegistry` interfaces. Create the DI Token system.
   *Gate:* The `examples/minimal-host` fixture boots an empty container with zero type errors.
3. **Extract `@jini/platform` & `@jini/sidecar`:** Verbatim lift of OS/IPC primitives.
   *Gate:* OD sidecar tests pass using the packed tarballs. OD's platform files become 1-line re-exports.
4. **Extract `@jini/agent-runtime`:** Lift the add-a-file runtimes registry and parsers.
   *Gate:* A non-OD fixture can discover a dummy agent CLI without any OD concepts loaded.
5. **Extract `@jini/daemon` (Lifecycle):** Move `EventSink`, `AgentExecutor`, and `RunLifecycle`.
   *Gate:* `minimal-host` can start, stream, and cancel a dummy event loop. OD adapter files are gutted to re-exports.
6. **Implement Execution Delegate in `ToolRegistry`:** Add `ExecutionDelegate` to `@jini/core` and bridge it in `@jini/daemon`.
   *Gate:* `minimal-host` successfully auto-confirms or rejects a dummy tool call via a synthetic delegate.
7. **Extract `@jini/persistence`:** Port OD's sqlite run/event store behind token interfaces.
   *Gate:* `minimal-host` writes and retrieves a run.
8. **Extract `@jini/http` & `@jini/cli`:** Build the transport routers that consume the DI container.
   *Gate:* `minimal-host` boots HTTP, hits a dummy route, and successfully responds to CLI `--json` using the same underlying logic.
9. **Extract `@jini/chat-core` & `@jini/chat-react`:** Lift chat parsing, app-services, and React hooks.
   *Gate:* A React test fixture renders a chat stream entirely driven by `minimal-host`.
10. **Lock OD Adapter & Prove OD-Sync:** Finalize OD's `apps/daemon` routes into `createDaemon` calls and OD-specific route-packs.
    *Gate:* OD boots green. Apply a known past `git format-patch` from OD history targeting `EventSink.ts` to verify it hits the re-export and generates a clean, trackable merge conflict.

---

## 5. The Rot Guardrail

**The #1 risk to this architecture over 2 years is "Domain Creep" (Convenience Leakage).** 
Because the primary maintainers will inevitably spend most of their time working on Open Design or Tovu, there will be immense pressure to add "universally useful" product concepts (like `ProjectContext`, `WorkspaceId`, or `DesignSystem`) directly into `@jini/daemon` to avoid wiring them through the DI container. Once one product concept leaks in, the general-purpose boundary collapses.

**The Guardrail: The Strict Neutrality CI Gate.**
The `examples/minimal-host` fixture is not just a smoke test; it is the ultimate architectural enforcer. It must boot the daemon, execute a run, and call a tool using **zero product concepts**. Every single Pull Request to the Jini engine MUST run and pass this test. If a developer attempts to add a requirement to the kernel that `minimal-host` cannot satisfy without inventing a dummy "project" or "workspace", the CI run fails, and the PR is permanently blocked. Neutrality must be continuously, mathematically proven, not just asserted in documentation.
LOCK_SEAT2_DONE exit=0
