/**
 * The desktop auto-updater lifecycle around one `AutoUpdateController`: start it when this launch may
 * run one, stop it when the host's automatic-updates preference turns it off, say whether the final
 * quit installs an update, and hand a manual "Check for updates" the same native updater. The
 * controller's own rules live in `auto-update-controller.ts`; this module owns only the lifecycle
 * state. The host injects eligibility, the preference read/write, the lazy native-updater load, the
 * controller factory, the "Update ready" prompt and a reporter (no copy or logging lives here); see
 * the electron/updates README section for wiring.
 */
import type { AutoUpdateController } from './auto-update-controller.js';

/** The slice of electron-updater's `autoUpdater` the lifecycle itself toggles. */
export interface DesktopNativeUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
}

/** The lifecycle's state: what an entry module would otherwise keep in four module variables. */
export interface DesktopUpdaterState<U extends DesktopNativeUpdater = DesktopNativeUpdater> {
  /** The auto-updater, or `null` when this launch does not run one (ineligible, or the preference is
   *  off). `before-quit` asks it whether the final quit installs an update. */
  controller: AutoUpdateController | null;
  native: U | null;
  starting: boolean;
  /** The version `controller` downloaded and prompted for; a manual check shows that prompt again. */
  readyVersion: string | null;
}

/** Lifecycle events the host turns into its own log lines. */
export interface DesktopUpdaterReporter {
  /** This launch runs no updater; `reason` is the host's `skipReason()`. */
  skipped: (args: { reason: string }) => void;
  /** A background start failed; it never fails the boot. */
  startFailed: (args: { error: unknown }) => void;
}

export interface DesktopUpdaterPorts<U extends DesktopNativeUpdater = DesktopNativeUpdater> {
  /** The persisted automatic-updates choice, read fresh each time. */
  automaticUpdates: () => boolean;
  saveAutomaticUpdates: (args: { enabled: boolean }) => void;
  /** The host's reason this launch runs no updater, or null. */
  skipReason: () => string | null;
  /** Resolves the native updater. Called only once the skip gate has passed, so an ineligible launch
   *  never reads it. */
  loadNativeUpdater: () => Promise<U>;
  /** No quit drain has begun. */
  quitIdle: () => boolean;
  /** Builds a controller bound to `updater`. Called once per start, so host inputs it reads (a data
   *  directory that may still move, for one) are read when a controller is created. */
  createController: (args: {
    updater: U;
    promptUpdateReady: (args: { version: string }) => Promise<boolean>;
  }) => AutoUpdateController;
  /** The host's "Update ready" prompt; resolves true for Restart. */
  promptUpdateReady: (args: { version: string }) => Promise<boolean>;
  reporter: DesktopUpdaterReporter;
}

export interface DesktopUpdater<U extends DesktopNativeUpdater = DesktopNativeUpdater> {
  state: DesktopUpdaterState<U>;
  start(): Promise<void>;
  startInBackground(): void;
  setAutomaticUpdates(args: { enabled: boolean }): void;
  finalQuitHeldForUpdate(): boolean;
  willQuit(): void;
  readyVersion(): string | null;
  loadUpdaterForCheck(): Promise<U>;
  showReadyPrompt(args: { version: string }): Promise<void>;
}

/** Nothing started yet. */
export function createDesktopUpdaterState<U extends DesktopNativeUpdater = DesktopNativeUpdater>(
  _requiredArgs = {}, _optionalArgs = {},
): DesktopUpdaterState<U> {
  return { controller: null, native: null, starting: false, readyVersion: null };
}

/**
 * Binds the updater lifecycle to injected preference, native-updater and controller ports.
 * @complexity O(1) per call beyond the injected ports.
 */
