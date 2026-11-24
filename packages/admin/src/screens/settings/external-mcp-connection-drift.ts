import type { AdminExternalMcpAdmissionsSnapshot, AdminExternalMcpConfigFailure, AdminFederatedAdmissionEntry } from "@jini-ai/core/contracts/hosted-mcp";
import type { AdmissionDriftConnection, AdmissionDriftKind, ExternalMcpDriftCopy, SavedConnectionIntent } from "./external-mcp-drift-types.js";
import { describeConnectionDrift, parseSavedToolNames } from "./external-mcp-tool-drift.js";

/** Matches Node's spawn ENOENT for the saved absolute executable, rather than an error about
 * a child dependency. POSIX, drive-rooted Windows and UNC paths are read regardless of the
 * browser's OS because the launcher runs on the site's host.
 * @complexity O(n) time in command/reason length, O(command length) additional space. */
function isMissingLauncher({ saved, reason }: { saved: SavedConnectionIntent; reason: string }, _options = {}): boolean {
  if (saved.transport !== "stdio" || !saved.command) return false;
  const absoluteCommand = /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(saved.command);
  return absoluteCommand && reason.includes(`spawn ${saved.command} ENOENT`);
}

/**
 * Whether a boot-time config-resolution failure names a decrypt failure specifically, the one case
 * {@link DECRYPT_FAILED_KEY} exists for. Matches `external-mcp-store.ts`'s own `openExternalMcpEnv`
 * wording (`"stored credentials could not be decrypted: ..."`) by substring rather than by importing
 * a server-side string constant across the admin/website package boundary — the same loose-coupling
 * choice `probe.ts`'s own `looksLikeReauthFailure` makes for the identical reason: a future wording
 * change on that side just stops matching here (falling back to the pre-existing generic message),
 * never throws.
 *
 * Deliberately does NOT surface `reason` itself in the banner even though `external-mcp-store.ts`
 * guarantees it is secret-free (`probe.ts`'s INV-006 doc) — this file's whole job is translated,
 * predictable operator copy, not a window onto whatever a future error message happens to say.
 *
 * @complexity O(1).
 */
function isDecryptFailureReason({ reason }: { reason: string }, _options = {}): boolean {
  return reason.includes("could not be decrypted");
}

/**
 * The four-combination truth table {@link connectionLevelEntry} documents, as a flat chain rather
 * than a nested ternary — the same extraction `@jini-ai/ui/fetch-query`'s
 * `resolveFetchQueryStatus` records the reasoning for.
 *
 * @returns The disagreement's kind, or `null` when intent and reality agree.
 * @complexity O(1).
 */
function resolveConnectionLevelKind({ enabled, isLive, liveToolCount }: { enabled: boolean; isLive: boolean; liveToolCount: number }, _options = {}): "not-running" | "disabled-but-running" | null {
  if (!isLive) return enabled ? "not-running" : null;
  // A live connection with an empty admitted set says nothing either way — the daemon may hold the
  // session open having admitted none of its tools, which the per-tool rows already explain.
  if (!enabled && liveToolCount > 0) return "disabled-but-running";
  return null;
}

/**
 * Resolves a `not-running`/`disabled-but-running` connection-level row's final kind and copy, giving
 * the `not-running` arm a more specific reading when a boot-time config-resolution failure names a
 * decrypt problem — see {@link DECRYPT_FAILED_KEY}'s own doc on why the generic "restart the
 * assistant" copy is actively wrong for that one case — and, for any OTHER reported failure, the
 * {@link FAILED_TO_START_KEY} reading, where restarting is just as wrong. A missing absolute stdio
 * launcher gets terse recovery copy instead of the spawn path. A `disabled-but-running` connection never
 * takes this branch: it is live by definition, and a config-resolution failure means the connection
 * never got that far. Split out of {@link connectionLevelEntry}, the same "flat chain rather than a
 * nested ternary" extraction {@link resolveConnectionLevelKind} above already models.
 *
 * @complexity O(n) time in the failure text and command length, O(command length) additional space.
 */
