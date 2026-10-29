import type { AboutUpdateControl, AboutUpdatePrimaryAction, AppVersionInfo, SilentUpdatesState, UpdaterModel } from './types.js';

/**
 * Default dictionary keys the About panel resolves against the host's own
 * i18n. Exported so a host can see the full set it needs to provide rather
 * than discovering them one missing string at a time.
 */
export const ABOUT_UPDATE_KEYS = {
  development: 'settings.updateStatusDevelopment',
  unsupported: 'settings.updateStatusUnsupported',
  checking: 'settings.updateStatusChecking',
  checkingLabel: 'updater.checking',
  upToDate: 'settings.updateStatusUpToDate',
  recheck: 'settings.updateRecheck',
  available: 'settings.updateStatusAvailable',
  availableUnknown: 'settings.updateStatusAvailableUnknown',
  download: 'updater.download',
  downloading: 'settings.updateStatusDownloading',
  downloadingPercent: 'settings.updateStatusDownloadingPercent',
  downloadingLabel: 'updater.downloading',
  ready: 'settings.updateStatusReady',
  readyUnknown: 'settings.updateStatusReadyUnknown',
  installNow: 'settings.updateNow',
  installRestart: 'updater.installRestart',
  installingRestart: 'updater.installingRestart',
  installing: 'settings.updateStatusInstalling',
  opening: 'updater.opening',
  quit: 'updater.quitButton',
  failed: 'updater.failed',
  retry: 'settings.updateRetry',
  notChecked: 'settings.updateStatusNotChecked',
  check: 'settings.updateCheck',
} as const;

type UpdaterStatusState = NonNullable<UpdaterModel['status']>['state'];

const K = ABOUT_UPDATE_KEYS;

/**
 * Shared by the capability gate and the reported `unsupported` state — one
 * outcome, since the operator can do nothing about either from this panel.
 */
const UNSUPPORTED_CONTROL: AboutUpdateControl = {
  primaryAction: null,
  primaryLabelKey: null,
  showReleaseLink: true,
  statusKey: K.unsupported,
  statusTone: 'warning',
};

const DEVELOPMENT_CONTROL: AboutUpdateControl = {
  primaryAction: null,
  primaryLabelKey: null,
  showReleaseLink: true,
  statusKey: K.development,
  statusTone: 'neutral',
};

/** `{ statusVars: { version } }` when the version is known (truthy), else nothing. */
function versionVars(model: UpdaterModel): Pick<AboutUpdateControl, 'statusVars'> {
  return model.availableVersion ? { statusVars: { version: model.availableVersion } } : {};
}

/** Whether either install route (hand off to an installer, or apply in place) is open. */
function canInstall(model: UpdaterModel): boolean {
  return Boolean(model.canOpenInstaller || model.canApplyInPlace);
}

function deriveAvailable(model: UpdaterModel): AboutUpdateControl {
  return {
    primaryAction: model.canDownload ? 'download' : null,
    primaryLabelKey: model.canDownload ? K.download : null,
    showReleaseLink: true,
    statusKey: model.availableVersion ? K.available : K.availableUnknown,
    statusTone: 'warning',
    ...versionVars(model),
  };
}

function deriveDownloading(model: UpdaterModel): AboutUpdateControl {
  const percent = model.downloadProgress?.percent;
  const known = typeof percent === 'number';
  return {
    primaryAction: null,
    primaryLabelKey: K.downloadingLabel,
    showReleaseLink: true,
    statusKey: known ? K.downloadingPercent : K.downloading,
    statusTone: 'neutral',
    ...(known ? { statusVars: { percent } } : {}),
  };
}

function deriveDownloaded(model: UpdaterModel): AboutUpdateControl {
  const payload = model.updateKind === 'payload';
  // The installer is already running; the only useful act left is to get
  // out of its way.
  if (model.installerOpened && model.canQuitAfterInstallerOpen) {
    return {
      primaryAction: 'quit',
      primaryLabelKey: K.quit,
      showReleaseLink: false,
      statusKey: payload ? K.installingRestart : K.opening,
      statusTone: 'neutral',
    };
  }
  const installable = canInstall(model);
  const installLabelKey = payload ? K.installRestart : K.installNow;
  return {
    primaryAction: installable ? 'install' : null,
    primaryLabelKey: installable ? installLabelKey : null,
    showReleaseLink: true,
    statusKey: model.availableVersion ? K.ready : K.readyUnknown,
    statusTone: 'success',
    ...versionVars(model),
  };
}

/**
 * Retry the furthest-along step that is still possible: re-install a
 * download we already have, else re-download a version we know about,
 * else start over. Sending the operator back to "check" when a finished
 * download is sitting on disk would throw away the expensive part.
 */
function errorRetryAction(model: UpdaterModel): AboutUpdatePrimaryAction {
  if (model.status?.downloadPath != null && canInstall(model)) return 'install';
  if (model.availableVersion != null && model.canDownload) return 'download';
  return 'check';
}

function deriveError(model: UpdaterModel): AboutUpdateControl {
  return {
    primaryAction: errorRetryAction(model),
    primaryLabelKey: K.retry,
    showReleaseLink: true,
    statusKey: K.failed,
    statusTone: 'error',
  };
}

/**
 * `idle`, and any state a newer backend reports that this build predates.
 * Falling through to "you can check" is the safe default: it offers the
 * one action that is valid from any unknown state.
 */
