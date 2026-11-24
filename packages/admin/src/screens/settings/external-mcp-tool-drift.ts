import type { AdminFederatedAdmissionEntry, AdminToolRefusalReason } from "@jini-ai/core/contracts/hosted-mcp";
import type { AdmissionDriftConnection, AdmissionDriftEntry, AdmissionDriftKind, ExternalMcpDriftCopy, SavedConnectionIntent } from "./external-mcp-drift-types.js";

/** The one refusal that is routine rather than newsworthy — see this file's header. */
const ROUTINE_REFUSAL = "not-in-operator-allowlist" as const satisfies AdminToolRefusalReason;

/** Every refusal that describes a defect in the EXTERNAL server rather than anything the operator
 *  can change from this tab. Named once so the four entries below and the unknown-reason fallback
 *  cannot drift apart on which bucket they land in. */
const SERVER_SIDE_DEFECT = "server-side-defect" as const satisfies AdmissionDriftKind;

/** The kinds a restart alone never changes: the server does not offer the tool, marks it
 *  destructive, published it broken, cannot be unlocked, or fails to start. Every OTHER kind is the
 *  boot-time freeze (`trust.ts` R5) seen from one side or the other — or a write grant, which takes
 *  effect at the next restart — so it is listed here by exclusion, and a kind added later defaults to
 *  the pre-existing restart headline. */
const RESTART_CANNOT_FIX: ReadonlySet<AdmissionDriftKind> = new Set<AdmissionDriftKind>([
  "not-offered",
  "destructive",
  "server-side-defect",
  "decrypt-failed",
  "failed-to-start",
  "missing-launcher",
  "needs-sign-in",
]);

/** Whether any drift row can benefit from a restart alone.
 * @param input.connections - The banner's already-resolved drift rows.
 * @returns False for an empty banner or exclusively unfixable failures.
 * @example admissionRestartHelps({ connections: [] }) // false
 * @complexity O(c · e) time, O(1) space in connections and their rows. */
export function admissionRestartHelps(
  { connections }: { connections: readonly AdmissionDriftConnection[] },
  _optional: Record<string, never> = {},
): boolean {
  return connections.some((connection) => connection.entries.some((entry) => !RESTART_CANNOT_FIX.has(entry.kind)));
}

/**
 * The banner's first line: whether the rows below are waiting on a restart, or are things a restart
 * cannot change. One row a restart would change is enough for the restart headline.
 *
 * @complexity O(c · e) in connections and their rows.
 */
export function describeDriftHeadline({ connections, copy }: { connections: readonly AdmissionDriftConnection[]; copy: ExternalMcpDriftCopy }, _optional = {}): string {
  const restartHelps = admissionRestartHelps({ connections });
  return restartHelps ? copy.restartHeadline : copy.noRestartHeadline;
}

/** The gate refusals worth showing, in the daemon's own order. */
function refusalEntries({ entry, copy }: { entry: AdminFederatedAdmissionEntry; copy: ExternalMcpDriftCopy }): AdmissionDriftEntry[] {
  const rows: AdmissionDriftEntry[] = [];
  for (const refusal of entry.refused) {
    if (refusal.reason === ROUTINE_REFUSAL) continue;
    const refusalCopy = copy.refusal[refusal.reason];
    // A reason this build does not know about is still REPORTED — an unrecognized refusal that
    // silently vanished would be the exact defect this file exists to close, one version later.
    rows.push({
      connectionId: entry.connectionId,
      remoteName: refusal.remoteName,
      kind: refusalCopy?.kind ?? SERVER_SIDE_DEFECT,
      messageKey: refusalCopy?.key ?? copy.refusedFallback,
      messageVars: {},
    });
  }
  return rows;
}

/** The two config-drift lists — config that can never take effect, which `trust.ts` already
 *  computes precisely so it is reported rather than silently inert. */
function driftEntries({ entry, copy }: { entry: AdminFederatedAdmissionEntry; copy: ExternalMcpDriftCopy }): AdmissionDriftEntry[] {
  return [
    ...entry.allowlistedButAbsent.map((remoteName): AdmissionDriftEntry => ({
      connectionId: entry.connectionId,
      remoteName,
      kind: "not-offered",
      messageKey: copy.notOffered,
      messageVars: {},
    })),
    ...entry.writeAllowedButNotAllowlisted.map((remoteName): AdmissionDriftEntry => ({
      connectionId: entry.connectionId,
      remoteName,
      kind: "inert-write-grant",
      messageKey: copy.inertWriteGrant,
      messageVars: { name: remoteName },
    })),
  ];
}

