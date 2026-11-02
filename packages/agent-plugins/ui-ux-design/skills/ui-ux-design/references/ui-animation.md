# UI Animation

> Maintained in AI-Dev-Shop. Downstream copies are synced from here; edit it in
> AI-Dev-Shop, not in a downstream copy.

Use this reference when implementing any animation: scroll reveals, text reveals,
transitions, pinned or scroll-linked sections, or micro-interactions.

This file owns **how** to animate: library choice, implementation defaults, and
micro-interaction recipes. It does not restate what siblings own:

- `delight-and-motion.md`: where delight belongs, intensity, microcopy.
- `ui-loop.md`: the final restraint and motion review (category 6) and the
  accessibility baseline (category 8), including "understandable with reduced motion".
- `components-and-states.md`: which states each component needs and its interaction
  rules (feedback timing, optimistic vs confirmed feedback).
- `foundations.md`: motion duration and easing as design tokens.
- `kuinetic-reference.md`: kUInetic syntax and every effect name used below.
- The `impeccable` skill's `reference/animate.md`, when installed: the motion thesis,
  choosing material by meaning, the duration-by-consequence table, and the default
  arrival curve. Use its numbers; this file does not repeat them.

## Library Choice: kUInetic First

1. **Detect kUInetic before writing any motion.** Use the signals in
   `kuinetic-reference.md` → Detect: `data-kui` in markup, a `vendor/kuinetic/` folder,
   a `kuinetic*.js` script tag, the `kuinetic` package, or `window.__kuinetic`.
2. **Present: use its attributes.** Express every effect the catalog names as `data-kui`.
   Do not hand-write CSS or JS for an effect it provides. Do not load GSAP, Motion,
   AOS, Animate.css or any second animation library for something it covers.
3. **Extend before escaping.** Compose effects with commas, sequence them with `at:`,
   name repeated compositions with `data-kui-define`, retarget with `target:`, and use
   `tween`/`tween-from` for supported properties outside a named preset (it has a fixed
   property list that excludes `width`, `height`, `top`, `left` and skew) before writing
   custom code.
4. **No matching effect: native CSS.** Transitions, `@keyframes`, `@starting-style`,
   View Transitions, or scroll-driven `animation-timeline` behind `@supports`. Reuse the
   same duration and easing tokens. Never animate a property a `data-kui` effect already
   owns on the same element.
5. **Absent: native CSS first.** Propose adding kUInetic only when the surface needs
   several of its effects and adding a dependency is in scope; never for one effect.
6. **Vendored copies lag.** Confirm a recent option exists in the shipped bundle before
   using it (`kuinetic-reference.md` → Version lag).

## Implementation Defaults

### Timing And Easing

- With kUInetic, keep its per-effect defaults (entrance 600ms `ease-out`, hover 220ms,
  press 120ms, counters 1600ms). Override per element only to match a project token.
- Without it, take durations from impeccable's table and store them as tokens.
- Match the curve to direction: entering decelerates (`ease-out`, `expo-out`,
  `quart-out`); leaving accelerates (`ease-in`); moving between two on-screen states
  uses `ease-in-out`; `linear` only for continuous rotation, progress, and scrubbing.
- Overshoot (`back-out`, `spring(bounce:…)`) only on small, rare confirmations such as a
  badge or count bump, never on layout or page-level motion.
- Entrance travel 8–24px. Longer travel reads as slow, not premium.

### Staggering

- Stagger only siblings that read as a list or grid. To start the group together, put
  the effect on the parent with `target:`: `data-kui="fade-up target:'.card' cascade:60ms"`.
  The matched children share one activation. `data-kui-stagger` alone only sets delays;
  children with their own `data-kui` keep their own triggers.
- Step 30–90ms per item. For a list of unknown length, budget the total with
  `spread:` (≤ 600ms) instead of a per-item step.
- Split text: keep kUInetic's unit defaults (chars 30ms, words 90ms, lines 160ms).
  Prefer lines or words for headlines; chars only for short display text.
- Use `cols:` with `order:center` only when the grid reads two-dimensionally.

### Scroll Reveals

