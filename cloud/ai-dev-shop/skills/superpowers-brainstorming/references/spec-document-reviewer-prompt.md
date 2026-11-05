# Spec Document Reviewer Prompt

Use this after the design/spec document is drafted.

```text
Review this design/spec for implementation readiness.

File: [SPEC_FILE_PATH]

Check for:
- missing sections, TODOs, placeholders, or unresolved questions
- ambiguous requirements or contradictory statements
- missing edge cases or failure behavior
- scope that is too large for one implementation plan
- unclear boundaries between units, modules, or responsibilities
- obvious over-engineering or out-of-scope additions

Return:
- Status: Approved | Issues Found
- Blocking issues
- Advisory suggestions
```
