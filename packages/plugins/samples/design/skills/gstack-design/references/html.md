# Frontend Implementation Handoff

## When

Use after a design direction is approved and the user wants a frontend implementation plan, static prototype, or production handoff. The `html` mode name is legacy shorthand; it is not a raw HTML-only constraint.

## Workflow

1. Confirm the approved design source: consultation output, shotgun winner, screenshot, mockup, or user description.
2. Detect the project frontend stack when a repo is present; prefer the existing framework and design system.
3. Convert design intent into implementable structure: layout, components, states, tokens, responsive rules, and content hierarchy.
4. If producing static HTML/CSS, keep it semantic, responsive, accessible, and clearly labeled as a prototype.
5. If producing framework guidance, specify components, props, state handling, CSS strategy, and verification steps.
6. Verify the result against the approved direction using browser evidence when browser automation is available.

## Output

- Implementation target and assumptions
- Component/layout plan
- Token and style notes
- Accessibility and responsive checks
- Prototype or implementation handoff
- Verification checklist

## Guardrails

- Do not assume upstream-specific prototype tooling or generated design-board services exist.
- Do not ignore the host app's current framework or design system.
- Do not skip final visual verification when browser automation is available.
