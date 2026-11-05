---
name: context-engineering
version: 1.0.0
last_updated: 2026-02-22
description: Use when managing agent context windows, designing context injection strategies, implementing token budget policies, compressing context, or diagnosing context degradation.
---

# Skill: Context Engineering

The goal is always the smallest set of high-signal tokens that maximizes the likelihood of desired outcomes. Every agent gets exactly what it needs for its task — nothing more.

Load `references/session-setup-patterns.md` for: CLAUDE.md/rules file template, Brain Dump and Selective Include context injection patterns, cross-tool rules file equivalents (.cursorrules, AGENTS.md, etc.), MCP integration table, and the Silent Confusion anti-pattern.

*Source: Addy Osmani / agent-skills / context-engineering*

## Agent Skills Files as the Primary Context Mechanism

Each agent's `skills.md` file is loaded once at dispatch and defines its operating parameters. It does not grow during a session.

A well-designed `skills.md`:
- States the agent's role clearly enough that the agent can decide in-scope vs out-of-scope without asking
- Defines exactly what inputs the agent requires — agents should refuse to operate on incomplete inputs
- Defines the expected output format — reduces downstream parsing failures
- Lists common failure modes — prevents the agent from making predictable mistakes
- Lists escalation triggers — prevents agents from spinning in loops on unresolvable problems

Treat `skills.md` files as versioned artifacts. When an agent repeatedly makes the same mistake, a **human** should update the relevant `skills.md` to address it — agents never edit framework files directly. That human-applied update propagates permanently to all future dispatches of that agent, unlike a one-time prompt correction.

## Progressive Disclosure

Do not load everything at once. Load information only when it is relevant to the current task.

**Level 1 — Agent identity**: The skills.md file. Always loaded. Defines role, workflow, output format.
**Level 2 — Task context**: The active spec, relevant architecture constraints, current test certification. Loaded when the task begins.
**Level 3 — Deep reference**: Architecture pattern details, project memory entries, security checklists. Loaded only when a specific need arises.

The Coordinator controls what context each agent receives. A Programmer Agent working on invoice creation does not need the authentication architecture document unless the invoice creation spec involves auth. Load it when needed, not by default.

## Project Knowledge Files

These three files capture shared context that no individual `skills.md` covers:

**`<ADS_MEMORY_ROOT>/knowledge/project_memory.md`**
Stable, project-specific facts: conventions, gotchas, tribal knowledge.
- "We use UTC everywhere for all timestamps"
- "The legacy billing API returns HTTP 200 even on errors — check the response body for error codes"
- "camelCase in API responses, snake_case in database columns"

Update when: A convention is established or changed. A gotcha is discovered.
Do not include: Architecture decisions (those belong in ADRs). Lessons learned (those belong in learnings.md).

**`<ADS_MEMORY_ROOT>/knowledge/learnings.md`**
Retrospective lessons: what went wrong, why, and what to do instead.
- "2026-02-15: TDD Agent wrote tests against a draft spec that hadn't been approved yet. Tests had to be rewritten when spec changed. Fix: TDD Agent must verify spec is human-approved before certifying tests."
- "2026-02-18: Programmer Agent bypassed the repository interface and queried the DB directly. Code Inspection caught it. Reminder: all DB access must go through the repository layer."

Update when: A failure pattern reveals something worth remembering.
Governance: Entries are permanent. Do not delete old lessons.

**`<ADS_MEMORY_ROOT>/knowledge/project_notes.md`**
Open questions, parking lot items, in-progress thinking.
- "Open: Should EC-02 (idempotency) be handled at the API layer or the service layer? Waiting on architect decision."
- "Parked: Rate limiting on invoice creation — deferred to v1.1."

Update when: Questions are opened or resolved. Scope items are deferred.
Governance: Resolved items should be closed (not deleted — mark as [RESOLVED]).

## Memory Placement Authority

When making any context engineering decision about where to write a memory entry, `<AI_DEV_SHOP_ROOT>/framework/governance/knowledge-routing.md` is the authoritative source. It defines which file each category of memory belongs in and supersedes any informal judgment call.

Rules:
- Before writing any memory entry, consult `knowledge-routing.md` to confirm the correct destination file
- Never write project-specific memory (conventions, gotchas, decisions, lessons) into framework files: `AGENTS.md`, any `skills.md`, or any `framework/templates/` file. Framework files define agent behavior — they are not storage for project-specific state
- If a memory entry does not clearly fit a category in `knowledge-routing.md`, add an Open Question to `project_notes.md` and escalate to the Coordinator to update the routing rules before writing the entry

This rule exists to prevent knowledge files from becoming junk drawers and framework files from becoming contaminated with project-specific state that does not transfer to other projects.

## Scope Boundaries for Knowledge Files

Getting this wrong turns knowledge files into junk drawers, which degrades every agent that reads them.

| Content Type | Correct Location |
|---|---|
| Requirements, acceptance criteria | Spec files |
| Architecture pattern choices | ADRs in `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/` |
| Reusable domain knowledge | `<AI_DEV_SHOP_ROOT>/skills/` files |
| Project-specific conventions | `project_memory.md` |
| Lessons from past failures | `learnings.md` |
| Open questions, deferred items | `project_notes.md` |
| Agent operating procedures | `<AI_DEV_SHOP_ROOT>/agents/*/skills.md` |

## Context Injection by Coordinator

The Coordinator is responsible for injecting the right context into each agent dispatch. This means:

