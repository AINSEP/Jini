import path from 'node:path';
import { createInstallModule, type InstallAgentPluginOptional, type InstallAgentPluginRequired } from './install.js';
import { createUninstallModule } from './uninstall.js';
import { createActivationModule, type AgentPluginActivations } from './activation.js';
import { createResolveAgentPluginRefsModule } from './resolve-agent-plugin-refs.js';
import { createPersistentStateModule } from './persistent-state.js';
import { createInstalledPackageIndex } from './installed-package-index.js';
import { provisionAgentPluginMcp } from './mcp-provisioning.js';
import { planAgentPluginUpdate, type AgentPluginUpdatePlan } from './update-plan.js';
import { AgentPluginHostIncompatibleError, describeAgentPluginCompatibility, agentPluginDependentWarnings } from './compatibility.js';
import { AgentPluginUpdateError, createAgentPluginUpdateStore, isMissing, type AgentPluginUpdateJournal } from './update-store.js';
import type { AgentPluginLifecyclePorts } from './ports.js';
import type { InstalledAgentPlugin } from './types.js';

export interface UpdateAgentPluginRequired extends InstallAgentPluginRequired {
  readonly pluginId: string;
  /** The digest the operator previewed; any other live revision refuses with PLUGIN_CHANGED. */
  readonly expectedOldDigest: string;
  /** The authenticated principal, recorded in the update audit. */
  readonly actor: string;
  /** Host owns settings schemas; archives never supply executable migrations or snapshot code.
   * Return a NON-SECRET summary only: it is persisted (0600) in the journal and update history. */
  readonly snapshotSettings: (required: { workspaceId: string; pluginId: string }, optional: Record<string, never>) => Promise<unknown>;
}
export interface UpdateAgentPluginResult {
  readonly plugin: InstalledAgentPlugin;
  readonly enabled: boolean;
  readonly alreadyInstalled: boolean;
  readonly warnings: readonly string[];
}
type InstallAgentPluginPort = (required: InstallAgentPluginRequired, optional: InstallAgentPluginOptional) => Promise<InstalledAgentPlugin>;

interface UpdateTarget {
  readonly previous: InstalledAgentPlugin;
  readonly installed: readonly InstalledAgentPlugin[];
  readonly activations: AgentPluginActivations;
  readonly enabled: boolean;
}
interface UpdateTransaction {
  readonly required: UpdateAgentPluginRequired;
  readonly store: ReturnType<typeof createAgentPluginUpdateStore>;
  readonly target: UpdateTarget;
  readonly candidate: InstalledAgentPlugin;
  readonly publish: () => Promise<InstalledAgentPlugin>;
}

const PLAN_REFUSALS: Partial<Record<AgentPluginUpdatePlan['action'], { code: string; message: string }>> = {
  'downgrade-refused': { code: 'PLUGIN_DOWNGRADE_REFUSED', message: 'Plugin downgrades are refused.' },
  'id-mismatch': { code: 'PLUGIN_ID_MISMATCH', message: 'Choose a candidate for this plugin.' },
};

/** Update transaction owner for operator-installed plugins (bundled ones stay seed-managed).
 *
 * Runs inside the installer's identity lock and per-plugin file lock (the publish guard), so it is
 * serialized against enable/disable/uninstall, which take the same plugin lock. Nothing called in
 * the guard re-takes that lock: activation writes use their own activations.json lock.
 *
 * Invariant: never two live digests. The old revision moves to a frozen rollback area outside
 * `package/sha256` before the candidate is published; a per-plugin journal (pending -> published ->
 * committed) lets boot reconciliation restore it if the process dies before commit.
 *
 * Documented behavior:
 * - In-flight MCP calls against the old revision may fail once the roster is re-provisioned.
 * - Running chats keep the skill text they already captured; new runs resolve the new revision.
 * - Rollback bytes are retained after commit (a run may still read them) and collected by the next
 *   boot's reconciliation, when no run can hold those paths.
 * - Plugin data and memory directories carry over untouched. A rollback restores package bytes and
 *   activation only; it does NOT revert data, memory or settings written while the candidate ran.
 *   The settings snapshot is an audit record, not a restore source.
 * - Caches: this package keeps no cache of skill prompt indexes or search ranking keyed by plugin
 *   (search ranking is computed per call from the installed list; per-run automatic-use state is
 *   per run; module imports are keyed by the digest path), so a switch has nothing to invalidate.
 */
