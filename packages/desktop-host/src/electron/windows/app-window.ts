/**
 * @file A standalone sandboxed app window: its constructor options and its setup ORDER — window
 * tracking, title pinning and the navigation boundary all before the first load — verified without
 * Electron. The host injects the title, URL, partition, preload path, a `BrowserWindow` factory and
 * the navigation-policy installer; nothing here imports Electron or knows the host's product copy.
 */
import type { ElectronNavigableContents } from "../navigation-policy/index.js";

/** The `BrowserWindow` options {@link createAppWindow} builds. */
interface AppWindowOptions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  title: string;
  show: boolean;
  webPreferences: {
    contextIsolation: boolean;
    nodeIntegration: boolean;
    sandbox: boolean;
    preload: string;
    partition?: string;
  };
}

/** The slice of a `BrowserWindow` {@link createAppWindow} touches; `C` is its `webContents`. */
interface AppWindow<C = ElectronNavigableContents> {
  webContents: C;
  on(event: "page-title-updated", listener: (event: { preventDefault(): void }) => void): unknown;
  loadURL(url: string): Promise<unknown>;
}

/** The host-supplied effects {@link createAppWindow} drives. */
interface AppWindowPorts<W extends AppWindow<unknown>> {
  /** `(options) => new BrowserWindow(options)`. */
  createBrowserWindow: (options: AppWindowOptions) => W;
  /** Installs the host's navigation boundary on the new window's contents, pinned to `appOrigin`. */
  installNavigationPolicy: (required: { contents: W["webContents"]; appOrigin: string }) => void;
}

/**
 * The constructor options for one standalone app window.
 *
 * @param required.preloadPath the compiled preload every app window gets.
 * @param required.title the window title (host copy).
 * @param optional.partition a per-site cookie partition; omitted entirely (not set to `undefined`) when absent.
 * @param optional.selftest a self-test keeps every window hidden.
 * @returns the constructor options.
 * @complexity O(1).
 */
function appWindowOptions(
  { preloadPath, title }: { preloadPath: string; title: string },
  { partition, selftest = false }: { partition?: string | undefined; selftest?: boolean | undefined } = {},
): AppWindowOptions {
  return {
    width: 1360,
    height: 900,
    // Leave room for a navigation rail plus an editor; narrower host windows set their own floor.
    minWidth: 1024,
    minHeight: 700,
    title,
    show: !selftest,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
      // One cookie jar per site. Cookies ignore PORT, so without this every loopback site shares
      // `127.0.0.1`'s jar: site A's session cookie would be sent to site B's server, and B's login
      // would overwrite A's. Absent for a single-site attach, which keeps the default session.
      ...(partition ? { partition } : {}),
    },
  };
}

/**
 * Create, guard and load one standalone app window.
 *
 * @param required.url the URL to load; its parsed origin is the only one the window may stay on.
 * @param required.title see {@link appWindowOptions}.
 * @param required.preloadPath see {@link appWindowOptions}.
 * @param required.ports the window factory and navigation-policy installer.
 * @param optional.trackWindow a self-test tracker's `add`, when this launch has one.
 * @returns the window, already loading `url`.
 * @throws TypeError when `url` does not parse — before anything loads.
 * @complexity O(1).
 */
function createAppWindow<W extends AppWindow<unknown>>(
  { url, title, preloadPath, ports }: { url: string; title: string; preloadPath: string; ports: AppWindowPorts<W> },
  { partition, selftest = false, trackWindow }: {
    partition?: string | undefined; selftest?: boolean | undefined; trackWindow?: ((window: W) => void) | undefined;
  } = {},
): W {
  const window = ports.createBrowserWindow(appWindowOptions({ preloadPath, title }, { partition, selftest }));

  // Registered BEFORE `loadURL` below, and before this function returns to its caller: a self-test
  // tracker that only learns of a window after its first load can miss that load's failure.
  trackWindow?.(window);

  // Electron adopts the loaded page's own `document.title` by default, overwriting the `title` this
  // constructor was given the instant the page finishes loading. When every site's page sets the
  // SAME title, a multi-window launch ends up with indistinguishable windows, which defeats a native
  // Window menu doubling as a site switcher. `preventDefault()` keeps each window pinned to the title
  // it was given at creation.
  window.on("page-title-updated", (event) => event.preventDefault());

  // Anything that navigates away from the app's own origin belongs in the OS browser, and nothing
  // but this origin may run with the preload. The boundary must answer before the first load starts.
  ports.installNavigationPolicy({ contents: window.webContents, appOrigin: new URL(url).origin });

  void window.loadURL(url);
  return window;
}

export { appWindowOptions, createAppWindow };
export type { AppWindow, AppWindowOptions, AppWindowPorts };
