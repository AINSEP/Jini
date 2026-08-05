# Jini Architecture — First-Round Proposal

## 1. Executive Recommendation

I recommend the **blank-engine-with-OD-as-reference** strategy using a **package-first extraction** model. Copying Open Design's 5.5GB repository to mutate it into Jini (copy-then-refactor) creates an immediate, unmergeable fork that will inevitably drift from active upstream Open Design development. Instead, Jini must start as a clean repository containing only the generic engine packages and a `project-runner` control plane. Open Design is pulled in strictly as a Git sparse-clone under an ignored `references/` directory to run contract tests. This forces rigorous dependency inversion from day one: Open Design remains the primary application and consumes Jini's generic packages via adapters, ensuring Jini is genuinely reusable and not just Open Design with a different name.

## 2. Proposed Repository Topology

This structure isolates the generic engine from the reference implementation, verified to avoid polluting Jini with Open Design's massive `.git` history.

```text
Jini/
├── AI-Dev-Shop/                  # Agent/harness governance layer (verified present)
├── project-runner/               # Orchestration and task ledger control plane
├── packages/
│   ├── jini-core/                # Base types, event protocols, adapter interfaces
│   ├── jini-daemon-core/         # Generic HTTP daemon, sidecar transport, agent lifecycle
│   ├── jini-artifacts/           # Generic artifact parser and registry
│   └── jini-chat-react/          # Reusable chat UI components (headless hooks + slots)
├── integrations/
│   └── open-design/              # OD-specific Jini adapters and compatibility tests
├── references/
│   └── open-design/              # (Git sparse clone of OD, strictly .gitignored)
└── docs/
    └── jini-port/                # Tasks ledger, session handoffs, architecture maps
```

## 3. Package and Module Boundaries

| Package | Responsibility | Public API | Dependencies Allowed | Dependencies Forbidden | First Consumer |
|---|---|---|---|---|---|
| `jini-core` | Shared DTOs, protocols, adapter interfaces | `ChatEvent`, `RuntimeAdapter` | TypeScript standard lib | Node.js, Next.js, React, OD concepts | `jini-daemon-core` |
| `jini-daemon-core` | Agent lifecycle, sidecar IPC, generic HTTP routes | `AgentHost`, `startServer()` | `jini-core`, Express/Fastify | OD `RUNTIME_DATA_DIR`, OD SQLite schemas | OD `apps/daemon` |
| `jini-artifacts` | Markdown/artifact parsing and base renderers | `parseArtifact()`, base types | `jini-core`, React (peer) | OD-specific custom artifact types | OD `apps/web` |
| `jini-chat-react` | Presentational chat components and hooks | `ChatPane`, `Composer` (slots) | `jini-core`, React | Next.js router, OD `App.tsx` state | OD `apps/web` |
| `foundry/integrations/open-design` | Map OD logic to Jini interfaces | `ODChatAdapter`, `ODDataRoot` | `jini-*`, OD libraries | (Connects the two domains) | Open Design |

## 4. Daemon Core and Adapter Design

The Open Design daemon currently conflates generic runtime capabilities (agent spawning, sidecar IPC) with product specifics (project/workspace management, OD-specific skills).
**Extraction:** Jini provides `jini-daemon-core` as an embeddable library exposing `AgentHost`, `TransportRouter`, and a `SkillRegistry`.
**Adapters:** The user's `server.ts` rewrites represent excellent seams. Open Design will instantiate Jini's `AgentHost` and inject an `ODWorkspaceAdapter`. Daemon paths must not hardcode OD's `RUNTIME_DATA_DIR`; instead, the generic core accepts a storage interface, preventing hidden OD assumptions from leaking into Jini. The engine will expose both an embeddable library and a CLI, allowing maximum flexibility for future products.

## 5. Agent and CLI Discovery Design

