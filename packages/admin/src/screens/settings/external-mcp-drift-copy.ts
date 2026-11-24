import type { ExternalMcpDriftCopy, ExternalMcpRefusalCopy } from "./external-mcp-drift-types.js";

/**
 * Refusal reason to operator copy.
 *
 * The first two keys are verbatim from `external-mcp-i18n.ts` and are translated. The last four are
 * new English-only strings for refusals that describe a defect in the EXTERNAL server rather than
 * anything the operator can change — deliberately not invented in 21 locales for a case that
 * should be rare, since `createDictionaryTranslator` falls back to the English key.
 */
const REFUSAL_COPY: ExternalMcpRefusalCopy = {
  "remote-declares-not-read-only": { kind: "needs-write-grant", key: "Tick 'Allow changes' to enable this tool." },
  "remote-declares-destructive": {
    kind: "destructive",
    key: "The server marks this tool as destructive. The assistant does not enable destructive external tools.",
  },
  "missing-or-invalid-input-schema": {
    kind: "server-side-defect",
    key: "This server published no usable input schema for this tool, so the assistant cannot offer it.",
  },
  "invalid-remote-tool-name": {
    kind: "server-side-defect",
    key: "This server advertised a tool under a name the assistant will not register.",
  },
  "duplicate-remote-tool-name": {
    kind: "server-side-defect",
    key: "This server advertised the same tool name twice, so the assistant kept only the first.",
  },
  "connection-tool-cap-reached": {
    kind: "server-side-defect",
    key: "This connection has already reached its maximum number of tools, so this one was left out.",
  },
};

/** Translated, already in `external-mcp-i18n.ts`. */
const NOT_OFFERED_KEY = "This server does not offer a tool by that name.";
const INERT_WRITE_GRANT_KEY =
  "'{name}' is on the write list but not on the allowlist — it has no effect until it's also allowlisted.";

/** ADM-001's three keys. English-only for now, the same deliberate choice the four server-side-defect
 *  strings above record: `createDictionaryTranslator` falls back to the English key, and inventing
 *  21 translations ahead of the copy settling is the more expensive mistake to undo. Each one names
 *  the restart, because the restart is the entire fix in all three cases. */
const STILL_LIVE_KEY = "The assistant is still running this tool, but it's no longer on the allowlist. Restart the assistant to unload it.";
const NOT_RUNNING_KEY = "The assistant isn't running this server at all. Restart the assistant to load it.";
const DISABLED_BUT_RUNNING_KEY = "This server is switched off, but the assistant is still running it. Restart the assistant to unload it.";

/** The follow-on ADM-001 left open (2026-09-07), same English-only choice for the same reason. Says
 *  "removed", not "deleted" or "not configured", to match what the operator actually did — clicked
 *  the card's own remove button — rather than a database term they never see. */
const REMOVED_BUT_STILL_RUNNING_KEY =
  "This server was removed from your configuration, but the assistant is still running it. Restart the assistant to unload it.";

/**
 * A saved, enabled connection that failed to decrypt at boot — same English-only choice as the three
 * keys above, for the same reason (2026-09-13). Names the site key specifically, by the tab's own
 * current label (`SiteKeyTab.tsx`, renamed from "the previous label" the same day), rather than the generic
 * "restart the assistant" {@link NOT_RUNNING_KEY} gives for this exact case: restarting alone changes
 * nothing here, because the decrypt will fail again on the next boot until the token itself is fixed.
 */
const DECRYPT_FAILED_KEY =
  "This server's saved credentials can't be unlocked because the site key isn't available. Add or restore it on the Secrets page's Site key tab, then restart the assistant.";

/**
 * A saved, enabled connection the daemon tried at its last boot and could not start (2026-09-29).
 * Shows the daemon's own reason — for a stdio server that is the child's exit plus the tail of what
 * it printed to stderr (`adapter.stdio.ts`, with the connection's own env values redacted), which is
 * the only place a message like npm's "Unsupported URL Type" ever reaches. English-only, same
 * choice as the keys above.
 *
 * This is the one row that surfaces `reason` verbatim, a deliberate exception to
 * {@link isDecryptFailureReason}'s "translated, predictable copy only" rule: every translated sentence
 * we could write here ("the server failed") hides the one fact the operator needs to fix it.
 */
const FAILED_TO_START_KEY = "The assistant tried to start this server, but it failed: {reason}";

/** Headline for a drift banner where a restart WILL help — something saved since boot. */
const RESTART_HEADLINE_KEY = "Saved. The assistant is still running with its previous tool list.";
/** Headline when nothing listed would change on a restart — the server itself does not offer a
 *  tool, refused it, or failed to start. Saying "still running its previous tool list" there sent
 *  the operator to restart, see the same list again, and conclude the restart was broken. */
const NO_RESTART_HEADLINE_KEY = "Some saved tools aren't loaded. The reasons are below.";

/** A not-running OAuth connection that was never signed in (2026-10-23). Whatever the daemon said,
 *  the fix is the row's own Connect button, so the row says that instead of the raw reason. */
const NEEDS_SIGN_IN_KEY = "Not signed in. Use Connect on this server below.";

export const EXTERNAL_MCP_DRIFT_COPY: ExternalMcpDriftCopy = {
  refusal: REFUSAL_COPY,
  refusedFallback: "The assistant refused this tool at startup.",
  notOffered: NOT_OFFERED_KEY,
  inertWriteGrant: INERT_WRITE_GRANT_KEY,
  stillLive: STILL_LIVE_KEY,
  notRunning: NOT_RUNNING_KEY,
  disabledButRunning: DISABLED_BUT_RUNNING_KEY,
  removedButStillRunning: REMOVED_BUT_STILL_RUNNING_KEY,
  decryptFailed: DECRYPT_FAILED_KEY,
  failedToStart: FAILED_TO_START_KEY,
  launcherMissing: "Launcher missing",
  restartHeadline: RESTART_HEADLINE_KEY,
  noRestartHeadline: NO_RESTART_HEADLINE_KEY,
  needsSignIn: NEEDS_SIGN_IN_KEY,
};
