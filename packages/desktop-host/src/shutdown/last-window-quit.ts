/**
 * @file The ask before the app's last window closes: "Quit and stop N running sites?".
 * Closing that window with sites running otherwise either stops them with no warning
 * (Windows, Linux) or leaves them running behind a Dock icon (macOS). The host passes the native
 * box, the open servers and `app.quit` in, so every rule here runs under plain node with fakes.
 *
 * **Why Keep running minimizes on Windows and Linux.** macOS keeps an app alive with no windows, so
 * there the window closes and the Dock icon reopens it. Elsewhere a closed last window fires
 * `window-all-closed`, which quits and stops every site, and this app has no tray. A hidden window
 * would leave no way back; a minimized one stays on the taskbar, and closing it asks again, so Quit
 * is always reachable. It also needs no icon, menu or Linux tray support the way a tray would.
 *
 * **Why it latches on `before-quit`, not on `quitPhase`.** Every quit route (Cmd+Q, menu Quit, a
 * signal, Restart to update, this box's own Quit) reaches `before-quit` before any window closes,
 * so none of them may meet this box. `quitPhase` cannot say so: it stays `"idle"` when there was
 * nothing to drain, including while a macOS update is staging, and Electron's `quitAndInstall` then
 * closes the windows BEFORE its own `before-quit`. Holding a close there would abort the update.
 *
 * **Why it keeps its own window set.** `BrowserWindow.getAllWindows()` also lists the hidden capture
 * windows, so "am I the last?" would never be true while one exists.
 * `isVisible()` cannot filter them: on macOS it answers false for a window another one covers.
 */

interface LastWindowQuitLabels {
  quitOne: string;
  quitMany: string;
  keepsOne: string;
  keepsMany: string;
  quit: string;
  keepInBackground: string;
  cancel: string;
}

interface LastWindowQuitDialogOptions {
  type: "question";
  title: string;
  message: string;
  detail?: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: boolean;
  signal?: AbortSignal;
}

/** The slice of a `BrowserWindow` this ask touches. */
interface QuitPromptWindow {
  on(event: "close", listener: (event: { preventDefault(): void }) => void): unknown;
  on(event: "closed", listener: () => void): unknown;
  close(): void;
  minimize(): void;
}

/** The slice of a child process handle counted here: `external` marks one this app only attached to. */
interface CountedServer {
  external?: boolean;
}

/** Everything the ask needs from the host. */
interface LastWindowQuitPorts<W> {
  /** Every server `before-quit`'s drain would call `stop()` on. */
  openChildren: () => readonly CountedServer[];
  /** `process.platform`. */
  platform: string;
  /** Dialog copy, read when the box opens. */
  dialogCopy: () => { title: string; labels: LastWindowQuitLabels };
  /** `dialog.showMessageBox`, parented so it is a sheet on macOS and modal to the window on Windows. */
  showMessageBox: (required: { window: W; options: LastWindowQuitDialogOptions }) => Promise<{ response: number }>;
  /** `app.quit()`: the same graceful drain Cmd+Q runs. */
  quit: () => void;
  /** Keep running in background: idle sleep must not stop these sites later. */
  keepChildrenRunning: () => void;
  reportError: (required: { error: unknown }) => void;
}

/** The ask, as the host uses it. */
interface LastWindowQuitPrompt<W> {
  /** Count this window as open and ask before it closes last. Only app windows belong here. */
  watch(required: { window: W }): void;
  /** How many app windows are open. Capture windows are not counted, so a Dock click can reopen the app while one exists. */
  openCount(): number;
  /** A quit has started: dismiss an open box, and never ask again. Idempotent. */
  onQuitStarted(): void;
}

const QUIT_BUTTON = 0;
const KEEP_RUNNING_BUTTON = 1;
const CANCEL_BUTTON = 2;

/**
 * What a quit does to the open servers: stopping an attached one only ends this app's watch on it
 * so that site keeps running by design.
 * @returns How many sites stop, and how many keep running. @complexity O(n) open servers.
 */
function quitChildCounts({ children }: { children: readonly CountedServer[] }, _optional = {}): { stops: number; keeps: number } {
  const keeps = children.filter((server) => server.external).length;
  return { stops: children.length - keeps, keeps };
}

/**
 * The native box. `stops` and `keeps` are the two {@link quitChildCounts} numbers.
 * @returns The box's options, with the supplied copy. @complexity O(1).
 */