**Source of truth:** A generic `AgentManifest` registry stored in the host product's configured data root.
**Schema:** `{ id, name, binPath, capabilities: [streaming, custom_tools], authStrategy }`.
**Refresh policy:** Populated by a local scanner that checks well-known OS paths (e.g., `~/.npm`, `~/.cargo/bin`) on daemon startup, and via an explicit API trigger.
**Normalization:** Differences in streaming (e.g., Claude's `stream-json` vs Codex's text-stdin) are normalized via a `RuntimeTransportAdapter` interface in `jini-daemon-core`. The core provides generic mid-turn input plumbing, but the specific transport adapter handles the serialization required by the specific model.

## 6. Frontend Feature-Slice and Reusable UI Design

Currently, Open Design relies on massive components (`App.tsx`, `ChatPane.tsx`, `ChatComposer.tsx`).
**Decomposition:** First, reorganize OD's `apps/web` into feature slices (following the `features/memory` pattern verified in the porting plan).
**Reusable UI:** `jini-chat-react` should provide headless hooks and presentational components (`MessageList`, `ToolCard`) that utilize **slots** (React `children` or render props).
By injecting OD's `AssistantMessage` attachments or custom design-system tools via slots, `jini-chat-react` remains completely agnostic of Next.js and Open Design's styling framework.

## 7. Open Design Integration Strategy

Open Design remains a separate repository and the primary consumer. Upstream changes flow normally in the OD repo. Jini pulls these updates by refreshing its local `references/open-design` sparse clone. When Jini extracts a package (e.g., `jini-artifacts`), an independent Pull Request is opened against the Open Design repository to replace local OD code with the Jini NPM package dependency. Fixes discovered during extraction are pushed directly to OD upstream, preventing two drifting implementations.

## 8. Project Runner and Durable Ledger

The `project-runner` is a repo-local control plane (not a CI system).
**Ledger Contract:** `ADS-memory/reports/jini-port/tasks.json` is the committed source of truth.
**Schema:** `{ id, status, source_ref, target, scope_files, validation_commands, blocker }`.
**States & Transitions:** `pending -> in_progress -> done | blocked | failed`.
**Locking:** A task is leased by an agent writing its ID and timestamp to `tasks.json` and committing the lease to a working branch.
**Ephemeral vs Committed:** `tasks.json`, validation scripts, and `decisions.md` are committed. Agent scratch files and active session logs (`ADS-memory/reports/jini-port/sessions/<id>.md`) remain local/ephemeral until a task transitions out of `in_progress`, at which point the handoff note is committed.

## 9. Cloud Agent Workflow

1. A cloud agent (Codex/Claude) clones Jini, runs `jini-next-task` to find a `pending` task, and creates a working branch.
2. The agent executes `jini-start-session` (claiming the lease) and provisions the OD reference clone.
3. The agent performs the scoped refactor (e.g., moving pure helpers) and runs the attached validation commands (e.g., `pnpm typecheck`).
4. On success, it runs `jini-finish-session --status done`, which links the handoff document and updates the ledger.
5. Concurrent conflicts are avoided because tasks are scoped to non-overlapping feature slices. If a lease expires or validation fails, the branch is abandoned and the task returns to `pending`.

## 10. CBM, Graphify, and Understand Anything Export Strategy

**Committed:** Small, high-signal JSON summaries (e.g., `architecture-map.json`, `dependency-seams.json`) stamped with the exact OD source commit hash and date. These are versioned in Jini so cloud agents have instant context.
**Local/Object Storage:** The massive 1.6GB Open Design `.git` history and heavy local vector AST indexes are NOT committed to Jini.
**Refresh:** A local runner script regenerates the CBM/Graphify exports explicitly before generating new task batches, ensuring cloud agents never read stale graph data.

## 11. Migration Phases With Exit Criteria

**Frontend Extraction Sequence:**
1. Characterize -> 2. Pure helpers -> 3. Artifact extraction -> 4. Chat component slots.
**Daemon Extraction Sequence:**
1. Route isolation -> 2. `AgentHost` adapter -> 3. Daemon core extraction.

