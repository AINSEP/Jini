---
name: system-design
version: 1.1.0
last_updated: 2026-05-29
description: Use when designing macro system topology, estimating scale, evaluating distributed-systems tradeoffs, or drafting a technical architecture spec. Keeps system-blueprint and ADR work grounded in explicit requirements, capacity, reliability, and operational decisions.
---

# Skill: System Design

Use this as a shared reference skill for macro system design. It combines distributed-systems design guidance with architecture-spec structure.

This skill is not a pipeline owner. It supports `system-blueprint`, `architecture-decisions`, and architecture-document writing. It should sharpen decisions, not replace those stages.

## Use This When

- the system shape is still open
- the team needs explicit scale or capacity reasoning
- you need to compare storage, cache, queue, and consistency tradeoffs
- you are drafting `ARCHITECTURE.md`, `system-blueprint.md`, or similar macro-design documents
- you need a clearer high-level design before ADR decisions become binding

## Do Not Use This For

- feature-level UI architecture
- detailed database implementation tuning
- replacing ADR production
- inventing distributed complexity for simple CRUD work

## Load Strategy

Read this file for the runtime contract. Open references only when needed:

- `references/requirements-and-capacity.md` for requirements framing, estimates, and high-level component shaping
- `references/distributed-systems-patterns.md` for storage, cache, queue, reliability, scaling, and tradeoff patterns
- `references/distributed-systems-decision-triggers.md` when a design has replicated state, multi-region availability, distributed writes, cross-service transactions, or leader/coordinator concerns
- `references/operational-depth-patterns.md` for production-depth operational patterns: hot keys, idempotency, deduplication, concurrency failures, graceful degradation, rate limiting, secrets, auth, abuse detection, and more
- `references/architecture-spec-template.md` for a generic architecture-document structure
- `references/apple-platform-architecture.md` only when the target is iOS/macOS or the source material needs Apple-platform translation
- `ORIGINAL.md` for source provenance and adaptation notes

## Core Workflow

1. Clarify the problem before drawing architecture.
2. Separate functional requirements from non-functional requirements.
3. Estimate scale early enough to rule out naive decisions, but do not overfit fake precision.
4. Produce a high-level topology before deep-diving subsystems.
5. Make tradeoffs explicit:
   - consistency vs availability
   - latency vs cost
   - simplicity vs future scale
   - managed service convenience vs portability
6. Document risks, operational assumptions, and future breakpoints.

## Design Checklist

- users, traffic shape, and peak behavior are explicit
- read/write ratio and data growth assumptions are stated
- major boundaries and ownership lines are clear
- stateful components are identified
- failure modes and recovery paths are considered
- observability and deployment implications are included
- security-sensitive surfaces are named, not implied
- the design matches the actual complexity of the product

## Output Expectations

Good system-design output should include:

- requirements and constraints
- capacity assumptions
- high-level topology
- major data flows
- storage and messaging choices
- scaling and reliability strategy
- security and operational concerns
- key tradeoffs and risks

When writing a formal architecture document, use `references/architecture-spec-template.md` as the structural guide.

## Guardrails

- Start simple. Add queues, sharding, event streams, or multi-region only when the drivers justify them.
- Do not hide uncertainty. Call out unknowns and assumptions.
- Prefer modular monolith defaults unless there is a real reason to distribute.
- If the target is an Apple client app, keep Apple-specific stack choices in the Apple reference, not in the root contract.
- If `system-blueprint` or the ADR already defines a binding boundary, align with it rather than improvising a parallel design.
