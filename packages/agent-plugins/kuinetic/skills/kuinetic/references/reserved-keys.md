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
