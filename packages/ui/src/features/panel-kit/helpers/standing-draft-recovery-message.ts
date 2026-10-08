import type { StandingDraftAutosaveSnapshot } from "../hooks/use-standing-draft-autosave.hooks.js";

/** Compare timestamps explicitly; restoration only changes the working copy, never the server. */
export function standingDraftRecoveryMessage(
  { draft, t, serverUpdatedAt }: { draft: StandingDraftAutosaveSnapshot; t: (key: string) => string; serverUpdatedAt?: string },
  _options = {},
): string {
  const captured = Date.parse(draft.savedAt);
  const server = Date.parse(serverUpdatedAt ?? draft.serverUpdatedAt ?? "");
  const comparison = server > captured ? "Server content is newer."
    : server < captured ? "Local changes are newer."
    : server === captured ? "Both copies have the same timestamp." : "";
  return `${t("Restore unsaved changes from")} ${draft.savedAt}${comparison ? ` · ${t(comparison)}` : ""}`;
}
