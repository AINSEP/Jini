import type { Clock } from '@jini-ai/core/primitives';
import type { InstancePresencePort } from './instance-presence.js';
import { decideFinalQuit, decideRestartClick, electUpdaterOwner, shouldCheckNow, FIRST_CHECK_DELAY_MS, UPDATER_TICK_MS, UPDATE_CHECK_INTERVAL_MS, PRESENCE_STALE_MS } from './update-policy.js';

/** Native structural AppUpdater surface; framework methods keep their positional ABI.
 * Listener payloads retain their event-specific native types.
 */
export interface ElectronUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** Existing object-shaped updater ABI retained until hosts delete their compatibility glue. */
export interface LegacyUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  checkForUpdates(): Promise<{ downloadPromise?: Promise<unknown> | null } | null>;
  quitAndInstall(requiredArgs: Record<string, never>, optionalArgs?: { isSilent?: boolean; isForceRunAfter?: boolean }): void;
  on(required: { event: 'update-downloaded'; listener: (args: { payload: { version: string } }) => void }): unknown;
  on(required: { event: 'error'; listener: (args: { payload: unknown }) => void }): unknown;
}
export type UpdaterLike = ElectronUpdater | LegacyUpdaterLike;
type UpdaterRegistration =
  | [event: 'update-downloaded', listener: (info: { version: string }) => void]
  | [event: 'error', listener: (error: Error) => void];
export interface UpdateTimer { unref?: () => void }
export interface UpdateTimersPort {
  setTimeout({ callback, ms }: { callback: () => void; ms: number }): UpdateTimer;
  setInterval({ callback, ms }: { callback: () => void; ms: number }): UpdateTimer;
  clear({ timer }: { timer: UpdateTimer }): void;
}
export interface UpdateTiming {
  firstCheckDelayMs: number;
  tickMs: number;
  checkIntervalMs: number;
  staleMs: number;
  stageTimeoutMs: number;
}
/** Host-replaceable copy formatters let the host own its wording and branding. */
export interface UpdateMessages {
  downloaded: (args: { version: string }) => string;
  error: (args: { message: string }) => string;
  promptFailed: (args: { message: string }) => string;
  checkFailed: (args: { message: string }) => string;
  presenceWriteFailed: (args: { message: string }) => string;
}
export interface AutoUpdateControllerEffects {
  updater: UpdaterLike;
  platform: NodeJS.Platform;
  pid: number;
  presence: InstancePresencePort;
  /** Compatibility placement; new hosts supply these overrides in parameter two. */
  timers?: UpdateTimersPort;
  timing?: UpdateTiming;
  messages?: UpdateMessages;
  promptUpdateReady: (args: { version: string }) => Promise<boolean>;
  explainOthersOpen: (args: { count: number }) => void;
  quit: () => void;
  log: (args: { message: string }) => void;
}
/** New hosts share a core Clock. The old callback is accepted until compatibility glue is removed. */
export type AutoUpdateControllerDeps = AutoUpdateControllerEffects & (
  | { clock: Clock; now?: never }
  | { now: () => number; clock?: never }
);
export interface AutoUpdateControllerOptions {
  timers?: UpdateTimersPort;
  timing?: Partial<UpdateTiming>;
  messages?: UpdateMessages;
}

/** Default update copy is replaceable as a whole by the host. */
export const defaultUpdateMessages: UpdateMessages = {
  downloaded: ({ version }) => `auto-update: ${version} downloaded`,
  error: ({ message }) => `auto-update: ${message}`,
  promptFailed: ({ message }) => `auto-update: prompt failed: ${message}`,
  checkFailed: ({ message }) => `auto-update: check failed: ${message}`,
  presenceWriteFailed: ({ message }) => `auto-update: presence write failed: ${message}`,
};

/** Reference timings preserve boot/network contention and missed-heartbeat tolerance. */
export const defaultUpdateTiming: Readonly<UpdateTiming> = {
  firstCheckDelayMs: FIRST_CHECK_DELAY_MS,
  tickMs: UPDATER_TICK_MS,
  checkIntervalMs: UPDATE_CHECK_INTERVAL_MS,
  staleMs: PRESENCE_STALE_MS,
  // Bound the macOS wait for Squirrel's handoff; quit without the update after two minutes.
  stageTimeoutMs: 2 * 60 * 1000,
};

