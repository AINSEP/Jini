/**
 * @file The workspace window's application menu: Electron's default menus, plus History with
 * Back (Cmd+[) and Forward (Cmd+]) for the project tab on screen.
 *
 * A menu accelerator is the one key binding that still fires while focus is inside a project tab's
 * `<webview>` guest, which a key listener in the host page never sees. Setting a menu
 * replaces the default, so this template rebuilds it role for role and adds History. The one
 * difference: an unpackaged run's Help menu lost Electron's own links (electronjs.org, docs,
 * issues). A packaged app never showed those.
 *
 * **Main only asks.** A click sends `back` or `forward` to the focused window's renderer and knows
 * nothing about tabs. Every project tab stays mounted, and only the visible one subscribes, so a
 * command with no project tab showing reaches nobody.
 *
 * No `electron` import, so it can be tested under plain node.
 */
/** What a click asks the renderer to do. */
type HistoryCommand = "back" | "forward";

/** A menu click's focused window, as far as this module reads one. Electron types it as a
 *  `BaseWindow`, which has no `webContents`, so that is optional. */
interface HistoryCommandWindow {
  isDestroyed(): boolean;
  webContents?: { send(channel: string, payload: string): void };
}

/** One History item. `click` has the leading parameters of Electron's `MenuItem` click. */
interface HistoryMenuItem {
  label: string;
  accelerator: string;
  click: (item: unknown, window: HistoryCommandWindow | undefined) => void;
}

/** The History menu: exactly Back, then Forward. */
interface HistoryMenu {
  label: string;
  submenu: [HistoryMenuItem, HistoryMenuItem];
}

/** The View menu: Electron's default reload/dev-tools items, this shell's own Zoom controls in
 *  place of the built-in zoom roles (the built-in roles target the top-level webContents instead of
 *  the visible guest), then Toggle Full Screen. */
interface ViewMenu<Zoom> {
  label: string;
  submenu: [
    { role: "reload" },
    { role: "forceReload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    ...Zoom[],
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
}

/** One top-level entry of {@link workspaceMenuTemplate}: an Electron menu role, View, History, or
 *  Find. */
type WorkspaceMenuEntry<Find, Zoom> =
  | { role: "appMenu" | "fileMenu" | "editMenu" | "windowMenu" }
  | { role: "help"; submenu: [] }
  | ViewMenu<Zoom>
  | HistoryMenu
  | Find;

/**
 * Electron's default View menu, with the supplied Zoom controls in place of
 * the built-in zoom roles.
 *
 * @complexity O(1).
 */
function viewMenu<Zoom>({ label, zoomItems }: { label: string; zoomItems: Zoom[] }, _optional = {}): ViewMenu<Zoom> {
  return {
    label,
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      ...zoomItems,
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };
}

/**
 * Sends one history command to a window's renderer.
 *
 * @param window the menu click's focused window. Electron types it as a `BaseWindow`, which has
 *   no `webContents`, so that is checked rather than assumed.
 * @param command
 * @returns whether anything was sent.
 * @complexity O(1).
 */
function sendHistoryCommand({ window, command, channel }: { window: HistoryCommandWindow | undefined; command: HistoryCommand; channel: string }, _optional = {}): boolean {
  if (!window || window.isDestroyed() || !window.webContents) return false;
  window.webContents.send(channel, command);
  return true;
}

/**
 * The History menu. Named for Chrome's, which has the same two shortcuts.
 *
 * @complexity O(1).
 */
function historyMenu({ channel, labels }: { channel: string; labels: { menu: string; back: string; forward: string } }, _optional = {}): HistoryMenu {
  return {
    label: labels.menu,
    submenu: [
      { label: labels.back, accelerator: "CmdOrCtrl+[", click: (_item: unknown, window: HistoryCommandWindow | undefined) => void sendHistoryCommand({ window, command: "back", channel }) },
      { label: labels.forward, accelerator: "CmdOrCtrl+]", click: (_item: unknown, window: HistoryCommandWindow | undefined) => void sendHistoryCommand({ window, command: "forward", channel }) },
    ],
  };
}

/**
 * Electron's default application menu with History and Find added before Window. The Help menu is
 * empty, as a packaged app's default is.
 *
 * @param platform `process.platform`; only macOS gets the app menu.
 * @complexity O(1).
 */
function workspaceMenuTemplate<Find, Zoom>({ platform, view, history, find }: { platform: NodeJS.Platform; view: ViewMenu<Zoom>; history: HistoryMenu; find: Find }, _optional = {}): WorkspaceMenuEntry<Find, Zoom>[] {
  return [
    // `as const`: a conditional spread otherwise widens this role, and every entry after it, to `string`.
    ...(platform === "darwin" ? [{ role: "appMenu" } as const] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    view,
    history,
    find,
    { role: "windowMenu" },
    { role: "help", submenu: [] },
  ];
}

export { sendHistoryCommand, historyMenu, viewMenu, workspaceMenuTemplate };
export type { HistoryCommandWindow, HistoryCommand, HistoryMenu, HistoryMenuItem, ViewMenu, WorkspaceMenuEntry };
