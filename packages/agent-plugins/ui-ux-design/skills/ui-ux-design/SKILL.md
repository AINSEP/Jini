---
name: ui-ux-design
version: 1.7.0
last_updated: 2026-10-30
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

## Execution

- Read any supplied feature spec, current product UI constraints and architecture decisions before making visual decisions; state assumptions where context is missing.
- Preserve an existing design system unless the user explicitly requests a new direction.
- For every page or screen creation, redesign, audit, or visual-polish task, read
  `references/ui-loop.md` before making design decisions. It is the canonical home
  for the design-intent gate, complete review checklist, browser Change → Observe
  loop, evidence boundary, reconciliation, and handoff rules.
- Run its **Design Intent** mode for every page or screen. Add **Rendered Iteration**
  mode only when `browser-live-analysis` verifies `browser_automation = enabled`.
- For web pages, Design Intent includes a concrete mobile composition plan before
  implementation: first-view message and action, content order, stacking/reflow,
  typography and spacing changes, imagery/crops, and interaction risks. Do not defer
  mobile thinking until browser QA.
- For an implemented website or web app that can be affected by responsive layout,
  mobile navigation, forms, overlays, or sticky/fixed elements, first run the
  browser preflight. Load and run `references/chrome-mobile-test-matrix.md` only
  when `browser_automation = enabled`. Use Chrome/Chromium when the provider exposes
  it; otherwise record `CHROME_NOT_VERIFIED` and provide the unresolved manual checks.
- Define foundations before screens: tokens, typography, spacing, breakpoints, layout rules, interaction baselines.
- Define component behavior before polish: default, hover, focus, active, loading, empty, error, success, disabled.
- After the required `references/ui-loop.md`, load only the domain references needed
  for the current task. **Any request for visual quality loads
  `references/premium-ui.md` up front**, then follows its surface routing: load all
  three design-school notes for broad, open-ended, hybrid marketing/product, or
  high-stakes premium work; use its smaller marketing or product-UI subset only for
  a clearly narrow task. `ui-loop.md` remains the only generic page/screen review
  checklist.
  - `references/ui-loop.md` for the required page/screen design gate, canonical
    checklist, browser iteration loop, and verification boundary
  - `references/chrome-mobile-test-matrix.md` for the conditional browser-observed
    phone viewport matrix and mobile interaction bug sweep
  - `references/premium-ui.md` for routing among premium psychology, concrete visual-system heuristics, and product-UI affordance methods
  - `references/foundations.md` for the token, layout, responsive, and visual-system decision contract
  - `references/components-and-states.md` for the reusable component inventory, state matrix, and interaction specification
  - `references/brand-and-voice.md` for brand inputs, tone rules, messaging architecture, and visual-identity translation
  - `references/research-and-validation.md` for assumption labeling, personas, journeys, and usability-test planning
  - `references/visual-storytelling.md` for narrative frames, visual proof, and data-storytelling methods
  - `references/openai-frontend-skill.md` for composition-first art direction and distinctive landing-page or branded-demo methods
  - `references/delight-and-motion.md` for contextual microcopy, micro-interactions, personality, and delight intensity
  - `references/ui-animation.md` when animating anything (scroll reveals, text reveals,
    transitions, pinned sections, micro-interactions): kUInetic-first library choice,
    implementation defaults, and micro-interaction recipes
  - `references/kuinetic-reference.md` with `ui-animation.md` when the page has kUInetic
    (`data-kui`, `vendor/kuinetic/`, the `kuinetic` package): attributes, effect names, tiers
  - `references/inclusive-ai-imagery.md` for generated-imagery prompting and representation review
- Treat accessibility, responsive behavior, and implementation clarity as default requirements.
- Produce design output that Programmer, QA/E2E, and Code Inspection can execute without guessing.

## UI Loop Contract

- `references/ui-loop.md` owns all page/screen self-review questions and iteration
  mechanics. Do not recreate a short checklist here or copy its rendered checks into
  another skill or agent persona.
- Before finalizing design direction, complete the reference's eight-category Design
  Intent pass. When Rendered Iteration is available, complete its browser-observed
  checks and reconciliation pass before claiming visual completion.
- When a surface cannot be rendered, label it design-reviewed but not
  rendered-verified and provide the unresolved manual viewport/state checks.
- When the Chrome mobile matrix is triggered, complete it after the general rendered
  checks and before claiming responsive or mobile verification.
- The Design Intent mobile plan is always required for a web page even when the
  Chrome matrix cannot run. The matrix validates the rendered result; it is not the
  first point at which mobile composition is considered.
