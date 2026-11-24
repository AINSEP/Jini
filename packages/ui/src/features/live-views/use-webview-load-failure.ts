/**
 * @file Telling a guest `<webview>` that failed apart from one that stalled or loaded. Split out of
 * the host's app hooks barrel (which still re-exports it) with no behaviour change.
 */
import { useEffect, useState } from 'react';

/** The fields of Electron's `did-fail-load` event this hook reads. */
export interface LoadFailureEvent {
  readonly isMainFrame: boolean;
  readonly errorCode: number;
}

/** The slice of Electron's `<webview>` this hook listens to. Structural, so this browser package
 *  never imports Electron; a real `<webview>` satisfies it, and the hook hands back the caller's
 *  own element type `G` for listeners that need more of it. */
export interface LoadFailureGuest {
  addEventListener(type: 'did-fail-load', listener: (event: LoadFailureEvent) => void): void;
  addEventListener(type: 'did-finish-load', listener: () => void): void;
  removeEventListener(type: 'did-fail-load', listener: (event: LoadFailureEvent) => void): void;
  removeEventListener(type: 'did-finish-load', listener: () => void): void;
}

/**
 * Detects a guest that is alive-but-not-answering, and tells apart the two different ways that
 * can happen — `failed`, a FACT: `did-fail-load` fired on the `<webview>`'s main frame with a
 * real error, as opposed to a normal in-flight navigation being cancelled. `stalled`, a GUESS:
 * neither `did-fail-load` nor `did-finish-load` showed up at all within `STALL_TIMEOUT_MS`, which
 * means exactly nothing — Chromium never told this hook anything either way, and the guest may
 * still be about to answer on its own. The host's workspace view treats the two accordingly: `failed`
 * swaps the guest out outright, the same way a stopped project does, because there is nothing left
 * to wait for. `stalled` only lays a recovery panel over the still-loading guest, because there
 * might be.
 *
 * Two Electron quirks make `isMainFrame`/`errorCode` filtering load-bearing rather than optional.
 * `did-fail-load` fires for sub-resources too — a missing favicon, a failed XHR inside the admin —
 * and `isMainFrame` is what tells those apart from the guest itself being unreachable. It also
 * fires with `errorCode === -3` (`ABORTED`) on completely ordinary navigations: the view toggle
 * and the reload button both cancel whatever load was already in flight, and Chromium reports that
 * cancellation exactly the way it reports a real failure. Counting either as a failure would swap
 * a perfectly good admin for an error panel on every ordinary click.
 *
 * `STALL_TIMEOUT_MS` is this hook's own ceiling on "still loading, no verdict yet" — ported
 * unchanged from the original host's own measurement of a freshly created project's slowest real
 * first admin request (see that host's own history for the live numbers): comfortably past how long a
 * local admin normally takes to answer, comfortably short of leaving the operator staring at a
 * blank pane for the rest of the session.
 *
 * `resetKey` is the host workspace's load reset key (reload nonce, view, soft loads), not read
 * here for its value — only for when it changes. A recovery remount replaces the guest (new DOM
 * node, so listeners must move with it), while a view switch or a soft load (`reload()`,
 * `loadURL()`) renavigates the same node; all of them deserve a clean slate, since
 * without one a single transient failure would pin the recovery panel in place even after the
 * operator's next click plainly asked for another try. The same reset also re-arms the stall timer,
 * which is what lets the recovery panel's own "Start site" retry get a second, fresh judgment.
 *
 * **The guest arrives through `guestRef`, a callback ref, and that is the D-03 fix.** This used to
 * take a `RefObject` and depend on `[webviewRef, resetKey]`. A ref OBJECT is stable for the
 * component's whole life, and the host's workspace view renders the `<webview>` only when
 * `running && !failed` — so on the two ordinary paths that mount a guest (a stopped tab whose 4 s
 * poll flips to `running`, and the failure panel's own retry) neither dependency changed, the
 * effect never re-ran, and NO listener and no stall timer were ever installed on the node actually
 * on screen. Only "Reload while healthy" — where `key` remounts the guest in the same commit the
 * effect follows — attached them, which is the path that needs recovery least. The hook was right
 * in form and wrong in binding: its own doc said the listeners "must move with" the node, and
 * nothing in its inputs changed when the node appeared. Holding the node in STATE makes it a
 * dependency that really does change on attach, so the effect's lifetime IS the node's.
 *
 * The failure reset is deliberately a SECOND effect keyed on `resetKey` alone. Folding it back into the
 * node-keyed effect looks tidier and reintroduces a worse bug: `failed` going true unmounts the
 * guest, which fires `guestRef(null)`, which would re-run a combined effect and clear the very
 * flag that unmounted it — the guest remounts, fails again, and the panel flickers forever.
 *
 * **`loaded` is the third flag, added alongside `failed`/`stalled` for the same reason those two
 * exist: "the guest is mounted" is not "the admin is on screen".** Before it, a fresh guest gave
 * the operator nothing to look at from the moment it mounted until either `did-finish-load` swapped
 * in real content or `STALL_TIMEOUT_MS` ran out and guessed something was wrong — a blank pane for
 * up to 8 seconds on every ordinary open, indistinguishable from a hang. `loaded` is what a caller
 * checks to show its OWN "still loading" state in that window, instead of leaving it silent.
 * `true` only once `did-finish-load` has actually fired for the CURRENT `resetKey`; it resets to
 * `false` in lockstep with `failed`/`stalled` so a remount, a view switch, or a soft load all start
 * from "not loaded yet" rather than carrying over a previous navigation's finished state.
 *
 * @returns `guestRef` alongside the three flags — the caller MUST put it on the `<webview>`; there
 *   is no other way for this hook to see the node. `guest` is that node, for the host workspace's
 *   history listeners, which need the same lifetime and cannot take a second ref on one element.
 */
