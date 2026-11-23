import type { AuthorizeFn } from "@jini-ai/core/contracts/events";

/** Theme editors need the preview channel even when they cannot read administrative settings. */
export async function authorizeChangeFeed(
  {
    authorize,
    principalId,
    workspaceId,
    includePreview,
  }: { authorize: AuthorizeFn; principalId: string; workspaceId: string; includePreview: boolean },
  _optional: Record<string, never> = {},
): Promise<{ settings: boolean; preview: boolean; reason: string }> {
  const settings = await authorize({
    principalId,
    workspaceId,
    permission: "settings.read",
    entityType: "setting-value",
  });
  const preview = includePreview
    ? await authorize({ principalId, workspaceId, permission: "theme.set", entityType: "theme" })
    : { allowed: false };
  return { settings: settings.allowed, preview: preview.allowed, reason: settings.reason };
}
