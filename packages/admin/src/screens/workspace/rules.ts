import type { AdminWorkspaceResponse } from "@jini-ai/core/contracts/site/cms-workspace";

/**
 * @file Pure logic for the workspace screen — everything that computes a value rather than
 * rendering one. The screen's error-code message overrides stay with the host (they are its copy).
 */

/**
 * Whether the rename form's draft `name`/`slug` differ from the persisted workspace — drives
 * whether the Save button is enabled and whether a stale "Saved." label is suppressed after a
 * further edit.
 *
 * @complexity Time/space: O(1).
 */
export function isWorkspaceDirty(
  { workspace, name, slug }: { workspace: Pick<AdminWorkspaceResponse, "name" | "slug">; name: string; slug: string },
  _options: Record<string, never> = {},
): boolean {
  return name !== workspace.name || slug !== workspace.slug;
}
