/**
 * A manual "Check for updates" from any running copy. The auto-update controller only checks from
 * the elected owner copy on its own interval, so a copy launched later could sit on an old version
 * for hours. This runs one check in the clicking copy, through the same native updater the
 * controller already listens to: a download it starts ends in the controller's own "Update ready"
 * prompt, and electron-updater reuses a download another copy already cached, so nothing downloads
 * twice. The host supplies eligibility, the preference read, every word of copy and the error
 * formatters (a caught updater error is handed to them raw, never turned into text here); see the
 * electron/updates README section for wiring.
 */

/** The slice of electron-updater's `autoUpdater` a manual check needs. */
export interface CheckableUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<{
    isUpdateAvailable?: boolean;
    updateInfo?: { version: string };
    downloadPromise?: Promise<unknown> | null;
  } | null>;
}

export type UpdateCheckOutcome =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready'; version: string }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'downloading'; version: string }
  | { kind: 'available'; version: string }
  | { kind: 'error' };

/** One native message box's text. */
export interface UpdateNotice {
  type: 'info' | 'error';
  message: string;
  detail: string;
}

/** What the host's copy sees for one outcome; `error` adds the raw message and copyable details. */
export interface UpdateNoticeArgs {
  outcome: UpdateCheckOutcome;
  currentVersion: string;
  isPackaged: boolean;
  automaticUpdates: boolean;
  errorMessage?: string | undefined;
  errorDetails?: string | undefined;
}

/** Host-owned wording for every notice a manual check can show. */
export interface UpdateCheckCopy {
  /** The notice for an outcome, or null to show nothing (the `ready` prompt replaces a notice). */
  notice: (args: UpdateNoticeArgs) => UpdateNotice | null;
  /** The notice for a download this check started that later failed. */
  downloadFailed: (args: { version: string; error: unknown }) => UpdateNotice;
  /** Copyable, redacted diagnostics appended to a failed check's notice as `errorDetails`. */
  checkFailedDetails: (args: { error: unknown }) => string;
}

export interface UpdateCheckNowDeps {
  isPackaged: boolean;
  currentVersion: () => string;
  /** The host's reason this launch runs no updater, or null. */
  skipReason: () => string | null;
  automaticUpdates: () => boolean;
  /** The version this copy's controller already downloaded and prompted for, or null. */
  readyVersion: () => string | null;
  loadUpdater: () => Promise<CheckableUpdater>;
  /** The existing "Update ready" prompt; restarts when the operator picks Restart. */
  showReadyPrompt: (args: { version: string }) => Promise<void>;
  notify: (notice: UpdateNotice) => void;
  log: (args: { message: string }) => void;
  copy: UpdateCheckCopy;
  /** The host's redacting log formatter for an updater error. */
  describeErrorForLog: (args: { error: unknown }) => string;
  /** The host's plain message for a failed check's error, handed to `copy.notice` as `errorMessage`. */
  describeErrorMessage: (args: { error: unknown }) => string;
}

const NETWORK_ERROR = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|ERR_CONNECTION|ERR_TIMED_OUT|ENOTFOUND|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/;

/** True when an electron-updater error message means the update server was unreachable. O(message). */
export function isNetworkUpdateError({ message }: { message: string }, _optional = {}): boolean {
  return NETWORK_ERROR.test(message);
}

type CheckResult = Awaited<ReturnType<CheckableUpdater['checkForUpdates']>>;

/**
 * One manual check at a time: a second click while one runs joins it, so no second dialog opens.
 * With automatic updates off it only looks: nothing downloads, and the notice says so.
 * @complexity O(1) per click, plus one network check.
 */
export function createUpdateCheckNow(deps: UpdateCheckNowDeps, _optional = {}): { checkNow: () => Promise<UpdateCheckOutcome> } {
  let inFlight: Promise<UpdateCheckOutcome> | null = null;
  const report = createUpdateOutcomeReporter(deps);
  // Called by its own name: the host's redacting describer is the one thing a caught error reaches
  // before a log line, and the log-safety gate recognises that describer by name.
  const { describeErrorForLog } = deps;

  function reportCheckResult({ result, automatic }: { result: CheckResult; automatic: boolean }): UpdateCheckOutcome {
    const version = result?.updateInfo?.version;
    if (!result?.isUpdateAvailable || !version) return report({ outcome: { kind: 'up-to-date', version: deps.currentVersion() } });
    if (!automatic) return report({ outcome: { kind: 'available', version } });
    // The controller's own listener prompts when this finishes; only a failure needs saying here.
    result.downloadPromise?.catch((error: unknown) => {
      deps.log({ message: `update download failed: ${describeErrorForLog({ error })}` });
      deps.notify(deps.copy.downloadFailed({ version, error }));
    });
    return report({ outcome: { kind: 'downloading', version } });
  }

  async function run(): Promise<UpdateCheckOutcome> {
    const skip = deps.skipReason();
    if (skip !== null) return report({ outcome: { kind: 'unavailable', reason: skip } });
    const automatic = deps.automaticUpdates();
    try {
      const ready = automatic ? deps.readyVersion() : null;
      if (ready !== null) {
        await deps.showReadyPrompt({ version: ready });
        return { kind: 'ready', version: ready };
      }
      const updater = await deps.loadUpdater();
      if (!automatic) {
        // A first import has electron-updater's defaults; the operator asked for a look only.
        updater.autoDownload = false;
        updater.autoInstallOnAppQuit = false;
      }
      return reportCheckResult({ result: await updater.checkForUpdates(), automatic });
    } catch (error) {
      deps.log({ message: `update check failed: ${describeErrorForLog({ error })}` });
      return report({ outcome: { kind: 'error' } }, {
        errorMessage: deps.describeErrorMessage({ error }), errorDetails: deps.copy.checkFailedDetails({ error }),
      });
    }
  }

  return {
    checkNow() {
      inFlight ??= run().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

function createUpdateOutcomeReporter(deps: UpdateCheckNowDeps) {
  return function report({ outcome }: { outcome: UpdateCheckOutcome }, { errorMessage, errorDetails }: { errorMessage?: string; errorDetails?: string } = {}): UpdateCheckOutcome {
    const notice = deps.copy.notice({
      outcome, currentVersion: deps.currentVersion(), isPackaged: deps.isPackaged,
      automaticUpdates: deps.automaticUpdates(), errorMessage, errorDetails,
    });
    if (notice) deps.notify(notice);
    return outcome;
  };
}

/** Register the check once on the host's channel. The renderer only awaits; main shows every notice. O(1). */
export function registerUpdateCheckIpc({ ipcMain, channel, checkNow }: {
  ipcMain: { handle: (channel: string, listener: () => Promise<void>) => void };
  channel: string;
  checkNow: () => Promise<UpdateCheckOutcome>;
}, _optional = {}): void {
  ipcMain.handle(channel, async () => { await checkNow(); });
}
