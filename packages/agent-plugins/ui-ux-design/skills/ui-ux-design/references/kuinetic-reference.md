# kUInetic Reference

> Maintained in AI-Dev-Shop. Downstream copies are synced from here; edit it in
> AI-Dev-Shop, not in a downstream copy.

Attribute and effect lookup for kUInetic, the declarative `data-kui` animation library.
`ui-animation.md` owns when to use it and the motion rules; this file only lists what
exists. Not a tutorial.

**Authority:** the kUInetic source, package `kuinetic` v0.2.4 (MIT, kuinetic.com),
checked at commit `9fc5e54` on 2026-10-30. Every name below is registered in the
source; each group's `Source:` line is a path inside the kUInetic repo. Where the docs
and the source disagree, this file follows the source.

**Version lag:** a vendored bundle (e.g. `<theme>/vendor/kuinetic/kuinetic.js`) can be
older than the source. Before relying on a recent option (`direction:rise-mask`, the
`from:` event source, `wide:`/`narrow:`), grep the shipped bundle for it. Use
`kuinetic.describe('<effect>')` in the page only for effect parameters; it does not list
reserved keys, gates or event-source syntax, which live in the parser. An unknown effect is skipped; an unsupported
parameter or value may fall back to its default, and an invalid breakpoint gate is dropped
so the effect runs at every width. Nothing throws, and diagnostics appear only with a
reporter (see Dev warnings).

## Detect

kUInetic is present when any of these hold:

- markup carries `data-kui` (authored) or `data-kui-fx` / `data-kui-state` (stamped at runtime)
- the page loads `kuinetic.js`, `kuinetic.all.js`, `kuinetic.min.js` or `kuinetic.all.min.js`,
  or the theme ships a `vendor/kuinetic/` folder
- `package.json` depends on `kuinetic`, or code imports `kuinetic`, `kuinetic/css`, `kuinetic/advanced`
- `window.__kuinetic` (the auto-started animator) exists in the running page

Source: `src/browser/boot.ts`, `src/core/attrs.ts`, `package.json`.

## Install And Initialise

| Setup | How |
|---|---|
| Split bundle (preferred: CSS still works if JS fails) | `<link rel="stylesheet" href="kuinetic.css">` + `<script src="kuinetic.js"></script>`. Auto-starts at `DOMContentLoaded` with `observe: true`; the animator is `window.__kuinetic`. |
| One tag | `kuinetic.all.js` / `kuinetic.all.min.js` (CSS embedded, same auto-start). |
| Manual start | `data-kui-manual` on the script tag, then `kuinetic.kuinetic({ observe: true }).start()`. |
| npm / bundler | `import { kuinetic } from 'kuinetic'`, `import 'kuinetic/css'`, `kuinetic({ observe: true }).start()`. An import never auto-starts. |
| Dev warnings | Pass `reporter: consoleReporter()` in the options; the default reporter is silent. |
| Pre-JS hide | `<html data-kui-cloak>` hides cloaked entrances until start; fails open (start, watchdog, CSS release). |

Never start a second animator beside an auto-started bundle. Pass custom options before
auto-start, or use `data-kui-manual` and create exactly one animator; a factory call with
options after the page has been scanned creates a second animator. Source: `README.md`, `src/browser/boot.ts`,
`src/css/base.css`, `src/core/reporter.ts`.

## Attribute Grammar

```html
<h2 data-kui="fade-up 700ms 120ms ease-out distance:16px, blur-in 400ms at:-200ms">
```

- First token is the effect; then positional **duration → delay → easing**, or
  `duration:` / `delay:` / `ease:`. Effect parameters are `key:value`.
- Comma-separate effects whose channels don't collide. A collision keeps the first and warns.
- Quote any value containing spaces or commas: `target:'.stops > li'`.
- Named bundle: `<template data-kui-define="card-in" data-kui="fade-up 700ms, blur-in 400ms at:-200ms">`,
  then `data-kui="card-in 300ms"`. Local values override the bundle.
- Longhand attributes (an inline key wins): `data-kui-on`, `data-kui-timeline`,
  `data-kui-threshold`, `data-kui-stagger`. Timing has no longhand. Set reduced motion
  with the `rm:` key.
