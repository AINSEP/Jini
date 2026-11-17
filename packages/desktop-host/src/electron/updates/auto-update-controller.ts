import type { Clock } from '@jini-ai/core/primitives';
import { describeErrorForLog } from '@jini-ai/core';
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

interface UpdateState {
  started: boolean;
  stopped: boolean;
  lastCheckAt: number | null;
  checking: boolean;
  readyVersion: string | null;
  promptedVersion: string | null;
  restartRequested: boolean;
  installStarted: boolean;
}

/** Shared collaborators and mutable lifecycle state for the controller helpers below. */
interface UpdateCtx {
  readonly deps: AutoUpdateControllerDeps;
  readonly now: () => number;
  readonly timers: UpdateTimersPort;
  readonly timing: Readonly<UpdateTiming>;
  readonly messages: UpdateMessages;
  readonly startedAt: number;
  readonly handles: UpdateTimer[];
  readonly state: UpdateState;
}

function logError(ctx: UpdateCtx, build: (required: { message: string }) => string, error: unknown): void {
  ctx.deps.log({ message: build({ message: describeErrorForLog({ err: error }) }) });
}

/** Request a restart only before staging; a second quit could interrupt Squirrel's handoff.
 * @complexity O(n) live presence records; effects are explanation or a quit request.
 */
function requestRestart(ctx: UpdateCtx): void {
  const { state, deps } = ctx;
  if (state.stopped || state.installStarted) return;
  const count = otherInstances(ctx);
  const action = decideRestartClick({ updateReady: state.readyVersion !== null, otherInstances: count });
  if (action === 'others-open') deps.explainOthersOpen({ count });
  if (action !== 'restart') return;
  state.restartRequested = true; deps.quit();
}

function onDownloaded(ctx: UpdateCtx, info: { version: string }): void {
  const { state, deps, messages } = ctx;
  if (state.stopped) return;
  state.readyVersion = info.version;
  deps.log({ message: messages.downloaded({ version: info.version }) });
  if (state.promptedVersion === info.version) return;
  state.promptedVersion = info.version;
  // Promise wrapping catches a prompt that throws synchronously as well as a rejection.
  Promise.resolve().then(() => deps.promptUpdateReady({ version: info.version })).then(
    restart => { if (restart && !state.stopped) requestRestart(ctx); },
    error => logError(ctx, messages.promptFailed, error),
  );
}

function onUpdaterError(ctx: UpdateCtx, error: unknown): void {
  if (ctx.state.stopped) return;
  logError(ctx, ctx.messages.error, error);
  // A failed Squirrel handoff must release the held quit rather than leave the app hanging.
  if (ctx.state.installStarted) ctx.deps.quit();
}

function registerUpdaterListeners(ctx: UpdateCtx): void {
  const { updater } = ctx.deps;
  if (isNativeUpdater(updater)) {
    updater.on('update-downloaded', (info: { version: string }) => onDownloaded(ctx, info));
    updater.on('error', (error: unknown) => onUpdaterError(ctx, error));
  } else {
    updater.on({ event: 'update-downloaded', listener: ({ payload }) => onDownloaded(ctx, payload) });
    updater.on({ event: 'error', listener: ({ payload }) => onUpdaterError(ctx, payload) });
  }
}

function otherInstances({ deps }: UpdateCtx): number { return deps.presence.readLive().filter(record => record.pid !== deps.pid).length; }
function heartbeat(ctx: UpdateCtx): void {
  const { deps } = ctx;
  try { deps.presence.write({ record: { pid: deps.pid, startedAt: ctx.startedAt, heartbeatAt: ctx.now() } }); }
  catch (error) { logError(ctx, ctx.messages.presenceWriteFailed, error); }
}
function check(ctx: UpdateCtx): void {
  const { state } = ctx;
  state.lastCheckAt = ctx.now(); state.checking = true;
  let result: ReturnType<UpdaterLike['checkForUpdates']>;
  try { result = ctx.deps.updater.checkForUpdates(); }
  catch (error) { state.checking = false; logError(ctx, ctx.messages.checkFailed, error); return; }
  result.then(value => value?.downloadPromise ?? null)
    .catch(error => logError(ctx, ctx.messages.checkFailed, error))
    .finally(() => { state.checking = false; });
}
function tick(ctx: UpdateCtx): void {
  const { state, deps } = ctx;
  if (state.stopped) return;
  heartbeat(ctx);
  const time = ctx.now();
  const isOwner = electUpdaterOwner({ instances: deps.presence.readLive(), now: time, staleMs: ctx.timing.staleMs }) === deps.pid;
  if (shouldCheckNow({ isOwner, lastCheckAt: state.lastCheckAt, now: time, busy: state.checking || state.readyVersion !== null, intervalMs: ctx.timing.checkIntervalMs })) check(ctx);
}
/** Hand off installation with native flags; false lets the current quit proceed on a sync failure.
 * Logs failures and cancels their fallback; successful handoffs retain it. @complexity O(1).
 */