export function createDesktopUpdater<U extends DesktopNativeUpdater>({ ports }: { ports: DesktopUpdaterPorts<U> }, {
  state = createDesktopUpdaterState<U>(),
}: { state?: DesktopUpdaterState<U> } = {}): DesktopUpdater<U> {
  let startup: Promise<void> | null = null;
  const loadController = createUpdaterControllerLoader({ ports, bind: createUpdaterControllerBinder({ state, ports }) });

  /** Starts the auto-updater unless this launch must not run one (the host's `skipReason`). */
  function start(): Promise<void> {
    if (startup) return startup;
    if (state.controller || !ports.automaticUpdates()) return Promise.resolve();
    state.starting = true;
    // A manual check must await the same lazy import and listener binding as background start.
    startup = loadController().finally(() => {
      state.starting = false;
      startup = null;
    });
    return startup;
  }

  // Not awaited: the updater's first check waits on its own timer, and a failure to load it must
  // never block or fail the boot.
  function startInBackground(): void {
    start().catch((error: unknown) => ports.reporter.startFailed({ error }));
  }

  return {
    state,
    start,
    startInBackground,
    /** Persist first: a failed write must leave the actual updater and the checkbox unchanged. */
    setAutomaticUpdates: createAutomaticUpdatesSetter({ ports, startInBackground, stop: createUpdaterStopper({ state }) }),
    finalQuitHeldForUpdate: createFinalQuitUpdateCheck({ ports, state }),
    // `will-quit`: removes this instance's presence record.
    willQuit: () => state.controller?.willQuit(),
    readyVersion: () => (state.controller ? state.readyVersion : null),
    loadUpdaterForCheck: createManualUpdaterLoader({ ports, start, state }),
    async showReadyPrompt({ version }) {
      if (await ports.promptUpdateReady({ version })) state.controller?.requestRestart();
    },
  };
}

interface LifecycleArgs<U extends DesktopNativeUpdater> {
  ports: DesktopUpdaterPorts<U>;
  state: DesktopUpdaterState<U>;
}

/** A manual "Check for updates": the same native updater the controller listens to. */
function createManualUpdaterLoader<U extends DesktopNativeUpdater>({ ports, start, state }: LifecycleArgs<U> & { start: () => Promise<void> }) {
  return async function loadUpdaterForCheck(): Promise<U> {
    // With updates on, the controller must be listening before a download can start.
    if (ports.automaticUpdates()) await start();
    const updater = await ports.loadNativeUpdater();
    state.native ??= updater;
    return updater;
  };
}

/**
 * The quit that actually ends the app, once nothing is left to drain. A downloaded update installs
 * here, and only when no other instance of the app is running (`update-policy.ts`'s
 * `decideFinalQuit`). When the install takes over (macOS staging, or Restart to update) it quits the
 * app itself, so this quit is held.
 */
function createFinalQuitUpdateCheck<U extends DesktopNativeUpdater>({ ports, state }: LifecycleArgs<U>) {
  return function finalQuitHeldForUpdate(): boolean {
    if (!ports.automaticUpdates()) {
      if (state.native) state.native.autoInstallOnAppQuit = false;
      return false;
    }
    return state.controller?.beforeFinalQuit() ?? false;
  };
}

function createAutomaticUpdatesSetter<U extends DesktopNativeUpdater>({ ports, startInBackground, stop }: {
  ports: DesktopUpdaterPorts<U>; startInBackground: () => void; stop: () => void;
}) {
  return function setAutomaticUpdates({ enabled }: { enabled: boolean }): void {
    ports.saveAutomaticUpdates({ enabled });
    if (enabled) startInBackground();
    else stop();
  };
}

function createUpdaterStopper<U extends DesktopNativeUpdater>({ state }: { state: DesktopUpdaterState<U> }) {
  return function stop(): void {
    state.controller?.willQuit();
    state.controller = null;
    // A download already in flight may finish, but its stopped controller cannot prompt/install.
    // Electron-updater's Windows quit listener also reads this flag before installing.
    if (state.native) {
      state.native.autoDownload = false;
      state.native.autoInstallOnAppQuit = false;
    }
  };
}

function createUpdaterControllerLoader<U extends DesktopNativeUpdater>({ ports, bind }: {
  ports: DesktopUpdaterPorts<U>; bind: (updater: U) => void;
}) {
  return async function loadController(): Promise<void> {
    const skip = ports.skipReason();
    if (skip !== null) {
      ports.reporter.skipped({ reason: skip });
      return;
    }
    const updater = await ports.loadNativeUpdater();
    // The operator may turn updates off while the lazy import is resolving.
    if (!ports.automaticUpdates() || !ports.quitIdle()) return;
    bind(updater);
  };
}

function createUpdaterControllerBinder<U extends DesktopNativeUpdater>({ state, ports }: LifecycleArgs<U>) {
  return function bind(updater: U): void {
    state.native = updater;
    state.readyVersion = null;
    state.controller = ports.createController({
      updater,
      promptUpdateReady: ({ version }) => {
        state.readyVersion = version;
        return ports.promptUpdateReady({ version });
      },
    });
    state.controller.start();
  };
}