- Stamped by the runtime; read, never author: `data-kui-fx`, `data-kui-state`,
  `data-kui-unmatched`, `data-kui-part`, `data-kui-rm` (the compiled reduced-motion policy).

Source: `src/core/parse.ts`, `src/core/attrs.ts`, `src/core/bundles.ts`.

## Reserved Keys

| Key | Values |
|---|---|
| `on:` | `enter` (once, default for reveals), `leave`, `load`, `manual`, `hover`/`unhover`, `focus`/`blur`, `click`, any DOM event (`invalid`, `submit`, `cart:updated`), or a forward/back pair `hover/unhover`, `enter/leave`. |
| `data-kui-on="click from:#copy-btn"` | Listen on another element. Longhand only. |
| `actions:` | Four scroll crossings, slash-separated: `play` `pause` `resume` `reverse` `reset` `restart` `complete` `none`. |
| `threshold:` | Fraction visible before `enter` fires: `threshold:30%`. Default `0%`. |
| `timeline:` | `time` (default), `view`, `scroll`, `pin`. Range: `data-kui-timeline="view entry 0% cover 60%"`. |
| `at:` | Relative to the previous effect: `-200ms`, `+100ms`, `after`, `with`, `with+150ms`. |
| `repeat:` / `yoyo:` | Total plays or `infinite`; `yoyo:true` alternates. |
| `above:` / `below:` | Viewport gate on `sm` `md` `lg` `xl` `2xl`. `wide:` / `narrow:` gate the same scale against the nearest `data-kui-container` ancestor. |
| `cascade:` / `spread:` | Group stagger step, or total budget, on the **parent** (or `data-kui-stagger="90ms"`). |
| `order:` / `cols:` / `along:` | `start` `end` `center` `edges` `random`, a child index, or an `x/y` point; `cols:6` or `cols:auto`; `along:x`/`along:y`. |
| `target:` / `scope:page` | Animate matching descendants (or page matches) instead of the host. |
| `rm:` | Reduced-motion policy, mildest to strictest `shorten`, `crossfade`, `disable`; may only be stricter than the effect's own. |
| `func:` | Global function run on `kui:finish`. Never build it from CMS or user input. |

`stagger:` on the split-text effects is the gap between generated pieces, not the group
`cascade:`. Source: `src/core/parse.ts`, `src/core/activation.ts`,
`src/core/event-sources.ts`, `src/core/types.ts`, `src/core/repeat.ts`, `src/core/breakpoints.ts`,
`src/core/stagger-config.ts`, `src/core/target.ts`.

**Easing keywords:** `linear` `ease` `ease-in` `ease-out` `ease-in-out` `step-start`
`step-end` `expo-in` `expo-out` `expo-in-out` `back-in` `back-out` `back-in-out`
`quart-out` `circ-out` `spring` `bounce`; functions `cubic-bezier()` `steps()` `linear()`
`spring(bounce:0.3)` / `spring(stiffness:400 damping:20 mass:1)` (`bounce` 0–0.85; the
spring shapes the curve, your duration still holds). Source: `src/core/parse.ts`, `src/core/easing.ts`.

**Events and API:** `kui:start`, `kui:finish`, `kui:reverse-finish`, `kui:cancel` bubble
with `detail { effects, activation, timeline, reason }`. `kui` is `window.__kuinetic` under a
script tag, or what `kuinetic(...).start()` returns: `kui.play(target, effect, options)`,
`kui.activate(el)`, `kui.deactivate(el)`, `kui.control(target)` (`pause` `play` `reverse`
`seek(0..1)` `timeScale`, `progress`, `state`), `kui.process(el)`, `kui.reset(el)`.
JS-rendered and scroll-driven effects expose no playhead. Source: `src/core/control.ts`,
`src/core/animator.ts`.

## Effects By Family

Defaults are the source defaults; override per element.

