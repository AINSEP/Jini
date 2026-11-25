/**
 * @file `SiteUpdatePort` for a self-hosted site that runs as a container image: an update is a tag
 * bump plus a redeploy, and rollback puts the previous tag back. The adapter only says HOW; WHEN is
 * decided by `runSiteUpdate`, which refuses without the owner's approval for that exact version.
 * Checking for an update never reads or writes the tag.
 */
import type { IdGenerator } from '@jini-ai/core/primitives';
import { UNAVAILABLE_ERROR_ID } from '@jini-ai/core/errors/reporter';
import { checkForUpdateFromFeed } from './check-for-update.js';
import {
  isSiteVersion, SiteUpdateError,
  type ReleaseFeedPort, type SiteDataRestorePort, type SiteHealthPort, type SiteUpdateCallOptions, type SiteUpdatePort,
} from './contracts.js';

/** Where the host keeps the site's image tag and how it restarts the site on it. */
export interface ImageTagPort {
  /** The tag the site is running on right now. */
  currentTag(required: Record<string, never>, optional?: SiteUpdateCallOptions): Promise<string>;
  /** Records `tag` as the one to run (compose file, service spec, ...). */
  setTag(required: { tag: string }, optional?: SiteUpdateCallOptions): Promise<void>;
  /** Restarts or redeploys the site on `tag` and waits until it is up. */
  redeploy(required: { tag: string }, optional?: SiteUpdateCallOptions): Promise<void>;
}

/** Options of {@link imageTagForVersion}. */
export interface ImageTagForVersionOptions {
  /** Text put before the version, e.g. `v` for `v1.2.3` tags. Default none. */
  prefix?: string | undefined;
  /** Mints the `ERR-` id of a refused tag; without it the reserved unavailable id is used. */
  ids?: IdGenerator | undefined;
}

// The image-reference tag grammar: one word character first, then up to 127 of [word . -].
const IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

/**
 * Derives the image tag for a release version. Only release versions are accepted, so a moving tag
 * like `latest` (which cannot be rolled back) or text carrying shell characters never becomes a tag.
 *
 * @param required.version - The release version, e.g. `1.2.3`.
 * @returns `prefix + version`.
 * @throws SiteUpdateError (`invalid-image-tag`) in plain words, message prefixed by its `ERR-` id.
 * @complexity O(n) in the length of the version.
 */
export function imageTagForVersion(required: { version: string }, _optional: ImageTagForVersionOptions = {}): string {
  const tag = `${_optional.prefix ?? ''}${required.version}`;
  const fail = (detail: string): never => {
    throw new SiteUpdateError({ code: 'invalid-image-tag', errorId: _optional.ids?.newId() ?? UNAVAILABLE_ERROR_ID, detail });
  };
  if (!isSiteVersion({ version: required.version })) {
    fail(`"${required.version}" is not a release version like 1.2.3, so it cannot name the site image. Moving tags such as "latest" are refused because they cannot be rolled back.`);
  }
  if (!IMAGE_TAG_PATTERN.test(tag)) fail(`"${tag}" has characters an image tag cannot hold. Use only letters, digits, ".", "_" and "-".`);
  return tag;
}

/** Options of {@link createSelfHostedSiteUpdate}. */
export interface SelfHostedSiteUpdateOptions extends ImageTagForVersionOptions {
  /** Pass when the new image migrates data on start, so a rollback also restores the data backup. */
  data?: SiteDataRestorePort | undefined;
  /**
   * The host's managed recovery: stop the site, restore the data backup, restart on `previousTag`, and
   * check the old version is healthy, as one operation. When given it replaces the legacy tag switch and
   * `data` restore entirely; managed production updates always pass it.
   */
  rollbackDeployment?: SelfHostedRollbackDeploymentPort | undefined;
}

/** Puts the kept previous image and its data back together; see {@link SelfHostedSiteUpdateOptions.rollbackDeployment}. */
export type SelfHostedRollbackDeploymentPort = (
  required: { previousTag: string; backupId: string },
  optional?: SiteUpdateCallOptions,
) => Promise<void>;

/**
 * Builds the self-hosted adapter.
 *
 * @param required.feed - Where releases are announced.
 * @param required.images - Reads, sets and redeploys the site's image tag.
 * @param required.health - The live check of the site on the new version.
 * @returns A `SiteUpdatePort` to hand to `runSiteUpdate`.
 * @complexity O(1) port calls per method.
 */
export function createSelfHostedSiteUpdate(
  required: { feed: ReleaseFeedPort; images: ImageTagPort; health: SiteHealthPort },
  _optional: SelfHostedSiteUpdateOptions = {},
): SiteUpdatePort {
  const { feed, images, health } = required;
  const tagOptions = { prefix: _optional.prefix, ids: _optional.ids };
  const tagFor = (version: string): string => imageTagForVersion({ version }, tagOptions);
  // The tag actually running before each apply, by backup id: the truest "previous tag" to go back to.
  const previousTags = new Map<string, string>();
  const switchTo = async (tag: string, optional?: SiteUpdateCallOptions): Promise<void> => {
    await images.setTag({ tag }, optional);
    await images.redeploy({ tag }, optional);
  };
  return {
    checkForUpdate: ({ runningVersion }, optional) =>
      checkForUpdateFromFeed({ runningVersion, feed }, { signal: optional?.signal, ids: _optional.ids }),
    planUpdate: async ({ runningVersion, update }) => {
      tagFor(update.latest); // Refuse a bad tag before the owner is ever asked to approve it.
      return { fromVersion: runningVersion, toVersion: update.latest, notes: update.notes };
    },
    applyUpdate: async ({ plan, backupId }, optional) => {
      const tag = tagFor(plan.toVersion);
      const previous = await images.currentTag({}, optional);
      previousTags.set(backupId, previous);
      await switchTo(tag, optional);
      return { summary: `Switched the site image from ${previous} to ${tag} and restarted it.` };
    },
    verifyUpdate: async ({ plan }, optional) => {
      const expected = tagFor(plan.toVersion);
      const running = await images.currentTag({}, optional);
      if (running !== expected) return { status: 'unhealthy', reason: `The site image is ${running}, not ${expected}.` };
      return health.check({ expectedVersion: plan.toVersion }, optional);
    },
    rollback: async ({ to, backupId }, optional) => {
      // Without a recorded apply (e.g. the adapter was rebuilt after a restart) the kept version names the tag.
      const previousTag = previousTags.get(backupId) ?? tagFor(to);
      // The online database adapter cannot choose when to replace a live database file, so managed
      // rollback delegates image and data recovery together instead of running the legacy pair first.
      const { rollbackDeployment } = _optional;
      if (rollbackDeployment) return rollbackDeployment({ previousTag, backupId }, optional);
      await switchTo(previousTag, optional);
      await _optional.data?.restore({ backupId }, optional);
    },
  };
}
