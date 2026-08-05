# Jini — Whole-System Architecture Improvement (Holistic Pass)

The kernel architecture (Option A, typed DI tokens, async ports, OD-sync patch canary) provides a rigorous, product-agnostic foundation. However, moving outward from the locked kernel, the surrounding system assumes that organizational boundaries will naturally align with runtime boundaries. They do not. 

Below is the holistic review identifying where these subsystems collide, followed by concrete architectural corrections to ensure Jini survives not just as a clean kernel, but as a consumable engine.

---

## 1. End-to-end seams that don't fit (MOST IMPORTANT)

The most severe architectural fractures exist at the boundaries where the Jini engine interfaces with the development loop, the frontend, and the automation layer.

### Two agent systems: Semantic Collision & Domain Bleed
There is a massive nomenclature and domain overlap between the engine runtime and the automation layer. 
- **Verified state**: In `@jini/agent-runtime` (derived from `open-design-agentic/packages/contracts/src/api/chat.ts`), a `Run` is a runtime LLM execution, an `Agent` is a process wrapper (e.g., Claude Code), and a `Task` is an internal async background job (defined in `contracts/src/tasks.ts` as `TaskStatus` with states like `queued`, `starting`, `running`).
- **Verified state**: In `AI-Dev-Shop` / `project-runner`, an `Agent` is a pipeline persona (Software Architect, Programmer), a `Tool` is a bash skill, and a `Task` is a ledger milestone. 
- **The Seam**: If `project-runner` is the canonical job state machine consumed by Jini and all downstream products for their dev-automation, developers spanning the boundary will face constant context-collapse. When a developer says "the Task failed" or "the Agent is stuck," the system cannot differentiate between a runtime production failure in Jini and a dev-time pipeline failure in `project-runner`. The engine and the automation layer are using identical nouns for entirely parallel execution planes.

### Frontend ↔ Kernel: The Transport Impedance Mismatch
The kernel's event architecture expects a durable consumer; the frontend architecture expects ephemeral state.
- **Verified state**: The locked plan defines the kernel's `EventLog` as "replayable: ordering, replay cursor, idempotency key, cancellation." 
- **The Seam**: Existing frontend patterns (and `@jini/chat-react`) typically consume fire-and-forget SSE streams (via `POST /api/runs`). If the browser connection drops and reconnects, raw SSE does not natively resume from a cursor without a dedicated synchronization loop. If `@jini/chat-react` relies on fetching full historical snapshots on mount and piping stateless SSE for updates, the robust durability of the kernel's `EventLog` is completely wasted. The React UI will suffer from duplicate events or missed deltas during network blips, masking a hardened backend behind a fragile frontend.

### Consumer packaging ↔ Frontend/Desktop dev loop
The CI requirement to prove neutrality via `npm pack` tarballs solves the repository boundary problem but severely degrades the developer experience.
- **The Seam**: Moving to packed tarballs means consumer repos (OD, Open-Marketing) must import transpiled ESM/CJS for React packages like `@jini/chat-react` and `@jini/renderers-react`. If an OD developer spots a UI bug, they cannot hot-reload a fix. They must switch to the Jini repo, rebuild the packages, pack them, install the tarballs in OD, and restart the Vite/Next bundler. This iteration loop is prohibitively slow for frontend development, where instant visual feedback (HMR) is mandatory.

### `project-runner` Task Ledger ↔ The Extraction Tasks
- **The Seam**: The 10 extraction tasks outlined in the Jini plan (e.g., "strangler-fig OD adapter", "verify patch canary") are highly contextual, repo-spanning human-architectural milestones. `project-runner` task ledgers assume programmatic, isolated, verifiable steps with clear "Done" states. Attempting to force the Jini extraction through the rigid `project-runner` pipeline will cause the extraction to stall, as dev agents cannot easily arbitrate the subjective strangler-fig migration paths required by the patch canary.

---

## 2. Frontend reuse model

The decision to migrate to Vite and extract the UI into headless hooks (`useChat`, `useRun`) + slots is conceptually sound for logic reuse, but it exposes a critical flaw in the locked OD-sync strategy.

**The OD-Sync UI Paradox:**
The locked OD-sync mechanism relies on a CI patch canary (`git format-patch` targeting path-mirrored files). This works flawlessly for the Node daemon because the backend logic is lifted verbatim. 
However, the UI is undergoing a paradigm shift: from a tightly-coupled Next.js monolith to framework-agnostic, Vite-compatible headless hooks. You cannot apply a `git format-patch` generated from an upstream OD Next.js `ChatPane.tsx` component onto a refactored Jini `useChat` hook. The patch canary will instantly and permanently fail on the frontend the moment the architecture diverges.

**Concrete Improvements:**
1. **The Strangler-Fig UI**: To honor the locked OD-sync constraint, the frontend extraction *must not* be a clean-break rewrite on day one. You must path-mirror the messy OD React components verbatim into `@jini/chat-react` first, establish the patch canary, and *then* incrementally build the headless hooks alongside them. Only once the headless hooks reach parity can you migrate OD to use them and drop the mirrored legacy files.
2. **Compound Components over Slots**: "Slots" (passing React nodes as props) scale poorly and often lead to prop-drilling nightmares. `@jini/chat-react` should export Compound Components (e.g., `<Chat>`, `<Chat.Composer>`, `<Chat.MessageList>`) paired with React Contexts. This provides the styling flexibility Open-Marketing needs without forcing them to manually wire 15 slot props.

---

## 3. Automation layer

The decision to isolate automation into a separate repo is correct, but the internal architecture of that automation is over-fragmented.