1. Always include the active spec version and hash
2. Include only the architecture constraints relevant to the current module
3. Include only the test certification records relevant to the failing tests being fixed
4. Include recent project_memory entries that apply to the domain being worked on; apply the standing-rule exception in `<AI_DEV_SHOP_ROOT>/skills/coordination/SKILL.md` (Dispatch Prompt Construction).
5. Do not pass the full conversation history — pass structured summaries

A Programmer Agent dispatch should include:
- Active spec (with version/hash)
- Failing test names and their spec references
- Architecture constraints for the affected module
- Relevant project_memory entries
- The handoff output from the TDD Agent

It should not include: the full TDD Agent session history, the Spec Agent's drafting notes, or Code Inspection findings from a previous unrelated feature.

## Avoiding Context Rot

At the start of every new pipeline cycle:
1. Confirm that all agent inputs reference the current spec version and hash
2. Discard stale findings from previous cycles that have been addressed
3. Refresh any project knowledge that may have been updated

The Coordinator must verify spec hash alignment before dispatching any agent. An agent operating against a stale spec hash is operating on context rot. The output will be wrong, confidently.

## Token Economics

Context has a compounding cost in multi-agent systems. The more agents, the more expensive context management becomes.

| Configuration | Token multiplier (relative to baseline) |
|---|---|
| Single agent, no tools | ~1× |
| Single agent with tools | ~4× |
| Multi-agent system | ~15× |

80% of agent performance variance comes from token budget and context quality. 10% comes from tool design. 5% comes from model choice. Optimizing context quality has higher ROI than upgrading the model.

The practical implication: before adding another agent to the pipeline, calculate whether the context overhead of coordination is worth the specialization gain.

## Attention Degradation Thresholds

Models exhibit predictable degradation patterns as context grows:

**Lost-in-the-middle effect**: Information positioned in the middle of a long context receives significantly less attention than information at the beginning or end. Critical instructions, constraints, and spec references belong at the beginning of the context, not buried in the middle.

**U-shaped attention curve**: Attention peaks at the start and end of context, with a trough in the middle. For multi-agent pipelines, place the most important context (active spec, architecture constraints, specific task) at the very beginning.

**Model-specific degradation thresholds** (approximate):
- Claude: Noticeable degradation around 100K tokens; severe by ~180K
- GPT-4-class: Degradation around 64K tokens; severe by ~200K
- Gemini: More resilient, degradation later (~500K); severe ~800K

Keep individual agent context windows well below these thresholds. If context is approaching the limit, compress before dispatching.

## Context Compression Strategies

When an agent's context grows too large, compress before the degradation threshold is reached — not after.

**Anchored Iterative Summarization** (highest quality):
Summarize in chunks, maintaining an anchor section that persists key decisions and constraints. Each new chunk is summarized relative to the anchor. Best quality (~3.7/5), ~98.6% compression ratio. Use for contexts that contain important reasoning chains.

**Regenerative Summary**:
Discard the full history and regenerate a fresh summary from scratch, asking the agent to reconstruct what it knows. Slightly lower quality (~3.44/5), ~98.7% compression. Use when the history is long but the final state is all that matters.

**Opaque Compression**:
Summarize everything into a compact block with no internal structure — maximum compression (~99.3%, ~3.35/5). Use when context must be minimized at the cost of nuance.

Compression trigger: when context exceeds 60% of the model's effective attention window (not the token limit — the attention degradation threshold is lower than the limit).

## Observation Masking

Verbose tool outputs consume attention without adding information. Replace them with structured references.

**Wrong — passes full output**:
```
TestRunner output: [2,400 lines of test logs]
```

**Right — observation masking**:
```
TestRunner result: 44/47 passing.
Failures: AC-03 (invoice zero-quantity), INV-01 (status transition), EC-02 (idempotency).
Full log: available at testrunner-output-cycle-7.log if needed.
```

The agent gets the signal (what failed) without the noise (2,400 lines of passing tests). The full log is accessible if genuinely needed, but it is not injected by default.

Apply observation masking to: test runner output, linter output, build logs, verbose API responses, long file contents where only specific sections are relevant.

## The Telephone Game Problem

In a multi-agent pipeline, context degrades at each handoff. Agent A's output becomes input to Agent B, which becomes input to Agent C. By Agent C, nuance from Agent A has been lost or distorted — like the telephone game.

**Wrong — forwarding full session history**:
```
Coordinator to Programmer: "Here is everything the TDD Agent said: [full 8,000-token session]"
```

**Right — canonical reconstruction**:
```
Coordinator to Programmer:
  Active spec: SPEC-001 v1.2 (hash: abc123) [full spec content]
  Certified tests: [list of 47 test names and their AC references]
  Architecture constraints: ADR-003 (Clean Architecture + CQRS)
  TDD handoff summary: 47 tests certified. Coverage gaps: EC-04 (no test written — see open question in spec).
```

The Coordinator always reconstructs context from canonical sources (spec, ADR, project_memory) rather than forwarding agent sessions verbatim. This prevents context degradation from compounding across hops.

## Consensus and Divergence

When multiple agents produce conflicting outputs (e.g., Software Architect and Code Inspection disagree on a boundary), the Coordinator must resolve the conflict rather than forwarding both to the next agent.

Resolution strategies:
1. **Authority precedence**: ADRs take precedence over code review opinions on architecture decisions
2. **Spec as tiebreaker**: If both agents are interpreting the spec differently, route back to Spec Agent for clarification — the conflict is a spec ambiguity, not an agent disagreement
3. **Weighted consensus**: For evaluation tasks, aggregate multiple scores and use the average rather than forwarding all raw scores
4. **Escalate genuine disagreements**: If two authoritative sources directly contradict each other on a factual question, escalate to human — do not pick one arbitrarily
