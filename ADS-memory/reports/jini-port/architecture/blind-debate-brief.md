# Jini Architecture Blind Debate Brief

Date prepared: 2026-07-16

Status: Ready to hand to another LLM coordinator. No debate has been run from this document.

## Coordinator mandate

Run a blind, adversarial architecture debate about how to turn the reusable parts of Open Design into Jini: an abstract engine that can support Open Design and other products through adapters.

The coordinator must not insert its own architecture proposal into the first-round packet. It may summarize and judge proposals only after every participant has frozen an independent first response.

## Requested participants

Use these three independent seats:

1. Codex using GPT-5.6 at high reasoning, or the closest exactly identified GPT-5.6 coding/reasoning model available.
2. Agy using its explicitly selected high-reasoning model. Record the exact model name shown by Agy before dispatch; do not call the CLI version the model version.
3. Claude Fable 5 using the exact model ID `claude-fable-5`.

If an exact requested model is unavailable, stop and report that fact. Do not silently substitute a different model family or version.

## Blindness and privacy rules

- Give every participant the exact same first-round brief.
- Do not show a participant another participant's answer before all first-round answers are frozen.
- Do not show the coordinator's answer or preferred architecture to any participant in round one.
- Do not request, store, or share private chain-of-thought. Ask only for concise rationale, assumptions, evidence, tradeoffs, and conclusions.
- Keep raw first-round submissions isolated until all three have finished.
- In later rounds, share only structured conclusions, disagreements, objections, and decision points. Do not share hidden reasoning or private scratch work.
- Identify every participant by exact model family, version, and reasoning level in the final report.
- Never invent a response for a failed, unavailable, or timed-out model.

## User's goal

Create a repository called Jini. “Jini” is Swahili for “engine.” It should become a generic, reusable engine extracted from Open Design, while Open Design remains a real consumer of it through product-specific adapters.

The result should make it possible to reuse daemon capabilities, agent/CLI integrations, chat UI, artifact rendering, orchestration, and selected frontend components in products that are not Open Design.

The system should also support long-running local and cloud coding work by Codex and Claude. Agents must be able to resume from a durable task ledger rather than relying on conversation history.

## Questions the debate must answer

These questions come from the user's earlier requests. Treat them as open questions; do not assume an answer from their wording.

### Jini repository strategy

- Should Jini begin as a minimal/blank engine repository with Open Design under `integrations/` or `references/`, and extract/refactor capabilities into the engine?
- Or should Jini begin as a copy of Open Design and be refactored internally until Open Design-specific behavior is behind adapters?
- Is there a better third strategy, such as a strangler extraction, package-first extraction, subtree, monorepo federation, or another arrangement?
- How should Jini reference upstream Open Design, the user's fork, stashed local changes, past commits, and the user's `server.ts` rewrites without turning Jini into an enormous or confusing repository?
- How should upstream Open Design changes continue to flow into Jini during extraction?
- How should fixes discovered during Jini extraction flow back to Open Design without creating two drifting implementations?
- What should the top-level Jini folder tree be?
- Should Jini be one repository, multiple repositories, or a monorepo with publishable packages?

### Daemon architecture and portability

- What does the Open Design daemon actually do, and which responsibilities are true reusable engine capabilities versus Open Design product behavior?
- Can the daemon currently be copied into another project and run usefully, and what hidden Open Design assumptions would travel with it?
- How hard is it to extract a reusable daemon core and separate all Open Design-specific behavior?
- Are the user's `server.ts` rewrites and route/runtime extractions good seams for speeding up that work?
- Which other daemon rewrites, branches, commits, or pull requests should be incorporated?
- What ports, contracts, dependency-injection boundaries, adapters, and composition roots should replace direct Open Design coupling?
- Should the generic engine expose an HTTP daemon, an embeddable library, a CLI, a sidecar protocol, or all four?
- Which responsibilities belong in daemon core, agent runtime, project/workspace services, artifact services, persistence, transports, and Open Design adapters?
- How should the engine discover and track installed coding CLIs such as OpenCode, Claude Code, Codex, Gemini, Cursor Agent, and future agents?
- Where should CLI discovery results live? Define the source of truth, refresh/invalidation policy, data schema, security boundary, and API used by UI and CLI consumers.
- How should per-agent differences in authentication, model discovery, prompt transport, streaming events, tool events, cancellation, resumability, and mid-turn input be normalized without reducing every runtime to a weak lowest-common-denominator interface?

### Frontend architecture and reusable UI

