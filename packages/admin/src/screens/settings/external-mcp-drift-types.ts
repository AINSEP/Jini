import type { AdminToolRefusalReason } from "@jini-ai/core/contracts/hosted-mcp";

/**
 * @file What the RUNNING assistant actually admitted, turned into operator-facing rows — the
 * missing half of the write-tools outline's §3.3 ("What does the user see when it goes wrong?"),
 * whose answer in every row of that table is still "stderr only" or "absent, silent".
 *
 * Everything upstream of this file already exists and already works: the daemon holds its boot
 * admission report (`mcp-federation/bootstrap.ts`), serves it (`GET /api/federation/admissions`,
 * C-009), the admin proxies it (`GET .../mcp-servers/admissions`, C-008), and `lib/api.ts` has a
 * client for it (`getExternalMcpAdmissions`). Nothing in this app called that client. So an
 * operator who ticked a tool in this tab and watched it not work had exactly one way to find out
 * why — read the daemon's terminal at the moment it booted — which on a desktop app nobody can SSH
 * into is no way at all.
 *
 * ## Why `not-in-operator-allowlist` never becomes a row
 *
 * It is the routine outcome of `trust.ts` R2's default-deny: a real server advertises tens of tools
 * and an operator allowlists three, so that reason fires for every tool nobody asked for. Rendering
 * it would bury the two or three rows that DO mean something under a list of tools the operator
 * deliberately did not enable. Every row below is a place the operator's own intent and the gate's
 * decision disagree — nowhere else.
 *
 * ## Copy discipline
 *
 * An admin copy string IS its own i18n key here (`dictionary-translator.ts`), so these functions
 * return the exact English string plus its `{token}` values and let the component bind a locale.
 * Six of the keys below already exist, fully translated, in `external-mcp-i18n.ts` — they were
 * written for this UI in Phase 2C and have been sitting unused since. The four that do not exist
 * are the rare structural refusals, and they fall back to English by design rather than being
 * invented in 21 languages here.
 *
 * Pure. No React, no `api`, no locale — every rule is a unit test.
 */
/** Why one row exists. Distinguished rather than collapsed because the operator's move differs:
 *  one is a tick away, one has no fix at all, one is a typo, one is a second listing. */
export type AdmissionDriftKind =
  | "needs-write-grant"
  | "destructive"
  | "not-offered"
  | "inert-write-grant"
  | "server-side-defect"
  // The three reverse-direction kinds (2026-09-07, ADM-001) — see {@link liveOnlyEntries} and
  // {@link connectionLevelEntry}. Every one of them is fixed by the same restart, and none of them
  // could produce a row before, because the comparison only ever ran `saved − live`.
  | "still-live-after-removal"
  | "not-running"
  | "disabled-but-running"
  // A fourth reverse-direction case ADM-001 deliberately left silent, and shouldn't have
  // (2026-09-07): a roster card the OPERATOR DELETED, as opposed to an env preset that never had
  // one. Both looked identical to this file — no roster card either way — until each live
  // connection's report started carrying `isPreset`. See {@link removedButStillRunningEntry}. Fixed
  // by the same restart as the other three.
  | "removed-but-still-running"
  // A more specific reading of `not-running` (2026-09-13): the daemon did not merely fail to admit
  // this connection, it never even ATTEMPTED to — `readEnabledExternalMcpConfigs` could not decrypt
  // its sealed env because the site key is not available, and the operator was being told to
  // restart the assistant for a problem restarting cannot fix on its own. See
  // {@link isDecryptFailureReason} and the `configFailures` plumbing in {@link describeAdmissionDrift}.
  | "decrypt-failed"
  // The other specific reading of `not-running` (2026-09-29): the daemon DID try this connection at
  // its last boot and the server failed to start or answer — a crashed stdio child, a timed-out
  // handshake. Restarting re-runs the same failing launch, so the generic "restart to load it" copy
  // sent the operator round a loop (observed: namecom's child exiting with code 1 on every boot).
  // The daemon's own reason is shown instead. See {@link FAILED_TO_START_KEY}.
  | "failed-to-start"
  | "missing-launcher"
  // An OAuth connection that isn't signed in (2026-10-23): fixed by the row's Connect button.
  | "needs-sign-in";

