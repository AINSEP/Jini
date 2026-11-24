# find

Find-in-page for a desktop renderer that hosts embedded `<webview>` guests: the find bar's state
machine, routing a query to whichever surface is on screen (a guest, or the window's own top-level
page through a host bridge), and the focus reclaim that keeps the bar typeable while Chromium's
finder keeps moving keyboard focus away from it. `find-target.ts`'s header carries the measured
Chromium behaviour behind every rule here.

- `find-query-scheduler.ts` — typing-settle scheduler (also exported from `./core`).
- `find-bar-state.ts` — reducer, surface-change close rule, match-count formatting (copy injected).
- `find-target.ts` — target resolution, `runFind`/`stopFind`, two-source result subscription.
- `find-input-focus.ts` — blur-then-focus restore and the reclaim-window decisions.
- `find-focus-clock.ts` — the clock/frame/timer port and its live browser wiring.
- `use-find-*.hooks.ts` — the four hooks a host composes into its own find hook.

## Wiring

Import from `@jini-ai/ui/find`. No Jini component imports these hooks; the host calls them.

The host composes `useFindBarState` → `useFindFocusReclaim` → `useFindBarEffects` →
`useFindInputBinding` inside its own find hook (passing each the refs the previous returned) and
hands the result to its own find bar component. The host injects:

- `bridge: FindBridge | undefined` — its preload bridge's find slice (`onFindToggle`, `findInPage`,
  `stopFindInPage`, `onFindResult`). The IPC channel names behind it stay in the host's contracts.
- `clock: FindFocusClock` — `liveFindClock` in production, a manual clock in tests.
- `activeGuestId` — the visible guest's id, or `null` for the window's own page; each mounted guest
  element is registered through `useFindBarState`'s `registerGuest`.
- `createQueryScheduler` (optional, on `useFindBarState`'s second argument) — defaults to
  `createFindQueryScheduler`.
- Copy: `formatFindMatchCount({ result, labels: { noResults, matchOf } })` — the host owns the
  counter text.
