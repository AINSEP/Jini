import type { ChatDeleteSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";

/** Freshly authorize an eligible permanent delete through the injected site port.
 * @throws ToolInputError if a required reader is missing; read/policy errors propagate.
 * @example await requireChatDeleteGrant({ surfaces, toolId: "trash_empty" });
 * @complexity O(13) lookup and one injected read, O(1) local space. */
export async function requireChatDeleteGrant(required: { surfaces: ChatDeleteSurfaceDeps; toolId: string; principalId?: string; isDeleteTool: (required: { toolId: string }) => boolean; missingGrant: (required: { toolId: string }) => Error }, _optional = {}): Promise<void> {
  if (!required.isDeleteTool({ toolId: required.toolId })) return;
  if (!required.surfaces.assertChatDeleteAllowed) throw required.missingGrant({ toolId: required.toolId });
  await required.surfaces.assertChatDeleteAllowed({ toolId: required.toolId,
    ...(required.principalId === undefined ? {} : { principalId: required.principalId }) });
}
