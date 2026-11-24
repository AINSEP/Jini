import type { NativeCapabilities } from "@jini-ai/core/contracts/agents";

import type { AdminRequestOps } from "./visitor-tools.js";

type Empty = Record<string, never>;

export const SUBAGENT_DANGERS = [
  "Security risk: subagents can act independently.",
  "Subagents inherit the assistant's bypassed permissions.",
  "You may not see what they do; the chat does not show subagent tool calls.",
  "Cost and machine load multiply with each subagent.",
] as const;

/** One agent's override of the site's Full CLI capability grant (keys are the native capabilities). */
export interface AssistantCliAgentPermissions { enabled?: boolean; capabilities?: Partial<NativeCapabilities> }

export interface AssistantSubagentsSettings {
  /** canEdit identifies a local owner; unavailableReason can still lock full access on this machine. */
  enabled: boolean; canEdit: boolean; capabilities?: Partial<NativeCapabilities>; unavailableReason?: string;
  /** Effective launch mode; older responses remain unknown and preflight fails closed. */
  permissionMode?: "bypass" | "restricted";
  byAgent?: Record<string, AssistantCliAgentPermissions>;
  agents?: readonly { id: string; name: string; writesPersonalConfig?: boolean; inheritedRunKey?: boolean }[];
  /** Only sent by the per-agent patch action; never interpreted as a site-default change. */
  agentId?: string;
}
export interface AssistantSubagentsPort {
  read(required: Empty, optional?: Empty): Promise<AssistantSubagentsSettings>;
  write(required: { enabled: boolean; agentId?: string; capabilities?: Partial<NativeCapabilities>; riskAcknowledged: boolean }, optional?: Empty): Promise<AssistantSubagentsSettings>;
}

/** Thin host adapter: shared authenticated requests retain the session/error boundary.
 * The host injects its bound request operations and its workspace id; a host binds once.
 * @complexity O(1) to build; each call is one request.
 */
export function createAssistantSubagentsPort(
  { http, workspaceId }: { http: AdminRequestOps; workspaceId: string },
  _optional: Empty = {},
): AssistantSubagentsPort {
  const path = `/workspaces/${workspaceId}/system/assistant-full-cli`;
  return {
    read: () => http.authenticatedAdminRequest({ path, method: "GET" }),
    write: (body, _optional = {}) => http.authenticatedAdminRequest({ path, method: "PUT", body }),
  };
}
