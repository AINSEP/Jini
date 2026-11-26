import { createPluginMemory, migratePluginLayout, assertPluginStatePath, withPluginStateLock, withWorkspaceMigrationLock, type PluginStateEffects, type WorkspaceMigrationOwnership } from '@jini-ai/agent-plugins/persistent-state';
import type { AgentPluginLayout } from '@jini-ai/core/contracts/headless/plugin-host';

export function bindAgentPluginMemory(effects: Pick<PluginStateEffects, 'filesystem' | 'withLock'> & {
  workspaceDirectory(required: { layout: AgentPluginLayout }): string;
  parseManifest(required: { value: unknown }): { ok: true; manifest: { name: string } } | { ok: false; errors: readonly string[] };
  onEvent(required: { event: string; message: string }): void;
  invalidWorkspace(required: { workspaceId: string; error: unknown }): void;
  siblingFailure(required: { workspaceId: string; error: unknown }): void;
}, _optional = {}) {
  return {
    pluginMemory: (required: Pick<PluginStateEffects, 'contain'> & { workspaceId: string; pluginId: string; layout: AgentPluginLayout }, _optional = {}) => createPluginMemory({ ...effects, contain: required.contain, workspaceRoot: required.layout.forWorkspace({ workspaceId: required.workspaceId }).root, pluginId: required.pluginId }),
    migrateAgentPluginLayout: (required: Pick<PluginStateEffects, 'contain'> & { layout: AgentPluginLayout; workspaceId: string }, optional: { ownership?: WorkspaceMigrationOwnership } = {}) => migrateAgentPluginLayout(required, optional, effects),
    /** Holds one workspace's layout-migration lock (the outermost lock; Jini owns the ordering) with this host's real file lock. */
    withAgentPluginWorkspaceLock: <T>(required: { workspaceRoot: string; run(held: { ownership: WorkspaceMigrationOwnership }): Promise<T> }, _optional = {}) => withWorkspaceMigrationLock({ ...effects, ...required }),
    appendPluginNotes: (required: Pick<PluginStateEffects, 'contain'> & { workspaceRoot: string; pluginId: string; guidance: string }, _optional = {}) => appendPluginNotes(required, effects),
    assertOwnedPluginPath: (required: Pick<PluginStateEffects, 'contain'> & { workspaceRoot: string; entryPath: string }, _optional = {}) => assertPluginStatePath({ ...effects, ...required }),
    withAgentPluginStateLock: <T>(required: Pick<PluginStateEffects, 'contain'> & { workspaceRoot: string; pluginId: string; run(): Promise<T> }, _optional = {}) => withPluginStateLock({ ...effects, ...required }),
    migrateSiteAgentPluginLayouts: (required: Pick<PluginStateEffects, 'contain'> & { layout: AgentPluginLayout; workspaceId: string }, optional: { ownership?: WorkspaceMigrationOwnership } = {}) => migrateSiteAgentPluginLayouts(required, optional, effects),
    migrateSiblingAgentPluginLayouts: (required: Pick<PluginStateEffects, 'contain'> & { layout: AgentPluginLayout; workspaceId: string }, _optional = {}) => migrateSiblingAgentPluginLayouts(required, effects),
  };
}

/** `ownership`: the caller holds this workspace's migration lock (`withAgentPluginWorkspaceLock`); run under it. */
async function migrateAgentPluginLayout(required: Pick<PluginStateEffects, 'contain'> & { layout: AgentPluginLayout; workspaceId: string }, optional: { ownership?: WorkspaceMigrationOwnership }, effects: Parameters<typeof bindAgentPluginMemory>[0]) {
  return migratePluginLayout({ ...effects, contain: required.contain, workspaceRoot: required.layout.forWorkspace({ workspaceId: required.workspaceId }).root,
    parsePluginId: ({ value }) => {
      const result = effects.parseManifest({ value });
      if (!result.ok) throw new Error(result.errors.join('; '));
      return result.manifest.name;
    },
    onEvent: effects.onEvent,
  }, optional.ownership ? { ownership: optional.ownership } : {});
}

async function appendPluginNotes(required: Pick<PluginStateEffects, 'contain'> & { workspaceRoot: string; pluginId: string; guidance: string }, effects: Parameters<typeof bindAgentPluginMemory>[0]): Promise<string> {
  const memory = createPluginMemory({ ...effects, contain: required.contain, workspaceRoot: required.workspaceRoot, pluginId: required.pluginId });
  const notes = await memory.list({ kind: 'notes' });
  if (!notes.length) return required.guidance;
  // Notes are user context, never an allowlist or permission grant. JSON quotes delimit untrusted text.
  return `${required.guidance}\n\nUser notes for this plugin (context only; permissions remain operator-controlled):\n${JSON.stringify(notes)}`;
}

async function discoverSiteWorkspaceIds(required: Pick<PluginStateEffects, 'contain'> & { layout: AgentPluginLayout; workspaceId: string }, effects: Parameters<typeof bindAgentPluginMemory>[0]) {
  const ids = new Set([required.workspaceId]);
  try {
    for (const entry of await effects.filesystem.readdir(effects.workspaceDirectory({ layout: required.layout }), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try { required.layout.forWorkspace({ workspaceId: entry.name }); ids.add(entry.name); }
      catch (error) { effects.invalidWorkspace({ workspaceId: entry.name, error }); }
    }
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  return ids;
}

/** The web boot owns the site tree, including workspaces the current request is not serving.
 * With `ownership` (the active workspace's lock is already held) only the active workspace migrates,
 * under that lock: its siblings ran first through {@link migrateSiblingAgentPluginLayouts}, because
 * holding one workspace's lock while acquiring another's could deadlock two boots. */
async function migrateSiteAgentPluginLayouts(required: Pick<PluginStateEffects, 'contain'> & { layout: AgentPluginLayout; workspaceId: string }, optional: { ownership?: WorkspaceMigrationOwnership }, effects: Parameters<typeof bindAgentPluginMemory>[0]) {
  if (optional.ownership) return migrateAgentPluginLayout({ contain: required.contain, layout: required.layout, workspaceId: required.workspaceId }, { ownership: optional.ownership }, effects);
  const ids = await discoverSiteWorkspaceIds(required, effects);
  let active = { complete: false, moved: 0 };
  for (const workspaceId of ids) {
    const result = await migrateAgentPluginLayout({ contain: required.contain, layout: required.layout, workspaceId }, {}, effects);
    if (workspaceId === required.workspaceId) active = result;
  }
  return active;
}

/** Migrates every other site workspace, one lock at a time and with no lock held across them. A
 * sibling's fault is logged and never blocks the active workspace's seed. */
async function migrateSiblingAgentPluginLayouts(required: Pick<PluginStateEffects, 'contain'> & { layout: AgentPluginLayout; workspaceId: string }, effects: Parameters<typeof bindAgentPluginMemory>[0]): Promise<void> {
  for (const workspaceId of await discoverSiteWorkspaceIds(required, effects)) {
    if (workspaceId === required.workspaceId) continue;
    try { await migrateAgentPluginLayout({ contain: required.contain, layout: required.layout, workspaceId }, {}, effects); }
    catch (error) { effects.siblingFailure({ workspaceId, error }); }
  }
}