**Phased Plan:**
*   **Phase 1: Characterization Tests.** Add strict boundary tests in OD for chat/artifacts.
    *   *Exit:* Tests pass on OD `origin/main`. *Rollback:* Delete tests in OD.
*   **Phase 2: Jini Core Bootstrapping.** Create blank Jini repo, `jini-core`, and `project-runner`.
    *   *Exit:* `project-runner` successfully clones OD sparse reference. *Rollback:* Delete Jini repo.
*   **Phase 3: Artifact Extraction.** Move OD artifact parsing into `jini-artifacts`.
    *   *Exit:* OD consumes Jini package with zero visual changes. *Rollback:* Revert OD import commit.
*   **Phase 4: Daemon Adapter Seam.** Implement `RuntimeAdapter` in OD, pointing to local daemon endpoints.
    *   *Exit:* OD UI runs agents through adapter. *Rollback:* Revert to direct API coupling.
*   **Phase 5: Jini Daemon Core.** Extract generic agent lifecycle to `jini-daemon-core`.
    *   *Exit:* OD `server.ts` boots Jini core. *Rollback:* Revert OD `server.ts`.

## 12. Testing and Compatibility Strategy

The public contract is the TypeScript interfaces in `jini-core`. Compatibility is proven by `foundry/integrations/open-design/compatibility-tests/` in Jini, which injects OD-like mocks into Jini to ensure Jini behaves correctly. In the OD repository, integration tests verify that consuming the Jini package doesn't break the product. Versioning strictly follows semver to manage deprecations.

## 13. Security, Recovery, Observability, and Cost

**Security:** Jini engine uses strict dependency injection for file-system access. It cannot access arbitrary paths; it can only read/write to the `OD_DATA_DIR` passed by the adapter. External CLIs run in isolated sub-processes.
**Recovery:** If an agent crashes or a stream is malformed, the adapter layer catches the exception, emits an error event to the frontend, and safely terminates the subprocess lease.
**Cost:** Use high-tier models (GPT-5.6/Claude Fable) strictly for architecture mapping and complex adapter design. Use cheaper, fast models for mechanical task execution (e.g., moving pure helpers, type-fixing) to cap costs.

## 14. Repository Size, Provenance, and Licensing

A full vendored copy of Open Design is explicitly rejected to avoid 5.5GB repo bloat. Jini remains kilobytes in size. Code moved into Jini retains its original Open Design license headers, augmented with `// Ported from Open Design (commit <hash>)` to guarantee provenance.

## 15. What Not to Generalize Yet

Do not generalize Open Design's project/workspace filesystem semantics, custom design systems, plugin marketplace specifics, data-root legacy fallbacks, or the packaged Electron desktop wrapper. These are highly specific product decisions that provide no value to a generic engine until a second consumer explicitly requires them.

## 16. Estimated Effort and Critical Path

*   **Elapsed Time:** 6–8 weeks.
*   **Engineering Effort:** 1 lead architect + 2 cloud agents.
*   **Critical Path:** Decomposing `ChatPane.tsx` state -> Extracting `jini-chat-react` -> Decomposing `apps/daemon/src/server.ts`.
*   **Uncertainty:** The highest risk is the undocumented state coupling between `useConversationChat.ts` and `ChatPane.tsx`, which may require more manual intervention than estimated.

## 17. Failure Modes and Reasons This Design Could Be Wrong

*   **Failure Mode 1:** `jini-chat-react` becomes an empty wrapper because Open Design requires too many custom injected slots, leading to an over-engineered, leaky abstraction.
*   **Failure Mode 2:** The sparse clone approach frustrates local development because TypeScript language servers fail to cross the repo boundary cleanly during refactoring.
*   **Why this could be wrong:** A Monorepo Federation (putting Jini and OD in the same pnpm workspace temporarily) might allow for atomic refactoring commits across both domains, which is safer during highly volatile early extractions.

## 18. Blind Spots