/** One place the operator's intent and the running assistant disagree. */
export interface AdmissionDriftEntry {
  /** The connection's id — identical to the roster row's `serverId` (`toResolvedFederatedConnections`
   *  sets `connectionId: config.serverId`), which is what lets a row be matched back to its card. */
  readonly connectionId: string;
  /** `null` for a row about the CONNECTION rather than about one of its tools (`not-running`,
   *  `disabled-but-running`). The section around the row already carries the connection id as its
   *  heading, so repeating it in the name slot would be a label, not a tool name — and a field
   *  called `remoteName` holding a connection id is the kind of misleading name that survives into
   *  a later reader's assumptions. */
  readonly remoteName: string | null;
  readonly kind: AdmissionDriftKind;
  /** Exact English copy, which is its own i18n key. */
  readonly messageKey: string;
  /** `interpolate()` values for a parameterized key; `{}` for a flat one. */
  readonly messageVars: Readonly<Record<string, string>>;
}

/** One connection's whole story: what is live, what was saved, and every disagreement. */
export interface AdmissionDriftConnection {
  readonly connectionId: string;
  /** Tools this daemon process actually registered for this connection. */
  readonly liveToolCount: number;
  /** Names in the operator's saved `allowedToolNames` that are NOT live — the ones a restart would
   *  change nothing about until the drift below is fixed, plus any that only need the restart. */
  readonly notLoaded: readonly string[];
  readonly savedToolCount: number;
  readonly entries: readonly AdmissionDriftEntry[];
}

/**
 * What the operator's roster says about ONE connection — the "saved" half of every comparison in
 * this file.
 *
 * `enabled` is here and not derivable (2026-09-07, ADM-001): `external-mcp-store.ts`'s
 * `readEnabledExternalMcpConfigs` skips a switched-off server, so "saved but not live" is the
 * CORRECT and expected state for one, and a rule that could not see the flag would report the
 * operator's own most deliberate action back to them as a fault.
 */
export interface SavedConnectionIntent {
  /** The roster card's `allowedToolNames` field, verbatim — `"a, b , c"` as it is stored. */
  readonly allowedToolNames: string;
  /** The card's on/off toggle. */
  readonly enabled: boolean;
  /** Saved launch details, used only to identify a missing stdio launcher. */
  readonly transport?: string;
  readonly command?: string;
  /** An OAuth row that isn't signed in — its row shows Connect, so the banner points there. */
  readonly needsSignIn?: boolean;
}

/** The host's tables of person-facing drift copy, injected REQUIRED into every function here that
 *  words a drift entry: each value is a dictionary key the host's translator renders (some carry
 *  `{name}`/`{reason}` placeholders the entries' `messageVars` fill). The kinds and their meaning
 *  are the engine's; only the wording (and the refusal table's kind choice) is the host's. */
export type ExternalMcpRefusalCopy = Readonly<Record<Exclude<AdminToolRefusalReason, "not-in-operator-allowlist">, { kind: AdmissionDriftKind; key: string }>>;

export interface ExternalMcpDriftCopy {
  /** Per refusal reason: the drift kind it is reported as and its message key. */
  readonly refusal: ExternalMcpRefusalCopy;
  /** Message key for a refusal reason the table does not know (a newer server). */
  readonly refusedFallback: string;
  readonly notOffered: string;
  readonly inertWriteGrant: string;
  readonly stillLive: string;
  readonly notRunning: string;
  readonly disabledButRunning: string;
  readonly removedButStillRunning: string;
  readonly decryptFailed: string;
  readonly failedToStart: string;
  readonly launcherMissing: string;
  readonly restartHeadline: string;
  readonly noRestartHeadline: string;
  readonly needsSignIn: string;
}
