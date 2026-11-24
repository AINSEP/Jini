export interface PluginMemoryListing {
  pluginId: string;
  learned: Array<{ relativePath: string; text: string }>;
  notes: Array<{ relativePath: string; text: string }>;
  limits: { learned: number; notes: number; files: number };
}
export interface AgentPluginMemoryPort {
  read(required: { pluginId: string }, optional?: Record<string, never>): Promise<PluginMemoryListing>;
  saveNote(required: { pluginId: string; entryPath: string; text: string }, optional?: Record<string, never>): Promise<PluginMemoryListing>;
}
