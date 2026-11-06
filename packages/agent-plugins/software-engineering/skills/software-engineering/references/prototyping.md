# Prototyping

## Operating Style

- Ask at most one clarifying question if needed to start.
- Keep scope to a single focused prototype — one idea, one slice.
- Prefer minimal files and direct implementation.
- Avoid heavy architecture, templates, and documentation unless requested.
- Work on a scratch branch or scratch directory — do not commit exploratory code to main.
- **Under-specification check**: if the request has no clear artifact (what to build) and no success condition (how to know it works) — offer one sentence before building: "This is open-ended — want me to run a quick structured sharpening before we build, or just start?" Default is start if no answer. If the request contains **contradictory directions**, do not default to start — ask the user to resolve the contradiction first.

Deliver runnable code or a concrete scaffold and a short known-rough-edges list. Mark exploratory work as non-production. Do not claim production readiness or modify security-critical authentication/payment flows without an explicit request. Use synthetic fixtures, never real secrets or personal data. For demand or usability experiments, identify one measurable success signal and the smallest authorized feedback loop.

Keep permissions, input validation and honest verification even when moving quickly. Before hardening, turn the prototype into concrete acceptance criteria, inspect its actual dependencies and load [planning](planning.md), [implementation](implementation.md), [security](security.md) and [verification](verification.md) only as needed. No external pipeline or planned skill is required.
