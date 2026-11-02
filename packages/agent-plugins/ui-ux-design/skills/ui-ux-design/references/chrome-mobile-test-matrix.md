# Chrome Mobile Test Matrix

Use this reference only for an existing or implemented web surface when responsive
behavior can be observed in a verified browser session. It expands the general
mobile checks in `ui-loop.md` into a repeatable Chrome/Chromium bug sweep; it is not
standing context for design specs, native apps, or non-rendered work.

This is a whole-page mobile check, not only a navigation/forms checklist. Run **Page
And Layout** for every applicable route to verify the first-view message, hierarchy,
content flow, typography, imagery, density, and overflow. Run the navigation, forms,
overlays, and sticky/fixed sections when those patterns exist.

## Preconditions And Browser Identity

1. Run the `browser-live-analysis` preflight and continue only when
   `browser_automation = enabled`.
2. Start the project with its normal local command and open the target route through
   the configured browser provider.
3. Select Chrome or Chromium when the provider exposes a browser-engine choice.
   Record the engine actually used. If Chrome/Chromium cannot be selected, run the
   available browser pass when useful but label the result `CHROME_NOT_VERIFIED`.
4. Keep console and failed-network-request evidence available throughout the pass.

Chrome responsive emulation does not prove physical-device behavior, mobile Safari,
safe-area handling on notched hardware, soft-keyboard effects, or real touch and
performance characteristics. Call out any of those that still require a device pass.

## Required Viewport Matrix

Use project-defined supported devices when they exist. Otherwise test this default
portrait matrix:

| Profile | Viewport | Purpose |
|---|---:|---|
| Narrow phone | `320 × 568` | Exposes minimum-width overflow, wrapping, and cramped controls |
| Common Android | `360 × 800` | Exercises a common narrow Android layout |
| Common modern phone | `390 × 844` | Primary contemporary phone composition |
| Large phone | `430 × 932` | Exposes over-wide content, spacing, and stretched mobile layouts |

Also test:

- one landscape viewport, default `844 × 390`, when the surface contains navigation,
  forms, media, drawers, modals, or sticky/fixed controls
- `breakpoint - 1`, `breakpoint`, and `breakpoint + 1` around every breakpoint changed
  by the task
- one normal desktop viewport after the mobile fixes as a regression control

For each applicable route and viewport, hard-reload, wait for the stable rendered
state, capture the first viewport and full-page state when useful, then interact with
the controls rather than judging from a screenshot alone.

## Checklist

Record each item as `PASS`, `N/A`, or a defect with route, viewport, state, evidence,
and intended correction.

### Page And Layout

- [ ] No unexpected horizontal scrolling, clipped content, off-canvas text, or
      element wider than the viewport.
- [ ] The first viewport still explains the page or current task and keeps the
      primary action discoverable without crowding.
- [ ] Headings, body copy, labels, badges, prices, and buttons wrap without collision,
      truncation, or isolated words that materially weaken the composition.
- [ ] Grids, cards, tables, code blocks, carousels, and media choose an intentional
      stack, scroll, crop, or alternate mobile treatment.
- [ ] Images remain sharp, correctly cropped, and proportionate; no important subject
      or product detail disappears at the mobile crop.
- [ ] Section spacing and content density remain coherent at all four widths rather
      than merely fitting inside them.

### Navigation

- [ ] The mobile navigation trigger is visible, labeled, reachable, and large enough
      to operate without hitting adjacent controls.
- [ ] The menu opens and closes through every supported path: trigger, close control,
      backdrop, Escape, route selection, and browser navigation where applicable.
- [ ] Opening the menu applies the intended background scroll lock; closing it
      restores scroll position and focus without leaving stale overlays.
- [ ] Long navigation labels, account controls, locale selectors, and nested items fit
      or scroll without hiding the exit path.

### Forms

- [ ] Labels, help text, required indicators, values, and validation messages remain
      visible and associated with the correct controls.
- [ ] Inputs use appropriate types and do not create unintended zoom, clipping, or
      horizontal movement when focused.
- [ ] Focused controls and the primary submit action remain reachable when the viewport
      height is reduced. Treat soft-keyboard behavior as requiring a real-device pass
      when browser emulation cannot reproduce it.
- [ ] Error, disabled, loading, success, and resubmission states do not change the
      layout in a way that hides the error or action.

### Modals, Drawers, Menus, And Overlays

- [ ] Dialogs, drawers, sheets, popovers, and menus fit within the current viewport
      and keep their title, content, and close or confirm actions reachable.
- [ ] Long overlay content scrolls in the intended container without trapping the page
      at an unreachable position.
- [ ] Background scroll lock, focus containment, focus return, backdrop behavior, and
      layering remain correct at each relevant width.
- [ ] Tooltips or hover-only disclosures have a touch-accessible alternative.

### Sticky And Fixed Elements

- [ ] Sticky headers, bottom navigation, cookie banners, chat widgets, and floating
      actions do not cover content, validation messages, or each other.
- [ ] `100vh`/`100svh`/`100dvh` sections account for persistent headers and controls
      and do not strand content below an unreachable fold.
- [ ] Sticky behavior starts and ends at the intended boundaries without jitter,
      overlap, or unexpected stacking-context failures.
- [ ] Safe-area-dependent placement is either verified on suitable hardware or
      explicitly left for a device pass.

### Interaction, States, And Stability

- [ ] Critical actions work through touch-style clicks and do not depend on hover.
- [ ] Loading, empty, error, success, long-content, and realistic-data states preserve
      the mobile layout and keep recovery actions visible.
- [ ] Resizing across breakpoints and rotating to the landscape check does not leave
      stale menu, modal, scroll-lock, or layout state behind.
- [ ] Reduced-motion mode preserves meaning and removes motion that becomes distracting
      or expensive on the mobile viewport.
- [ ] No new console errors, failed requests, obvious layout shifts, janky scrolling,
      or slow blocking media appear during the tested path.

## Completion Evidence

Before claiming mobile verification:

1. Re-run every viewport and state affected by a fix.
2. Re-run the desktop control viewport.
3. Record the routes, viewport profiles, browser engine, interactive paths, defects
   fixed, remaining `N/A` or device-only items, and representative screenshots.
4. Treat any unresolved issue that blocks navigation, reading, form completion, or a
   primary action as a failed mobile pass rather than a cosmetic advisory.