- Reveal once (`on:enter`). Use `enter/leave` only for decoration, never for content.
- Fire when a meaningful part is visible: `threshold:10%`–`30%` (kUInetic default `0%`).
- Never delay or hide the hero heading, LCP image, or anything visible at load.
- Content must render without JS. With kUInetic, opt into `<html data-kui-cloak>`,
  which fails open. Hand-written: for a JS-driven reveal, set the hidden from-state only
  under a class that JS adds, never in base CSS. `@supports` alone does not fail open,
  because it stays true when scripts fail; use it alone only when a complete CSS
  animation also restores visibility.
- Pick one reveal (effect, distance, duration) per page and repeat it; do not invent a
  new entrance per section.
- A hidden element (`display: none`, a closed `<dialog>` or popover) cannot trigger a
  visible entrance while closed. For opening transitions, especially repeated ones, use
  the open/close family (`fade-open`, `pop-open`) or `@starting-style`.

### Pinned And Scroll-Linked Sections

- Trigger (time-based, plays on enter) by default. Scrub (`timeline:view`, `scroll`, `pin`)
  only when scroll position is the meaning: progress, scrollytelling steps, before/after.
- Each pinned viewport of `distance:` must deliver a new step. Budget 1–2 viewports per
  idea; long pins read as broken scroll.
- Clear fixed headers once with `--kui-pin-offset` on `:root`, not per pin.
- Animate inside a pin with `timeline:pin`; a `view` timeline stalls while pinned.
- Pins, `horizontal-scroll`, and `stacking-cards` fight touch scrolling on phones: gate
  them with `above:md` and give the narrow layout a stacked fallback. Check short
  viewports with `chrome-mobile-test-matrix.md`.

### Reduced Motion

The baseline is `ui-loop.md`. Animation-specific rules:

- Set a policy per effect, not one global `0.01ms` kill. In kUInetic, `rm:` and the
  resolved policy apply to the whole attribute, including its `target:` groups, and the
  strictest policy wins; put effects that need different policies on separate elements. Short state feedback is
  shortened or crossfaded so the change is still visible; spatial, continuous,
  parallax, pinned, autoplaying, and scroll-linked motion is disabled to its end state.
- Never strand an element at its from-state (`opacity: 0`, offset).
- kUInetic applies this automatically (`kuinetic-reference.md` → Reduced Motion).
  Tighten one element with `rm:`; do not add your own overrides on `data-kui` elements.
- A disabled spinner or skeleton shimmer still needs a non-motion loading signal: text,
  `aria-busy`, or a static placeholder.
- Do not hang logic on `animationend` or `kui:start`. kUInetic still emits `kui:finish`
  (`reason: 'reduced-motion'`) for skipped effects; hand-written code must too.
- JS-driven motion reads `matchMedia('(prefers-reduced-motion: reduce)')` and listens
  for its `change` event. kUInetic's CSS responds live, but its JS policy is a startup
  snapshot: to honour a mid-session change, the app tears the animator down and recreates
  it with fresh capabilities (`capabilities: detect(true)`).

## Micro-Interactions

States come from `components-and-states.md`; the recipes below only say how each one
moves. Durations are ranges; pick one per project and tokenise it.