function resolveNotRunningCopy(
  { kind, configFailureReason, saved, copy }: {
    kind: "not-running" | "disabled-but-running";
    configFailureReason: string | undefined;
    saved: SavedConnectionIntent;
    copy: ExternalMcpDriftCopy;
  },
  _options = {},
): { readonly kind: AdmissionDriftKind; readonly messageKey: string; readonly messageVars: Readonly<Record<string, string>> } {
  if (kind === "not-running" && saved.needsSignIn) {
    return { kind: "needs-sign-in", messageKey: copy.needsSignIn, messageVars: {} };
  }
  if (kind === "not-running" && configFailureReason !== undefined) {
    if (isMissingLauncher({ saved, reason: configFailureReason })) {
      return { kind: "missing-launcher", messageKey: copy.launcherMissing, messageVars: {} };
    }
    return isDecryptFailureReason({ reason: configFailureReason })
      ? { kind: "decrypt-failed", messageKey: copy.decryptFailed, messageVars: {} }
      : { kind: "failed-to-start", messageKey: copy.failedToStart, messageVars: { reason: configFailureReason } };
  }
  return { kind, messageKey: kind === "not-running" ? copy.notRunning : copy.disabledButRunning, messageVars: {} };
}

/**
 * ADM-001's whole-connection half: a saved connection whose state the daemon disagrees with
 * outright, rather than one tool inside a connection it is running.
 *
 * Only two of the four combinations are a disagreement. Saved-and-enabled-and-not-live is the
 * operator having added or re-enabled a server since boot — `trust.ts` R5 freezes the admitted set
 * at connect, so it is genuinely absent and stays absent until a restart. Saved-and-disabled-and-
 * still-live is the same freeze seen from the other side. The other two agree and must render
 * nothing: an off server that is not running is not a fault, it is the switch working.
 *
 * @param options.configFailureReason - The daemon's own boot-time reason this connection never even reached
 *   an admission attempt, when one was reported (`describeAdmissionDrift`'s `configFailures`). See
 *   {@link resolveNotRunningCopy}.
 * @returns The connection row, or `null` when intent and reality agree.
 * @complexity O(t) in the saved name count.
 */
function connectionLevelEntry(
  { connectionId, saved, liveEntry, copy }: {
    connectionId: string;
    saved: SavedConnectionIntent;
    liveEntry: AdminFederatedAdmissionEntry | undefined;
    copy: ExternalMcpDriftCopy;
  },
  { configFailureReason }: { configFailureReason?: string | undefined } = {},
): AdmissionDriftConnection | null {
  const savedNames = parseSavedToolNames({ value: saved.allowedToolNames });
  const liveToolCount = liveEntry?.admitted.length ?? 0;
  const kind = resolveConnectionLevelKind({ enabled: saved.enabled, isLive: liveEntry !== undefined, liveToolCount });
  if (!kind) return null;
  const resolved = resolveNotRunningCopy({ kind, configFailureReason, saved, copy });

  return {
    connectionId,
    liveToolCount,
    // Every saved name for a connection that is not running: all of them are missing, which is the
    // count line's whole job. Empty for the disabled-but-running arm, where the live tools ARE the
    // saved ones and nothing is missing.
    notLoaded: liveEntry ? [] : savedNames,
    savedToolCount: savedNames.length,
    entries: [
      {
        connectionId,
        remoteName: null,
        kind: resolved.kind,
        messageKey: resolved.messageKey,
        messageVars: resolved.messageVars,
      },
    ],
  };
}

/**
 * Every connection with something to say, in the daemon's own connection order, then any saved
 * connection the daemon never reported.
 *
 * Two passes rather than one, and they never both claim the same connection: the first covers every
 * connection the daemon IS running (roster-backed or env preset), the second only adds rows for a
 * whole-connection disagreement the first pass structurally cannot see — a saved connection with no
 * live entry, or a switched-off one that is still live (2026-09-07, ADM-001). A live, agreeing
 * connection is claimed by neither.
 *
 * @param input.snapshot - `getExternalMcpAdmissions()`'s response. `undefined` means the daemon could not
 *   be asked, and returns `[]` deliberately: the caller renders that as its own sentence, and
 *   inventing "not running" rows out of a failed read would put a wrong diagnosis under a right one.
 * @param input.savedById - Each roster card's saved intent, keyed by its id. A connection the daemon
 *   reports that is absent here is EITHER an env preset (no roster card by design) OR a roster
 *   connection the operator just deleted — {@link describeLiveConnection} tells the two apart via
 *   the entry's own `isPreset`, not via this map, because this map cannot: a deleted card leaves
 *   nothing behind for it to distinguish.
 * @complexity O(c · t).
 * @overallScore 100
 */
