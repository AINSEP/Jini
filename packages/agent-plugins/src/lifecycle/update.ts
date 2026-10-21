import path from 'node:path';
import { createInstallModule, type InstallAgentPluginRequired } from './install.js';
import { createUninstallModule } from './uninstall.js';
import { createActivationModule } from './activation.js';
import { createResolveAgentPluginRefsModule } from './resolve-agent-plugin-refs.js';
import { createPersistentStateModule } from './persistent-state.js';
import { createInstalledPackageIndex } from './installed-package-index.js';
import { provisionAgentPluginMcp } from './mcp-provisioning.js';
import { planAgentPluginUpdate } from './update-plan.js';
import { AgentPluginHostIncompatibleError, describeAgentPluginCompatibility, agentPluginDependentWarnings } from './compatibility.js';
import { AgentPluginUpdateError, createAgentPluginUpdateStore, isMissing, type AgentPluginUpdateJournal } from './update-store.js';
import type { AgentPluginLifecyclePorts } from './ports.js';
import type { InstalledAgentPlugin } from './types.js';

export interface UpdateAgentPluginRequired extends InstallAgentPluginRequired {
  readonly pluginId: string;
  readonly expectedOldDigest: string;
  readonly actor: string;
  /** Host owns settings schemas; archives never supply executable migrations or snapshot code. */
  readonly snapshotSettings: (required: { workspaceId: string; pluginId: string }, optional: Record<string, never>) => Promise<unknown>;
}
export interface UpdateAgentPluginResult {
  readonly plugin: InstalledAgentPlugin;
  readonly enabled: boolean;
  readonly alreadyInstalled: boolean;
  readonly warnings: readonly string[];
}

/** Update transaction owner. The installer supplies its existing cross-process lock and verified
 * publication callback. The only live digest is the selected revision; rollback bytes are outside
 * packages/sha256. In-flight MCP calls may fail; running chats keep their captured skill text.
 * Rollback restores package/activation, not state written by the candidate. Settings are snapshotted.
 */
