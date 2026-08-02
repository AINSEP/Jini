/**
 * Origin: the `about` section of `SettingsDialog.tsx` (~5509-5669) and its
 * already-pure `deriveAboutUpdateControl` (line 249).
 *
 * GENERIC despite looking desktop-specific. Jini is a reusable engine, not
 * Tovu's private dependency — any desktop app built on it needs a version
 * panel and an auto-update state machine, and this is that state machine with
 * nothing product-bound left in it. A server host simply reports
 * `environment: 'web'` and gets the single "updates not supported here"
 * outcome, which is a legitimate answer rather than a missing feature.
 *
 * What is deliberately NOT ported: the origin's `keyof Dict` typing on label
 * and status keys, and its hardcoded `OPEN_DESIGN_RELEASES_URL`. Keys are
 * plain strings a host resolves against its own dictionary (same convention as
 * `LocaleOption` and `ProviderPreset`), and the releases URL is host-supplied.
 * Neither is a behaviour change — they are the two places the origin's own
 * product leaked into an otherwise generic rule.
 */

/** Where the host is running. Only `'desktop'` can self-update. */
export type UpdaterEnvironment = 'desktop' | 'web' | (string & {});

/** The updater's current phase, as reported by the host's update backend. */
export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
  | 'unsupported';

/**
 * How an update gets applied.
 *
 * `'payload'` swaps files in place and restarts; anything else hands off to a
 * platform installer. The distinction only changes wording, but it changes it
 * in three separate places, which is why it is modelled rather than inferred.
 */
export type UpdateKind = 'payload' | 'installer' | (string & {});

export interface UpdaterStatus {
  state: UpdaterState;
  /** Where a downloaded update landed. Its presence is what makes an
   *  install retryable after an error. */
  downloadPath?: string | null;
}

export interface UpdaterDownloadProgress {
  /** 0-100. Absent when the backend reports no measurable progress — which is
   *  a real case (an unknown content length), not an error. */
  percent?: number;
}

/** Everything the update state machine reads. Hosts map their own updater onto
 *  this shape rather than this shape onto theirs. */
export interface UpdaterModel {
  environment: UpdaterEnvironment;
  /** Operator-level switch — updates turned off in settings. */
  enabled: boolean;
  /** Build-level capability — this build can update at all. */
  supported: boolean;
  status?: UpdaterStatus;
  /** Version on offer, when known. */
  availableVersion?: string | null;
  downloadProgress?: UpdaterDownloadProgress;
  canDownload?: boolean;
  canOpenInstaller?: boolean;
  canApplyInPlace?: boolean;
  /** The installer has been handed off to the OS. */
  installerOpened?: boolean;
  /** Quitting now is what lets the handed-off installer proceed. */
  canQuitAfterInstallerOpen?: boolean;
  updateKind?: UpdateKind;
  /** An action is in flight; the host disables its button. */
  busy?: boolean;
}

export interface AppVersionInfo {
  version: string;
  /**
   * `false` means running from source rather than a packaged build.
   *
   * Checked FIRST and separately from `supported`, because a developer running
   * unpackaged should be told exactly that rather than "updates unsupported" —
   * the two look identical to the state machine but mean opposite things to
   * the person reading the panel.
   */
  packaged?: boolean;
}

export type AboutUpdatePrimaryAction = 'check' | 'download' | 'install' | 'quit';

export type AboutUpdateTone = 'neutral' | 'success' | 'warning' | 'error';

/** What the About panel should render for the current updater state. */
export interface AboutUpdateControl {
  /** `null` means no actionable button — the state is transient or terminal. */
  primaryAction: AboutUpdatePrimaryAction | null;
  /** Dictionary key for the button label. `null` hides the button entirely.
   *  Note a label can be present while the action is `null`: that renders a
   *  disabled progress button ("Downloading…"). */
  primaryLabelKey: string | null;
  showReleaseLink: boolean;
  statusKey: string;
  statusTone: AboutUpdateTone;
  /** Interpolation values for `statusKey`, when it takes any. */
  statusVars?: Record<string, string | number>;
}

/**
 * Visible state of the "allow silent updates" preference: the value the
 * toggle should currently display (the optimistic value while a write is in
 * flight, the confirmed value otherwise) and whether a write for it is
 * in-flight. Origin: `SettingsDialog.tsx`'s inline `cfg.allowSilentUpdates`
 * toggle handler (~5583-5644) — carries a write-token ref, an optimistic
 * set, and a rollback-to-`previous` on failure. Ported as the value/busy
 * transition only; the token/staleness half of that mechanism is NOT
 * duplicated here because `createAsyncCommitGuard`
 * (`features/memory/async-commit-guard.ts`) already is that primitive —
 * callers pair it with the functions below
 * rather than this tab growing a second copy.
 */
export interface SilentUpdatesState {
  allowSilentUpdates: boolean;
  busy: boolean;
}