| Family | Names | Source |
|---|---|---|
| Entrance | `fade-in` `fade-up` `fade-down` `fade-left` `fade-right` `slide-up` `slide-down` `slide-left` `slide-right` `slide-inline-start` `slide-inline-end` `slide-block-start` `slide-block-end` `zoom-in` `zoom-in-up` `zoom-in-down` `pop-in` `flip-in-x` `flip-in-y` `rotate-in` `roll-in` `swing-in` `blur-in` `fade-blur-up` `fade-blur-in` `back-in-up` `back-in-down` `bounce-in` `reveal-once` (same as `fade-up`). Base default `600ms ease-out`, `distance:24px`. Preset exceptions: `slide-*` use `distance:100px` (no fade); `back-in-up`/`back-in-down` use `120px` with `expo-out`; `pop-in` uses scale 0.6 with `back-out`; `bounce-in` starts at scale 0.3 and uses the multi-peak `bounce` curve. | `src/effects/catalog/core.ts` |
| Exit | `fade-out` `fade-out-up` `fade-out-down` `fade-out-left` `fade-out-right` `slide-out-up` `slide-out-down` `slide-out-left` `slide-out-right` `zoom-out` `pop-out` `blur-out` | `src/effects/catalog/core.ts` |
| Scroll-linked | `parallax-y` `parallax-x` `parallax-scale` `parallax-rotate` `depth-layer` `scroll-fade` `scroll-desaturate` `scroll-skew` `scroll-progress-bar` `scroll-progress-bar-y` `scroll-progress-ring`. Use `timeline:view`/`scroll`; duration is meaningless there. | `src/effects/catalog/core.ts` |
| Pin and scroll mechanics | `pin-section` (`distance:100vh`, `offset-top:`, `spacer:true`) `pin-until` `pin-spacer` `stacking-cards` `horizontal-scroll` `scrollytelling-step` (`steps:`, `target:` stamps `data-kui-step-state` before/active/after and `--kui-step`) `scroll-progress` `sequence-scrub` `video-scrub` `scroll-snap-x` `scroll-snap-y` `scroll-spy` `smooth-scroll-to`. Set `--kui-pin-offset` on `:root` to clear a fixed header. | `src/effects/scroll-mechanics/presets.ts` |
| Text split | `split-chars` (30ms) `split-words` (90ms) `split-lines` (160ms), `direction:fade\|up\|down\|mask\|rise-mask`, `unit:`, `stagger:`; presets `text-reveal-up` `text-reveal-down` (words) `text-reveal-mask` (lines, mask). `rise-mask` slides each unit up 120% inside a stationary clip. `--kui-mask-bleed: 0.1em` protects ascenders under tight leading. | `src/effects/catalog/text.ts`, `text-shared.ts` |
| Text other | `typewriter` `typewriter-loop` `scramble` `decode` `glitch` `word-cycler` `highlight-sweep` `underline-draw` `gradient-shimmer` `gradient-sweep` `text-outline-fill` `text-wave` `text-jitter` `marquee` `marquee-scroll-linked` `redaction-reveal` `text-3d-extrude` `var-weight` `var-width` `var-slant` `var-axis` | `src/effects/catalog/text.ts` |
| Media reveal | `wipe-up` `wipe-down` `wipe-left` `wipe-right` `wipe-circle` `wipe-diagonal` `mask-reveal` `curtain-reveal` `before-after-wipe` `ken-burns` `ken-burns-out` `blur-up` `image-parallax-frame` `slat-assemble` `duotone-hover` `grayscale-hover` `saturate-hover` `bg` `background` `video-backdrop` `video-hero` | `src/effects/catalog/media.ts` |
| Hover and press | `lift` (220ms, `distance:6px`) `lift-shadow` `pop` (`scale:1.06`) `shine-sweep` `split-flap` `border-draw` `border-glow` `beam-border` `underline-slide` `underline-center` `icon-wiggle` `icon-spin` `icon-bounce` `tilt-3d` `tilt-parallax` `cursor-follow` `cursor-lag` `cursor-label` `cursor-spotlight` `cursor-invert` | `src/effects/catalog/interaction.ts` |
| Press, group, reveal-on-hover | `press-depth` (120ms, `scale:0.96`) `group-dim`; `masked-label-swap` `masked-label-swap-x` `masked-label-swap-diagonal` `hover-intent` `anchored-preview` `anchored-preview-bottom` `anchored-preview-left` `anchored-preview-right` `search-expand`; `proximity-glow` `proximity-field` | `interaction-states.ts`, `interaction-reveal.ts`, `interaction-proximity.ts` (all `src/effects/catalog/`) |
| Feedback | `skeleton-shimmer` `skeleton-to-content` `spinner` `spinner-dots` `spinner-ring` `progress-indeterminate` `toast-slide-in` `toast-slide-out` `shake-error` `wobble` `ripple` `badge-pop` `count-bump` `heart-burst` `confetti-burst` `copy-confirm` `pull-to-refresh` | `src/effects/catalog/feedback.ts` |
| Numbers | `count-up` (1600ms, `from:` `to:` `decimals:` `format:` `currency:`) `count-down` `count-currency` `count-percent` `count-compact` `odometer-roll` `progress-ring` `progress-bar` `progress-segments` `gauge-sweep` `star-rating-fill` `sparkline-draw` `donut-sweep` | `src/effects/catalog/numbers.ts` |
| Forms | `label-float` `input-underline-grow` `focus-ring-grow` `validate-shake` `validate-check` `strength-meter` `toggle-morph` `checkbox-draw` `radio-fill` `range-fill` `submit-to-spinner-to-check` `step-progress` `carousel` | `src/effects/forms/index.ts` |
| SVG and icons | `draw-stroke` `draw-signature` `draw-underline` `checkmark-draw` `cross-draw` `chart-line-draw` (`length:` sets path length); toggles `hamburger-to-x` (`aria-expanded`) `play-to-pause` (`aria-pressed`) `plus-to-minus` (`aria-expanded`) | `src/effects/svg/index.ts` |
| Layout (FLIP) | `flip-reorder` `flip-filter` `flip-sort` `flip-shuffle` `accordion-height` `expand-to-modal` `grid-to-list` `tab-indicator-slide` `masonry-reflow`. Motion only; you own `aria-expanded`, focus, keys. | `src/effects/layout/presets.ts` |
| Open/close from `display: none` | `fade-open` `pop-open` `scale-open` `drop-open` `slide-open-up` `slide-open-down` (`@starting-style`). Each stays hidden until opened: native `<dialog>` and popovers open through their own APIs (`[open]`, `:popover-open`); for an ordinary element, toggle the presence of `data-open` | `src/effects/catalog/discrete.ts` |
| Page and view | `page-morph` `view-swap` (View Transitions); `page-fade` `page-slide` `curtain-wipe` `loading-bar` | `src/effects/catalog/view-transitions.ts`; `src/effects/three-d/index.ts` |
| Navigation | `header-shrink` `header-hide-on-scroll` `menu-stagger-open` `menu-fullscreen` `dropdown-open` `drawer-slide` `mega-menu-drop` `back-to-top-fade` | `src/effects/navigation/index.ts` |
| CSS 3D (core entry) | `card-flip-x` `card-flip-y` `cube-rotate` `fold-panel` `flip-card` `book-page-turn`; ring/stack carousels `carousel-3d` `carousel-stack` | `src/effects/three-d/index.ts`, `src/effects/carousel/` |
| Ambient loops | `glow-pulse` `aurora` `gradient-mesh` `gradient-border` `gradient-rotate-border` `float` `bob` `orbit` `floating-shapes` `starfield` `dot-grid-drift` `line-grid-drift` `scanline` `spotlight-follow` `wave-blob`; `beam-border-auto` (runs unconditionally and loops forever) | `src/effects/catalog/ambient.ts`; `beam-border-auto` in `src/effects/catalog/interaction.ts` |
| Gestures | `drag` `drag-x` `drag-y` `drag-inertia` `throwable` `elastic-pull` `rubber-band` `snap-back` `swipe` `swipe-x` `swipe-y` `long-press` `magnetic` `magnetic-snap` | `src/effects/gestures/index.ts` |
| Generic tween | `tween` (to values) `tween-from` (from values): `tween x:100 opacity:0 rotate:45deg 800ms` | `src/effects/tween/index.ts` |
| Showcase widgets | `lightbox` `video-lightbox` `compare` `carousel-fade` `carousel-slide` `video-hero-slideshow` `scroll-story` `hotspots` `device-frame` `slow-mo` | `src/showcase/` |
| Paths, material | `motion-path` `path-arc` `path-loop` `path-swoop` `path-wave`; `glass`; `rotate-static` | `src/effects/motion-path/index.ts`, `src/effects/catalog/materials.ts`, `src/effects/catalog/transforms.ts` |

