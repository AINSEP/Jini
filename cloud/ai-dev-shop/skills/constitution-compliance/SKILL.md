---
name: constitution-compliance
description: Use when a spec, red-team pass, or architecture artifact must be checked article-by-article against the project constitution and any exception must be justified or escalated.
---

# Constitution Compliance

## Execution

- Read `<ADS_MEMORY_ROOT>/governance/constitution.md` before finalizing the artifact.
- Evaluate every article against the proposed artifact and record `COMPLIES`, `EXCEPTION`, or `N/A`.
- Revise the artifact to comply when possible.
- If an exception remains, document the justification in the artifact's exception or complexity table.
- Block progression when an exception has no justification or requires human judgment.
- Carry forward any upstream constitution findings that still need resolution.

## Guardrails

- Do not skip articles because they seem unrelated.
- Do not mark `N/A` unless the article truly does not apply.
- Do not continue past an unjustified exception.
- Do not treat the constitution as advisory text; it is a gate.

## Output

- article-by-article compliance result
- justified exception list
- blocking escalations that must be resolved before proceeding

## Reference

- Preconditions:
  - the artifact affects architecture, spec intent, or delivery constraints
- Decision rule:
  - if compliance requires only a local revision, revise first
  - if compliance changes scope, direction, or risk acceptance, escalate
- Failure path:
  - if the artifact cannot comply and no justified exception exists, stop and request a human decision