/** Node scheduling adapter owns its native handles; clear never casts a host-supplied timer. */
export function createNodeUpdateTimers(): UpdateTimersPort {
  const handles = new Map<UpdateTimer, ReturnType<typeof setTimeout>>();
  const remember = (handle: ReturnType<typeof setTimeout>): UpdateTimer => {
    handles.set(handle, handle);
    return handle;
  };
  return {
    setTimeout: ({ callback, ms }) => remember(setTimeout(callback, ms)),
    setInterval: ({ callback, ms }) => remember(setInterval(callback, ms)),
    clear({ timer }) {
      const handle = handles.get(timer);
      if (handle === undefined) return;
      clearTimeout(handle); handles.delete(timer);
    },
  };
}

/** Forward native methods and mutable configuration without importing electron-updater.
 * Both native event listener overloads retain their payload types and the updater receiver.
 */
export function createElectronUpdaterAdapter({ updater }: { updater: ElectronUpdater }): ElectronUpdater {
  return {
    get autoDownload() { return updater.autoDownload; },
    set autoDownload(value) { updater.autoDownload = value; },
    get autoInstallOnAppQuit() { return updater.autoInstallOnAppQuit; },
    set autoInstallOnAppQuit(value) { updater.autoInstallOnAppQuit = value; },
    get autoRunAppAfterInstall() { return updater.autoRunAppAfterInstall; },
    set autoRunAppAfterInstall(value) { updater.autoRunAppAfterInstall = value; },
    checkForUpdates: () => updater.checkForUpdates(),
    quitAndInstall: (isSilent, isForceRunAfter) => updater.quitAndInstall(isSilent, isForceRunAfter),
    on(...args: UpdaterRegistration) {
      if (args[0] === 'update-downloaded') return updater.on(args[0], args[1]);
      return updater.on(args[0], args[1]);
    },
  };
}

// EventEmitter.on has two parameters (or a rest tuple); the legacy object registration has one.
// This compatibility distinction can disappear after hosts remove the one-object ABI.
function isNativeUpdater(updater: UpdaterLike): updater is ElectronUpdater {
  return updater.on.length !== 1;
}

export interface AutoUpdateController {
  start(): void;
  tick(): void;
  requestRestart(): void;
  /** True holds the final quit while an installation takes over. Call after the shutdown drain. */
  beforeFinalQuit(): boolean;
  willQuit(): void;
}
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Coordinates quiet downloads and last-instance installs through injected effects.
 * No single-instance lock is acquired. Construction registers updater listeners but starts no timers.
 * @complexity O(1) construction; O(n) live records per tick or final quit.
 */
