/**
 * @file Tracks window load outcomes for the host's desktop self-test mode, split out of `main.ts` so the
 * completion/failure semantics are directly testable under plain `node --test` — this module has no
 * `electron` import at all; it only needs a window shaped `{ webContents: { once(event, cb),
 * getURL(), getTitle() } }`, which a fake object can satisfy just as well as a real `BrowserWindow`.
 *
 * Reporting and process control (the `console.log`/`process.exitCode`/`app.quit()` a real self-test
 * run needs) are NOT done here — they are the three injected callbacks below — so this file stays a
 * pure completion tracker and `main.ts` keeps the only code that actually touches Electron or the
 * process.
 *
 * Two, not one, ordering hazards had to be closed together — fixing only the first re-created the
 * second, confirmed live (2026-09-05) against a real 2-site launch:
 *
 * 1. **Registration must happen per-window, at creation time, not after the whole batch is open.**
 *    A single-site launch's own window finishes loading in well under a second; a multi-site
 *    launch's FIRST window can finish loading while its SECOND site's server is still booting
 *    (`loadURL` is fire-and-forget, and `main.ts` opens each site in its startup loop sequentially).
 *    Registering `did-finish-load` listeners only after every window in the batch exists would miss
 *    an earlier window's event entirely — Electron does not replay a past event to a listener
 *    attached after the fact. `main.ts`'s `createWindow` therefore calls this tracker's `add()` the
 *    INSTANT each window is created, before that window's own `loadURL` call.
 * 2. **The expected window COUNT must be fixed upfront, not incremented as each window is added.**
 *    Fixing (1) alone by incrementing a counter inside `add()` reintroduced a worse failure: if
 *    window 1 finishes loading before window 2 is even created (exactly the ordering (1) describes),
 *    an incrementally-built counter reads "1 of 1 done" and quits immediately — before window 2's
 *    site ever gets a chance to open at all. Seeding `remaining` from the caller's own already-known
 *    total (it always knows how many sites it is about to open) up front makes early completions
 *    correctly WAIT rather than conclude the batch is done.
 */

/** The slice of Electron's `WebContents` this tracker touches. Overloaded per event, as Electron's own
 *  declaration is, so a real `BrowserWindow` and a test fake both satisfy it. */
interface SelftestWebContents {
  on(event: "did-fail-load", listener: (event: unknown, code: number, description: string, validatedURL: string, isMainFrame: boolean) => void): unknown;
  once(event: "did-finish-load", listener: () => void): unknown;
  getURL(): string;
  getTitle(): string;
}

/** A window as this tracker sees it: `BrowserWindow`, or a fake with the same `webContents` slice. */
interface SelftestWindow {
  webContents: SelftestWebContents;
}

/** The three effects {@link createSelftestTracker} leaves to its caller. */
interface SelftestCallbacks {
  onWindowLoaded(info: { url: string; title: string }): void;
  onWindowFailed(info: { url: string; code: number; description: string }): void;
  onAllSettled(info: { failed: boolean }): void;
}

/** What {@link createSelftestTracker} returns. */
interface SelftestTracker {
  add(window: SelftestWindow): void;
}

/**
 * @param input.expectedCount how many windows this launch will open, known by the caller before any of
 *   them exist (e.g. `siteDirs.length`) — see this file's own header, hazard 2.
 * @param input.callbacks.onWindowLoaded `({ url, title }) => void` — called once per window that finishes
 *   loading successfully.
 * @param input.callbacks.onWindowFailed `({ url, code, description }) => void` — called at most once, for
 *   the first window (if any) that fails to load.
 * @param input.callbacks.onAllSettled `({ failed }) => void` — called exactly once, either once every
 *   expected window has loaded successfully (`failed: false`) or as soon as any one fails
 *   (`failed: true`) — never both.
 * @returns `{ add(window) }` — call once per window, as soon as it is created; must be called
 *   exactly `expectedCount` times over this tracker's lifetime.
 * @complexity O(1) to construct; `add()` is O(1) per call.
 */
function createSelftestTracker({ expectedCount, callbacks }: { expectedCount: number; callbacks: SelftestCallbacks }, _options: Record<string, never> = {}): SelftestTracker {
  let remaining = expectedCount;
  let failed = false;

  return {
    add(window: SelftestWindow): void {
      window.webContents.on("did-fail-load", (_event: unknown, code: number, description: string, _validatedURL: string, isMainFrame: boolean) => {
        if (failed || !isMainFrame || code === -3) return;
        failed = true;
        callbacks.onWindowFailed({ url: window.webContents.getURL(), code, description });
        callbacks.onAllSettled({ failed: true });
      });

      window.webContents.once("did-finish-load", () => {
        callbacks.onWindowLoaded({ url: window.webContents.getURL(), title: window.webContents.getTitle() });
        remaining -= 1;
        if (remaining === 0 && !failed) callbacks.onAllSettled({ failed: false });
      });
    },
  };
}

export { createSelftestTracker };
export type { SelftestCallbacks, SelftestTracker, SelftestWebContents, SelftestWindow };
