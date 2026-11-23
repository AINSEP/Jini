import type { ToolExecutionContext, RememberedApprovalPort } from "@jini-ai/core";
import type { DetectedAgent } from "@jini-ai/core/contracts/site/agent-runtime";
import type { SettingsToolDeps as CoreSettingsToolDeps } from "@jini-ai/core/settings";
import type { SiteSettingsSetFn } from "./site-title-write.js";

/** The slice of the host's live chat-picker inventory the settings tools read (structural). */
export interface ChatAgentInventoryPort {
  listAssistantAgents(required: Record<string, never>, optional?: { waitForProbe?: boolean }): Promise<unknown>;
  listDetectedAssistantAgents(): Promise<readonly DetectedAgent[]>;
}

/** The agent runtime's selection check: a refusal message, or null when the selection is runnable. */
export type ValidateRuntimeSelectionPort = (required: {
  agents: readonly DetectedAgent[]; agentId: string; modelId: string; effort: string;
}) => string | null;

/** Native grants are bound to the invoking plugin's admitted identity/version/digest, never model input.
 * `TInventory` is the host's own inventory type, so its settings tools keep its full surface. */
export type SettingsToolDeps<TInventory extends ChatAgentInventoryPort = ChatAgentInventoryPort> = CoreSettingsToolDeps & {
  assistantAgentInventory?: TInventory;
  /** The composed host writer applies title bounds and visitor-credential policy alike. */
  set?: SiteSettingsSetFn;
  nativeApprovalMemory?: RememberedApprovalPort;
  approvalIdentityForRun?: (required: { ctx: ToolExecutionContext }) => Promise<{ key: string; label: string; version?: string }>;
};
