---
name: ui-ux-design
version: 2.0.0
last_updated: 2026-11-19
description: Use when creating frontend design systems, visual direction, component/state specs, responsive behavior, brand-aware UI guidance, premium/high-converting website polish, browser-backed UI iteration, or implementation-ready design handoff from a feature spec or existing product constraints.
---

# Skill: UI/UX Design

## Tool use and context

Load this skill and the references needed for the task through the current host's
guidance reader. Discover available editing, media and screenshot tools before using
them. Follow the host's tool permissions. CLI examples apply only to an authorized
coding checkout. If a capability is missing, explain the limitation instead of
inventing a tool. Use supplied specs and design notes as context; this skill does not
require a particular repository or framework. Return the design in the conversation
unless the user requests a saved artifact through an available tool.

## Core rules

- A redesign keeps the existing theme's design system: its tokens, fonts, colours,
  spacing and components. Add no new font or accent unless the user asks for a new direction.
- Read any supplied feature spec, current product UI constraints and architecture decisions before making visual decisions; state assumptions where context is missing.
- Define foundations before screens and every component state (default, hover, focus,
  active, loading, empty, error, success, disabled) before polish.
- Plan the mobile composition of a web page before building it.
- Accessibility and responsive behavior are default requirements. Never rely on colour
  alone or placeholder-only labels.
- Claim only what you observed: unrendered work is design-reviewed, not rendered-verified.

## Load before you build

These rows are required, not optional. Load each through the host's guidance reader:
this plugin, the skill named (default `ui-ux-design`) and the file named.

| Before you | Load |
|---|---|
| create, redesign, audit or polish a page, screen or theme | `references/ui-loop.md`, then `references/full-workflow.md` |
| decide visual quality (redesign, premium, marketing) | `references/premium-ui.md`; it routes to `references/sam-crawford-premium-websites.md`, `references/self-made-web-designer-core-skills.md`, `references/kole-jain-uiux-concepts.md` |
| set tokens, type, spacing, layout, breakpoints | `references/foundations.md` |
| specify components or states | `references/components-and-states.md` |
| define brand or tone | `references/brand-and-voice.md` |
| plan research, personas or journeys | `references/research-and-validation.md` |
| frame a story or infographic | `references/visual-storytelling.md` |
| art-direct a distinctive landing page (tell the user first) | `references/openai-frontend-skill.md` |
| add microcopy or delight | `references/delight-and-motion.md` |
| animate anything | `references/ui-animation.md` |
| use kUInetic, or the theme already uses it | the `kuinetic` plugin (skill `kuinetic`) first, then `references/ui-animation.md` |
| generate imagery | `references/inclusive-ai-imagery.md` |
| verify mobile in a browser | `references/chrome-mobile-test-matrix.md` |
| audit accessibility | skill `frontend-accessibility` |
| screen privacy, consent or policy risk | skill `web-compliance` |
| build a dashboard, admin or app system | skill `interface-design` |
| run consultation, shotgun, html or review | skill `gstack-design` |
| audit against Vercel's guidelines (on request only) | skill `vercel-web-design-guidelines` |
| build React/Tailwind with shadcn/ui | the `shadcn-ui` plugin |