function lastWindowQuitDialog({ title, labels: copy, stops, keeps }: { title: string; labels: LastWindowQuitLabels; stops: number; keeps: number }, _optional = {}): LastWindowQuitDialogOptions {
  return {
    type: "question",
    title,
    message: (stops === 1 ? copy.quitOne : copy.quitMany).replace("{count}", () => String(stops)),
    ...(keeps > 0 ? { detail: (keeps === 1 ? copy.keepsOne : copy.keepsMany).replace("{count}", () => String(keeps)) } : {}),
    buttons: [copy.quit, copy.keepInBackground, copy.cancel],
    defaultId: QUIT_BUTTON,
    cancelId: CANCEL_BUTTON,
    // Windows would otherwise turn "Quit", which it does not recognise as a common button, into a
    // large command link above a lone Cancel. Ignored on macOS.
    noLink: true,
  };
}

/**
 * Binds the ask to its ports. A close is held first and answered later, because `close` can only be
 * prevented synchronously; Quit then runs the ordinary quit, so nothing here stops a site, and
 * Keep running leaves them all as they are.
 * @returns The ask. @complexity O(1) per close, plus O(n) open servers when it asks.
 */
function createLastWindowQuitPrompt<W extends QuitPromptWindow>(
  { ports }: { ports: LastWindowQuitPorts<W> },
  _optional = {},
): LastWindowQuitPrompt<W> {
  const windows = new Set<W>();
  // One-shot: a page's `beforeunload` can veto the close Keep running starts, and the next must ask.
  const released = new WeakSet<W>();
  const state = {
    quitStarted: false,
    openBox: null as AbortController | null,
  };

  const keepRunning = createBackgroundWindowKeeper({ ports, released });

  const ask = createAsk({ state, ports, keepRunning });

  function onClose({ window, event }: { window: W; event: { preventDefault(): void } }): void {
    if (state.quitStarted || released.delete(window)) return;
    // While the box is open the answer decides; the close that opened it is already held.
    if (state.openBox) {
      event.preventDefault();
      return;
    }
    if (windows.size > 1) return;
    const { stops, keeps } = quitChildCounts({ children: ports.openChildren() });
    if (stops === 0) return;
    event.preventDefault();
    ask({ window, stops, keeps });
  }

  return {
    openCount: () => windows.size,
    watch({ window }) {
      windows.add(window);
      window.on("close", (event) => onClose({ window, event }));
      // `closed`, not `close`: a page's `beforeunload` can still veto a close that passed here.
      window.on("closed", () => windows.delete(window));
    },
    onQuitStarted() {
      state.quitStarted = true;
      state.openBox?.abort();
      state.openBox = null;
    },
  };
}

function createAsk<W extends QuitPromptWindow>({ state, ports, keepRunning }: { state: { quitStarted: boolean; openBox: AbortController | null; }; ports: LastWindowQuitPorts<W>; keepRunning: ReturnType<typeof createBackgroundWindowKeeper<W>> }) {
  return function ask({ window, stops, keeps }: { window: W; stops: number; keeps: number }): void {
    const box = new AbortController();
    state.openBox = box;
    ports.showMessageBox({ window, options: { ...lastWindowQuitDialog({ ...ports.dialogCopy(), stops, keeps }), signal: box.signal } })
      .then(({ response }) => {
        state.openBox = null;
        if (response === QUIT_BUTTON) ports.quit();
        if (response === KEEP_RUNNING_BUTTON) keepRunning({ window });
      })
      .catch((error: unknown) => {
        state.openBox = null;
        ports.reportError({ error });
      });
  };
}

function createBackgroundWindowKeeper<W extends QuitPromptWindow>({ ports, released }: { ports: LastWindowQuitPorts<W>; released: WeakSet<W> }) {
  return function keepRunning({ window }: { window: W }): void {
    ports.keepChildrenRunning();
    if (ports.platform !== "darwin") {
      window.minimize();
      return;
    }
    released.add(window);
    window.close();
  };
}

export { createLastWindowQuitPrompt, lastWindowQuitDialog, quitChildCounts };
export type { LastWindowQuitPorts, LastWindowQuitPrompt, QuitPromptWindow, LastWindowQuitLabels, LastWindowQuitDialogOptions };
