# Plan Document Reviewer Prompt

Use this after a plan chunk is drafted.

```text
Review this implementation plan chunk for execution readiness.

Plan chunk: [PLAN_FILE_PATH]
Spec or requirements: [SPEC_FILE_PATH]

Check for:
- missing steps, TODOs, or placeholders
- unclear or oversized tasks
- weak file decomposition
- missing verification commands or expected outcomes
- scope drift away from the source requirements

Return:
- Status: Approved | Issues Found
- Blocking issues
- Advisory suggestions
```
