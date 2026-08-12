---
name: ui-ux-design
version: 1.1.0
last_updated: 2026-08-09
description: Use when creating frontend design systems, visual direction, component/state specs, responsive behavior, brand-aware UI guidance, premium/high-converting website polish, or implementation-ready design handoff from a feature spec or existing product constraints.
---

# Skill: UI/UX Design

## Execution

- Read the active spec, current product UI constraints, and ADR notes before making visual decisions.
- Preserve an existing design system unless the user explicitly requests a new direction.
- Define foundations before screens: tokens, typography, spacing, breakpoints, layout rules, interaction baselines.
- Define component behavior before polish: default, hover, focus, active, loading, empty, error, success, disabled.
- Load only the reference files needed for the current task, with one standing exception: **any request for visual quality loads the premium bundle up front** — `references/premium-ui.md` together with `sam-crawford-premium-websites.md`, `self-made-web-designer-core-skills.md`, and `kole-jain-uiux-concepts.md`. That is ~6k tokens for all four, and the specifics live in the three notes, not the summary. Do not wait for the user to name a source; they never will.
  - `references/premium-ui.md` for premium/luxury/high-trust/high-converting website and product UI polish — first impression, hierarchy, premium signals, and the three design-school notes it carries
  - `references/foundations.md` for tokens, layout, theming, responsive rules
  - `references/components-and-states.md` for component inventory, state matrix, interaction rules
  - `references/brand-and-voice.md` for brand system, tone, messaging, visual identity direction
  - `references/research-and-validation.md` for personas, journeys, usability-test planning, design validation
  - `references/visual-storytelling.md` for narrative layouts, data storytelling, campaign-style pages
  - `references/openai-frontend-skill.md` for composition-first landing pages, branded demos, art direction, and anti-generic UI checks
  - `references/delight-and-motion.md` for microcopy, micro-interactions, personality, motion, delight
  - `references/inclusive-ai-imagery.md` for inclusive representation rules and AI image/video prompting
- Treat accessibility, responsive behavior, and implementation clarity as default requirements.
- Produce design output that Programmer, QA/E2E, and Code Inspection can execute without guessing.

## Guardrails

- Do not implement frontend code unless the owning agent explicitly changes scope.
- Do not invent a brand system when the product already has one; extend or document the existing one.
- Do not prescribe motion, whimsy, or theme toggles by default when they conflict with product context.
- Do not rely on color alone for meaning, placeholder-only labels, or non-semantic interaction patterns.
- Do not use AI-image guidance unless image or video generation is actually in scope.
- Do not present user research fiction as real evidence; label proposed research and validation plans as plans.
- If `references/openai-frontend-skill.md` is activated, explicitly tell the user before using its direction so they can redirect if they do not want that visual approach.

## Output

Write a concise design artifact that includes:

- visual direction summary
- design foundations: tokens, typography, spacing, layout, breakpoints
- component inventory and state matrix
- interaction, motion, and microcopy rules
- accessibility and inclusive-design requirements
- brand/voice constraints when relevant
- implementation notes for Programmer
- verification notes for QA/E2E and Code Inspection

Default path: `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/design-spec.md`

## Reference

### Preconditions

- Inputs expected: active feature spec, existing UI/design constraints, ADR constraints if available, target platform context.
- If the request is an audit of existing UI rather than design creation, pair this skill with `vercel-web-design-guidelines` and `frontend-accessibility`.

### Decision Rule

- Any signal that visual quality matters — premium, high-end, expensive, luxury, agency-grade, high-converting, "make it look good", a redesign, or a first-impression/marketing surface -> load `premium-ui.md` **and its three notes** first
- Need layout, theming, or token structure -> load `foundations.md`
- Need reusable components or interaction states -> load `components-and-states.md`
- Need brand system or tone definition -> load `brand-and-voice.md`
- Need validation plan or persona/journey structure -> load `research-and-validation.md`
- Need narrative landing page, infographic, or campaign framing -> load `visual-storytelling.md`
- Need visually strong landing-page composition, branded demo direction, or anti-generic UI guidance -> load `openai-frontend-skill.md`
- Need delight, motion, or playful interaction guidance -> load `delight-and-motion.md`
- Need AI-generated imagery or inclusive representation constraints -> load `inclusive-ai-imagery.md`

### Failure Path

- If brand direction conflicts with accessibility or compliance, keep the baseline and escalate the conflict.
- If the spec lacks enough product context for irreversible design decisions, produce a constrained design spec with explicit assumptions and open questions.
- If requested style would materially harm usability, note the tradeoff and require human approval before locking it in.
