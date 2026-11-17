/**
 * @file Application-version bridge for an Electron shell: one read-only IPC handler that answers
 * with the version the window should show.
 *
 * Why this exists: release tooling bumps `package.json` only on the release-tag commit, so a dev
 * launch from any branch would show the last bumped version and pass for an older release. A dev
 * launch therefore shows the nearest release tag (read once through an injected git port) plus a
 * dev suffix, or the package version plus that suffix without git. A packaged build answers with
 * `app.getVersion()` verbatim on every request. The tag convention, suffix and channel id are the
 * host's: they arrive as `versionFromTag`, `devSuffix` and `channel`.
 */

/** Resolves the nearest release tag name, or rejects. */
export type DescribeReleaseTag = (required: { cwd: string }) => Promise<string>;

export interface DevAppVersionRequired {
  readonly repoRoot: string;
  readonly packageVersion: string;
  /** Maps a tag name to the version it announces, or `null` when it is not a release tag. */
  readonly versionFromTag: (tag: string) => string | null;
  readonly describeTag: DescribeReleaseTag;
  /** Appended to a dev version, e.g. `-dev`. */
  readonly devSuffix: string;
}

/** Dev version from the nearest release tag, else the package version, both marked dev. Never rejects.
 * @example await resolveDevAppVersion({ repoRoot, packageVersion, versionFromTag, describeTag, devSuffix: "-dev" });
 * @complexity O(1) besides one `describeTag` call.
 */
export async function resolveDevAppVersion(
  { repoRoot, packageVersion, versionFromTag, describeTag, devSuffix }: DevAppVersionRequired,
  _optional: Record<string, never> = {},
): Promise<string> {
  try {
    const version = versionFromTag((await describeTag({ cwd: repoRoot })).trim());
    if (version) return `${version}${devSuffix}`;
  } catch { /* no git, not a checkout, or no tag: the package fallback below is still marked dev */ }
  return `${packageVersion}${devSuffix}`;
}

export interface AppVersionBridgeRequired extends Omit<DevAppVersionRequired, "packageVersion"> {
  readonly ipcMain: { handle: (channel: string, listener: () => string | Promise<string>) => void };
  readonly app: { getVersion: () => string; isPackaged: boolean };
  readonly channel: string;
}

/** Register once before the first window opens. Native IPC/getVersion errors propagate. Packaged
 * builds read `app.getVersion()` per request; a dev launch starts one tag read here.
 * @example registerAppVersionBridge({ ipcMain, app, channel, repoRoot, versionFromTag, describeTag, devSuffix });
 * @complexity O(1) time and space per registration and request.
 */
export function registerAppVersionBridge(
  { ipcMain, app, channel, ...dev }: AppVersionBridgeRequired,
  _optional: Record<string, never> = {},
): void {
  if (app.isPackaged) {
    ipcMain.handle(channel, () => app.getVersion());
    return;
  }
  const version = resolveDevAppVersion({ ...dev, packageVersion: app.getVersion() });
  ipcMain.handle(channel, () => version);
}
