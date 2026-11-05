# OpenAI Frontend Skill Reference

Use this reference for visually led landing pages, branded demos, polished prototypes, and other frontend work where composition and art direction matter more than component count.

This reference supplies an optional composition language. `ui-loop.md` owns generic
review, `visual-storytelling.md` owns narrative sequencing, and
`delight-and-motion.md` owns contextual motion decisions.

Source note: adapted into local reference form from OpenAI's curated frontend skill on 2026-03-21 so this repo does not need to fetch it from the web during use.

## Activation Guardrail

- Hard guard: if you activate this reference, explicitly tell the user in your next reply that you are using `openai-frontend-skill.md`.
- Say why it was activated in plain language, such as landing-page composition, branded demo direction, or anti-generic UI guidance.
- Do this before presenting design direction, layout proposals, or stylistic recommendations derived from this reference.
- If the user does not want this direction, stop using this reference and fall back to the base UX skill plus the other applicable local references.

## Working Model

Before designing, define:

1. visual thesis: the mood, material, and energy
2. dominant visual plane: what carries the composition before component details
3. interaction character: how static, tactile, cinematic, or editorial it should feel

## Composition Defaults

- Start with composition before components.
- Prefer one strong visual anchor in the first viewport.
- Treat the first screen like a poster, not a document.
- Make the brand or product name the loudest text on branded pages.
- Use spacing, scale, alignment, contrast, and cropping before adding extra UI chrome.
- Default to cardless layouts unless the card itself is the interaction.

## Landing Page Sequence

Default structure:

1. hero: product or brand, promise, CTA, dominant visual
2. support: one concrete feature, offer, or proof point
3. detail: workflow, atmosphere, depth, or story
4. final CTA: start, contact, convert, or visit

## Hero Rules

- One composition only.
- Use a full-bleed image or another dominant visual plane when the brief supports it.
- Keep the text column narrow and placed over a calm visual area.
- Keep headlines readable in one glance and protect contrast and tap targets when
  text sits over imagery.
- Count sticky or fixed headers against the first-viewport budget. Do not stack
  persistent chrome above a `100vh` or `100svh` hero without accounting for it.

## Product UI Rules

For app surfaces, use restraint:

- calm hierarchy
- strong typography
- dense but readable information
- minimal chrome
- cards only when the card is the interaction

Organize product UI around:

- primary workspace
- navigation
- secondary context or inspector
- one clear accent for action or state

## Imagery Rules

- Imagery must do narrative work, not just fill space.
- Prefer strong, real-looking photography for brands, editorial, venue, or lifestyle surfaces.
- Choose crops with a stable tonal area for text.
- Avoid embedded signage, logos, or typography fighting the UI.
- If several moments are needed, use several images instead of a collage.

## Copy Rules

- Write in product language, not design commentary.
- Let the headline carry meaning, keep supporting copy short, and cut repetition
  between sections.
- Give each section one responsibility: explain, prove, deepen, or convert.

For dashboards or operational UI:

- prefer utility copy over marketing copy
- lead with status, action, scope, or decision value
- avoid homepage-style hero language unless explicitly requested

## Motion Recipe

For visually led work, explore a small set of intentional motions:

- one entrance sequence in the hero
- one scroll, sticky, or depth effect
- one hover, reveal, or layout transition

Keep the selected motions noticeable enough to support the intended atmosphere,
fast and smooth on mobile, and consistent across the page. Remove any that are
merely ornamental. This is an art-direction recipe, not a required motion count;
`ui-loop.md` owns the final restraint and reduced-motion review.

## Composition Anti-Patterns

- no cards by default
- no hero cards by default
- no boxed center-column hero when the brief wants full bleed
- no more than one dominant idea per section
- no filler copy
- no busy imagery behind text
- no split-screen hero unless one side stays visually calm
- no more than two typefaces without a reason
- no more than one accent color unless the product already has a system

## Failure Examples

Reject or revise when you see:

- generic SaaS card grid as the first impression
- strong image but weak brand presence
- strong headline but no clear action
- repeated mood-setting sections with no informational progression
- carousel with no narrative purpose
- app UI built from stacked cards instead of layout

## Source Litmus Questions

- Is the brand or product unmistakable in the first screen?
- Is there one strong visual anchor?
- Can the page be understood by scanning headlines?
- Does each section have one job?
- Are cards actually necessary?
- Does motion improve hierarchy or atmosphere?
- Would the design still feel strong if shadows and decorative polish were removed?

Do not turn these defaults into fixed numeric caps or a second acceptance checklist.
Use the UI Loop to judge whether the selected composition succeeds in context.
