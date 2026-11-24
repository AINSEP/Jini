/**
 * Electron-native binding of `../electron/usability`'s Find menu: the policy (labels, accelerator,
 * "only a live focused window with webContents receives the toggle") has one implementation there;
 * this module only adapts Electron's positional shapes to that package's object-argument ports.
 *
 * Why a menu at all: a menu accelerator is the one key binding that still fires while focus is
 * inside a project tab's `<webview>` guest, which a key listener in the host page never sees.
 * Everything AFTER the bar opens (typing, Enter, Shift+Enter, Escape) is an ordinary DOM keydown on
 * the bar's own input, which lives in the host document, so only the one "open the bar" step needs
 * main's help at all.
 *
 * The toggle channel and the labels are host-owned and injected; no `electron` import, so it can be
 * tested under plain node.
 */
import { findMenu as buildFindMenu, sendFindToggle as sendToggle } from "../electron/usability/find-menu.js";

/** A focused native window as Electron's menu callback supplies it (positional `send`). */
export interface NativeFindCommandWindow {
  isDestroyed(): boolean;
  webContents?: { send(channel: string): void };
}

/** Electron's `MenuItemConstructorOptions` click shape: `(menuItem, focusedWindow)`. */
export interface NativeFindMenuItem {
  label: string;
  accelerator: string;
  click: (item: unknown, window: NativeFindCommandWindow | undefined) => void;
}

export interface NativeFindMenu { label: string; submenu: [NativeFindMenuItem] }

/** Translate a native focused window to the package send port. @complexity O(1). */
function windowPort({ window }: { window: NativeFindCommandWindow | undefined }) {
  if (!window) return undefined;
  const contents = window.webContents;
  return {
    isDestroyed: () => window.isDestroyed(),
    ...(contents ? { webContents: { send: ({ channel }: { channel: string }) => contents.send(channel) } } : {}),
  };
}

/** Send the host's find toggle to a native focused window. @complexity O(1). */
export function sendNativeFindToggle({ window, channel }: { window: NativeFindCommandWindow | undefined; channel: string }, _optional: Record<string, never> = {}): boolean {
  return sendToggle({ window: windowPort({ window }), channel });
}

/** Build native menu callbacks with the host's channel and wording. @complexity O(1). */
export function nativeFindMenu({ channel, labels }: { channel: string; labels: { menu: string; item: string } }, optional: { accelerator?: string } = {}): NativeFindMenu {
  const menu = buildFindMenu({ channel, labels }, optional);
  const item = menu.submenu[0];
  return { ...menu, submenu: [{ ...item, click: (_item, window) => item.click({ window: windowPort({ window }) }) }] };
}