- What are the main Open Design frontend layers and components today?
- How should the frontend be reorganized into feature slices?
- Which parts are reusable engine/UI packages, and which parts must stay Open Design-specific?
- How should large components such as `ChatPane`, `ChatComposer`, and the top-level application shell be decomposed?
- How can ChatPane, ChatComposer, message rendering, attachments, tool cards, artifacts, question forms, conversation state, run state, and transports be reused without importing Open Design project/workspace assumptions?
- Should reusable UI be headless hooks plus components, a component library, feature packages, a reference application, web components, or another design?
- What adapter or slot interfaces are necessary for product-specific project context, plugins, models, agents, artifacts, comments, feedback, file previews, and design-system behavior?
- How should the reusable frontend remain useful outside Next.js or outside the exact Open Design daemon API?
- What is a realistic sequence and effort estimate for making the frontend Open Design-agnostic and reusable?

### Automation and cloud execution

- Can the extraction and continuing synchronization be automated outside conventional CI/CD?
- Which existing agent program should execute the work: Codex cloud, Claude Code, Agy, OpenHands, another coding-agent runner, or a combination?
- What must a repo-local `project-runner/` do beyond ordinary scripts?
- How should work be planned locally and executed in the cloud by Codex and Claude?
- How should a cloud agent claim a task, create a branch/worktree, record a session, run validation, report blockers, and safely resume after context loss?
- How should concurrent agents avoid duplicate work and conflicting writes?
- Which decisions require a human checkpoint, and which bug fixes/refactors can proceed autonomously?
- How should the workflow keep an inventory of Open Design bugs discovered during extraction and fix them autonomously in the correct repository?
- What prevents an autonomous agent from optimizing Jini while breaking Open Design compatibility?

### Durable task and session ledger

- What files and schemas should make task state durable across local sessions, Codex cloud sessions, Claude sessions, and agent failures?
- What are the task states and legal transitions?
- How are dependencies, blockers, leases, attempts, source commit, target commit, validation commands, validation results, decisions, and handoff notes recorded?
- How are concurrent updates locked or reconciled?
- What is committed to Git, and what remains local or ephemeral?
- How does a new agent deterministically find the next safe task?
- How are tasks linked back to architecture decisions and compatibility tests?

### Codebase understanding reports for cloud agents

- How should Codebase Memory MCP, Graphify, and Understand Anything be run against Open Design and Jini?
- Which reports or graph exports should be committed or uploaded so cloud agents know what to read without rebuilding expensive local indexes?
- Which heavy indexes must remain local or in object storage because of repository size?
- What small summaries, knowledge graphs, architecture maps, dependency seams, key-symbol indexes, hotspots, and source maps should be versioned in Jini?
- How should reports record the exact source repository, branch, and commit they describe?
- How are reports refreshed automatically without presenting stale graph data as current truth?
- Should cloud agents read one overview document, a folder tree of scoped reports, or both?

### AI-Dev-Shop and governance

- `AI-Dev-Shop/` must be present in Jini. Should it be vendored, a submodule, a package, or synchronized another way?
- A top-level `project-runner/` must be present.
- How should AI-Dev-Shop governance, agent roles, task ledgers, and cloud execution relate without duplicating responsibilities?
- What is the smallest useful control plane that remains understandable and maintainable?

### Reference repository size and provenance

- Would `references/open-design/` make Jini too large on GitHub?
- Compare a normal vendored copy, Git submodule, sparse/partial clone created on demand, Git subtree, generated source snapshot, and no local reference checkout.
- How should GitHub file-size limits, clone time, LFS, history size, and cloud-agent checkout costs affect the choice?
- How should code provenance, license notices, commit attribution, and upstream source mappings be preserved when code moves from Open Design into Jini?

### Compatibility, releases, and operations

- What is the public compatibility contract between Jini core and product adapters?
- How are contracts versioned, migrated, deprecated, and tested?
- How does the engine handle security boundaries around local files, subprocesses, credentials, MCP servers, plugins, and external CLIs?
- How does it fail and recover when an agent crashes, a stream is malformed, a task lease expires, an upstream API changes, or a migration only partially completes?
- What observability is required for runs, costs, retries, failures, and compatibility drift?
- How can an extraction be rolled back at each phase?
- What release strategy lets Open Design adopt Jini incrementally instead of requiring a flag-day rewrite?
- What evidence proves that Jini is genuinely reusable rather than merely Open Design with renamed symbols?

### Cost and model use

- What is the cheapest model tier that can still do a good job running Codebase Memory MCP, Graphify, Understand Anything, mapping the codebase, and explaining it to the user?
- Which tasks need a strong reasoning model, and which indexing, summarization, ledger, validation, and mechanical refactoring tasks can use cheaper models?
- How should the workflow cap cost while preserving accuracy and avoiding stale or shallow architecture reports?

## Known repository facts

These are context facts, not architectural conclusions. The coordinator should verify facts that may have changed before running the debate.

### Local repositories