export function createAutoUpdateController(deps: AutoUpdateControllerDeps, options: AutoUpdateControllerOptions = {}): AutoUpdateController {
  const { updater, platform, pid, presence, log } = deps;
  const clock: Clock = deps.clock !== undefined ? deps.clock : { nowMs: deps.now };
  const now = () => clock.nowMs();
  const timers = options.timers ?? deps.timers ?? createNodeUpdateTimers();
  const timing = { ...defaultUpdateTiming, ...deps.timing, ...options.timing };
  const messages = options.messages ?? deps.messages ?? defaultUpdateMessages;
  const startedAt = now();
  const handles: UpdateTimer[] = [];
  let started = false;
  let stopped = false;
  let lastCheckAt: number | null = null;
  let checking = false;
  let readyVersion: string | null = null;
  let promptedVersion: string | null = null;
  let restartRequested = false;
  let installStarted = false;
  updater.autoDownload = true;
  // Windows registers its quit handler only if this is true at download time; final-quit policy
  // later decides whether to allow installation. macOS must withhold Squirrel until the final quit.
  updater.autoInstallOnAppQuit = platform === 'win32';

  const onDownloaded = (info: { version: string }) => {
    if (stopped) return;
    readyVersion = info.version;
    log({ message: messages.downloaded({ version: info.version }) });
    if (promptedVersion === info.version) return;
    promptedVersion = info.version;
    // Promise wrapping catches a prompt that throws synchronously as well as a rejection.
    Promise.resolve().then(() => deps.promptUpdateReady({ version: info.version })).then(
      restart => { if (restart && !stopped) requestRestart(); },
      error => log({ message: messages.promptFailed({ message: messageOf(error) }) }),
    );
  };
  const onError = (error: unknown) => {
    if (stopped) return;
    log({ message: messages.error({ message: messageOf(error) }) });
    // A failed Squirrel handoff must release the held quit rather than leave the app hanging.
    if (installStarted) deps.quit();
  };
  if (isNativeUpdater(updater)) {
    updater.on('update-downloaded', onDownloaded);
    updater.on('error', onError);
  } else {
    updater.on({ event: 'update-downloaded', listener: ({ payload }) => onDownloaded(payload) });
    updater.on({ event: 'error', listener: ({ payload }) => onError(payload) });
  }

  function otherInstances(): number { return presence.readLive().filter(record => record.pid !== pid).length; }
  function heartbeat(): void {
    try { presence.write({ record: { pid, startedAt, heartbeatAt: now() } }); }
    catch (error) { log({ message: messages.presenceWriteFailed({ message: messageOf(error) }) }); }
  }
  function check(): void {
    lastCheckAt = now(); checking = true;
    let result: ReturnType<UpdaterLike['checkForUpdates']>;
    try { result = updater.checkForUpdates(); }
    catch (error) { checking = false; log({ message: messages.checkFailed({ message: messageOf(error) }) }); return; }
    result.then(value => value?.downloadPromise ?? null)
      .catch(error => log({ message: messages.checkFailed({ message: messageOf(error) }) }))
      .finally(() => { checking = false; });
  }
  function tick(): void {
    if (stopped) return;
    heartbeat();
    const time = now();
    const isOwner = electUpdaterOwner({ instances: presence.readLive(), now: time, staleMs: timing.staleMs }) === pid;
    if (shouldCheckNow({ isOwner, lastCheckAt, now: time, busy: checking || readyVersion !== null, intervalMs: timing.checkIntervalMs })) check();
  }
  function requestRestart(): void {
    if (stopped) return;
    const count = otherInstances();
    const action = decideRestartClick({ updateReady: readyVersion !== null, otherInstances: count });
    if (action === 'others-open') deps.explainOthersOpen({ count });
    if (action !== 'restart') return;
    restartRequested = true; deps.quit();
  }
  function startInstall(silent: boolean, relaunch: boolean): true {
    installStarted = true;
    updater.autoRunAppAfterInstall = relaunch;
    // Arm before the handoff so a synchronous failure cannot leave the held quit hanging.
    const fallback = timers.setTimeout({ callback: () => { if (!stopped) deps.quit(); }, ms: timing.stageTimeoutMs });
    fallback.unref?.(); handles.push(fallback);
    try {
      if (isNativeUpdater(updater)) updater.quitAndInstall(silent, relaunch);
      else updater.quitAndInstall({}, { isSilent: silent, isForceRunAfter: relaunch });
    }
    catch (error) { log({ message: messages.error({ message: messageOf(error) }) }); deps.quit(); }
    return true;
  }
  return {
    start() {
      if (started || stopped) return;
      // Advertise presence immediately so siblings see us, while delaying the first update check.
      started = true; heartbeat();
      const first = timers.setTimeout({ callback: tick, ms: timing.firstCheckDelayMs });
      const every = timers.setInterval({ callback: tick, ms: timing.tickMs });
      first.unref?.(); every.unref?.(); handles.push(first, every);
    },
    tick,
    requestRestart,
    beforeFinalQuit() {
      if (stopped) return false;
      const action = decideFinalQuit({ platform, updateReady: readyVersion !== null,
        otherInstances: readyVersion !== null && !installStarted ? otherInstances() : 0,
        restartRequested, installStarted });
      if (platform === 'win32' && !installStarted) updater.autoInstallOnAppQuit = action === 'install-on-quit';
      if (action === 'stage-then-quit') return startInstall(false, false);
      if (action === 'install-and-relaunch') return startInstall(true, true);
      return false;
    },
    willQuit() {
      if (stopped) return;
      stopped = true;
      for (const handle of handles) timers.clear({ timer: handle });
      presence.remove({ pid });
    },
  };
}
