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
import { AgentPluginUpdateError, createAgentPluginUpdateStore, isMissing, settleAgentPluginUpdateJournal, type AgentPluginUpdateJournal } from './update-store.js';
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
    await settleAgentPluginUpdateJournal({ store });
    const target = await readTarget({ required });
    const plan = planAgentPluginUpdate({ installed: { ...target.previous, enabled: target.enabled }, candidate });
    if (plan.action === 'none') return { plugin: target.previous, enabled: target.enabled, alreadyInstalled: true, warnings: [] };
    const refusal = PLAN_REFUSALS[plan.action];
    if (refusal) throw new AgentPluginUpdateError(refusal);
    const warnings = admissionWarnings({ target, candidate, planWarnings: plan.warnings });
    const plugin = await performUpdate({ required, store, target, candidate, publish });
    return { plugin, enabled: target.enabled, alreadyInstalled: false, warnings };
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
    // until boot) holds identical bytes and would make the rollback rename fail, so it is removed,
    // and only when present: the rename cannot replace a non-empty directory. A run still reading
    // that retained copy loses it here (the same bytes stay live at package/sha256/<digest> until
    // the switch below). Done before recording intent, so recovery never sees both a stale copy
    // and a live old revision.
    const staleCopy = store.rollbackRoot({ digest: journal.fromDigest });
    if (await store.realDirectoryExists({ root: staleCopy })) await removal.removeFrozenPackageTree(staleCopy);
    await store.write({ journal });
    return journal;
  }

  /** The live-state switch. Any failure restores the old revision; a failed restore keeps the
   * journal for boot and reports PLUGIN_ROLLBACK_INCOMPLETE carrying both errors. The candidate is
   * re-enabled only after its MCP roster is provisioned, so an MCP failure leaves it off even when
   * the rollback that follows cannot finish. */
  async function switchRevision({ required, store, target, publish, journal }: UpdateTransaction & { journal: AgentPluginUpdateJournal }, _optional = {}): Promise<InstalledAgentPlugin> {
    const { workspaceId } = required;
    await disableBeforeSwitch({ workspaceId, store, journal });
    let current = journal;
    try {
      await freezeRollback({ store, previous: target.previous });
      const installed = await publish();
      // `current` follows the durable record: recovery re-provisions MCP only once `published` is on disk.
      const published: AgentPluginUpdateJournal = { ...journal, state: 'published' };
      await store.write({ journal: published });
      current = published;
      await provisionAgentPluginMcp({ mcpProvisioning: ports.mcpProvisioning, workspaceId, installed });
      await setActivation({ workspaceId, journal, enabled: journal.enabled });
      await store.write({ journal: { ...journal, state: 'committed', result: 'updated' } });
      return installed;
    } catch (cause) {
      throw await rollBackAfterFailure({ workspaceId, journal: current, cause });
    }
  }

  /** If the first switch-off fails no byte has moved and activation is unchanged, so there is
   * nothing to recover: the intent is dropped instead of being left pending for boot. */
  async function disableBeforeSwitch({ workspaceId, store, journal }: { workspaceId: string; store: UpdateTransaction['store']; journal: AgentPluginUpdateJournal }, _optional = {}): Promise<void> {
    try { await setActivation({ workspaceId, journal, enabled: false }); }
    catch (cause) { await store.clear({}); throw cause; }
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

  /** Idempotent recovery (automatic rollback restore, exempt from downgrade planning): remove the
   * candidate, put the old revision back live and frozen, re-provision its MCP roster when the
   * candidate may have been provisioned (journal reached `published`), and only then restore its
   * activation decision. Any failure restoring bytes keeps the journal for the next boot, including
   * failure after the restore rename.
   *
   * MCP re-provisioning is attempted at boot too, not skipped: provisioning writes host-owned roster
   * records naming the candidate's servers, and nothing guarantees the host rebuilds them from the
   * installed bytes at start. A host whose boot binding has no MCP port (it throws) therefore gets the
   * degraded outcome below rather than a journal that fails every boot.
   */
  async function restoreUpdate({ workspaceId, journal }: { workspaceId: string; journal: AgentPluginUpdateJournal }, _optional = {}): Promise<void> {
    const store = createAgentPluginUpdateStore({ ports, workspaceId, pluginId: journal.pluginId });
    const oldRoot = store.liveRoot({ digest: journal.fromDigest });
    await setActivation({ workspaceId, journal, enabled: false });
    await restoreOldBytes({ store, journal, oldRoot });
    if (journal.state === 'published' && !await reprovisionOld({ workspaceId, journal, oldRoot })) {
      ports.onEvent?.({ event: 'agent-plugin-update-recovered-disabled', message: `Plugin '${journal.pluginId}': the previous revision is back but its MCP servers could not be re-provisioned; it stays off until an operator enables it.` });
    } else {
      await setActivation({ workspaceId, journal, enabled: journal.enabled });
    }
    await store.finish({ journal: { ...journal, result: 'rolled-back' } });
  }

  /** Removes the candidate and puts the old revision back live. Refreezing runs whichever branch
   * ran, so a crash between an earlier reinstate rename and its refreeze is repaired here.
   * @throws AgentPluginUpdateError PLUGIN_ROLLBACK_MISSING, PLUGIN_UPDATE_PATH_UNSAFE. */
  async function restoreOldBytes({ store, journal, oldRoot }: { store: UpdateTransaction['store']; journal: AgentPluginUpdateJournal; oldRoot: string }, _optional = {}): Promise<void> {
    const rollbackRoot = store.rollbackRoot({ digest: journal.fromDigest });
    const oldLive = await store.realDirectoryExists({ root: oldRoot });
    if (!oldLive && !await store.realDirectoryExists({ root: rollbackRoot })) {
      throw new AgentPluginUpdateError({ code: 'PLUGIN_ROLLBACK_MISSING', message: 'Previous plugin bytes are missing; recovery is required.' });
    }
    const candidateRoot = store.liveRoot({ digest: journal.toDigest });
    if (await store.realDirectoryExists({ root: candidateRoot })) await removal.removeFrozenPackageTree(candidateRoot);
    // A read-only directory cannot be renamed, so unfreeze the rollback root before moving it back.
    if (!oldLive) {
      await ports.filesystem.chmod(rollbackRoot, 0o700);
      await ports.filesystem.rename(rollbackRoot, oldRoot);
    }
    await ports.filesystem.chmod(oldRoot, 0o555);
  }

  /** @returns false when the old revision's MCP roster could not be re-provisioned; the bytes are
   * already back, so the caller degrades to "restored but off" instead of wedging the journal. */
  async function reprovisionOld({ workspaceId, journal, oldRoot }: { workspaceId: string; journal: AgentPluginUpdateJournal; oldRoot: string }, _optional = {}): Promise<boolean> {
    try {
      const installed = await index.indexInstalledRoot({ packageRoot: oldRoot, archiveDigest: journal.fromDigest });
      await provisionAgentPluginMcp({ mcpProvisioning: ports.mcpProvisioning, workspaceId, installed });
      return true;
    } catch { return false; }
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
        ports.onEvent?.({ event: 'agent-plugin-update-recovery-failed', message: `Plugin '${pluginId}': an interrupted update could not be recovered (${errorCode({ error })}); it is kept off until a later boot recovers it.` });
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
    const switchOff = (error: unknown) => switchOffUnrecovered({ workspaceId, pluginId, error });
    const journal = await store.read({}).catch(switchOff);
    if (journal?.state === 'committed') await store.finish({ journal });
    else if (journal) await restoreUpdate({ workspaceId, journal }).catch(switchOff);
    for (const rollbackRoot of await store.listRollbackRoots({})) await removal.removeFrozenPackageTree(rollbackRoot);
  }

  /** Unrecovered = off: an unreadable journal or a failed restore switches the plugin off (best
   * effort; the journal stays, so the next boot retries) and rethrows. A failure only filing a
   * committed audit or collecting rollback bytes never reaches here. Bundled plugins never get a
   * journal from this module and are never touched. */
  async function switchOffUnrecovered({ workspaceId, pluginId, error }: { workspaceId: string; pluginId: string; error: unknown }, _optional = {}): Promise<never> {
    const workspaceRoot = ports.layout.forWorkspace({ workspaceId }).root;
    try {
      if (!await activation.isAgentPluginRecordedAsBundled(workspaceRoot, pluginId)) {
        await activation.setAgentPluginActivation({ workspaceRoot, pluginId, enabled: false, actor: 'system:update-recovery' }, { origin: 'operator-installed' });
      }
    } catch { /* best effort: the retained journal keeps refusing mutations until a boot recovers it */ }
    throw error;
  }

  function errorCode({ error }: { error: unknown }, _optional = {}): string {
    return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unknown error';
  }
  return { updateAgentPlugin, reconcileAgentPluginUpdates };
}