Catalog note (`docs/catalog.md` §I): every hover effect ships a `:focus-visible`
equivalent and a coarse-pointer fallback.

## Reduced Motion

Each effect declares a policy; the runtime stamps it as `data-kui-rm`, and
`src/css/base.css` applies it under `prefers-reduced-motion: reduce`:

- `shorten`: CSS animations run at 1ms with no delay. Entrances, hover, feedback, counters.
  JS counters instead finish in one timer tick (~16ms) after any authored delay.
- `crossfade`: replaced by a 200ms fade. No effect defaults to it; opt in with `rm:crossfade`.
- `disable`: no animation; the element is forced to its end state (`opacity: 1`, no
  translate/scale/rotate/filter/offset-path). Split text, typewriter, scramble, pins,
  parallax, scroll progress, ambient loops, spinners, cursor and tilt effects, gestures, FLIP layout,
  `toggle-morph`.
- CSS transitions on every marked element shorten to 1ms under every policy.
- A skipped effect still emits `kui:finish` with `reason: 'reduced-motion'` (no `kui:start`),
  so chained work still runs.
- The animator option `reducedMotion: 'ignore'` exists for demos and tests only.

Source: `src/core/types.ts` (`ReducedMotionPolicy`), `src/core/animator.ts`,
`src/core/host-facts.ts`, `src/css/base.css`; per-effect policy is each primitive's
`reducedMotion` field.