- Open Design checkout: `/Users/la/Desktop/Programming/OSS-Repos/open-design`
- Jini checkout: `/Users/la/Desktop/Programming/Jini`
- Jini already contains `AI-Dev-Shop/`.
- At the time this brief was prepared, Jini was a dirty working tree with substantial frontend changes. Do not reset, clean, or overwrite it as part of the debate.
- At the time this brief was prepared, no GitHub repository named `leonaburime-ucla/Jini` had been confirmed through the GitHub CLI.
- Jini's configured Git remotes still pointed to Open Design repositories at the time of inspection. Verify before making any remote changes.

### Open Design source state at the time of inspection

- Local branch: `refactor/web-memory-slice`
- Upstream remote: `https://github.com/nexu-io/open-design.git`
- User fork remote: `https://github.com/leonaburime-ucla/open-design.git`
- The local branch was 36 commits ahead of and 52 commits behind upstream `origin/main` by symmetric commit count.
- The local branch was one commit behind its fork tracking branch.
- The branch contains a substantial frontend memory vertical-slice refactor.
- Upstream contains newer daemon, frontend, desktop, packaged-runtime, security, and tooling work not present on the local branch.
- Open Design's local working tree was approximately 5.5 GB, including an approximately 1.6 GB `.git` directory. These numbers include local state and are not the size of a clean sparse clone.

### Existing extraction work to inspect

The debate should not assume these changes are correct, but it should inspect them as evidence:

- User-authored Open Design daemon and `server.ts` rewrites on GitHub and in local branches.
- Daemon extraction pull requests previously identified around `startChatRun`, route/runtime extraction, and server decomposition.
- `apps/daemon/src/server.ts` and extracted modules under daemon runtime, routes, HTTP, events, bootstrap, marketplace, shell, telemetry, and request-composition areas.
- The frontend memory slice and its boundary checks as a possible example—not a mandated template—of feature-slice decomposition.
- Existing reusable packages such as contracts, components, platform, sidecar, and sidecar protocol.

### Open Design constraints that may matter to extraction

- `apps/daemon` is the privileged local daemon and owns HTTP APIs, agent spawning, skills, design systems, artifacts, and static serving.
- `apps/web` is the React/Next web application.
- Shared web/daemon DTOs and event contracts belong in a pure TypeScript contracts package.
- Generic OS-process primitives, generic sidecar runtime, and Open Design-specific sidecar protocol are already separated to some degree.
- Open Design expects user-facing capabilities to be available through both web UI and the `od` CLI using the same daemon HTTP API.
- Daemon-owned data is intended to derive from one resolved runtime data root, with narrow documented exceptions.
- Agent runtimes differ in input and streaming behavior; Claude currently has special stream-JSON handling for possible mid-turn input.
- The frontend has very large orchestration and chat components, including `App`, `ChatPane`, and `ChatComposer`.

## Source material every participant should receive

Provide identical snapshots or reports to all three participants. Do not give only one participant live repository access and expect the others to reason from a summary.

Minimum shared material:

- This debate brief.
- `docs/jini-open-design-porting-plan.md`, clearly labeled as prior analysis that contains suggestions, not settled decisions.
- Root `AGENTS.md` from current Open Design.
- Root `AGENTS.md` from current Jini.
- Current Git status and remote summary for both repositories.
- A commit/branch divergence summary for Open Design upstream, user fork, and relevant rewrite branches.
- A bounded file/symbol map of the daemon and frontend from Codebase Memory MCP.
- Available Graphify and Understand Anything summaries, each stamped with source commit and generation date.
- A list of the user's relevant GitHub pull requests, branches, and commits, with concise diff summaries.

If Codebase Memory MCP, Graphify, or Understand Anything output is missing, state that explicitly. Do not fabricate a report or treat an incomplete index as current.

## Candidate strategies to compare

These are options, not endorsements. Participants must be free to reject all of them.

1. Greenfield Jini core with Open Design as a reference/integration source.
2. Open Design copy that is progressively inverted into generic core plus adapters.
3. Strangler/package-first extraction: keep Open Design primary while extracting one contract-tested capability at a time into Jini.
4. A monorepo or workspace arrangement that temporarily contains both product and engine during extraction.
5. Any stronger option the participant believes the framing missed.

Every participant must explain which option it chooses, why the others fail, and what new evidence would change its recommendation.

## Required first-round output from each participant

Return a final structured proposal only. Do not return hidden chain-of-thought.

Use these sections:

