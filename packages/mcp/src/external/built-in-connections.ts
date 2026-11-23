/** Desktop publishes its managed roster ids when starting this site process. No label matching. */
export function readBuiltInExternalMcpServerIds(
  { env }: { env: Record<string, string | undefined> },
  _options = {},
): readonly string[] {
  try {
    const value: unknown = JSON.parse(env.JINI_BUILT_IN_MCP_SERVER_IDS ?? "[]");
    return Array.isArray(value) && value.every(id => typeof id === "string") ? value : [];
  } catch { return []; }
}

export function isBuiltInExternalMcpServer(
  { serverId, ids }: { serverId: string; ids?: readonly string[] | undefined },
  _options = {},
): boolean { return ids?.includes(serverId) ?? false; }

export function describeExternalMcpOwnership<T extends { serverId: string }>(
  { server, ids }: { server: T; ids?: readonly string[] },
  _options = {},
): T & { builtIn: boolean } {
  return { ...server, builtIn: isBuiltInExternalMcpServer({ serverId: server.serverId, ids }) };
}