## Opt-In Tiers

| Tier | Load | Names |
|---|---|---|
| Advanced (experimental, WebGL2 / Canvas / Web Audio, API may change without a major) | `<script src="kuinetic.advanced.js">` beside core, either order; or `registerAdvanced(k)` from `kuinetic/advanced` (or `registerShaders`, `registerScenes`, `registerCamera`, `registerParticles`, `registerFluidCursor`, `registerAudio`). No CSS file. | `shaders` `shader-displace` `shader-fluid` `fluid-pointer` `shader-liquid` `liquid-distort` `shader-particles` `particle-field` `shader-morph` `image-morph` `shader-gradient` `gradient-liquid` `gradient-bands` `gradient-holo` `shader-logo` `logo-gradient`; `scene` `scene-step`; `camera-scene` `camera-layer`; `particle-dissolve`; `fluid-trail` `cursor-fluid` `fluid-cursor`; `audio-source` `audio-reactive` `audio-mic` |
| 3D model | Not published: `src/3d/` is absent from the package `exports` and its renderer is not built. Do not use. | `model-3d` |
| Notes | Optional `kuinetic.notes.js`, only to add plain-words notes to `describe()` output. | none |

Every advanced primitive declares `reducedMotion: 'disable'`. Generative shaders bake one
still frame, `scene` holds its final frame, and `camera-scene` renders a stationary
composition. Source: `src/advanced/index.ts` and its modules,
`docs/advanced-modules.md`, `src/3d/index.ts`.

## Gotchas

- A hidden element (`display: none`, a closed `<dialog>` or popover) cannot trigger a visible entrance while closed, and `on:enter` may fire only once it opens. For opening transitions, especially repeated ones, prefer the open/close family.
- Split, typewriter and scramble skip a host that contains a link or control; put them on a leaf.
- Author counters with the final value as text (`<b data-kui="count-up to:237">237</b>`).
- `repeat:infinite` is dropped on `view`/`scroll`/`pin` timelines. A `view` timeline stalls while pinned; use `timeline:pin`.
- `submit-to-spinner-to-check` runs on fixed timers (`load:1200ms`, `hold:1500ms`) with no error stage; it is a demo, not request state.
- `copy-confirm` fades 0 → 1 → 0 over 1400ms and ends hidden; put it on the status label, not the button. Under reduced motion it inherits `shorten`, runs in about 1ms and ends at opacity 0, so the app must keep its own visible "Copied" status for the hold period.
- `above:`/`below:` accept only the five named breakpoints. `above:900px` is invalid, and the gate is dropped, so the effect runs at every width.