export function createUpdateModule(ports: AgentPluginLifecyclePorts, optional: { installAgentPlugin?: InstallAgentPluginPort } = {}) {
  const installAgentPlugin = optional.installAgentPlugin ?? createInstallModule(ports).installAgentPlugin;
  const activation = createActivationModule(ports);
  const removal = createUninstallModule(ports);
  const refs = createResolveAgentPluginRefsModule(ports);
  const persistent = createPersistentStateModule(ports);
  const index = createInstalledPackageIndex({ ports });

  /** Verifies and stages the candidate through the installer, then runs the transaction in its
   * publish guard. @throws AgentPluginUpdateError, AgentPluginHostIncompatibleError, install errors. */
  async function updateAgentPlugin(required: UpdateAgentPluginRequired, _optional: Record<string, never> = {}): Promise<UpdateAgentPluginResult> {
    const input = { ...required, layout: ports.layout };
    const outcomes: UpdateAgentPluginResult[] = [];
    await installAgentPlugin(input, { publishGuard: async ({ plugin, publish }) => {
      const outcome = await updateLocked({ required: input, candidate: plugin, publish });
      outcomes.push(outcome);
      return outcome.plugin;
    } });
    const [outcome] = outcomes;
    if (!outcome) throw new AgentPluginUpdateError({ code: 'PLUGIN_UPDATE_NOT_RUN', message: 'The installer did not run the update transaction.' });
    return outcome;
  }

  /** All validation precedes the first live-state mutation. @complexity O(p) installed plugins. */
  async function updateLocked({ required, candidate, publish }: {
    required: UpdateAgentPluginRequired; candidate: InstalledAgentPlugin; publish: () => Promise<InstalledAgentPlugin>;
  }, _optional = {}): Promise<UpdateAgentPluginResult> {
    // The installer locked the candidate's id; refuse before reading another plugin's state.
    if (candidate.pluginId !== required.pluginId) throw new AgentPluginUpdateError(PLAN_REFUSALS['id-mismatch']!);
    const store = createAgentPluginUpdateStore({ ports, workspaceId: required.workspaceId, pluginId: required.pluginId });
    await settleOutstanding({ store });
    const target = await readTarget({ required });
    const plan = planAgentPluginUpdate({ installed: { ...target.previous, enabled: target.enabled }, candidate });
    if (plan.action === 'none') return { plugin: target.previous, enabled: target.enabled, alreadyInstalled: true, warnings: [] };
    const refusal = PLAN_REFUSALS[plan.action];
    if (refusal) throw new AgentPluginUpdateError(refusal);
    const warnings = admissionWarnings({ target, candidate, planWarnings: plan.warnings });
    const plugin = await performUpdate({ required, store, target, candidate, publish });
    return { plugin, enabled: target.enabled, alreadyInstalled: false, warnings };
  }

  /** An unfinished journal blocks new updates until boot recovery; a committed one whose audit
   * filing was interrupted is filed now. */
  async function settleOutstanding({ store }: { store: UpdateTransaction['store'] }, _optional = {}): Promise<void> {
    const outstanding = await store.read({});
    if (!outstanding) return;
    if (outstanding.state !== 'committed') throw new AgentPluginUpdateError({ code: 'PLUGIN_UPDATE_PENDING', message: 'Restart the host to recover the interrupted update.' });
    await store.finish({ journal: outstanding });
  }

  /** Exactly one live revision at the previewed digest, operator-installed, with a readable decision. */
  async function readTarget({ required }: { required: UpdateAgentPluginRequired }, _optional = {}): Promise<UpdateTarget> {
    const workspaceRoot = ports.layout.forWorkspace({ workspaceId: required.workspaceId }).root;
    const installed = await refs.listInstalledPlugins(workspaceRoot);
    const matches = installed.filter(plugin => plugin.pluginId === required.pluginId);
    if (matches.length !== 1 || matches[0]!.archiveDigest !== required.expectedOldDigest) {
      throw new AgentPluginUpdateError({ code: 'PLUGIN_CHANGED', message: 'The installed plugin changed; preview it again.' });
    }
    const previous = matches[0]!;
    if (await activation.isAgentPluginRecordedAsBundled(workspaceRoot, previous.pluginId)) {
      throw new AgentPluginUpdateError({ code: 'PLUGIN_BUNDLED', message: 'Bundled plugins are managed by the host.' });
    }
    const verdict = await activation.resolveAgentPluginActivation(workspaceRoot, previous.pluginId);
    if (verdict.verdict === 'undetermined') throw new AgentPluginUpdateError({ code: 'PLUGIN_ACTIVATION_UNKNOWN', message: 'Repair this plugin activation record before updating.' });
    const activations = await activation.readAgentPluginActivations(workspaceRoot);
    return { previous, installed, activations, enabled: verdict.verdict === 'active' };
  }

  /** An enabled plugin must stay host-compatible; requirement and dependent losses only warn. */
  function admissionWarnings({ target, candidate, planWarnings }: {
    target: UpdateTarget; candidate: InstalledAgentPlugin; planWarnings: readonly string[];
  }, _optional = {}): string[] {
    const { previous, installed, activations } = target;
    const compatibility = describeAgentPluginCompatibility({ plugin: candidate, installed, activations });
    if (target.enabled && !compatibility.hostOk) throw new AgentPluginHostIncompatibleError({ pluginId: candidate.pluginId });
    return [...planWarnings, ...compatibility.missingRequires.map(id => `Needs ${id}`),
      ...agentPluginDependentWarnings({ plugin: previous, installed, activations, nextProvides: candidate.provides ?? [] })];
  }

  /** Records intent, switches revisions, then files the audit. A failed audit filing after commit
   * does not undo the update: the committed journal stays and the next update or boot files it. */
  async function performUpdate(transaction: UpdateTransaction, _optional = {}): Promise<InstalledAgentPlugin> {
    const journal = await beginJournal(transaction);
    const installed = await switchRevision({ ...transaction, journal });
    try { await transaction.store.finish({ journal: { ...journal, state: 'committed', result: 'updated' } }); }
    catch {
      ports.onEvent?.({ event: 'agent-plugin-update-audit-deferred', message: `Plugin '${journal.pluginId}': the committed update will be filed in its history at the next boot.` });
    }
    return installed;
  }

  async function beginJournal({ required, store, target, candidate }: UpdateTransaction, _optional = {}): Promise<AgentPluginUpdateJournal> {
    const { previous, enabled } = target;
    const settingsSnapshot = await required.snapshotSettings({ workspaceId: required.workspaceId, pluginId: previous.pluginId }, {});
    const journal: AgentPluginUpdateJournal = { schemaVersion: 1, state: 'pending', transactionId: ports.ids.newId(),
      pluginId: previous.pluginId, actor: required.actor, enabled, fromDigest: previous.archiveDigest,
      toDigest: candidate.archiveDigest, fromVersion: previous.version, toVersion: candidate.version,
      settingsSnapshot, startedAt: new Date(ports.clock.nowMs()).toISOString() };
    await store.prepare({});
    // A copy of this same digest retained by an earlier committed update (kept for in-flight runs
    // until boot) holds identical bytes and would make the rollback rename fail. Discard it before
    // recording intent, so recovery never sees both a stale copy and a live old revision.
    await removal.removeFrozenPackageTree(store.rollbackRoot({ digest: journal.fromDigest }));
    await store.write({ journal });
    return journal;
  }

  /** The live-state switch. Any failure restores the old revision; a failed restore keeps the
   * journal for boot and reports PLUGIN_ROLLBACK_INCOMPLETE carrying both errors. */
  async function switchRevision({ required, store, target, publish, journal }: UpdateTransaction & { journal: AgentPluginUpdateJournal }, _optional = {}): Promise<InstalledAgentPlugin> {
    const { workspaceId } = required;
    let current = journal;
    try {
      await setActivation({ workspaceId, journal, enabled: false });
      await freezeRollback({ store, previous: target.previous });
      const installed = await publish();
      // `current` follows the durable record: recovery re-provisions MCP only once `published` is on disk.
      const published: AgentPluginUpdateJournal = { ...journal, state: 'published' };
      await store.write({ journal: published });
      current = published;
      await setActivation({ workspaceId, journal, enabled: journal.enabled });
      await provisionAgentPluginMcp({ mcpProvisioning: ports.mcpProvisioning, workspaceId, installed });
      await store.write({ journal: { ...journal, state: 'committed', result: 'updated' } });
      return installed;
    } catch (cause) {
      throw await rollBackAfterFailure({ workspaceId, journal: current, cause });
    }
  }

  /** Moves the old revision out of `package/sha256` (reusing uninstall's staging move) and refreezes it. */
  async function freezeRollback({ store, previous }: { store: UpdateTransaction['store']; previous: InstalledAgentPlugin }, _optional = {}): Promise<void> {
    const rollbackRoot = store.rollbackRoot({ digest: previous.archiveDigest });
    await removal.stageForRemoval(path.dirname(previous.packageRoot), previous.packageRoot, { quarantined: rollbackRoot });
    await ports.filesystem.chmod(rollbackRoot, 0o555);
  }

  async function rollBackAfterFailure({ workspaceId, journal, cause }: { workspaceId: string; journal: AgentPluginUpdateJournal; cause: unknown }, _optional = {}): Promise<unknown> {
    try {
      await restoreUpdate({ workspaceId, journal });
      return cause;
    } catch (rollbackError) {
      return new AgentPluginUpdateError({ code: 'PLUGIN_ROLLBACK_INCOMPLETE', message: 'The update failed and its rollback did not finish; restart the host to recover.' },
        { cause: new AggregateError([cause, rollbackError], 'update failure, then rollback failure') });
    }
  }

  async function setActivation({ workspaceId, journal, enabled }: { workspaceId: string; journal: AgentPluginUpdateJournal; enabled: boolean }, _optional = {}) {
    return activation.setAgentPluginActivation({ workspaceRoot: ports.layout.forWorkspace({ workspaceId }).root,
      pluginId: journal.pluginId, enabled, actor: journal.actor }, { origin: 'operator-installed' });
  }

  async function exists({ root }: { root: string }, _optional = {}): Promise<boolean> {
    try { await ports.filesystem.lstat(root); return true; }
    catch (error) { if (!isMissing({ error })) throw error; return false; }
  }

  /** Idempotent recovery (automatic rollback restore, exempt from downgrade planning): remove the
   * candidate, put the old revision back live, restore its activation decision, and re-provision
   * its MCP roster when the candidate may have been provisioned (journal reached `published`).
   * Any failure keeps the journal for the next boot, including failure after the restore rename.
   */
  async function restoreUpdate({ workspaceId, journal }: { workspaceId: string; journal: AgentPluginUpdateJournal }, _optional = {}): Promise<void> {
    const store = createAgentPluginUpdateStore({ ports, workspaceId, pluginId: journal.pluginId });
    const oldRoot = store.liveRoot({ digest: journal.fromDigest });
    const oldLive = await exists({ root: oldRoot });
    if (!oldLive && !await exists({ root: store.rollbackRoot({ digest: journal.fromDigest }) })) {
      throw new AgentPluginUpdateError({ code: 'PLUGIN_ROLLBACK_MISSING', message: 'Previous plugin bytes are missing; recovery is required.' });
    }
    await setActivation({ workspaceId, journal, enabled: false });
    await removal.removeFrozenPackageTree(store.liveRoot({ digest: journal.toDigest }));
    if (!oldLive) await reinstateRollback({ store, journal, oldRoot });
    await setActivation({ workspaceId, journal, enabled: journal.enabled });
    if (journal.state === 'published') {
      const installed = await index.indexInstalledRoot({ packageRoot: oldRoot, archiveDigest: journal.fromDigest });
      await provisionAgentPluginMcp({ mcpProvisioning: ports.mcpProvisioning, workspaceId, installed });
    }
    await store.finish({ journal: { ...journal, result: 'rolled-back' } });
  }

  /** A read-only directory cannot be renamed, so unfreeze the root, move it back, refreeze it. */
  async function reinstateRollback({ store, journal, oldRoot }: { store: UpdateTransaction['store']; journal: AgentPluginUpdateJournal; oldRoot: string }, _optional = {}): Promise<void> {
    const rollbackRoot = store.rollbackRoot({ digest: journal.fromDigest });
    await ports.filesystem.chmod(rollbackRoot, 0o700);
    await ports.filesystem.rename(rollbackRoot, oldRoot);
    await ports.filesystem.chmod(oldRoot, 0o555);
  }

  /** Boot only, before serving runs: recover incomplete switches, file committed audits, then
   * collect retained rollback bytes. One plugin's failure does not stop the others; the first
   * failure is rethrown afterwards. Bundled plugins have no update journal and get no decisions.
   * @complexity O(p + f) workspace entries and retained rollback files.
   */
  async function reconcileAgentPluginUpdates({ workspaceId }: { workspaceId: string }, _optional: Record<string, never> = {}): Promise<void> {
    const workspaceRoot = ports.layout.forWorkspace({ workspaceId }).root;
    const failures: unknown[] = [];
    for (const pluginId of await listPluginStateIds({ workspaceId })) {
      try {
        await persistent.withPluginLock({ workspaceRoot, pluginId, run: () => reconcilePlugin({ workspaceId, pluginId }) });
      } catch (error) {
        failures.push(error);
        ports.onEvent?.({ event: 'agent-plugin-update-recovery-failed', message: `Plugin '${pluginId}': an interrupted update could not be recovered.` });
      }
    }
    if (failures.length) throw failures[0];
  }

  /** Workspace entries that can be plugin state roots. Reserved names (staging, packages, memory,
   * data) and invalid ids are rejected by the layout itself and are skipped, never locked. */
  async function listPluginStateIds({ workspaceId }: { workspaceId: string }, _optional = {}): Promise<string[]> {
    const workspace = ports.layout.forWorkspace({ workspaceId });
    let entries;
    try { entries = await ports.filesystem.readdir(workspace.root, { withFileTypes: true }); }
    catch (error) { if (!isMissing({ error })) throw error; return []; }
    return entries.filter(entry => entry.isDirectory() && isPluginStateRoot({ workspace, pluginId: entry.name })).map(entry => entry.name);
  }

  function isPluginStateRoot({ workspace, pluginId }: { workspace: ReturnType<AgentPluginLifecyclePorts['layout']['forWorkspace']>; pluginId: string }): boolean {
    try { workspace.pluginRootDir({ pluginId }); return true; }
    catch { return false; }
  }

  async function reconcilePlugin({ workspaceId, pluginId }: { workspaceId: string; pluginId: string }, _optional = {}): Promise<void> {
    const store = createAgentPluginUpdateStore({ ports, workspaceId, pluginId });
    const journal = await store.read({});
    if (journal?.state === 'committed') await store.finish({ journal });
    else if (journal) await restoreUpdate({ workspaceId, journal });
    for (const rollbackRoot of await store.listRollbackRoots({})) await removal.removeFrozenPackageTree(rollbackRoot);
  }
  return { updateAgentPlugin, reconcileAgentPluginUpdates };
}
