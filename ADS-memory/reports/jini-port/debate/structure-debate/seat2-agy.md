# Verdict

This proposed structure is fundamentally **right-with-fixes**. It successfully identifies the critical adapter-port boundary necessary to abstract the engine from the product, but it is fatally compromised by residual Open Design (OD) tilt and severe package over-engineering. The single biggest concern is the architectural cowardice of the "Monorepo Trap": co-locating `foundry/integrations/open-design` inside the Jini repository. By allowing the primary consumer to live in-tree, Jini ceases to be an independent, product-neutral engine and devolves into a mere refactoring of the Open Design monorepo. This setup destroys the physical forcing function required to guarantee neutrality. If OD and Jini share a commit history, engine boundaries will invisibly warp to serve OD’s immediate needs, bypassing strict port/adapter discipline and instantly breaking strict consumers like Zana.

# Strongest objections

**1. The Monorepo Trap (Hidden OD-Tilt)**
*The Flaw:* Housing `foundry/integrations/open-design` inside the Jini engine repository.
*Why it bites:* Placing the consumer inside the engine's repository eliminates the hard physical boundary needed to enforce true product neutrality. In a monorepo, a developer can alter an engine API and update the OD adapter in the exact same PR. This guarantees that the engine will continuously warp to fit OD's specific edge cases. Zana (the zero-OD-import consumer) will break silently because the engine's "neutrality" is only ever tested against the in-tree OD implementation.
*The Concrete Fix:* Eject `foundry/integrations/open-design` from this repository entirely. Jini must be a pure upstream provider that publishes `@jini/*` packages. OD, Zana, and Open-Marketing must consume these packages across a strict repository boundary. During the strangler extraction, enforce integration via local `pnpm link` or npm overrides, but never commit the consumer to the engine tree.

**2. The `workspace-react` App Shell Delusion**
*The Flaw:* Classifying layout, panels, command-palette, and theming (`workspace-react`) as a generic engine package.
*Why it bites:* Claiming the workspace shell is product-neutral is blatant OD-tilt. The app shell *is* the product's identity. Forcing a specific visual hierarchy and workflow paradigm onto consumers violates the core premise of a general-purpose engine. Zana re-derived its own architecture specifically to avoid this; Tovu swaps the web UI entirely. If Jini ships the workspace shell, it is just shipping OD under a different name.
*The Concrete Fix:* Eject `workspace-react` into the consumer repositories. The engine should only provide atomic, headless hooks (`@jini/chat-react`) and dumb primitive UI building blocks (`@jini/components`), leaving the compositional app shell and layout routing entirely to the product.

**3. Micro-Package Fragmentation**
*The Flaw:* Shattering the plugin and sidecar logic into absurdly granular micro-packages (`plugin-runtime`, `registry-protocol`, `metatool`, `download`, `diagnostics`, `release`, `sidecar`, `sidecar-proto`).
*Why it bites:* Proposing 19+ packages for a v1 extraction is catastrophic over-engineering. It creates a massive tax on internal boundary management, versioning, and dependency graphs for code that shares an identical lifecycle and execution context. This fragmentation slows down extraction by forcing developers to constantly navigate artificial npm boundaries for highly cohesive logic.
*The Concrete Fix:* Radically consolidate. Merge the six plugin/metatool micro-packages into a single, cohesive `@jini/agent-runtime` package. Merge `sidecar-proto` directly into `@jini/protocol` or `@jini/sidecar`. Reduce the engine to a maximum of 8 cohesive packages.

**4. The Tovu-Runner Void (No Default Host)**
*The Flaw:* The structure provides a daemon library (`daemon-core`) but no standard runnable host application, while explicitly expecting Tovu-Runner to "swap only apps/web/src".
*Why it bites:* If Tovu-Runner's defining constraint is that it only swaps the web source, it inherently requires a fully composed, executable daemon application to serve that frontend. Forcing Tovu to manually orchestrate `createDaemon({ports})` from raw engine libraries breaks its simple swap constraint and forces it to maintain a composition root.
*The Concrete Fix:* Introduce an `apps/jini-daemon` standard host application inside the engine repo. This provides a reference composition root (wiring up standard OS ports) that Tovu can run out-of-the-box, fulfilling the promise of a drop-in engine.

**5. Leaked Product Baggage (`agui-adapter`)**
*The Flaw:* Placing the `agui-adapter` alongside core engine packages.
*Why it bites:* AG-UI is an interop seam specifically built for OD's legacy CopilotKit implementation. It is product-specific legacy debt masquerading as a core capability. Injecting it into the general engine pollutes the neutral protocol and forces Zana to inherit OD's historical UI decisions.
*The Concrete Fix:* Push `agui-adapter` into the consumer's adapter layer (OD's repo) or isolate it as an explicitly optional, deprecated `@jini/adapter-agui` package. The core engine protocol must remain completely ignorant of AG-UI.

# The open questions

**Is `workspace-react` engine or per-product?**
**Per-product, decisively.** Theming, layouts, panels, and routing define a product's unique identity and user experience. The engine ships the internal logic (headless hooks) and pure generic components; the consumer must build the car. Including it in the engine is a failure of abstraction.

**Are code-exec/terminal/capability-registry in v1 or parked?**
**Parked.** The strangler pattern demands achieving parity with existing systems before building net-new features. Do not build capabilities OD currently lacks just to appease Zana in v1. Zana can inject its existing implementations via the daemon ports in v1. These capabilities should only be absorbed into the Jini engine in v2, once the extraction is stabilized.