const IDLE_CONTROL: AboutUpdateControl = {
  primaryAction: 'check',
  primaryLabelKey: K.check,
  showReleaseLink: true,
  statusKey: K.notChecked,
  statusTone: 'neutral',
};

/**
 * One deriver per reported state. A `Map` (not an object literal) so a
 * state string that happens to name an `Object.prototype` member can never
 * resolve to anything but the idle fallback.
 */
const STATE_DERIVERS: ReadonlyMap<UpdaterStatusState, (model: UpdaterModel) => AboutUpdateControl> = new Map<UpdaterStatusState, (model: UpdaterModel) => AboutUpdateControl>([
  [
    'checking',
    () => ({
      primaryAction: null,
      primaryLabelKey: K.checkingLabel,
      showReleaseLink: true,
      statusKey: K.checking,
      statusTone: 'neutral',
    }),
  ],
  [
    'not-available',
    () => ({
      primaryAction: 'check',
      primaryLabelKey: K.recheck,
      showReleaseLink: true,
      statusKey: K.upToDate,
      statusTone: 'success',
    }),
  ],
  ['available', deriveAvailable],
  ['downloading', deriveDownloading],
  ['downloaded', deriveDownloaded],
  [
    'installing',
    () => ({
      primaryAction: null,
      primaryLabelKey: K.installingRestart,
      showReleaseLink: false,
      statusKey: K.installing,
      statusTone: 'neutral',
    }),
  ],
  ['error', deriveError],
  ['unsupported', () => ({ ...UNSUPPORTED_CONTROL })],
]);

/**
 * Derives what the About panel's update row should show.
 *
 * A total function over the updater state — every branch returns a complete
 * `AboutUpdateControl`, so the panel never has to decide anything itself.
 *
 * Order matters, and the first two checks are not interchangeable:
 *
 * 1. **Unpackaged build first.** Running from source is reported as its own
 *    "development" state rather than "unsupported". Both disable updating, but
 *    telling a developer their build is unsupported would be actively
 *    misleading.
 * 2. **Then capability.** Not desktop, or updates disabled, or an unsupported
 *    build — one shared "unsupported" outcome, since the operator can do
 *    nothing about any of them from this panel.
 *
 * After that it is a lookup of the reported state in `STATE_DERIVERS`. Two subtleties worth
 * keeping when reading it:
 *
 * - `primaryLabelKey` can be set while `primaryAction` is `null`. That is the
 *   in-progress case — a visible but inert button reading "Downloading…"
 *   rather than the button vanishing and the row reflowing.
 * - The release link is hidden in exactly the two states where the app is
 *   about to disappear (installing, or quitting to let an installer run).
 *   Offering a navigation there invites a click that cannot complete.
 *
 * @complexity O(1) — a fixed-size map lookup, no iteration.
 */
export function deriveAboutUpdateControl(
  model: UpdaterModel,
  appVersionInfo: AppVersionInfo | null,
): AboutUpdateControl {
  if (appVersionInfo?.packaged === false) return { ...DEVELOPMENT_CONTROL };
  if (model.environment !== 'desktop' || !model.enabled || !model.supported) return { ...UNSUPPORTED_CONTROL };
  const derive = model.status ? STATE_DERIVERS.get(model.status.state) : undefined;
  return derive ? derive(model) : { ...IDLE_CONTROL };
}

/**
 * Whether the primary button should be disabled.
 *
 * Three independent reasons, any of which is sufficient: there is no action to
 * take, the host says an action is already in flight, or the caller is
 * awaiting its own async work.
 */
export function isAboutUpdateActionDisabled(
  control: AboutUpdateControl,
  model: UpdaterModel,
  actionBusy = false,
): boolean {
  return control.primaryAction === null || Boolean(model.busy) || actionBusy;
}

/**
 * Optimistically applies a new "allow silent updates" value and marks a
 * write in flight. Call the instant the operator flips the toggle, before
 * the write is even issued — the control must never wait on the network to
 * reflect the click.
 *
 * Pairs with a caller-owned staleness guard (e.g. `createAsyncCommitGuard`):
 * this function has no notion of "which write is current" because it is not
 * given one — ordering is entirely the caller's responsibility, same split
 * as `useMemoryConfig`'s optimistic toggles pairing that guard with their
 * own confirmed-value bookkeeping.
 *
 * @complexity O(1)
 */
export function beginSilentUpdatesWrite(next: boolean): SilentUpdatesState {
  return { allowSilentUpdates: next, busy: true };
}

/**
 * A silent-updates write that landed: keeps the already-applied optimistic
 * value and clears busy. Callers must have already checked their own
 * staleness guard before calling this — a settle for a write that is no
 * longer the latest attempt must never reach here at all, not be filtered
 * out inside it.
 *
 * @complexity O(1)
 */
export function resolveSilentUpdatesWriteSuccess(value: boolean): SilentUpdatesState {
  return { allowSilentUpdates: value, busy: false };
}

/**
 * A silent-updates write that failed: rolls back to `previous` — the value
 * in effect immediately before THIS write's own optimistic set, not a
 * hardcoded default and not necessarily the value before some earlier,
 * already-superseded write. Clears busy. Same staleness precondition as
 * {@link resolveSilentUpdatesWriteSuccess}.
 *
 * @complexity O(1)
 */
export function resolveSilentUpdatesWriteFailure(previous: boolean): SilentUpdatesState {
  return { allowSilentUpdates: previous, busy: false };
}
