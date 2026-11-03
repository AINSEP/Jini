import fs from "node:fs";

/**
 * Whether `electronPath` lives somewhere that will vanish — so writing it into a durable launcher
 * would, while it is still there, make every site's daemon exec from it (holding the disk image
 * open so it cannot be ejected), and once it is gone, fail with a spawn error naming neither cause.
 *
 * Two macOS cases, both only ever produced by opening the app without installing it:
 *
 * - **A read-only volume under `/Volumes`** — a mounted `.dmg`. Read-only rather than every
 *   `/Volumes` path, because an app an operator deliberately installed on a writable external drive
 *   is a durable choice of theirs.
 * - **App Translocation** (`.../AppTranslocation/<uuid>/d/Application.app`) — Gatekeeper's randomized
 *   read-only mirror of a quarantined app, a new path on every launch.
 *
 * @param options.isReadOnlyVolume asked about `/Volumes/<name>` only; production uses
 *   {@link isReadOnlyVolumeRoot}.
 * @returns Whether persisting this executable path would pin a transient installation.
 * @example isTransientAppPath({ executablePath: "/Applications/Sample.app/Contents/MacOS/Sample" });
 * @complexity O(n) in the path length, plus one filesystem probe for a `/Volumes` path.
 */
export function isTransientAppPath({ executablePath: electronPath }: { executablePath: string },
  { isReadOnlyVolume = volumeRoot => isReadOnlyVolumeRoot({ volumeRoot }) }: { isReadOnlyVolume?: (volumeRoot: string) => boolean } = {},
): boolean {
  if (electronPath.includes("/AppTranslocation/")) return true;
  const volume = /^\/Volumes\/[^/]+/.exec(electronPath);
  return volume !== null && isReadOnlyVolume(volume[0]);
}

/** A mounted disk image refuses write access with `EROFS`; anything else (a writable drive, a
 *  permission denial, a path that is gone) is not evidence of one.
 *  @param options.accessSync the write probe; production uses `fs.accessSync`, a test passes a fake
 *    so the `EROFS` answer can be exercised without mounting a read-only volume.
 *  @returns True only for a read-only filesystem; missing paths and access denials return false.
 *  @example isReadOnlyVolumeRoot({ volumeRoot: "/Volumes/Installer" });
 *  @complexity O(1) — one `access` call. */
export function isReadOnlyVolumeRoot(
  { volumeRoot }: { volumeRoot: string },
  { accessSync = fs.accessSync }: { accessSync?: (target: string, mode: number) => void } = {},
): boolean {
  try {
    accessSync(volumeRoot, fs.constants.W_OK);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EROFS";
  }
}

/**
 * Whether the launcher already at `launcherPath` execs an Electron binary that exists at a durable
 * location — i.e. an installed copy's launcher, which a launch from a disk image must leave alone
 * rather than break. The unavailable stub and a launcher naming a transient path both answer false.
 * @returns False on an unreadable launcher, absent executable, or transient installation.
 * @example launcherNamesDurableInstall({ launcherPath: "/tmp/toolchain/bin/node" });
 *
 * @complexity O(n) in the launcher's size.
 */
export function launcherNamesDurableInstall({ launcherPath }: { launcherPath: string },
  { isReadOnlyVolume = volumeRoot => isReadOnlyVolumeRoot({ volumeRoot }) }: { isReadOnlyVolume?: (volumeRoot: string) => boolean } = {},
): boolean {
  let existing: string;
  try {
    existing = fs.readFileSync(launcherPath, "utf8");
  } catch {
    return false;
  }
  const electron = /^exec '([^']+)'/m.exec(existing)?.[1];
  return electron !== undefined && !isTransientAppPath({ executablePath: electron }, { isReadOnlyVolume }) && fs.existsSync(electron);
}

