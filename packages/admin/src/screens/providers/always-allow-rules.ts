import type { AdminExternalMcpServer, ExternalMcpToolApprovalDto } from "@jini-ai/core/contracts/site/cms-external-mcp";
import type { QueryKey } from "@jini-ai/core/fetch";
import { buildAgentListHandles } from "@jini-ai/core/agent-handles";

/**
 * @file Pure derivations for the Integrations "Always allow" tab (`AlwaysAllowPanel.tsx`).
 */

export const ALWAYS_ALLOW_KEYS = {
  list: ["external-mcp-tool-approvals"] as QueryKey,
};

/** One server's card on the tab: its roster label and the tools set to "Always allow" on it. */
export interface AlwaysAllowGroup {
  serverId: string;
  /** The roster label, or the id when the server is no longer on the roster. */
  label: string;
  /** Agent handle for the server's section. Ids like `get_file` are not valid handles, so every
   *  handle here is slugified and de-duplicated by `buildAgentListHandles`. */
  handle: string;
  tools: readonly { toolName: string; grantedAt: string; revokeHandle: string }[];
}

/**
 * Groups saved approvals by server, labelled from the roster, servers A–Z by label and tools in the
 * order the route sends them (A–Z), each with a valid, distinct agent handle.
 *
 * @complexity O(a + s + g log g) for a approvals, s servers and g groups.
 */
export function groupAlwaysAllow(
  approvals: readonly ExternalMcpToolApprovalDto[],
  servers: readonly Pick<AdminExternalMcpServer, "serverId" | "label">[],
): AlwaysAllowGroup[] {
  const labels = new Map(servers.map((server) => [server.serverId, server.label || server.serverId]));
  const groups = new Map<string, { toolName: string; grantedAt: string }[]>();
  for (const { serverId, toolName, grantedAt } of approvals) {
    const tools = groups.get(serverId) ?? [];
    tools.push({ toolName, grantedAt });
    groups.set(serverId, tools);
  }
  const sorted = [...groups.entries()]
    .map(([serverId, tools]) => ({ serverId, label: labels.get(serverId) ?? serverId, tools }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const handles = buildAgentListHandles({ prefix: "always-allow-server", ids: sorted.map((group) => group.serverId) });
  // `buildAgentListHandles` returns exactly one handle per id, positionally aligned, so both
  // index reads below always hit.
  return sorted.map((group, index) => {
    const handle = handles[index] as string;
    const revokeHandles = buildAgentListHandles({ prefix: `${handle}-revoke`, ids: group.tools.map((tool) => tool.toolName) });
    return {
      ...group,
      handle,
      tools: group.tools.map((tool, toolIndex) => ({ ...tool, revokeHandle: revokeHandles[toolIndex] as string })),
    };
  });
}

/** The date a tool was set to "Always allow", in the viewer's locale; the raw value if unparseable. */
export function formatGrantedAt({ grantedAt, locale }: { grantedAt: string; locale: string }, _options: Record<string, never> = {}): string {
  const date = new Date(grantedAt);
  return Number.isNaN(date.getTime()) ? grantedAt : date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}
