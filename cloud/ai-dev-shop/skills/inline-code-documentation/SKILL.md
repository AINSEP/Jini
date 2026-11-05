---
name: inline-code-documentation
description: Use when generating or updating code that must include language-appropriate inline documentation for functions, methods, classes, and modules.
---

# Inline Code Documentation

## Execution

- Document every new or materially changed function, method, class, and module using the language's idiomatic format.
- Cover purpose, parameters, return value, side effects, and thrown or returned errors.
- Add at least one usage example for public-facing interfaces.
- Apply the same rule to local helpers, callbacks, and nested functions when they remain named code in the patch.
- Review touched code for documentation coverage before handoff.

## Guardrails

- Do not defer documentation to review.
- Do not skip documentation because code is small or "obvious."
- Keep docs behavior-focused; do not narrate the implementation line by line.
- When behavior changes, update stale docs in the same touched scope.

## Output

- documented files or symbols
- any doc updates required by behavior changes
- confirmation that inline documentation matches the shipped behavior

## Reference

- Preconditions:
  - code is being created or materially changed
  - the language has an idiomatic inline documentation format
- Decision rule:
  - public-facing interfaces always need an example
  - local helpers still need documentation when they carry behavior or side effects worth understanding
- Failure path:
  - if docs cannot be kept accurate in the same patch, the code is not ready for handoff
- Examples:
  - `<AI_DEV_SHOP_ROOT>/agents/programmer/references/inline-documentation-examples.md`
  - `<AI_DEV_SHOP_ROOT>/skills/tool-design/SKILL.md`