export function createUpdateModule(ports: AgentPluginLifecyclePorts, _optional: Record<string, never> = {}) {
  const activation = createActivationModule(ports);
  const removal = createUninstallModule(ports);
  const refs = createResolveAgentPluginRefsModule(ports);
  const persistent = createPersistentStateModule(ports);
  const index = createInstalledPackageIndex({ ports });

  async function updateAgentPlugin(required: UpdateAgentPluginRequired, _optional: Record<string, never> = {}): Promise<UpdateAgentPluginResult> {
    required = { ...required, layout: ports.layout };
    let result: UpdateAgentPluginResult | undefined;
    await createInstallModule(ports).installAgentPlugin(required, { publishGuard: async ({ plugin, publish }) => {
      if (plugin.pluginId !== required.pluginId) throw new AgentPluginUpdateError({ code: 'PLUGIN_ID_MISMATCH', message: 'Choose a candidate for this plugin.' });
      result = await updateLocked({ required, candidate: plugin, publish });
      return result.plugin;
    } });
    return result!;
  }

  /** All validation and intent recording precede the first live-state mutation. @complexity O(p). */
  async function updateLocked({ required, candidate, publish }: {
    required: UpdateAgentPluginRequired; candidate: InstalledAgentPlugin; publish: () => Promise<InstalledAgentPlugin>;
  }, _optional = {}): Promise<UpdateAgentPluginResult> {
    const workspaceRoot = required.layout.forWorkspace({ workspaceId: required.workspaceId }).root;
    const installed = await refs.listInstalledPlugins(workspaceRoot);
    const matches = installed.filter(plugin => plugin.pluginId === required.pluginId);
    if (matches.length !== 1 || matches[0]!.archiveDigest !== required.expectedOldDigest) {
      throw new AgentPluginUpdateError({ code: 'PLUGIN_CHANGED', message: 'The installed plugin changed; preview it again.' });
    }
    const previous = matches[0]!;
    const activations = await activation.readAgentPluginActivations(workspaceRoot);
    if (await activation.isAgentPluginRecordedAsBundled(workspaceRoot, previous.pluginId)) {
      throw new AgentPluginUpdateError({ code: 'PLUGIN_BUNDLED', message: 'Bundled plugins are managed by the host.' });
    }
    const verdict = await activation.resolveAgentPluginActivation(workspaceRoot, previous.pluginId);
    if (verdict.verdict === 'undetermined') throw new AgentPluginUpdateError({ code: 'PLUGIN_ACTIVATION_UNKNOWN', message: 'Repair this plugin activation record before updating.' });
    const enabled = verdict.verdict === 'active';
    const plan = planAgentPluginUpdate({ installed: { ...previous, enabled }, candidate });
    if (plan.action === 'downgrade-refused') throw new AgentPluginUpdateError({ code: 'PLUGIN_DOWNGRADE_REFUSED', message: 'Plugin downgrades are refused.' });
    if (plan.action === 'none') return { plugin: previous, enabled, alreadyInstalled: true, warnings: [] };
    const compatibility = describeAgentPluginCompatibility({ plugin: candidate, installed, activations });
    if (enabled && !compatibility.hostOk) throw new AgentPluginHostIncompatibleError({ pluginId: previous.pluginId });
    const warnings = [...plan.warnings, ...compatibility.missingRequires.map(id => `Needs ${id}`),
      ...agentPluginDependentWarnings({ plugin: previous, installed, activations, nextProvides: candidate.provides ?? [] })];
    return performUpdate({ required, previous, candidate, enabled, warnings, publish });
  }

  async function performUpdate({ required, previous, candidate, enabled, warnings, publish }: {
    required: UpdateAgentPluginRequired; previous: InstalledAgentPlugin; candidate: InstalledAgentPlugin;
    enabled: boolean; warnings: readonly string[]; publish: () => Promise<InstalledAgentPlugin>;
  }, _optional = {}): Promise<UpdateAgentPluginResult> {
    const store = createAgentPluginUpdateStore({ ports, ...required });
    const outstanding = await store.read({});
    if (outstanding) {
      if (outstanding.state !== 'committed') throw new AgentPluginUpdateError({ code: 'PLUGIN_UPDATE_PENDING', message: 'Restart the host to recover the interrupted update.' });
      await store.write({ journal: outstanding, history: true });
      await store.clear({});
    }
    const journal: AgentPluginUpdateJournal = { schemaVersion: 1, state: 'pending', transactionId: ports.ids.newId(),
      pluginId: previous.pluginId, actor: required.actor, enabled, fromDigest: previous.archiveDigest,
      toDigest: candidate.archiveDigest, fromVersion: previous.version, toVersion: candidate.version,
      settingsSnapshot: await required.snapshotSettings({ workspaceId: required.workspaceId, pluginId: previous.pluginId }, {}),
      startedAt: new Date(ports.clock.nowMs()).toISOString() };
    await store.prepare({});
    await store.write({ journal });
    let installed: InstalledAgentPlugin;
    try {
      await setActivation({ workspaceId: required.workspaceId, journal, enabled: false });
      const rollbackRoot = store.rollbackRoot({ digest: journal.fromDigest });
      await removal.stageForRemoval(path.dirname(previous.packageRoot), previous.packageRoot, { quarantined: rollbackRoot });
      await ports.filesystem.chmod(rollbackRoot, 0o555);
      installed = await publish();
      await store.write({ journal: { ...journal, state: 'published' } });
      await setActivation({ workspaceId: required.workspaceId, journal, enabled });
      await provisionAgentPluginMcp({ mcpProvisioning: ports.mcpProvisioning, workspaceId: required.workspaceId, installed });
      await store.write({ journal: { ...journal, state: 'committed', result: 'updated' } });
    } catch (cause) {
      await restoreUpdate({ workspaceId: required.workspaceId, journal });
      throw cause;
    }
    // Retain rollback bytes for in-flight consumers. Next boot has no runs holding these paths.
    return { plugin: installed, enabled, alreadyInstalled: false, warnings };
  }

  async function setActivation({ workspaceId, journal, enabled }: { workspaceId: string; journal: AgentPluginUpdateJournal; enabled: boolean }, _optional = {}) {
    return activation.setAgentPluginActivation({ workspaceRoot: ports.layout.forWorkspace({ workspaceId }).root,
      pluginId: journal.pluginId, enabled, actor: journal.actor }, { origin: 'operator-installed' });
  }

  async function exists({ root }: { root: string }, _optional = {}): Promise<boolean> {
    try { await ports.filesystem.stat(root); return true; }
    catch (error) { if (isMissing({ error })) return false; throw error; }
  }

  /** Idempotent recovery: remove the new live revision before restoring the old one. Any failure
   * retains the journal for the next boot, including failure after the restore rename.
   */
  async function restoreUpdate({ workspaceId, journal }: { workspaceId: string; journal: AgentPluginUpdateJournal }, { atBoot = false }: { atBoot?: boolean } = {}): Promise<void> {
    const store = createAgentPluginUpdateStore({ ports, workspaceId, pluginId: journal.pluginId });
    const oldRoot = store.liveRoot({ digest: journal.fromDigest });
    const rollbackRoot = store.rollbackRoot({ digest: journal.fromDigest });
    const newRoot = store.liveRoot({ digest: journal.toDigest });
    const rollbackExists = await exists({ root: rollbackRoot });
    if (!rollbackExists && !await exists({ root: oldRoot })) throw new AgentPluginUpdateError({ code: 'PLUGIN_ROLLBACK_MISSING', message: 'Previous plugin bytes are missing; recovery is required.' });
    await setActivation({ workspaceId, journal, enabled: false });
    if (await exists({ root: newRoot })) await removal.removeFrozenPackageTree(newRoot);
    if (rollbackExists) {
      await ports.filesystem.chmod(rollbackRoot, 0o700);
      await ports.filesystem.rename(rollbackRoot, oldRoot);
    }
    await ports.filesystem.chmod(oldRoot, 0o555);
    await setActivation({ workspaceId, journal, enabled: journal.enabled });
    if (!atBoot) {
      const installed = await index.indexInstalledRoot({ packageRoot: oldRoot, archiveDigest: journal.fromDigest });
      await provisionAgentPluginMcp({ mcpProvisioning: ports.mcpProvisioning, workspaceId, installed });
    }
    await store.write({ journal: { ...journal, result: 'rolled-back' }, history: true });
    await store.clear({});
  }

  /** Boot only, before serving runs: recover incomplete switches, then collect retained bytes.
   * Bundled plugins have no update journal and are never assigned activation decisions here.
   * @complexity O(p + f) workspace entries and retained rollback files.
   */
  async function reconcileAgentPluginUpdates({ workspaceId }: { workspaceId: string }, _optional: Record<string, never> = {}): Promise<void> {
    const workspace = ports.layout.forWorkspace({ workspaceId });
    let entries;
    try { entries = await ports.filesystem.readdir(workspace.root, { withFileTypes: true }); }
    catch (error) { if (isMissing({ error })) return; throw error; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(entry.name)) continue;
      await persistent.withPluginLock({ workspaceRoot: workspace.root, pluginId: entry.name,
        run: () => reconcilePlugin({ workspaceId, pluginId: entry.name }) });
    }
  }

  async function reconcilePlugin({ workspaceId, pluginId }: { workspaceId: string; pluginId: string }, _optional = {}): Promise<void> {
    const store = createAgentPluginUpdateStore({ ports, workspaceId, pluginId });
    const journal = await store.read({});
    if (journal && journal.state !== 'committed') await restoreUpdate({ workspaceId, journal }, { atBoot: true });
    if (journal?.state === 'committed') {
      await store.write({ journal, history: true });
      await store.clear({});
    }
    const rollbackDir = path.dirname(store.rollbackRoot({ digest: 'unused' }));
    let entries;
    try { entries = await ports.filesystem.readdir(rollbackDir, { withFileTypes: true }); }
    catch (error) { if (isMissing({ error })) return; throw error; }
    for (const entry of entries) {
      if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) await removal.removeFrozenPackageTree(path.join(rollbackDir, entry.name));
    }
  }
  return { updateAgentPlugin, reconcileAgentPluginUpdates };
}