/**
 * ADM-001's `live − saved` half: tools the running daemon is still serving that the operator's
 * allowlist no longer names.
 *
 * `savedAllowedToolNames === undefined` returns NOTHING, and that is the load-bearing case rather
 * than a defensive default. `mcp-federation/bootstrap.ts` merges roster connections with
 * env-registered PRESET connections (`resolveRegisteredPresets`, e.g. the Supabase MCP plugin) into
 * one report list, and a preset has no roster card by design — so "no saved entry" means "no
 * operator intent is recorded here", not "the operator allowlisted nothing". Reading it as the
 * latter would put every preset tool in this list on every boot, forever. An empty STRING is the
 * opposite: a card exists and its allowlist was cleared, so every live tool really is drift.
 *
 * @complexity O(t) in the connection's admitted tool count.
 */
function liveOnlyEntries(
  { entry, savedAllowedToolNames, copy }: {
    entry: AdminFederatedAdmissionEntry;
    savedAllowedToolNames: string | undefined;
    copy: ExternalMcpDriftCopy;
  },
  _options = {},
): AdmissionDriftEntry[] {
  if (savedAllowedToolNames === undefined) return [];
  const saved = new Set(parseSavedToolNames({ value: savedAllowedToolNames }));
  return entry.admitted
    .filter((tool) => !saved.has(tool.remoteName))
    .map((tool): AdmissionDriftEntry => ({
      connectionId: entry.connectionId,
      remoteName: tool.remoteName,
      kind: "still-live-after-removal",
      messageKey: copy.stillLive,
      messageVars: {},
    }));
}

/** `"a, b , c"` as the roster card stores it, back to names. Mirrors the host's external-MCP roster hook's
 *  own `join(", ")` on the way out; blanks are dropped so an empty field is zero names, not one. */
export function parseSavedToolNames({ value }: { value: string | undefined }, _options = {}): string[] {
  return (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * One connection's drift, or `null` when the live assistant and the saved roster agree — the
 * common case, which must render nothing at all rather than a reassuring banner nobody needs.
 *
 * @param input.entry - This connection's live admission report from the daemon.
 * @param input.savedAllowedToolNames - The roster card's own `allowedToolNames` field, verbatim, or
 *   `undefined` when this connection has no roster card at all (an env preset). The two are NOT
 *   interchangeable — see {@link liveOnlyEntries}.
 * @complexity O(t) in the connection's advertised/refused/admitted tool count.
 * @overallScore 100
 */
export function describeConnectionDrift(
  { entry, savedAllowedToolNames, copy }: {
    entry: AdminFederatedAdmissionEntry;
    savedAllowedToolNames: string | undefined;
    copy: ExternalMcpDriftCopy;
  },
  _options = {},
): AdmissionDriftConnection | null {
  const entries = [...refusalEntries({ entry, copy }), ...driftEntries({ entry, copy }), ...liveOnlyEntries({ entry, savedAllowedToolNames, copy })];
  const live = new Set(entry.admitted.map((tool) => tool.remoteName));
  const saved = parseSavedToolNames({ value: savedAllowedToolNames });
  const notLoaded = saved.filter((name) => !live.has(name));

  if (entries.length === 0 && notLoaded.length === 0) return null;

  return {
    connectionId: entry.connectionId,
    liveToolCount: entry.admitted.length,
    notLoaded,
    savedToolCount: saved.length,
    entries,
  };
}

/**
 * The one-click fix: the new `writeAllowedToolNames` field value that grants `remoteName` the
 * write authorization `trust.ts` R3 requires, without disturbing any grant already there.
 *
 * Returns the field value only — the caller writes it through the SAME `updateSource` port the
 * card's own edit form uses, so the merge rules that protect `env` and `oauthClientSecret` from
 * being blanked (the host's external-MCP roster hook's header) apply here unchanged.
 *
 * Idempotent: granting a name that is already granted returns the list unchanged, so a double
 * click cannot produce a duplicate entry the store would then have to dedupe.
 *
 * @complexity O(n) in the current grant count.
 * @overallScore 100
 */
export function grantWriteFieldValue(
  { currentWriteAllowedToolNames, remoteName }: {
    currentWriteAllowedToolNames: string | undefined;
    remoteName: string;
  },
  _options = {},
): string {
  const names = parseSavedToolNames({ value: currentWriteAllowedToolNames });
  if (names.includes(remoteName)) return names.join(", ");
  return [...names, remoteName].join(", ");
}
