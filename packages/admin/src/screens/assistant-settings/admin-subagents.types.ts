import type { useAssistantOwnerGrant } from "./use-assistant-owner-grant.hooks.js";

type OwnerGrantView = Pick<ReturnType<typeof useAssistantOwnerGrant>, "loadError" | "saveError" | "busy" | "dialog">;
type UserMcp = { capabilities?: { userMcp?: boolean | undefined } | undefined };
/** The slice of the host's Full CLI access grant the owner screen reads (the host's settings type satisfies it). */
export interface AdminSubagentsSettings extends UserMcp {
  enabled: boolean; canEdit: boolean;
  /** With `canEdit`, a local env lock: the server reads the switch OFF, so the screen locks it and shows this reason. */
  unavailableReason?: string | undefined;
  agents?: readonly { id: string; name: string }[] | undefined;
  byAgent?: Record<string, UserMcp | undefined> | undefined;
}
/** What `AdminSubagents` needs from the host's wired controller; grant policy stays in the host. */
export interface AdminSubagentsController extends OwnerGrantView {
  settings: AdminSubagentsSettings | null;
  setEnabled(required: { enabled: boolean }, optional?: Record<string, never>): Promise<void>;
  setAgentMcp(required: { agentId: string; enabled: boolean }, optional?: Record<string, never>): Promise<void>;
}
/** The host's wired controller hook, as `AdminSubagents` calls it. */
export type UseAdminSubagentsHook = (required: { t: (key: string) => string }, optional?: Record<string, never>) => AdminSubagentsController;
/** The host's product copy: the master's ⓘ explainer, the tool-sources hint and a per-agent MCP explainer. */
export interface AdminSubagentsCopy { info: string; toolSourcesHint: string; agentMcpInfo: (required: { name: string }) => string }
