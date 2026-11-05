---
name: enterprise-spec
version: 1.1.1
last_updated: 2026-03-22
description: Overlay skill that activates on top of spec-writing for enterprise contexts. Adds cross-repository orchestration, work-management integration, role-based approval gating, shift-left specialist harnesses, closed-loop outcome feedback, and program-level spec rollup. Do NOT use this skill alone — load it alongside skills/spec-writing/SKILL.md.
overlay: true
base_skill: spec-writing
---

# Skill: Enterprise Spec (Overlay)

This skill is an overlay on top of `spec-writing`. It adds enterprise-only concerns and does not replace the base spec contract.

Load order:

1. `spec-writing/SKILL.md`
2. `enterprise-spec/SKILL.md`

Keep this file lean. Read it for the overlay contract, then load only the reference files needed for the specific enterprise context.

## Version Notes

- `1.1.1` adds explicit version notes so the refactor history is visible inside the skill instead of only in git.
- `1.1.0` converted the overlay from a single long manual into a routing layer plus focused enterprise reference files.

## Activation Criteria

Activate this overlay when any of the following is true:

- the feature spans multiple repositories or services
- enterprise work-management tooling is required
- multiple organizational roles must approve progress
- the work belongs to a tracked initiative, program, or OKR
- compliance, audit, or contractual approval trails are required

If none of these apply, use `spec-writing` alone.

## Overlay Contract

Enterprise spec work adds six concerns beyond standard spec-writing:

| Concern | Contract |
|---|---|
| Cross-Repo Orchestration | Program-level specs own end-to-end behavior; repo-level sub-specs own local behavior only. |
| Work-Management Mapping | Requirements must map to tracked work items when enterprise work tracking is in scope. |
| Approval Gating | Required organizational roles must approve specific phase transitions before the Coordinator proceeds. |
| Shift-Left Harnesses | Security, infrastructure, and performance constraints are injected before implementation tasks begin. |
| Closed-Loop Feedback | Post-ship defects must route back through spec/test workflow and produce learnings. |
| Program Rollup | Initiative-level rollups track feature inventory, dependencies, status, and shared contracts. |

## Required Context

Before using this overlay, confirm:

- whether the feature is single-repo or multi-repo
- whether work items already exist and in which system
- which roles must approve each gate
- whether specialist harnesses are required
- whether the work belongs to a named program or initiative
- whether compliance or audit recordkeeping is mandatory

## Hard Gates

- Do not apply enterprise process to small single-team work without justification.
- Do not allow repository sub-specs to redefine shared cross-service contracts.
- Do not advance past an approval gate without recorded approvals for the required roles.
- Do not start implementation before required harness constraints are injected.
- Do not treat post-ship defects as ad hoc code patches.
- Do not mark an enterprise spec package approved if required enterprise artifacts are missing.

## Cross-Repo Rules

- Program-level `feature.spec.md` owns the end-to-end capability.
- Repository-level sub-specs inherit from the program-level spec and scope themselves to one boundary.
- Shared contracts are defined once at the program level.
- Cross-repo traceability must exist before a program-level requirement is considered verified.
- Program-level completion requires every affected repository path to complete its pipeline and all shared contract tests to pass.

For concrete layouts and examples, load `references/cross-repo-orchestration.md`.

## Work-Management Rules

- Every enterprise-tracked requirement must map to a work item when work-management integration is in scope.
- Missing mapping is blocking.
- Pipeline stage transitions must translate to work item status transitions.
- If tooling integration exists, the Coordinator applies transitions safely.
- If tooling integration does not exist, the Coordinator must emit explicit transition instructions.

For format examples, load `references/work-management-and-approvals.md`.

## Approval Rules

- Approval gates are role-based, not just “human approved”.
- Rejections route back to the responsible prior-stage agent with reason preserved.
- Approval history is append-only.
- The Coordinator halts at a gate until all required roles are present and approved.

For gate tables and `approvals.md` examples, load `references/work-management-and-approvals.md`.

## Shift-Left Harness Rules

- Harness injection happens after ADR approval and before task generation.
- Security harness is required for security-sensitive paths.
- Infrastructure harness is required for topology or environment changes.
- Performance harness is required for explicit latency, throughput, or availability requirements.
- Harnesses constrain implementation; they do not implement the feature.

For injected constraint examples, load `references/shift-left-harnesses.md`.

## Closed-Loop Feedback Rules

- Every post-ship defect must be categorized as either intent-to-spec gap or spec-to-implementation gap.
- Fixes route through spec/test workflow first, not direct code patching.
- Every defect must be recorded in `<ADS_MEMORY_ROOT>/knowledge/learnings.md`.
- Repeated defect patterns must become harness improvements after the recurrence threshold is met.

For the defect-record format and examples, load `references/closed-loop-feedback.md`.

## Program Rollup Rules

- Use a program-level rollup only when the work belongs to a named initiative spanning multiple specs, teams, or time horizons.
- Program specs track initiative-level goals and inventory, not feature-level REQ detail.
- Feature specs that belong to a program must declare the program in metadata.
- Shared contracts and cross-feature dependencies are tracked at the program level.

For `program.spec.md` and rollup examples, load `references/program-rollup.md`.

## Enterprise Artifact Set

An enterprise spec package extends the strict-mode package from `spec-writing`.

| Artifact | Required When |
|---|---|
| `work-items.md` | enterprise work-management tracking is in scope |
| `approvals.md` | multi-role approval is required |
| `integration-contracts.ts` | the feature spans multiple repositories or services |
| program-level `traceability.spec.md` | the feature spans multiple repositories or services |
| `program.spec.md` | the feature belongs to a named program or initiative |

## Compliance Checklist

- activation criteria actually justify the overlay
- enterprise-only artifacts are present when applicable
- shared contracts are defined once at program level
- work-item mappings are complete when required
- gate approvals are complete before progression
- harness constraints exist before implementation starts
- post-ship defects route through the closed-loop process
- program rollup metadata is present when the feature belongs to a program

## References

- `references/cross-repo-orchestration.md`
- `references/work-management-and-approvals.md`
- `references/shift-left-harnesses.md`
- `references/closed-loop-feedback.md`
- `references/program-rollup.md`
