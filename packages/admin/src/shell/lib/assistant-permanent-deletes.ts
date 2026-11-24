import type { AssistantPermanentDeletesPolicy } from "@jini-ai/core/contracts/site/headless-assistant-permanent-deletes-policy";

import type { AdminRequestOps } from "./visitor-tools.js";

/**
 * @file The assistant's permanent-deletes risk setting as a port. The host injects its bound request
 * operations and workspace id; the tool list, dangers copy and settings namespace stay host-owned.
 */

export interface AssistantPermanentDeletesSettings extends AssistantPermanentDeletesPolicy { canEdit: boolean }
export interface AssistantPermanentDeletesPort {
  read(required: Record<string, never>, optional?: Record<string, never>): Promise<AssistantPermanentDeletesSettings>;
  write(required: AssistantPermanentDeletesPolicy & { riskAcknowledged: boolean }, optional?: Record<string, never>): Promise<AssistantPermanentDeletesSettings>;
}

/**
 * Uses the same authenticated request/error boundary as subagents.
 *
 * @complexity Time/space: O(1) to build; each call is one request.
 */
export function createAssistantPermanentDeletesPort(
  { http, workspaceId }: { http: AdminRequestOps; workspaceId: string },
  _optional: Record<string, never> = {},
): AssistantPermanentDeletesPort {
  const path = `/workspaces/${workspaceId}/system/assistant-permanent-deletes`;
  return {
    read: () => http.authenticatedAdminRequest({ path, method: "GET" }),
    write: (body, _optional = {}) => http.authenticatedAdminRequest({ path, method: "PUT", body }),
  };
}
