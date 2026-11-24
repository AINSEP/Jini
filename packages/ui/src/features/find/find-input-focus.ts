/**
 * Puts focus back in the find input after ANY reported find result — every one of them means
 * Chromium just moved keyboard focus somewhere else.
 *
 * `TextFinder::FindInternal` runs unconditionally on a match, whichever frame it is in:
 * `ClearFocusedElement()` on the frame that was searched, then `SetFocusedFrame()` onto it. For a
 * top-level match that blurs the find input, which lives in the same document. For a guest match
 * it does the same to the GUEST frame, which — because a focused text input always holds a
 * selection (a caret is one) — takes keyboard focus away from the host input the identical way.
 * There is no way to keep focus through the search either way; it has to be restored after.
 * Without this the bar accepts exactly one character and Enter reaches nobody.
 *
 * **`blur()` first, then `focus()` — a bare `focus()` is a no-op exactly when it matters.** After a
 * guest match the host input is STILL this document's `activeElement` and `document.hasFocus()` is
 * still `true`: Chromium moved the BROWSER's keyboard routing into the guest without telling this
 * frame. `focus()` on an element Blink already considers focused changes nothing, so the browser
 * never hears that this frame wants the keys back, and every later OS keystroke lands in the guest.
 * Measured live with real OS keystrokes (the host's live find verifier's native-key phase):
 * typing "the" left "t" in the bar; a `blur()`+`focus()` between keys let every one land. Playwright's
 * `keyboard.type` never saw it — CDP delivers keys to the page it targets, not to wherever the
 * browser's focus routing points — which is why the live verifier passed while the app was broken.
 *
 * The `blur()` fires this input's own `blur` event synchronously, which `useFindInputBinding`'s blur
 * listener would otherwise read as another Chromium theft and answer with ANOTHER restore — a
 * blur/focus loop for the whole {@link FIND_FOCUS_RECLAIM_MS} window. `restoring` is raised for
 * exactly the duration of that `blur()` so the listener can ignore it.
 *
 * Not keyed on which target was asked, because that and where the result reports come apart: a
 * guest's find is rerouted to the window's own find manager once that manager exists, and only
 * then does the window report instead of the guest. Both sources took focus, so both call this —
 * see {@link subscribeToFindResults}'s `onReported`.
 *
 * @complexity O(1).
 */
export function restoreFindInputFocus({ input }: { input: { blur(): void; focus(): void } | null }, { restoring = { current: false } }: { restoring?: { current: boolean } } = {}): void {
  if (!input) return;
  restoring.current = true;
  try {
    input.blur();
  } finally {
    restoring.current = false;
  }
  input.focus();
}

/** How long after ISSUING a find a blur on the find input is treated as Chromium's own focus
 *  theft rather than the user genuinely clicking away — see {@link shouldReclaimFindFocus}. */
export const FIND_FOCUS_RECLAIM_MS = 1000;

/**
 * Whether a blur on the find input, while the bar is `open`, should be undone because it is
 * almost certainly Chromium's `ClearFocusedElement`/`SetFocusedFrame` reaction to a find this file
 * just issued — not the user clicking away. `false` once {@link FIND_FOCUS_RECLAIM_MS} has passed
 * since the last issued find (a genuine click-away has to stick), `false` when no find has been
 * issued yet (`lastFindAt: null`), and `false` when the bar is already closed.
 *
 * @complexity O(1).
 */
export function shouldReclaimFindFocus(input: { open: boolean; lastFindAt: number | null; now: number }): boolean {
  if (!input.open || input.lastFindAt === null) return false;
  return input.now - input.lastFindAt < FIND_FOCUS_RECLAIM_MS;
}

/**
 * Whether `useFindFocusReclaim`'s per-frame reclaim should restore focus again on this animation frame.
 *
 * **Why every frame, and not just once per result.** Measured live with real OS keystrokes: the
 * guest takes the keys the moment it selects its FIRST match, but its `found-in-page` only arrives
 * once it has finished COUNTING every match — 100-600ms later on a real admin page. A key typed in
 * that gap reaches the find input's `keydown` but its text is inserted into the guest instead, and
 * nothing at all — no `blur`, no `focusout`, no `document.hasFocus()` change, no main-process
 * `focus` event — fires on the host when the theft happens, so there is no signal to react to. The
 * only thing that closes the gap is re-asserting focus on every frame from the moment a find is
 * issued until it reports.
 *
 * `false` once the find has reported (`awaitingReport` — the report's own restore takes over),
 * outside {@link shouldReclaimFindFocus}'s window, and during IME composition (`composing`): a
 * `blur()` ends a composition, so reclaiming mid-composition would make the bar untypeable in any
 * input method that composes.
 *
 * @complexity O(1).
 */
export function shouldKeepReclaimingFindFocus(input: {
  open: boolean;
  lastFindAt: number | null;
  now: number;
  awaitingReport: boolean;
  composing: boolean;
}): boolean {
  if (!input.awaitingReport || input.composing) return false;
  return shouldReclaimFindFocus(input);
}