export function describeAdmissionDrift(
  { snapshot, savedById, copy }: {
    snapshot: AdminExternalMcpAdmissionsSnapshot | undefined;
    savedById: Readonly<Record<string, SavedConnectionIntent>>;
    copy: ExternalMcpDriftCopy;
  },
  _options = {},
): readonly AdmissionDriftConnection[] {
  if (!snapshot) return [];
  const liveIds = new Set(snapshot.connections.map((entry) => entry.connectionId));
  // A connection in here never reached `attachFederatedMcpTools` at all, so it can never also be in
  // `liveIds` above — the two sets are disjoint by construction (see `AdminExternalMcpConfigFailure`'s
  // own doc), which is why only the second, no-live-entry pass below ever consults this map.
  const configFailureReasonById = new Map(
    (snapshot.configFailures ?? []).map((failure: AdminExternalMcpConfigFailure): [string, string] => [failure.connectionId, failure.reason]),
  );

  return [
    ...snapshot.connections.map((entry) => describeLiveConnection({ entry, saved: savedById[entry.connectionId], copy })),
    ...Object.entries(savedById)
      .filter(([connectionId]) => !liveIds.has(connectionId))
      .map(([connectionId, saved]) => connectionLevelEntry({ connectionId, saved, liveEntry: undefined, copy }, { configFailureReason: configFailureReasonById.get(connectionId) })),
  ].filter((connection): connection is AdmissionDriftConnection => connection !== null);
}

/**
 * A live connection with NO roster card that is also NOT a registered preset — the operator deleted
 * its saved config while the daemon still holds a working session for it. `external-mcp/delete.ts`
 * only removes the DB row and `trust.ts` R5 freezes the admitted set at connect, so deletion has no
 * effect on what is running until the next restart, and until `isPreset` existed this looked
 * identical to a preset with no card by design (`describeConnectionDrift(entry, undefined)`'s own
 * silent case) and was reported the same way: nothing, even though the assistant kept the removed
 * server's tools live and callable.
 *
 * Supersedes the per-tool rows for the same reason {@link connectionLevelEntry}'s two arms do —
 * which of a removed server's tools are still loaded is noise next to the one fact that matters, a
 * server the operator removed is still running — so this never runs {@link describeConnectionDrift}
 * for the same entry.
 *
 * @complexity O(1).
 */
function removedButStillRunningEntry({ entry, copy }: { entry: AdminFederatedAdmissionEntry; copy: ExternalMcpDriftCopy }): AdmissionDriftConnection {
  return {
    connectionId: entry.connectionId,
    liveToolCount: entry.admitted.length,
    notLoaded: [],
    savedToolCount: 0,
    entries: [
      {
        connectionId: entry.connectionId,
        remoteName: null,
        kind: "removed-but-still-running",
        messageKey: copy.removedButStillRunning,
        messageVars: {},
      },
    ],
  };
}

/** One LIVE connection's row. A whole-connection disagreement supersedes the per-tool rows: telling
 *  an operator which of a switched-off server's tools are still loaded, one line each, buries the
 *  one thing they need to read — that the server they turned off is still running. Split out of
 *  {@link describeAdmissionDrift} to keep that function under the shop complexity ceiling.
 *
 *  A connection with no roster card takes one of two readings, distinguished by `entry.isPreset`
 *  rather than inferred from the card's absence alone (2026-09-07): a real preset (`isPreset: true`)
 *  has no card BY DESIGN and stays silent, same as ADM-001 left it; anything else with no card is a
 *  roster connection the operator deleted, and gets its own whole-connection row via
 *  {@link removedButStillRunningEntry}. `!entry.isPreset` (not `entry.isPreset === false`) so an
 *  older daemon build that predates this field is read as "not a preset" — the fail-loud direction,
 *  since it surfaces a possibly-real orphaned connection instead of silently assuming it away. */
function describeLiveConnection(
  { entry, saved, copy }: {
    entry: AdminFederatedAdmissionEntry;
    saved: SavedConnectionIntent | undefined;
    copy: ExternalMcpDriftCopy;
  },
  _options = {},
): AdmissionDriftConnection | null {
  if (saved) {
    const connectionLevel = connectionLevelEntry({ connectionId: entry.connectionId, saved, liveEntry: entry, copy });
    return connectionLevel ?? describeConnectionDrift({ entry, savedAllowedToolNames: saved.allowedToolNames, copy });
  }
  if (!entry.isPreset) return removedButStillRunningEntry({ entry, copy });
  return describeConnectionDrift({ entry, savedAllowedToolNames: undefined, copy });
}
