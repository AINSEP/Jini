import type { StandingDraftAutosaveSnapshot } from "../hooks/use-standing-draft-autosave.hooks.js";
import { formatTimestamp } from "./format-timestamp.js";

/** The viewer's wall-clock time of the capture, `YYYY-MM-DD HH:MM`. The raw ISO string read as
 *  "from 2026-10-11T19:26:00.665Z" in the restore banner (2026-10-11): UTC and milliseconds the
 *  operator never thinks in. The draft was captured in this browser, so local time is the honest one. */
function formatSavedAtLocal(iso: string): string {
  return formatTimestamp({ iso }, { timeZone: "local" });
}

/** Compare timestamps explicitly; restoration only changes the working copy, never the server. */
export function standingDraftRecoveryMessage(
  { draft, t, serverUpdatedAt }: { draft: StandingDraftAutosaveSnapshot; t: (key: string) => string; serverUpdatedAt?: string },
  { formatSavedAt = formatSavedAtLocal }: { formatSavedAt?: (iso: string) => string } = {},
): string {
  const captured = Date.parse(draft.savedAt);
  const server = Date.parse(serverUpdatedAt ?? draft.serverUpdatedAt ?? "");
  const comparison = compareTimestamps(server, captured);
  const suffix = comparison ? ` · ${t(comparison)}` : "";
  return `${t("Restore unsaved changes from")} ${formatSavedAt(draft.savedAt)}${suffix}`;
}

/** Which copy is newer; empty when either timestamp failed to parse (NaN compares unequal to all). */
function compareTimestamps(server: number, captured: number): string {
  if (server > captured) return "Server content is newer.";
  if (server < captured) return "Local changes are newer.";
  if (server === captured) return "Both copies have the same timestamp.";
  return "";
}
