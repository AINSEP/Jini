
/**
 * A native menu accelerator still fires when focus is in a webview guest, where the host page's
 * DOM key listener cannot see Cmd+F. Only opening the bar needs main's help; once focused,
 * its input handles typing, Enter, Shift+Enter and Escape in the renderer document.
 * Structural ports keep this menu policy independent of a runtime Electron import.
 */
interface FindCommandWindow {
  isDestroyed(): boolean;
  // Electron menu callbacks can supply a BaseWindow without webContents; check before sending.
  webContents?: { send(args: { channel: string }): void };
}

interface FindMenuItem {
  label: string;
  accelerator: string;
  click: (args: { window: FindCommandWindow | undefined }) => void;
}

interface FindMenu {
  label: string;
  submenu: [FindMenuItem];
}

/** Send the caller-configured toggle channel to a live focused window. */
function sendFindToggle({ window, channel }: { window: FindCommandWindow | undefined; channel: string }): boolean {
  if (!window || window.isDestroyed() || !window.webContents) return false;
  window.webContents.send({ channel });
  return true;
}

/** Build a Find menu with host-owned labels and channel. */
function findMenu({ channel, labels }: { channel: string; labels: { menu: string; item: string } }, { accelerator = "CmdOrCtrl+F" }: { accelerator?: string } = {}): FindMenu {
  return {
    label: labels.menu,
    submenu: [
      {
        label: labels.item,
        accelerator,
        click: ({ window }) => void sendFindToggle({ window, channel }),
      },
    ],
  };
}

export { sendFindToggle, findMenu };
export type { FindCommandWindow, FindMenu, FindMenuItem };