**The Flaw in the Three-Way Split:**
The plan separates `AI-Dev-Shop` (pipeline/HOW), `ADS-memory` (durable decisions), and `project-runner` (execution). 
- **Verified state**: `AI-Dev-Shop` docs treat `ADS-memory` as a sibling directory that tracks state.
- **The Seam**: Treating memory as a foundational peer to the runner and the pipeline creates state synchronization hazards. Memory and ledgers are simply the stateful outputs of execution. 

**Concrete Improvements:**
Collapse `ADS-memory` entirely. `project-runner` must be the sole engine, maintaining its execution state natively within the host repository's `.local-artifacts` or `docs/` equivalents. `AI-Dev-Shop` should exist merely as the static YAML/Markdown definitions of the pipeline roles. Automation should be strictly relegated to validating Jini (running the `minimal-host` boot, checking the token linting) rather than attempting to execute the architectural strangler-fig extraction autonomously.

---

## 4. Desktop/sidecar + Tauri

Deferring `desktop-host` is the right pragmatic call, but the sidecar boundary requires preemptive hardening to prevent vendor lock-in.

**The Seam:**
`@jini/sidecar` currently relies on NDJSON IPC, which inherently assumes Node.js standard streams or Electron IPC bridges. If Tauri is introduced later (which relies on Rust asynchronous channels and a radically different security boundary), a sidecar protocol hardcoded to Node stream semantics will require an ugly, brittle translation layer.

**Concrete Improvements:**
The `RenderService` port is the correct abstraction, but it must be entirely decoupled from the transport mechanism. `@jini/protocol` must define the sidecar interface strictly as an abstract message-passing contract (`send(payload)`, `onReceive(callback)`), intentionally blind to whether the underlying transport is an Electron IPC bus, a Rust channel, or a local WebSocket. The Tauri experiment must remain out-of-tree until `node-host` and the initial Electron implementation prove this transport-blindness.

---

## 5. Cross-cutting

### Release and Versioning
Publishing ~14 packages as independent entities creates a devastating dependency resolution risk. If OD resolves `@jini/core@1.1.0` but `@jini/chat-react` internally resolves `@jini/core@1.0.0`, the typed DI tokens (`Symbol` or nominal identities) will mismatch at runtime, causing silent dependency injection failures ("missing binding"). 
**Fix:** Implement **Lockstep Versioning** (similar to React or Babel). All `@jini/*` packages must publish simultaneously under the exact same semantic version, enforcing a single unified engine version across the consumer's dependency tree.

### Observability
The kernel cannot rely on `console.log` or hardcoded telemetry sinks. Consumers like OD and Tovu-Runner will have entirely different observability stacks (PostHog, Datadog, custom metrics).
**Fix:** The kernel must export a `Logger` DI token and a standardized telemetry event union in `@jini/protocol`. Feature packs emit to this token, and the host preset binds it to their specific observability sink, keeping Jini perfectly agnostic.

### Security and Sandboxing
- **Verified state**: `@jini/platform` verbatim-lifts OS process/file primitives. 
- **The Seam**: Handing raw Node `child_process` execution to the `ToolExecutor` is acceptable for a local desktop daemon, but catastrophic for a cloud consumer like Tovu-Runner. 
**Fix:** The kernel must define a `SandboxExecution` DI token. Local hosts bind it to `@jini/platform` directly; cloud consumers bind it to an isolated container runtime. The kernel must never assume it has native host OS privileges.

---

## 6. The improved whole-system picture

To synthesize the above, here are the specific non-kernel modifications to the locked plan:

1. **Enforce Dev-Loop Symlinks**: Update the consumer requirement. The "packed tarball" constraint is strictly for CI validation (`minimal-host`). For local development, Jini must officially support and document a `pnpm overrides` or workspace-linking strategy. If you kill HMR for the UI, you kill developer adoption.
2. **Rename Internal Run/Task Nouns**: Rename the Jini kernel's internal `Task` infrastructure (e.g., `contracts/src/tasks.ts`) to `Jobs` or `Operations`. Reserve `Task`, `Agent`, and `Run` strictly for the AI entities to eliminate the semantic collision with `project-runner`.
3. **Abstract the UI Patch Canary**: Acknowledge that the UI cannot be rewritten into headless hooks while simultaneously passing a path-based patch canary. The UI must be ported verbatim first to establish the canary, and refactored incrementally behind that facade.
4. **Mandate Lockstep Versioning**: Integrate a lockstep release script for the `@jini/*` monorepo namespace to guarantee nominal type safety across DI tokens.

### The Single Biggest System-Level Risk (That Isn't the Kernel)

**The UI Dev Loop & Sync Impedance.** 

We have successfully locked the kernel by relying on verbatim lifting and a strict patch-canary to maintain Open Design compatibility. However, we are simultaneously attempting to extract the UI by completely refactoring it (from Next.js monolithic components to Vite-compatible headless hooks). 

This is an architectural paradox. You cannot maintain a git-patch umbilical cord to a fast-moving, upstream Next.js repository while rewriting the destination code into a framework-agnostic headless architecture. If the patch canary blocks CI because it cannot reconcile a Next.js UI bug fix with a new Vite headless hook, and developers cannot instantly hot-reload their UI fixes because of the tarball distribution boundary, the entire Jini extraction will grind to a halt on the frontend. The UI extraction must either be treated as a one-way clean break, or the strangler-fig pattern must be strictly enforced on the frontend components before any refactoring begins.
HOL_SEAT2_DONE exit=0