| Interaction | What moves | Duration / easing | Reduced motion | kUInetic | Without kUInetic |
|---|---|---|---|---|---|
| Hover | 2–6px lift, tint, underline, or sheen | 150–220ms `ease-out` | Shortened; color change stays | `lift` `lift-shadow` `pop` `underline-slide` `shine-sweep` `border-glow` | `transition` on `translate`/`background-color` inside `@media (hover: hover)` |
| Press / active | Scale to 0.96–0.98 or 1–2px down | 80–120ms in, ~150ms release, `ease-out` | Instant | `press-depth`; `ripple` for centered click feedback (it scales from the center, not from the pointer) | `:active { scale: 0.97 }` with a short transition |
| Focus-visible | Ring appears; optional grow | ≤150ms `ease-out` | Ring shown at once | `focus-ring-grow`; hover effects ship focus-visible twins | `:focus-visible` outline plus `outline-offset` transition |
| Loading | Spinner rotation, shimmer, indeterminate bar | Show after ~300ms; rotate 700–1000ms `linear` | Static placeholder plus text | `spinner` `spinner-dots` `spinner-ring` `skeleton-shimmer` `progress-indeterminate` | `@keyframes` rotate; delayed reveal via class |
| Loading → content | Content fades in where the skeleton was | 200–300ms `ease-out` | Instant swap | Replace the skeleton through application state; put `skeleton-to-content` on the content node and start it with `kui.activate(el)` when data lands (it fades the content in; it does not crossfade from the skeleton) | Opacity transition on a `data-loaded` attribute |
| Success | Check draws or label fades in, holds | 200–400ms `ease-out` | Instant | `validate-check` `checkmark-draw` `badge-pop` | `stroke-dashoffset` keyframes |
| Error | One small horizontal shake | 300–500ms, once | No shake; icon, message, color | `shake-error` (`data-kui-on="invalid"`) `validate-shake` | `translate` x keyframes, ≤ 6px |
| Toggle / switch | Thumb slides; track color crossfades | 150–250ms `ease-in-out` | Instant; position still shows state | `toggle-morph` (checkbox + `.kui-track > .kui-thumb`) `checkbox-draw` `radio-fill`; `hamburger-to-x` `plus-to-minus` keyed to `aria-expanded` | `:checked ~ .track` transition on `translate` |
| Counter / ticker | Number counts to its value; bump on change | Count 800–1600ms `ease-out`; bump 200–300ms `back-out` | Final value shown | `count-up` `count-currency` `count-percent` `count-compact` `odometer-roll`; `count-bump` on updates | rAF tween of the text with `font-variant-numeric: tabular-nums` |
| Copy to clipboard | Label or icon swaps to "Copied", holds 1–2s, reverts | 150ms fade in, ~200ms out | Instant swap; the app keeps "Copied" visible for the hold | The app owns a visible "Copied" status for the hold period; `copy-confirm` (`data-kui-on="manual"`, `kui.activate(label)` after `writeText()` resolves) is extra animation only, since under reduced motion it runs in ~1ms and ends hidden | Toggle a `data-copied` attribute and transition opacity |
| Optimistic UI | Result applies at once; list items move into place | FLIP 200–300ms `ease-out` | Instant reorder | `flip-reorder` `flip-filter` `flip-sort`; `count-bump` for counts | FLIP with `translate`, or the View Transitions API |

Recipe rules:

- Count and copy confirmations announce through an `aria-live="polite"` region; the
  motion is not the announcement. kUInetic counters already expose the final value.
- Author counters with their final value as text, never `0`.
- Show a copy or optimistic failure as visibly as the success: revert the change, then
  give the error state its own motion and message.
- `submit-to-spinner-to-check` runs on fixed timers with no error stage. Drive real
  request state yourself.
- Celebration effects such as `heart-burst` or `confetti-burst` follow
  `delight-and-motion.md`; never add them as routine feedback.

## Implementation Anti-Patterns

- Hand-writing an effect kUInetic already provides, or loading a second motion library
  beside it.
- Incidental layout animation: `width`, `height`, `top`, `left`, or margins changing as a
  side effect. Use `transform`/`opacity` or FLIP (the `flip-*` family). Expanding content
  is the deliberate exception: `accordion-height` animates measured pixel heights, and
  `grid-template-rows: 0fr → 1fr` also changes layout. For the grid trick, use one inner
  child with `min-height: 0; overflow: hidden`, and keep collapsed content out of the
  focus order separately (for example `inert`).
- `transition: all`. It animates layout, theme switches, and properties nobody chose.
- Blocking input until motion ends: disabled buttons during an entrance, ignored clicks,
  or keyframe animations that cannot be interrupted. Prefer transitions for state, which
  reverse from their current value.
- Per-item stagger with no total cap, or staggering results the user re-scans (search
  results, table rows, filtered lists).
- Scroll-driven motion on `scroll` listeners or per-frame `getBoundingClientRect()`.
  Use `animation-timeline`, IntersectionObserver, or kUInetic timelines.
- Content hidden in base CSS until a script runs, with no fail-open path.
- A spinner that flashes for operations under ~300ms, or a spinner as the only loading
  signal under reduced motion.
- Counters without tabular numerals, so the width jitters while counting.
- Scroll-jacking: replacing native scroll speed, or pins and horizontal tracks on phones
  without a stacked fallback.
