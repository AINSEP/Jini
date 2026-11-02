# UI Loop

This is the canonical self-review and iteration reference for page and screen
design. `ui-ux-design` owns it. Other skills and agents point here instead of
copying its questions or maintaining separate design checklists.

## Choose The Mode

| Mode | Use it when | Evidence boundary |
|---|---|---|
| **Design Intent** | Creating a new surface, writing a design spec, or working without verified browser automation | Answer the eight Core questions from the brief, product constraints, and available artifacts. State assumptions; do not claim rendered verification. |
| **Rendered Iteration** | An existing or implemented surface can be opened with verified `browser_automation` | Answer every Core question and rendered check from browser evidence at the relevant viewports and states. |

For every page or screen creation, redesign, audit, or visual-polish task, run
Design Intent mode before finalizing the direction. Add Rendered Iteration mode
when the browser capability is verified. If an existing surface cannot be rendered,
finish the Design Intent pass and provide specific manual checks for the unresolved
rendered items.

This is an internal design gate, not a questionnaire to push onto the user. Ask the
user only for missing product or brand information that would materially change the
direction. A weak or uncertain answer means revise, state an assumption, or record a
tradeoff; do not silently count it as a pass.

When Programmer runs Rendered Iteration, treat Premium quality and trust plus
Restraint and motion as conformance checks against the approved design/spec, not as
permission to invent new visual direction. If an honest answer requires a taste
decision Programmer does not own, stop and request Web Design routing.

## Canonical Review Checklist

In Design Intent mode, answer the bold **Core** question in each category. In
Rendered Iteration mode, answer the Core question and every nested check with
`PASS`, `N/A`, or a concrete observation and next correction. Do not apply a fixed
numeric cap to colors, type styles, or animation; require every added element to
earn its place in this product and context.

### 1. Purpose and first view

**Core:** Can the target user tell within a few seconds what this page or screen is,
who it is for, why it matters, and what to do next?

Rendered checks:

- On a marketing page, the hero teaches the offer clearly while creating the
  intended first impression; it does not become vague in the name of looking premium.
- The headline, supporting copy, visual, and primary action reinforce the same idea.
- On an app or tool screen, the first view makes the current context, status, key
  task, and next decision clear instead of imitating a marketing hero.

### 2. Narrative and copy

**Core:** Does every section or region have one clear job, form a coherent story,
and use no more copy than the user needs to understand or decide?

Rendered checks:

- The headings alone tell a coherent story when the page is skimmed.
- Sections explain, prove, differentiate, answer an objection, or convert in an
  order that matches the user's decision path.
- Repeated, generic, internal, jargon-heavy, or non-decision-changing copy is removed.
- Paragraphs, lists, labels, and line lengths are easy to scan, with enough whitespace
  to separate ideas without making the page feel disconnected.

### 3. Hierarchy, navigation, and action

**Core:** Is there an obvious focal point, reading order, and primary action without
competing calls to action, confusing navigation, or decorative noise?

Rendered checks:

- One primary action is visually dominant and secondary actions are subordinate.
- The next step appears where the user is likely to decide, including a clear ending
  to the page or task.
- Navigation labels, links, controls, and interaction cues are understandable without
  guessing, and the critical path has no obvious dead end.
- Scale, contrast, proximity, and alignment move the eye through the interface in the
  intended order.

### 4. Visual cohesion

**Core:** Do typography, spacing, color, imagery, icons, depth, and component
treatments feel like one intentional system rather than a collection of effects?

Rendered checks:

- Typography, spacing, alignment, content widths, and section rhythm are consistent.
- Palette, type choices, imagery, icon style, radii, borders, shadows, and surfaces
  feel as though they belong to the same product.
- Unnecessary colors, type treatments, cards, effects, and competing focal points
  have been removed.

### 5. Premium quality and trust

**Core:** Does the design feel specific, credible, and polished for this audience
rather than generic, template-like, or expensive-looking but unclear?

Rendered checks:

- The page has a product- and audience-relevant point of view or focal idea.
- Images and visual assets are sharp, purposefully cropped, context-relevant, and do
  useful work such as explaining, proving, guiding, or differentiating.
- Important claims use truthful, specific proof rather than filler, invented
  testimonials, generic logos, unsupported numbers, or placeholder content.
- The final section, completion state, or task ending feels deliberate and leaves a
  clear next action.

### 6. Restraint and motion

**Core:** Is every additional color, type style, effect, and animation earning its
place through meaning, feedback, orientation, or brand character?

Rendered checks:

- Each animation improves feedback, orientation, sequence, or brand expression.
- Simultaneous, repeated, scroll-driven, and decorative motions remain subordinate
  to the content and action.
- The experience remains understandable and polished with reduced motion, and motion
  stays smooth at the tested mobile viewport.

