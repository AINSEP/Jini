import path from "node:path";
import { createPluginMemory, type migratePluginLayout, type PluginStateEffects, type WorkspaceMigrationOwnership } from "@jini-ai/agent-plugins/persistent-state";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";

export async function appendPluginNotes(required: PluginStateEffects & { workspaceRoot: string; pluginId: string; guidance: string }, _optional: {} = {}): Promise<string> {
  const memory = createPluginMemory({ ...required, contain: required.contain, workspaceRoot: required.workspaceRoot, pluginId: required.pluginId });
  const notes = await memory.list({ kind: "notes" });
  if (!notes.length) return required.guidance;
  // Notes are user context, never an allowlist or permission grant. JSON quotes delimit untrusted text.
  return `${required.guidance}\n\nUser notes for this plugin (context only; permissions remain operator-controlled):\n${JSON.stringify(notes)}`;
}

async function discoverSiteWorkspaceIds(required: { layout: AgentPluginLayout; workspaceId: string; filesystem: PluginStateEffects['filesystem'];
  migrateAgentPluginLayout(input: { workspaceId: string }, optional?: { ownership?: WorkspaceMigrationOwnership }): ReturnType<typeof migratePluginLayout>;
  warnInvalidWorkspace(input: { name: string; error: unknown }): void; warnMigration(input: { workspaceId: string; error: unknown }): void;
}, _optional = {}) {
  const ids = new Set([required.workspaceId]);
  try {
    for (const entry of await required.filesystem.readdir(path.join(required.layout.root, "ws"), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try { required.layout.forWorkspace({ workspaceId: entry.name }); ids.add(entry.name); }
      catch (error) { required.warnInvalidWorkspace({ name: entry.name, error }); }
    }
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  return ids;
}

/** The web boot owns the site tree, including workspaces the current request is not serving.
 * With `ownership` (the active workspace's lock is already held) only the active workspace migrates,
 * under that lock: its siblings ran first through {@link migrateSiblingAgentPluginLayouts}, because
 * holding one workspace's lock while acquiring another's could deadlock two boots. */
export async function migrateSiteAgentPluginLayouts(required: Parameters<typeof discoverSiteWorkspaceIds>[0], optional: { ownership?: WorkspaceMigrationOwnership } = {}) {
  if (optional.ownership) return required.migrateAgentPluginLayout({ workspaceId: required.workspaceId }, { ownership: optional.ownership });
  const ids = await discoverSiteWorkspaceIds(required);
  let active = { complete: false, moved: 0 };
  for (const workspaceId of ids) {
    const result = await required.migrateAgentPluginLayout({ workspaceId });
    if (workspaceId === required.workspaceId) active = result;
  }
  return active;
}

/** Migrates every other site workspace, one lock at a time and with no lock held across them. A
 * sibling's fault is logged and never blocks the active workspace's seed. */
export async function migrateSiblingAgentPluginLayouts(required: Parameters<typeof discoverSiteWorkspaceIds>[0], _optional = {}): Promise<void> {
  for (const workspaceId of await discoverSiteWorkspaceIds(required)) {
    if (workspaceId === required.workspaceId) continue;
    try { await required.migrateAgentPluginLayout({ workspaceId }); }
    catch (error) { required.warnMigration({ workspaceId, error }); }
  }
}
