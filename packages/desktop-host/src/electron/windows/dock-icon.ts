/**
 * @file The macOS dock tile's icon: skip where there is no dock, never fail the boot over an icon.
 * The host injects `app.dock`, the icon path and a failure reporter, which receives the raw caught
 * value and owns its formatting and any log copy.
 */

/** The slice of `app.dock` {@link applyDockIcon} touches. */
interface DockIconPort {
  setIcon(iconPath: string): void;
}

/**
 * Put the host's mark on the macOS dock tile.
 *
 * `BrowserWindow`'s own `icon` option is a no-op on macOS — the tile comes from the `.app` bundle,
 * which an unpackaged `electron .` run does not have, so it shows Electron's own default instead.
 * `app.dock.setIcon` is the only thing that changes it for a dev run. Guarded on the API existing
 * rather than on the platform string alone, since `app.dock` is undefined off darwin.
 *
 * Best-effort: a missing or unreadable icon file must not stop the app booting.
 *
 * @param required.dock `app.dock`; `undefined` off macOS.
 * @param required.iconPath the icon PNG.
 * @param required.reportFailure receives the raw caught value when the icon could not be set.
 * @complexity O(1).
 */
function applyDockIcon(
  { dock, iconPath, reportFailure }: { dock: DockIconPort | undefined; iconPath: string; reportFailure: (required: { error: unknown }) => void },
  _optional = {},
): void {
  if (!dock) return;
  try {
    dock.setIcon(iconPath);
  } catch (error) {
    reportFailure({ error });
  }
}

export { applyDockIcon };
export type { DockIconPort };