**~19 packages — which merge?**
**Merge aggressively.** The engine must be lean. Target ~8 packages total:
- Merge `sidecar-proto` into `protocol`.
- Merge `plugin-runtime`, `registry-protocol`, `metatool`, `download`, `diagnostics`, and `release` into `agent-runtime`.
- Merge `chat-core` into `chat-react`.
- Merge `persistence` directly into `daemon-core` (persistence is just an implementation detail of the daemon ports).

**Does automation/ belong IN the Jini repo or a separate repo?**
**Separate repo (or an isolated meta-directory).** AI-Dev-Shop is the factory that builds the code; it is not the product itself. Mixing development infrastructure with runtime engine code creates dangerous architectural confusion. If it must live in the repo to self-host Jini's development, it must be sequestered in a `.automation/` dot-folder with strict linting preventing any `@jini/*` package from importing it.

**Monorepo-with-integrations vs each consumer in its own repo?**
**Each consumer in its own repo.** You cannot prove product-neutrality if the engine and the product share a commit history and CI pipeline. The Jini repo publishes packages; the consumer repos import them. This is non-negotiable for a truly independent engine.

# Automation layer

Folding `AI-Dev-Shop`, `ADS-memory`, and `project-runner` under an `automation/` folder in the source tree is a category error if treated as part of the engine. They represent the AI-driven software development lifecycle, not the runtime capabilities of the Jini product.

**The Relationship:**
- **`ADS-memory`** is the immutable database. It is the durable ledger of the repository's architecture, ADRs, and structural specifications (`specs_as_built/`).
- **`AI-Dev-Shop`** is the business logic. It contains the multi-agent delivery pipeline, the skills, and the routing logic that dictate *how* autonomous coding agents operate on the repository.
- **`project-runner`** is the execution compute layer. It provides the secure, stateful sandbox, leases, and git-ref CAS required for the Dev Shop agents to actually execute code modifications against the repo safely.

**Duplication and Missing Pieces:**
There is a superficial risk of confusing the engine's `agent-runtime` (which runs agents for the end-user of the Jini product) with the `project-runner` (which runs agents for the developers building the Jini repository). They must remain strictly separate. What is notably missing from this layer is a **Context Hydrator**—a mechanism to continuously synchronize the real-time state of the Jini repository (the AST, the changing dependency graph) back into `ADS-memory`. Without this, the `project-runner` will blindly execute agents that hallucinate obsolete APIs when attempting to refactor the engine.

# What's missing

The proposed structure omits several critical ports and abstractions required to achieve true product neutrality and consumer parity:

- **Telemetry/Analytics Port:** OD relies heavily on analytics. Without a generic telemetry port injected into the daemon, the extraction will either fail or OD-specific tracking will inevitably be hardcoded into the engine, violating neutrality.
- **VFS (Virtual File System) Port:** Hardcoding the `platform/` package to OS process/file primitives assumes a Node.js desktop environment. This breaks Zana or future consumers running in WebContainers or locked-down Tauri sandboxes. File access must be an injectable port.
- **Configuration/Settings Port:** The engine needs a standard interface to receive user preferences, API keys, and feature flags from varying host environments. Tovu, Zana, and OD all manage settings differently.
- **LLM Gateway Port:** A generic abstraction for LLM inference. If Jini hardcodes OD's specific AI backends, it fails its mandate. Zana must be able to swap in its own inference gateways seamlessly.

# Revised top-level tree

```text
jini/
├── .automation/                      # The Factory (AI-Dev-Shop + ADS-memory + project-runner)
│
├── packages/                         # The Engine: @jini/* (strictly product-neutral)
│   ├── protocol/                     # Generic DTOs, SSE + sidecar-proto + chat-core
│   ├── agent-runtime/                # Runtimes, discovery + all plugin/metatool packages
│   ├── daemon/                       # Compose root + ports (telemetry, VFS, config) + persistence
│   ├── sidecar/                      # NDJSON-IPC runtime
│   ├── desktop-host/                 # Host-adapter interface → electron/tauri impls
│   ├── chat-react/                   # Headless hooks + pure presentational UI components
│   └── artifacts-react/              # RendererRegistry + srcDoc sandbox
│
├── apps/
│   ├── jini-daemon/                  # Standard host for Tovu-Runner to reuse out-of-the-box
│   └── reference-web/                # Vite+React minimal test consumer (fake transport)
│
├── docs/                             # Architecture, extraction plans, AGENTS.md
├── scripts/                          # R1-R6 boundary rules (product-neutrality guard)
└── pnpm-workspace.yaml
```

**First 5 Extraction Tasks (Ordered):**

1. **Initialize `.automation/`:** Establish the AI pipeline and implement the `product-neutrality.test.ts` boundary guard to ensure zero OD leakage into Jini from commit one.
2. **Extract `@jini/protocol`:** Lift and purify the DTOs and SSE contracts from OD, validating them strictly against Zana's independent implementation to ensure no OD-specific assumptions leak.
3. **Extract `@jini/daemon`:** Define the strict port interfaces (including the missing Telemetry, VFS, LLM Gateway, Config) and build the `createDaemon` composition root, stubbed in a minimal test host.
4. **Extract `@jini/agent-runtime` & `@jini/sidecar`:** Move the execution environments and plugin capabilities, wiring them exclusively to the new daemon ports rather than concrete implementations.
5. **Extract `@jini/chat-react`:** Refactor ChatPane/ChatComposer into pure headless hooks and dumb presentational components, violently discarding the OD app-shell and CopilotKit legacy.
SD_SEAT2_DONE exit=0
