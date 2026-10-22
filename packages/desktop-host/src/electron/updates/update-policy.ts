/** Pure update eligibility, owner election and last-instance installation decisions. Constants are reference defaults; callers may override timing. */
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const UPDATER_TICK_MS = 15 * 60 * 1000;
// Periodically re-elect so a new owner takes over within minutes of the old one quitting.

const FIRST_CHECK_DELAY_MS = 30 * 1000;
// Delay the first check so network/update work does not compete with application boot.

const PRESENCE_STALE_MS = 3 * UPDATER_TICK_MS;
// Three missed ticks tolerate a busy event loop or sleep/wake without spuriously transferring ownership.

interface UpdaterEnvironment {
  isPackaged: boolean;

  windowsStore: boolean;
  platform: NodeJS.Platform;

  disabledByEnv: boolean;

  /** A headless self-test must never download updates or prompt the operator. */
  selftest: boolean;
}

/** Evaluate launch eligibility with host-selected platforms and reason wording. @complexity O(1) beyond platform membership. */
function updaterSkipReason({ environment: env, supportedPlatforms, reasons }: {
 environment: UpdaterEnvironment; supportedPlatforms: readonly NodeJS.Platform[];
 reasons: { notPackaged: string; windowsStore: string; unsupportedPlatform: (args: { platform: NodeJS.Platform }) => string; disabled: string; selftest: string };
}): string | null {
  // Development has no installed release to update; Store packages are updated by the Store and
  // must not be overwritten by a standalone installer. Published platforms are host policy.
  if (!env.isPackaged) return reasons.notPackaged;
  if (env.windowsStore) return reasons.windowsStore;
  if (!supportedPlatforms.includes(env.platform)) return reasons.unsupportedPlatform({ platform: env.platform });
  if (env.disabledByEnv) return reasons.disabled;
  if (env.selftest) return reasons.selftest;
  return null;
}

interface InstanceRecord {
  pid: number;
  startedAt: number;
  heartbeatAt: number;
}

/** Elect the oldest fresh instance, breaking equal start times by lowest pid. @complexity O(n) instances. */
function electUpdaterOwner({ instances, now, staleMs }: { instances: readonly InstanceRecord[]; now: number; staleMs: number }): number | null {
  // Elect only one downloader so sibling instances cannot race into the shared update cache.
  let owner: InstanceRecord | null = null;
  for (const instance of instances) {
    if (now - instance.heartbeatAt > staleMs) continue;
    if (owner === null || startedBefore(instance, owner)) owner = instance;
  }
  return owner === null ? null : owner.pid;
}

function startedBefore(a: InstanceRecord, b: InstanceRecord): boolean {
  return a.startedAt === b.startedAt ? a.pid < b.pid : a.startedAt < b.startedAt;
}

interface CheckInput {
  isOwner: boolean;

  lastCheckAt: number | null;
  now: number;

  busy: boolean;
  intervalMs: number;
}

/** Check only when the owner is idle and the caller-selected interval has elapsed. @complexity O(1). */
function shouldCheckNow(input: CheckInput): boolean {
  if (!input.isOwner || input.busy) return false;
  if (input.lastCheckAt === null) return true;
  return input.now - input.lastCheckAt >= input.intervalMs;
}

type FinalQuitAction = "proceed" | "install-on-quit" | "stage-then-quit" | "install-and-relaunch";

interface FinalQuitInput {
  platform: NodeJS.Platform;
  updateReady: boolean;

  otherInstances: number;
  restartRequested: boolean;

  installStarted: boolean;
}

/** Install only from the last instance after draining; an already-started installation proceeds normally. @complexity O(1). */
function decideFinalQuit(input: FinalQuitInput): FinalQuitAction {
  // Installers replace the shared bundle or terminate sibling processes. Only the last drained
  // instance may install. Do not feed Squirrel at download time: once staged it installs on ANY exit,
  // including an exit while siblings are still open; stage only at this final quit boundary.
  if (input.installStarted || !input.updateReady || input.otherInstances > 0) return "proceed";
  if (input.restartRequested) return "install-and-relaunch";
  return input.platform === "darwin" ? "stage-then-quit" : "install-on-quit";
}

type RestartClickAction = "restart" | "others-open" | "not-ready";

/** Restart only for a ready update with no live siblings. @complexity O(1). */
function decideRestartClick({ updateReady, otherInstances }: { updateReady: boolean; otherInstances: number }): RestartClickAction {
  if (!updateReady) return "not-ready";
  return otherInstances > 0 ? "others-open" : "restart";
}

export {
  FIRST_CHECK_DELAY_MS,
  PRESENCE_STALE_MS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATER_TICK_MS,
  decideFinalQuit,
  decideRestartClick,
  electUpdaterOwner,
  shouldCheckNow,
  updaterSkipReason,
};
export type { CheckInput, FinalQuitAction, FinalQuitInput, InstanceRecord, RestartClickAction, UpdaterEnvironment };
