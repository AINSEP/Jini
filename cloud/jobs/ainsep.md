# Job ainsep: Software Engineering agent plugin
Owner 11-05: make the "Tovu software engineering" agentic plugin, following the Agent Plugins standard.
Plan: cloud/plans/A-ainsep-plan-result.md; earlier notes: cloud/plans/night/P-ainsep-se-plan.md. TRIM.md "A" overrides.
- Standard: the open Agent Plugins spec (packages/agent-plugins/README.md; `$schema` https://agent-plugins.org/schemas/1.0.0/plugin.schema.json). Copy ui-ux-design's layout: plugin.json, skills/, README, LICENSE, NOTICE, __tests__. Host-specific data only under `extensions`.
- Package subpath `@jini-ai/agent-plugins/software-engineering`, name `software-engineering`, because Jini is reused by other products. Display name "Tovu Software Engineering" lives only in `extensions.tovu.displayName`.
- Content: AI-Dev-Shop's Programmer, Software Architect, TDD and Code Inspection guidance with a router, from /workspace/Jini/AI-Dev-Shop. One entry skill + 4 short references; size budgets in the plan. Link the memory discipline instead of repeating it. No provenance or session names in skill text.
- Gates as guidance: cognitive and cyclomatic ≤10, ≤9 in apps/desktop, nesting ≤3, exhaustive-switch exception as planned. Tests not required for features; bug fixes start with a failing test; tests added later get mutation-tested. Missing checkers report UNVERIFIED, never PASS.
- Tovu: add to the bundled catalog + overlay, available but OFF by default. Tests: reference resolution, self-containment, size, bundle selection. Cut routing evals.
- Also write the skill tree under cloud/ads-ainsep-skill/ on the Tovu branch so it can be committed to AI-Dev-Shop later. Do not edit AI-Dev-Shop. Release is not yours.
