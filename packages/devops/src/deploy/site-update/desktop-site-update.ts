/**
 * @file `SiteUpdatePort` for a site run by the desktop app: the app binary and the site's database
 * move together. The adapter only says HOW to update; WHEN is decided by `runSiteUpdate`, which
 * refuses without the owner's approval for that exact version. Nothing here starts on its own: no
 * timers, and checking for an update never downloads, stages or migrates anything.
 */
import type { IdGenerator } from '@jini-ai/core/primitives';
import { checkForUpdateFromFeed } from './check-for-update.js';
import type {
  ReleaseFeedPort, SiteDataRestorePort, SiteHealthPort, SiteUpdateCallOptions, SiteUpdatePort,
} from './contracts.js';

/** The desktop app's own updater (download, stage, swap in, undo). */
export interface DesktopAppUpdaterPort {
  /** The app version actually running now. */
  currentVersion(required: Record<string, never>, optional?: SiteUpdateCallOptions): Promise<string>;
  /** Downloads and stages `version` without running it. */
  stage(required: { version: string }, optional?: SiteUpdateCallOptions): Promise<void>;
  /** Swaps the staged `version` in (relaunching as needed). */
  applyStaged(required: { version: string }, optional?: SiteUpdateCallOptions): Promise<void>;
  /** Puts the kept previous `version` back. Must be safe when the swap never happened. */
  rollbackTo(required: { version: string }, optional?: SiteUpdateCallOptions): Promise<void>;
}

/** The site's database side: run the migrations of a new version, or restore the pre-update backup. */
export interface DesktopSiteMigratePort extends SiteDataRestorePort {
  migrate(required: { toVersion: string; backupId: string }, optional?: SiteUpdateCallOptions): Promise<void>;
}

/** Options of {@link createDesktopSiteUpdate}. */
export interface DesktopSiteUpdateOptions {
  /** Mints the `ERR-` id when a feed or running version is not a version number. */
  ids?: IdGenerator | undefined;
  /**
   * The host's managed recovery: stop the app, restore the data backup, restart on `previousVersion`, and
   * check the old version is healthy, as one operation. When given it replaces the legacy app-then-data
   * rollback entirely; managed production updates always pass it.
   */
  rollbackDeployment?: DesktopRollbackDeploymentPort | undefined;
}

/** Puts the kept previous app binary and its data back together; see {@link DesktopSiteUpdateOptions.rollbackDeployment}. */
export type DesktopRollbackDeploymentPort = (
  required: { previousVersion: string; backupId: string },
  optional?: SiteUpdateCallOptions,
) => Promise<void>;

/**
 * Builds the desktop adapter. Apply order is stage app -> migrate site data -> swap app in, so a
 * failed migration never leaves the new app running on old data; rollback undoes both sides.
 *
 * @param required.feed - Where app releases are announced.
 * @param required.app - The app updater.
 * @param required.migrate - Runs the site's migrations and restores its data backup.
 * @param required.health - The live check of the site on the new version.
 * @returns A `SiteUpdatePort` to hand to `runSiteUpdate`.
 * @complexity O(1) port calls per method.
 */
export function createDesktopSiteUpdate(
  required: { feed: ReleaseFeedPort; app: DesktopAppUpdaterPort; migrate: DesktopSiteMigratePort; health: SiteHealthPort },
  _optional: DesktopSiteUpdateOptions = {},
): SiteUpdatePort {
  const { feed, app, migrate, health } = required;
  return {
    checkForUpdate: ({ runningVersion }, optional) =>
      checkForUpdateFromFeed({ runningVersion, feed }, { signal: optional?.signal, ids: _optional.ids }),
    planUpdate: async ({ runningVersion, update }) => ({ fromVersion: runningVersion, toVersion: update.latest, notes: update.notes }),
    applyUpdate: async ({ plan, backupId }, optional) => {
      const version = plan.toVersion;
      await app.stage({ version }, optional);
      await migrate.migrate({ toVersion: version, backupId }, optional);
      await app.applyStaged({ version }, optional);
      return { summary: `Installed app ${version} and moved the site data to ${version}.` };
    },
    verifyUpdate: async ({ plan }, optional) => {
      // An updater can report success yet relaunch the old app; asking the site then would test the wrong version.
      const running = await app.currentVersion({}, optional);
      if (running !== plan.toVersion) return { status: 'unhealthy', reason: `The app is still on ${running}, not ${plan.toVersion}.` };
      return health.check({ expectedVersion: plan.toVersion }, optional);
    },
    rollback: async ({ to, backupId }, optional) => {
      // The online database adapter cannot choose when to replace a live database file, so managed
      // rollback delegates binary and data recovery together instead of running the legacy pair first.
      const { rollbackDeployment } = _optional;
      if (rollbackDeployment) return rollbackDeployment({ previousVersion: to, backupId }, optional);
      await app.rollbackTo({ version: to }, optional);
      await migrate.restore({ backupId }, optional);
    },
  };
}