*   **Missing Architecture Option:** Web Components or Micro-frontends. The brief assumes React packages, but Web Components would make Jini truly framework-agnostic.
*   **Unasked Question:** How does Jini handle user authentication, telemetry, and rate-limiting if the generic daemon HTTP server is extracted?
*   **Framing Assumption:** The assumption that Open Design's current codebase is modular enough to extract via adapters without requiring a fundamental rewrite of the state-management layer.

## 19. Decision Checklist (Requires User Approval)

- [ ] Approve wiping the current dirty Jini repository and converting it to a clean engine structure.
- [ ] Approve the `blank-engine-with-OD-as-reference` strategy over a monolithic fork.
- [ ] Approve the use of a Git sparse clone for the reference integration.
- [ ] Approve the separation of React presentation (`jini-chat-react`) from Next.js routing.
- [ ] Approve the structure of the `tasks.json` ledger.

## 20. Implementation Backlog (First 10 Tasks)

*Sized for resumable cloud-agent sessions.*

1.  **Initialize Jini Base:** Wipe dirty Jini, create top-level folders (`project-runner`, `packages`, `docs`), and initialize `tasks.json`. (Goal: Clean repo state).
2.  **Configure Runner Clone:** Write `project-runner/bin/jini-sync-open-design` to establish the sparse `.gitignore`d clone of OD. (Validation: Script runs and clones successfully).
3.  **OD Chat Characterization:** In OD repo, write boundary Vitest tests for `ChatPane` and `ChatComposer` rendering outputs. (Validation: Tests pass on `origin/main`).
4.  **Extract Chat Pure Helpers:** In OD repo, move pure stateless formatting functions out of `ChatPane.tsx` into `features/chat/model/`. (Validation: `pnpm typecheck` and tests pass).
5.  **Jini Core Bootstrapping:** Create `packages/jini-core` with initial `ChatEvent` and `ChatRuntimeAdapter` TypeScript interfaces. (Validation: `tsc` compiles cleanly).
6.  **OD Artifact Slice:** In OD repo, isolate all artifact parsing logic into `features/artifacts/`. (Validation: OD build succeeds, zero UI changes).
7.  **Jini Artifact Package:** Move the isolated artifact parsers from OD into `packages/jini-artifacts` in the Jini repo. (Validation: Package builds independently).
8.  **OD Consumes Jini Artifacts:** Update OD repo to import `jini-artifacts` instead of local files. (Validation: E2E tests pass).
9.  **Daemon Adapter Seam:** In OD repo, implement the `AgentHost` adapter interface wrapping existing `server.ts` daemon endpoints. (Validation: Agents still spawn correctly).
10. **Chat React Base:** Extract `MessageRow` and `ToolCard` from OD into `packages/jini-chat-react`, converting OD-specific components into injectable slots. (Validation: Storybook or isolated tests render generic components).

## 21. Assumptions and Top 5 Risks

**Assumptions:**
- The user's `server.ts` rewrites are stable enough to build adapters around.
- Open Design's UI state can be decoupled from Next.js routers without rewriting the entire app.

**Top 5 Risks & Mitigations:**
1.  **Risk:** Agent sessions overwrite each other's ledger updates. **Mitigation:** Strict file locking mechanism in `tasks.json` using lease timestamps.
2.  **Risk:** Jini becomes a massive repo. **Mitigation:** Use Git sparse checkout `blob:none` and strictly `.gitignore` the reference clone.
3.  **Risk:** Open Design upstream diverges wildly during extraction. **Mitigation:** Small, atomic package extractions merged directly back into OD `origin/main` continuously.
4.  **Risk:** Cloud agents mutate Jini incorrectly. **Mitigation:** Validation commands (typecheck, tests) must pass locally before the runner allows a `done` transition.
5.  **Risk:** React slot injection causes severe performance regressions. **Mitigation:** Enforce React `memo` and strict referential equality checks on injected components in `jini-chat-react`.

```txt
<<JINI_DEBATE_SUBMISSION_END>>
```
SEAT2_DONE exit=0
