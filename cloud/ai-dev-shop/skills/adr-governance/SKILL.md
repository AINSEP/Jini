---
name: adr-governance
version: 1.0.0
last_updated: 2026-06-03
description: Just-in-time governance ADR lookup and enforcement for cross-cutting architectural rules. Provides path-based ADR matching, comply-or-explain workflow, promotion from pipeline ADRs, and exception tracking.
---

# Skill: ADR Governance

Focused loop skill for enforcing cross-cutting Governance ADRs during implementation. Governance ADRs are durable rules that outlive individual features — they live in `<ADS_MEMORY_ROOT>/governance/adrs/` and are indexed for path-based lookup.

## When to Use

- **Implementation agents (Programmer, Refactor, TDD):** Activate when touching files that fall under governance ADR scope globs, or when an enforcement check (linter, CI, code review) references a governance ADR violation.
- **Software Architect:** Activate after writing a pipeline ADR to evaluate whether cross-cutting decisions should be promoted to the governance registry.

## Enforcement Levels

| Level | Meaning | Agent behavior on deviation |
|---|---|---|
| **DEFAULT** | Follow unless you document why not | Record exception: which ADR, why inapplicable, what instead. Proceed. |
| **MANDATORY** | No deviation without human approval | Block and escalate to Coordinator. Do not proceed. |
| **ADVISORY** | Guidance only | Note awareness. No exception record needed. Proceed. |

## Workflow: Just-in-Time Lookup (Implementation Agents)

1. **Identify target files.** Before implementation, list the files you will create or modify.
2. **Read the index.** Load `<ADS_MEMORY_ROOT>/governance/adrs/ADR-INDEX.md`. If the file does not exist or the table is empty, no governance ADRs apply — skip the rest of this workflow. Match your target file paths against the `Scope Globs` column for rows with Status = `ACCEPTED` only. Ignore `PROPOSED`, `SUPERSEDED`, and `DEPRECATED` rows.
3. **Load only matching ADRs.** Read only the governance ADR files whose scope matches your working set. Do not load unrelated ADRs.
4. **Evaluate compliance.** For each matching ADR:
   - If you can comply: do so. No further action needed.
   - If you must deviate:
     - **MANDATORY:** Stop. Escalate to Coordinator with explanation of why compliance is impossible.
     - **DEFAULT:** Document the exception (see Exception Recording below). Proceed with the deviation.
     - **ADVISORY:** Proceed. No documentation required.

## Workflow: Violation Recovery

When a linter, CI check, or code review flags a governance ADR violation:

1. Read the specific ADR referenced in the error.
2. Understand the rule, why it exists, and how to comply.
3. Either fix the violation, or (for DEFAULT only) record an exception explaining why the rule doesn't apply here.
4. Re-run the check to confirm resolution.

## Workflow: Promotion (Software Architect)

After writing a pipeline ADR at `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/adr.md`:

1. **Evaluate cross-cutting scope.** Does this ADR establish rules, boundaries, or patterns that apply beyond the current feature? Examples: module import restrictions, shared service contracts, data access patterns, security boundaries.
2. **If yes — promote:**
   - Extract the durable rule using `<AI_DEV_SHOP_ROOT>/framework/templates/governance-adr-template.md`.
   - Save to `<ADS_MEMORY_ROOT>/governance/adrs/GOV-ADR-<NNN>-<slug>.md`.
   - Update `<ADS_MEMORY_ROOT>/governance/adrs/ADR-INDEX.md` with the new entry.
   - Link back to the originating pipeline ADR in the `Related` field.
3. **If no:** No promotion needed. The pipeline ADR remains feature-scoped.

## Exception Recording

When an agent takes a DEFAULT exception, append a record to `<ADS_MEMORY_ROOT>/governance/adrs/ADR-EXCEPTIONS.md`:

```
| <date> | <GOV-ADR-id> | <agent> | <file(s)> | <reason for deviation> | <what was done instead> |
```

Create `ADR-EXCEPTIONS.md` on first exception if it doesn't exist, with header:

```markdown
# Governance ADR Exception Ledger

| Date | ADR ID | Agent | Files | Reason | Alternative |
|---|---|---|---|---|---|
```

After appending, count recent exceptions for that same ADR ID in the ledger. If this entry makes 3 or more within the last 90 days, immediately flag for Coordinator review: "GOV-ADR-<id> has 3+ exceptions in 90 days — re-evaluation required."

## Re-evaluation Triggers

- **3+ exceptions against the same DEFAULT ADR within 90 days:** The ADR itself may be wrong or overly broad. Flag for Coordinator review.
- **Technology shift:** A library, framework, or platform change may invalidate the ADR's assumptions.
- **Calendar:** ADRs older than 12 months without exceptions should be spot-checked for relevance.

## Conflict Precedence

When multiple governance ADRs apply to the same file:

1. MANDATORY ADRs take precedence over DEFAULT and ADVISORY.
2. Among same-level ADRs, the more specific scope glob takes precedence over broader ones.
3. If two same-level, same-specificity ADRs conflict, escalate to Coordinator.
4. A pipeline ADR cannot override a MANDATORY governance ADR without human approval. It can supersede a DEFAULT governance ADR if it explicitly documents the supersession.

## Context Efficiency

This skill is designed for minimal context load:
- Read only ADR-INDEX.md (one small table) to determine relevance.
- Load only matching ADR files (typically 0-2 per task).
- Do not preload the full governance registry into agent context.
