---
name: kuinetic
description: Use when a page or theme uses kUInetic (`data-kui` attributes, a `vendor/kuinetic/` folder or the `kuinetic` package) or the user asks for kUInetic motion: attribute grammar, effect names, reduced motion and opt-in tiers of the declarative `data-kui` animation library.
---

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

## Load Before Use

These files hold the rest of this reference. Load each through the host's guidance reader
(this plugin, skill `kuinetic`, the file named below) before writing markup that needs it.

| Before you | Load |
|---|---|
| choose an effect name or check its parameters | `references/effects-by-family.md` |
| write a trigger, timeline, stagger, gate, `rm:`, easing, event or API call | `references/reserved-keys.md` |
| use an advanced (WebGL, Canvas, audio) or 3D effect | `references/opt-in-tiers.md` |

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

## Gotchas

- A hidden element (`display: none`, a closed `<dialog>` or popover) cannot trigger a visible entrance while closed, and `on:enter` may fire only once it opens. For opening transitions, especially repeated ones, prefer the open/close family.
- Split, typewriter and scramble skip a host that contains a link or control; put them on a leaf.
- Author counters with the final value as text (`<b data-kui="count-up to:237">237</b>`).
- `repeat:infinite` is dropped on `view`/`scroll`/`pin` timelines. A `view` timeline stalls while pinned; use `timeline:pin`.
- `submit-to-spinner-to-check` runs on fixed timers (`load:1200ms`, `hold:1500ms`) with no error stage; it is a demo, not request state.
- `copy-confirm` fades 0 → 1 → 0 over 1400ms and ends hidden; put it on the status label, not the button. Under reduced motion it inherits `shorten`, runs in about 1ms and ends at opacity 0, so the app must keep its own visible "Copied" status for the hold period.
- `above:`/`below:` accept only the five named breakpoints. `above:900px` is invalid, and the gate is dropped, so the effect runs at every width.
