/**
 * @file In-memory site-update adapter for tests and for hosts wiring the update flow before a real
 * platform adapter exists. It records every call, keeps a pretend live version, and can be told to
 * block, fail a check, or throw at any port so each safety branch can be exercised.
 */
import { checkForUpdateFromFeed } from './check-for-update.js';
import type {
  MigrationReadiness, ReleaseFeedPort, SiteRelease, SiteUpdateCallOptions, SiteUpdateVerification,
} from './contracts.js';
import type { SiteUpdatePorts } from './run-site-update.js';

export type FakeSiteUpdateFailPoint = 'createBackup' | 'check' | 'applyUpdate' | 'verifyUpdate' | 'rollback';

/** Options of {@link createFakeSiteUpdate}. */
export interface FakeSiteUpdateOptions {
  /** What the readiness gate answers. Default ok. */
  readiness?: MigrationReadiness;
  /** What the live check answers. Default healthy. */
  verify?: SiteUpdateVerification;
  /** A port that throws `fake <name> failed` after recording its call. */
  failOn?: FakeSiteUpdateFailPoint;
  /** Runs after each call is recorded, e.g. to abort mid-run. Receives the recorded call text. */
  onCall?: (call: string) => void;
}

/** The fake and its inspection handles. */
export interface FakeSiteUpdate {
  ports: SiteUpdatePorts;
  feed: ReleaseFeedPort;
  /** Calls to the backup, readiness and platform write/check ports, in order. */
  calls: string[];
  /** The abort signal each recorded call received, in the same order as `calls`. */
  signals: Array<AbortSignal | undefined>;
  state: { liveVersion: string };
}

/**
 * Builds an in-memory adapter whose feed always offers `latest`.
 *
 * @param required.runningVersion - The pretend live version at start.
 * @param required.latest - The release the feed announces.
 * @returns Ports for `runSiteUpdate`, the feed, and the recorded calls/signals/state.
 * @complexity O(1) per call.
 */
export function createFakeSiteUpdate(
  required: { runningVersion: string; latest: SiteRelease },
  _optional: FakeSiteUpdateOptions = {},
): FakeSiteUpdate {
  const fake: FakeSiteUpdate = { ports: undefined as never, feed: { latestRelease: async () => required.latest }, calls: [], signals: [], state: { liveVersion: required.runningVersion } };
  let errorCount = 0;
  let backupCount = 0;
  const nextErrorId = (): string => {
    errorCount += 1;
    return `ERR-FAKE-0000-0000-${String(errorCount).padStart(4, '0')}`;
  };
  const record = (failPoint: FakeSiteUpdateFailPoint, call: string, optional?: SiteUpdateCallOptions): void => {
    fake.calls.push(call);
    fake.signals.push(optional?.signal);
    _optional.onCall?.(call);
    if (_optional.failOn === failPoint) throw new Error(`fake ${failPoint} failed`);
  };
  fake.ports = {
    ids: { newId: nextErrorId },
    backup: {
      createBackup: async (_required, optional) => { record('createBackup', 'createBackup', optional); backupCount += 1; return { backupId: `backup-${backupCount}` }; },
    },
    readiness: {
      check: async ({ toVersion }, optional) => { record('check', `check:${toVersion}`, optional); return _optional.readiness ?? { status: 'ok' }; },
    },
    site: {
      checkForUpdate: ({ runningVersion }, optional) => checkForUpdateFromFeed({ runningVersion, feed: fake.feed }, optional),
      planUpdate: async ({ runningVersion, update }) => ({ fromVersion: runningVersion, toVersion: update.latest, notes: update.notes }),
      applyUpdate: async ({ plan, backupId }, optional) => {
        record('applyUpdate', `applyUpdate:${plan.toVersion}:${backupId}`, optional);
        fake.state.liveVersion = plan.toVersion;
        return { summary: `Deployed ${plan.toVersion}.` };
      },
      verifyUpdate: async ({ plan }, optional) => { record('verifyUpdate', `verifyUpdate:${plan.toVersion}`, optional); return _optional.verify ?? { status: 'healthy' }; },
      rollback: async ({ to, backupId }, optional) => { record('rollback', `rollback:${to}:${backupId}`, optional); fake.state.liveVersion = to; },
    },
  };
  return fake;
}
