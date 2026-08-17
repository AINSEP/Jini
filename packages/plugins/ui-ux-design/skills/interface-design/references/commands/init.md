# interface-design:init

Build UI with a craft-first system instead of ad hoc component choices.

## Workflow

1. Read `SKILL.md`.
2. Check whether `.interface-design/system.md` already exists.
3. If it exists, apply the existing direction and patterns.
4. If it does not exist, infer a direction from the product context and ask for confirmation before locking it in.
5. Build the UI using the chosen direction.
6. Offer to save any stable decisions into `.interface-design/system.md`.

## Before Building Each Component

State the intent and the technical approach before writing code:

- who the human is
- what they need to accomplish
- what the screen should feel like
- palette choice and why it fits
- depth choice and why it fits
- surfaces and why they fit
- typography and why it fits
- spacing base

## Guardrails

- Do not default to generic UI if the product has a distinct world or tone.
- Do not skip the system decision step when repeated UI work is likely.
- Do not narrate internal process to the user unless they need the design decision explained.