1. `Executive Recommendation`
2. `Proposed Repository Topology`
3. `Package and Module Boundaries`
4. `Daemon Core and Adapter Design`
5. `Agent and CLI Discovery Design`
6. `Frontend Feature-Slice and Reusable UI Design`
7. `Open Design Integration Strategy`
8. `Project Runner and Durable Ledger`
9. `Cloud Agent Workflow`
10. `CBM, Graphify, and Understand Anything Export Strategy`
11. `Migration Phases With Exit Criteria`
12. `Testing and Compatibility Strategy`
13. `Security, Recovery, Observability, and Cost`
14. `Repository Size, Provenance, and Licensing`
15. `What Not to Generalize Yet`
16. `Estimated Effort and Critical Path`
17. `Failure Modes and Reasons This Design Could Be Wrong`
18. `Blind Spots`
19. `Decision Checklist`

The `Proposed Repository Topology` section must include a concrete folder tree.

The `Package and Module Boundaries` section must include a table with responsibility, public API, dependencies allowed, dependencies forbidden, and first consumer.

The `Migration Phases` section must describe incremental phases that keep Open Design working and define a rollback point plus measurable exit criteria for every phase.

The `Estimated Effort` section must distinguish elapsed time, engineering effort, model/tool cost, and uncertainty. It must not provide false precision.

The `Blind Spots` section must name:

- A viable architecture option missing from the brief.
- A question the group should be asking but is not.
- The framing assumption most likely to be wrong.

End every complete submission with:

```txt
<<JINI_DEBATE_SUBMISSION_END>>
```

## Round-two debate procedure

After every first-round proposal is frozen:

1. The coordinator extracts a neutral decision ledger. It should contain conclusions and short rationale summaries, not chain-of-thought.
2. The coordinator identifies only material disagreements, incompatible assumptions, unaddressed requirements, and unique risks.
3. Give each participant the same ledger and disagreement packet.
4. Do not reveal model identities next to positions if anonymity can be preserved; label them Proposal A, B, and C during rebuttal.
5. Ask each participant to state:
   - Its current position on each disagreement.
   - The strongest objection to its own position.
   - The strongest objection to the leading alternative.
   - Whether it changed its conclusion and why.
   - What repo evidence or assumption change would change its mind.
6. Run no more than two rebuttal rounds unless the user explicitly asks for more.
7. A participant that fails or times out is marked withdrawn. Do not invent its rebuttal.

## Final synthesis requirements

The coordinator's final report must include:

- Exact participating models and reasoning modes.
- Transport/failure diagnostics separated from model answers.
- Each independent proposal in concise form.
- Areas of genuine agreement.
- Areas of unresolved disagreement and the assumptions causing them.
- Unique insights raised by only one participant.
- A decision ledger comparing all proposals on the same criteria.
- A recommended Jini repository tree.
- A package/interface boundary map.
- A phased Open Design-to-Jini migration plan with rollback points.
- A frontend extraction sequence.
- A daemon extraction sequence.
- A project-runner and task-ledger contract.
- A cloud-context export layout for Codebase Memory MCP, Graphify, and Understand Anything.
- A list of decisions requiring the user's approval before implementation.
- The first 10 concrete implementation tasks, ordered by dependency and sized for resumable cloud-agent sessions.

Do not claim consensus merely because two proposals use similar terminology. Agreement should mean they recommend compatible decisions under compatible assumptions.

## Evaluation rubric

Score each proposal from 1 to 5 on each dimension and explain every score briefly:

| Dimension | What a high score means |
|---|---|
| Reusability | A second non-Open-Design product can adopt the engine without importing product assumptions. |
| Incremental migration | Open Design remains usable throughout extraction, with clear rollback points. |
| Boundary clarity | Core, ports, adapters, products, UI, runtime, and orchestration have enforceable ownership. |
| Compatibility discipline | Contracts and tests detect drift between Jini and Open Design. |
| Frontend composability | Chat and artifact UI can be reused without copying giant Open Design components. |
| Runtime extensibility | New agents/CLIs can be added without editing a monolithic daemon switchboard. |
| Operational safety | Security, credentials, subprocesses, failure recovery, and observability are designed explicitly. |
| Cloud resumability | Independent cloud sessions can safely pick up durable, well-scoped tasks. |
| Maintainability | The design avoids excessive package fragmentation, indirection, and duplicated control planes. |
| Cost efficiency | Expensive models and graph generation are reserved for work that benefits from them. |
| Provenance and sync | Upstream history, licensing, source mappings, and bug flow remain understandable. |
| Time to first value | The plan delivers a reusable, tested capability early instead of waiting for a complete rewrite. |

## Actions forbidden during the debate

- Do not edit application source code.
- Do not create, delete, or change Git remotes.
- Do not create a GitHub repository.
- Do not reset, clean, stash, commit, merge, rebase, or push either working tree.
- Do not treat a local graph index as shareable cloud context unless it is explicitly exported.
- Do not assume prior proposed package names or folder trees are settled.
- Do not allow one model to see another model's private first-round draft.

The debate produces an architecture recommendation and implementation backlog only. Execution requires a separate user approval.