- Keep checklist details internal unless the user requests an audit or a failed item,
  assumption, or tradeoff materially affects the result.

## Guardrails

- Implementation authority belongs to the consuming persona and the user's request.
  The Web Design Agent authorizes presentation-layer implementation by default;
  spec-only, audit-only, and other consumers do not gain implementation authority
  merely by loading this skill.
- Do not invent a brand system when the product already has one; extend or document the existing one.
- Do not prescribe motion, whimsy, or theme toggles by default when they conflict with product context.
- Do not rely on color alone for meaning, placeholder-only labels, or non-semantic interaction patterns.
- Do not use AI-image guidance unless image or video generation is actually in scope.
- Do not present user research fiction as real evidence; label proposed research and validation plans as plans.
- Do not claim a Chrome mobile pass without recording the actual browser engine,
  tested routes and viewports, interactive paths, and remaining device-only checks.
- If `references/openai-frontend-skill.md` is activated, explicitly tell the user before using its direction so they can redirect if they do not want that visual approach.

## Output

Match the output to the operating context:

- **Existing surface, fix mode:** implement authorized presentation-layer changes
  and report what changed, why, the UI Loop mode used, what was actually observed,
  and unresolved tradeoffs. Do not force a standalone design artifact unless the
  user or pipeline asks for one.
- **Pre-implementation or pipeline direction:** write a concise design artifact at
  the path defined by the consuming persona or active pipeline. The Web Design Agent
  uses `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/web-design-spec.md`.
- **Audit-only:** provide prioritized findings and evidence without editing files.

When a design artifact is required, include:

- visual direction summary
- design foundations: tokens, typography, spacing, layout, breakpoints
- component inventory and state matrix
- interaction, motion, and microcopy rules
- UI Loop mode used, unresolved checklist items, and rendered-evidence status
- Chrome mobile matrix results when that conditional reference was activated
- accessibility and inclusive-design requirements
- brand/voice constraints when relevant
- implementation notes for Programmer
- verification notes for QA/E2E and Code Inspection

## Reference

### Preconditions

- Inputs expected: active feature spec, existing UI/design constraints, ADR constraints if available, target platform context.
- For an existing-UI audit, pair this skill with `frontend-accessibility`. Load
  `vercel-web-design-guidelines` only when the user explicitly requests Vercel's
  Web Interface Guidelines or a fresh external-rule compliance audit. Treat its
  `file:line` findings as supplemental evidence mapped into UI Loop categories;
  `ui-loop.md` remains the completion authority.

### Decision Rule

- Any page or screen creation, redesign, audit, or visual polish -> load
  `references/ui-loop.md` and complete Design Intent mode; add Rendered Iteration
  only with verified browser automation
- Implemented website/web-app work that can affect responsive layout, mobile
  navigation, forms, overlays, or sticky/fixed elements -> after browser preflight
  verifies automation, load and run `chrome-mobile-test-matrix.md`; otherwise record
  `CHROME_NOT_VERIFIED` and manual checks
- Any signal that visual quality matters — premium, high-end, expensive, luxury,
  agency-grade, high-converting, "make it look good", a redesign, or a
  first-impression/marketing surface -> load `premium-ui.md` first, then its full or
  narrow note set according to that router
- Need layout, theming, or token structure -> load `foundations.md`
- Need reusable components or interaction states -> load `components-and-states.md`
- Need brand system or tone definition -> load `brand-and-voice.md`
- Need validation plan or persona/journey structure -> load `research-and-validation.md`
- Need narrative landing page, infographic, or campaign framing -> load `visual-storytelling.md`
- Need visually strong landing-page composition, branded demo direction, or anti-generic UI guidance -> load `openai-frontend-skill.md`
- Need delight, motion, or playful interaction guidance -> load `delight-and-motion.md`
- Implementing any animation, scroll or text reveal, transition, or micro-interaction ->
  load `ui-animation.md`; add `kuinetic-reference.md` when kUInetic is detected
- Need AI-generated imagery or inclusive representation constraints -> load `inclusive-ai-imagery.md`
- User explicitly requests Vercel Web Interface Guidelines or a fresh external-rule
  compliance audit -> load `vercel-web-design-guidelines` as supplemental evidence,
  never as a second completion checklist

### Failure Path

- If brand direction conflicts with accessibility or compliance, keep the baseline and escalate the conflict.
- If the spec lacks enough product context for irreversible design decisions, produce a constrained design spec with explicit assumptions and open questions.
- If requested style would materially harm usability, note the tradeoff and require human approval before locking it in.