function startInstall(ctx: UpdateCtx, { silent, relaunch }: { silent: boolean; relaunch: boolean }): boolean {
  const { deps, handles, timers } = ctx;
  const { updater } = deps;
  ctx.state.installStarted = true;
  updater.autoRunAppAfterInstall = relaunch;
  // Arm before the handoff so a synchronous failure cannot leave the held quit hanging.
  const fallback = timers.setTimeout({ callback: () => { if (!ctx.state.stopped) deps.quit(); }, ms: ctx.timing.stageTimeoutMs });
  fallback.unref?.(); handles.push(fallback);
  try {
    if (isNativeUpdater(updater)) updater.quitAndInstall(silent, relaunch);
    else updater.quitAndInstall({}, { isSilent: silent, isForceRunAfter: relaunch });
  }
  catch (error) {
    timers.clear({ timer: fallback });
    handles.splice(handles.indexOf(fallback), 1);
    logError(ctx, ctx.messages.error, error);
    return false;
  }
  return true;
}
function startController(ctx: UpdateCtx): void {
  const { state, timers, timing, handles } = ctx;
  if (state.started || state.stopped) return;
  // Advertise presence immediately so siblings see us, while delaying the first update check.
  state.started = true; heartbeat(ctx);
  const first = timers.setTimeout({ callback: () => tick(ctx), ms: timing.firstCheckDelayMs });
  const every = timers.setInterval({ callback: () => tick(ctx), ms: timing.tickMs });
  first.unref?.(); every.unref?.(); handles.push(first, every);
}
function beforeFinalQuit(ctx: UpdateCtx): boolean {
  const { state, deps } = ctx;
  if (state.stopped) return false;
  const action = decideFinalQuit({ platform: deps.platform, updateReady: state.readyVersion !== null,
    otherInstances: state.readyVersion !== null && !state.installStarted ? otherInstances(ctx) : 0,
    restartRequested: state.restartRequested, installStarted: state.installStarted });
  if (deps.platform === 'win32' && !state.installStarted) deps.updater.autoInstallOnAppQuit = action === 'install-on-quit';
  if (action === 'stage-then-quit') return startInstall(ctx, { silent: false, relaunch: false });
  if (action === 'install-and-relaunch') return startInstall(ctx, { silent: true, relaunch: true });
  return false;
}
function willQuit(ctx: UpdateCtx): void {
  if (ctx.state.stopped) return;
  ctx.state.stopped = true;
  for (const handle of ctx.handles) ctx.timers.clear({ timer: handle });
  ctx.deps.presence.remove({ pid: ctx.deps.pid });
}

/** Coordinates quiet downloads and last-instance installs through injected effects.
 * No single-instance lock is acquired. Construction registers updater listeners but starts no timers.
 * @complexity O(1) construction; O(n) live records per tick or final quit.
 */
export function createAutoUpdateController(deps: AutoUpdateControllerDeps, options: AutoUpdateControllerOptions = {}): AutoUpdateController {
  const clock: Clock = deps.clock !== undefined ? deps.clock : { nowMs: deps.now };
  const now = () => clock.nowMs();
  const ctx: UpdateCtx = {
    deps, now,
    timers: options.timers ?? deps.timers ?? createNodeUpdateTimers(),
    timing: { ...defaultUpdateTiming, ...deps.timing, ...options.timing },
    messages: options.messages ?? deps.messages ?? defaultUpdateMessages,
    startedAt: now(),
    handles: [],
    state: { started: false, stopped: false, lastCheckAt: null, checking: false, readyVersion: null, promptedVersion: null, restartRequested: false, installStarted: false },
  };
  deps.updater.autoDownload = true;
  // Windows registers its quit handler only if this is true at download time; final-quit policy
  // later decides whether to allow installation. macOS must withhold Squirrel until the final quit.
  deps.updater.autoInstallOnAppQuit = deps.platform === 'win32';
  registerUpdaterListeners(ctx);
  return {
    start: () => startController(ctx),
    tick: () => tick(ctx),
    requestRestart: () => requestRestart(ctx),
    beforeFinalQuit: () => beforeFinalQuit(ctx),
    willQuit: () => willQuit(ctx),
  };
}