export function useWebviewLoadFailure<G extends LoadFailureGuest = LoadFailureGuest>(
  { resetKey }: { resetKey: unknown }, { timers = window }: { timers?: Pick<Window, 'setTimeout' | 'clearTimeout'> } = {},
): {
  failed: boolean;
  stalled: boolean;
  loaded: boolean;
  guest: G | null;
  guestRef: (node: G | null) => void;
} {
  const [failed, setFailed] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [guest, setGuest] = useState<G | null>(null);

  useEffect(() => {
    // Not read for its value — only for when it changes. `resetKey` is what makes reload and a
    // view switch a clean slate rather than a permanent black mark; without a genuine reference
    // to it here, Biome's exhaustive-deps rule reads the dependency as dead weight and asks to
    // drop it, which would drop the reset along with it.
    resetKey;
    setLoaded(false);
    setFailed(false);
    setStalled(false);
  }, [resetKey]);

  useEffect(() => {
    if (guest === null) return undefined;
    // A stopped site can remount a guest without changing resetKey. Reset only on attach:
    // detaching a failed guest must keep the recovery panel's failure flag intact.
    setLoaded(false);
    setStalled(false);

    const STALL_TIMEOUT_MS = 8000;
    const stallTimer = timers.setTimeout(() => setStalled(true), STALL_TIMEOUT_MS);

    const onFailLoad = (event: LoadFailureEvent) => {
      if (!event.isMainFrame || event.errorCode === -3) return;
      timers.clearTimeout(stallTimer);
      // A fact arriving after a guess: the guess was wrong (or overtaken), so withdraw it rather
      // than leave both true and ask the host's workspace view to decide which one wins.
      setStalled(false);
      setFailed(true);
    };
    const onFinishLoad = () => {
      timers.clearTimeout(stallTimer);
      setFailed(false);
      setStalled(false);
      setLoaded(true);
    };

    guest.addEventListener('did-fail-load', onFailLoad);
    guest.addEventListener('did-finish-load', onFinishLoad);
    return () => {
      timers.clearTimeout(stallTimer);
      guest.removeEventListener('did-fail-load', onFailLoad);
      guest.removeEventListener('did-finish-load', onFinishLoad);
    };
    // `resetKey` as well as the node: a VIEW switch or a soft load navigates the guest that is
    // already mounted, so the node is unchanged and only this re-arms the stall timer for the new
    // navigation. A recovery remount changes both (`key` remounts the element).
  }, [guest, resetKey, timers]);

  return { failed, stalled, loaded, guest, guestRef: setGuest };
}
