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
  const comparison = server > captured ? "Server content is newer."
    : server < captured ? "Local changes are newer."
    : server === captured ? "Both copies have the same timestamp." : "";
  return `${t("Restore unsaved changes from")} ${formatSavedAt(draft.savedAt)}${comparison ? ` · ${t(comparison)}` : ""}`;
}
