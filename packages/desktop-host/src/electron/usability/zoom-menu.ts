
/**
 * Send commands to the renderer so it can route zoom to the visible surface. Electron's built-in
 * zoom roles target the focused window's top-level webContents, which is wrong when a guest tab
 * is visible. Keep native menu construction outside this module to avoid a runtime Electron dependency.
 */
type ZoomCommandDirection = "in" | "out" | "reset";

interface ZoomCommandWindow {
  isDestroyed(): boolean;
  // Electron menu callbacks may provide a BaseWindow without webContents, so never assume it exists.
  webContents?: { send(args: { channel: string; direction: ZoomCommandDirection }): void };
}

interface ZoomMenuItem {
  label: string;
  accelerator: string;
  visible?: boolean;
  click: (args: { window: ZoomCommandWindow | undefined }) => void;
}

/** Send one zoom direction to a live focused window. */
function sendZoomCommand({ window, direction, channel }: { window: ZoomCommandWindow | undefined; direction: ZoomCommandDirection; channel: string }): boolean {
  if (!window || window.isDestroyed() || !window.webContents) return false;
  window.webContents.send({ channel, direction });
  return true;
}

/** Build zoom menu commands, including the hidden unshifted plus alias. */
function zoomMenuItems({ channel, labels }: { channel: string; labels: { reset: string; in: string; out: string } }): ZoomMenuItem[] {
  return [
    { label: labels.reset, accelerator: "CmdOrCtrl+0", click: ({ window }) => void sendZoomCommand({ window, direction: "reset", channel }) },
    { label: labels.in, accelerator: "CmdOrCtrl+Plus", click: ({ window }) => void sendZoomCommand({ window, direction: "in", channel }) },
    // Plus needs Shift on most keyboards; the hidden '=' alias supports its unshifted key too.
    { label: labels.in, accelerator: "CmdOrCtrl+=", visible: false, click: ({ window }) => void sendZoomCommand({ window, direction: "in", channel }) },
    { label: labels.out, accelerator: "CmdOrCtrl+-", click: ({ window }) => void sendZoomCommand({ window, direction: "out", channel }) },
  ];
}

export { sendZoomCommand, zoomMenuItems };
export type { ZoomCommandDirection, ZoomCommandWindow, ZoomMenuItem };