### 7. Responsive behavior and states

**Core:** Does the experience preserve its story, hierarchy, and usability across
relevant viewports and interaction states?

Design Intent prompts — answer these while designing a web page, before an
implementation or browser session exists:

- What must the first mobile viewport communicate, and which primary action must
  remain discoverable there?
- How do the hero, section order, grids, columns, cards, and supporting proof stack or
  reflow without changing the story?
- How do type scale, line length, spacing, density, imagery, and crop behavior change
  at narrow widths?
- Which desktop affordances need a touch-safe alternative, and which navigation,
  form, overlay, table, media, or sticky/fixed patterns are likely mobile risks?
- What may simplify or move later on mobile without hiding essential meaning,
  evidence, controls, or recovery paths?

For an implemented website or web app, load `chrome-mobile-test-matrix.md` after
browser preflight verifies `browser_automation = enabled` when the task can affect
responsive behavior. Its named viewports and interaction paths are the required
operational mobile pass; otherwise record `CHROME_NOT_VERIFIED` and manual checks.
The general checks below do not replace the matrix when it can run.

Rendered checks:

- Mobile preserves the story order with no overflow, clipping, tiny targets, awkward
  wrapping, or interaction that depends on hover.
- Wider screens keep intentional content widths and whitespace instead of becoming
  stretched, sparse, or disconnected.
- Where applicable, default, hover, focus, active, disabled, loading, empty, error,
  and success states are coherent and visually distinguishable.

### 8. Accessibility, performance, and final craft

**Core:** Is the design readable, accessible, fast-feeling, and complete without
sacrificing the original user intent or existing behavior?

Rendered checks:

- The critical path works by keyboard with visible focus, and color is not the only
  carrier of meaning.
- Contrast, readability, zoom behavior, semantics, and touch-target size are
  acceptable in the rendered experience.
- The page feels fast, stable, and responsive, without obvious layout shift,
  blocking media, janky effects, or visual weight that exceeds its value.
- No final craft defects remain: misalignment, inconsistent edges, accidental gaps,
  widows, truncation, placeholders, broken assets, or unfinished copy.
- Visual changes preserve the original task, application behavior, guards, and
  product constraints rather than merely making the surface look more polished.

## Rendered Change → Observe Loop

Use this only after `browser-live-analysis` verifies `browser_automation = enabled`.

1. Start the target app and identify the visual target from the spec, reference, or
   user description.
2. For a broad redesign, capture a baseline against the Canonical Review Checklist.
   For a narrow fix, identify the categories the change can affect.
3. Make one focused presentation-layer change.
4. Navigate or interact to render it, then capture a screenshot or inspect the DOM,
   computed styles, accessibility tree, console, and network evidence relevant to
   the claim.
5. Compare the observation with the target. Diagnose from the rendered evidence,
   correct the failed item, and repeat.
6. Before visual convergence, run every applicable rendered check at the primary
   desktop and mobile viewports and any task-specific breakpoint or state.
7. Record remaining items as `N/A`, an explicit user-approved tradeoff, or an
   out-of-scope seam; never turn an unobserved claim into a pass.

Do not run the complete checklist after every small edit. Use the current failed
item as the hot-loop target, then run the full pass at convergence.

If Programmer's ambient fast-feedback watcher
(`harness-engineering/quality/programmer-fast-feedback.md`) is running, do not let its
output interrupt the hot Change → Observe loop. Consume its stable-failure signal
during Reconciliation And Handoff.

## Convergence And Pass Budget

- One complete Design Intent or rendered checklist pass is required at convergence.
- Run a second complete pass only when the first pass caused a material revision,
  reconciliation changed visible behavior, or the user requested another example
  or critique round.
- Do not run more than two complete review passes without explicit user approval.
  Focused Change → Observe corrections inside a pass do not count as additional
  complete passes. Track this separately from the Web Design persona's optional
  concept-critique pass budget.
- Classify unresolved items as a blocker (clarity, usability, accessibility, or
  behavior), a quality issue, or optional polish. After two passes, stop cosmetic
  cycling: diagnose the underlying constraint and ask for direction when a blocker
  cannot be resolved within scope.
- Converge when blockers are resolved and every remaining item is an explicit
  user-approved tradeoff, an out-of-scope seam, or optional polish that does not
  justify another pass.

## Reconciliation And Handoff

After the rendered result is visually correct:

1. Run the relevant type checker, linter, tests, and accessibility checks.
2. Re-open the final browser state after reconciliation fixes.
3. Report the route and viewports observed, the meaningful visual evidence, the
   reconciliation results, and any unresolved tradeoffs or manual checks.

When only Design Intent mode was possible, label the result as design-reviewed but
not rendered-verified. Do not claim that a page “looks correct” from static code or
a design spec alone.
