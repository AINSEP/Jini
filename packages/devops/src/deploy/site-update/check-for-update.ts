import { compareSiteVersions, type CompareSiteVersionsOptions, type ReleaseFeedPort, type SiteUpdateAvailable, type SiteUpdateCallOptions } from './contracts.js';

/** Options of {@link checkForUpdateFromFeed}. */
export interface CheckForUpdateFromFeedOptions extends SiteUpdateCallOptions, CompareSiteVersionsOptions {}

/**
 * The shared "Update available?" answer an adapter can delegate its `checkForUpdate` to: asks the
 * feed for its newest release and reports it only when it is strictly newer than what is running.
 *
 * @param required.runningVersion - Version the live site reports.
 * @param required.feed - Where releases are announced.
 * @returns The newer release and its notes, or null when the site is current, ahead, or the feed is empty.
 * @throws SiteUpdateError when either version is not a semver version.
 * @complexity One feed call plus an O(n) version compare.
 */
export async function checkForUpdateFromFeed(
  required: { runningVersion: string; feed: ReleaseFeedPort },
  _optional: CheckForUpdateFromFeedOptions = {},
): Promise<SiteUpdateAvailable | null> {
  const release = await required.feed.latestRelease({}, { signal: _optional.signal });
  if (!release) return null;
  const order = compareSiteVersions({ left: required.runningVersion, right: release.version }, { ids: _optional.ids });
  return order < 0 ? { latest: release.version, notes: release.notes } : null;
}
