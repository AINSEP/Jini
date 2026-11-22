import { applyInternalChange } from "@jini-ai/core/optimistic-concurrency";
import type { AgentPluginMcpRecord, AgentPluginMcpRepo } from "./ports.js";

/**
 * Changes one provisioned external-MCP row without writing back anything this change did not decide
 * (lost-update design S1, rules M4/M7): read the row, let `build` derive the next one, write it
 * conditionally on the version and credentials that were read; once more from a fresh read if that
 * missed, then a conflict. The whole-row upsert this replaces restored every column read earlier —
 * including a token a refresh had just stored and an access decision an admin had just made.
 *
 * @param required.build - Derives the next row from the row just read; `null` means nothing to write.
 * @returns the row as written, or `null` when it does not exist or `build` had nothing to write.
 * @throws {RecordVersionConflictError} when the row changed again between the retry's read and write.
 * @complexity O(1) writes; at most two reads and two builds.
 */
export async function updateAgentPluginMcpRow(
  { repo, key, build }: { repo: Pick<AgentPluginMcpRepo, "findByServerId" | "updateIfVersion">; key: { workspaceId: string; serverId: string }; build: (current: AgentPluginMcpRecord) => AgentPluginMcpRecord | null },
  _options = {},
): Promise<AgentPluginMcpRecord | null> {
  return applyInternalChange<AgentPluginMcpRecord>({ recordKind: "MCP server", recordId: key.serverId, read: () => repo.findByServerId(key), build: async current => build(current),
    write: ({ current, next }) => repo.updateIfVersion({ record: next, expectedVersion: current.version, replaces: { sealedEnv: current.sealedEnv, sealedOAuth: current.sealedOAuth } }) });
}
