# Design Review

## When

Use to audit an existing UI for design quality, usability, accessibility, visual consistency, or AI-generated slop patterns.

## Workflow

1. Identify the target screen, flow, or component set.
2. Inspect available evidence: screenshots, browser state, DOM, component code, design docs, or user reports.
3. Audit hierarchy, spacing, alignment, typography, color contrast, responsive behavior, component states, loading/empty/error states, and interaction clarity.
4. Look for common AI slop: generic gradients, meaningless decorative visuals, mismatched radii, low-density cards, vague copy, and inconsistent spacing.
5. Classify findings as blocker, should-fix, or polish.
6. Recommend the smallest design change that fixes the issue before proposing a broad redesign.

## Output

- Evidence inspected
- Findings by severity
- Specific recommended fixes
- Accessibility and responsive notes
- Follow-up mode if needed

## Guardrails

- Do not claim visual evidence without inspection.
- Do not rewrite the product's visual direction unless the user asks.
- Do not bury accessibility blockers under polish comments.
