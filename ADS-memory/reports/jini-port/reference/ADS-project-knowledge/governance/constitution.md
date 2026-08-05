# [PROJECT_NAME] Constitution

- Version: 1.0.0
- Ratified: [ISO-8601 date]
- Last Amended: [ISO-8601 date]

## How to Use This Template

Copy this file to `ADS-project-knowledge/governance/constitution.md`. Fill in each article with your project's specific rules. Delete placeholder comments. The Spec Agent and Software Architect Agent read this file on every run — every article they cannot comply with must be either justified in the ADR's Complexity Justification table or escalated to the human.

---

## Article I — [PRINCIPLE NAME]
<!-- Example: Library-First -->

[Describe the principle in 1-3 sentences. Be specific enough that an agent can check compliance with a yes/no answer.]

**Complies if:** [Observable condition — e.g., "No custom implementation exists where a maintained library with >10k weekly downloads solves the same problem"]

**Exception process:** [What justification is required — e.g., "Document in Complexity Justification table: library evaluated, version, why it was rejected"]

---

## Article II — [PRINCIPLE NAME]
<!-- Example: Test-First (NON-NEGOTIABLE) -->

[Principle statement]

**Complies if:** [Observable condition]

**Exception process:** [What justification is required — or "No exceptions"]

---

## Article III — [PRINCIPLE NAME]
<!-- Example: Simplicity Gate -->

[Principle statement]

**Complies if:** [Observable condition]

**Exception process:** [What justification is required]

---

## Article IV — [PRINCIPLE NAME]
<!-- Example: Anti-Abstraction Gate -->

[Principle statement]

**Complies if:** [Observable condition]

**Exception process:** [What justification is required]

---

## Article V — [PRINCIPLE NAME]
<!-- Example: Integration-First Testing -->

[Principle statement]

**Complies if:** [Observable condition]

**Exception process:** [What justification is required]

---

## Article VI — [PRINCIPLE NAME]
<!-- Example: Security-by-Default -->

[Principle statement]

**Complies if:** [Observable condition]

**Exception process:** [What justification is required]

---

## Article VII — [PRINCIPLE NAME]
<!-- Example: Spec Integrity -->

[Principle statement]

**Complies if:** [Observable condition]

**Exception process:** [What justification is required]

---

## Article VIII — [PRINCIPLE NAME]
<!-- Example: Observability -->

[Principle statement]

**Complies if:** [Observable condition]

**Exception process:** [What justification is required]

---

## Governance

- This constitution supersedes all other project practices.
- Amendments require: written rationale, human approval, and a migration plan for in-flight work.
- All ADRs must include a Constitution Check section.
- Unjustified violations are a blocking escalation — the Coordinator treats them the same as a spec hash mismatch.

## Amendment Log

| Version | Date | Article | Change | Rationale |
|---------|------|---------|--------|-----------|
| 1.0.0 | [date] | All | Initial ratification | — |
