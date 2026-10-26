/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import { createPersistentStateModule } from './persistent-state.js';
import { AgentPluginHostIncompatibleError, describeAgentPluginCompatibility, agentPluginDependentWarnings } from './compatibility.js';
import { createActivationModule } from "./activation.js";
import { createResolveAgentPluginRefsModule } from "./resolve-agent-plugin-refs.js";
import { createAgentPluginUpdateStore, settleAgentPluginUpdateJournal } from "./update-store.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";
import type { InstalledAgentPlugin } from "./types.js";

/**
 * The id named is not installed in this workspace. A distinct class rather than a bare `Error` so
 * each caller can map it to its own boundary's vocabulary — 404 `AGENT_PLUGIN_NOT_FOUND` at the
 * admin route, `ToolInputError` at the tool — without either one string-matching a message.
 */
export class AgentPluginNotInstalledError extends Error {
  constructor({ pluginId }: { readonly pluginId: string }) {
    super(`agent plugin '${pluginId}' is not installed in this workspace`);
    this.name = "AgentPluginNotInstalledError";
  }
}

export interface SetAgentPluginEnabledInput {
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly enabled: boolean;

  /** Recorded as the activation record's updatedBy. The authenticated principal, never a constant. */
  readonly actor: string;
}

export interface SetAgentPluginEnabledResult {
  readonly pluginId: string;

  /** As actually written and read back, not as requested. */
  readonly enabled: boolean;
  readonly warnings?: readonly string[];
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const { setAgentPluginActivation, readAgentPluginActivations, resolveAgentPluginActivation } = createActivationModule(ports);
  const { listInstalledPlugins } = createResolveAgentPluginRefsModule(ports);
  const persistentState = createPersistentStateModule(ports);

  async function findInstalled({ workspaceRoot, pluginId }: { readonly workspaceRoot: string; readonly pluginId: string }) {
    const installed = await listInstalledPlugins(workspaceRoot);
    const plugin = installed.find(candidate => candidate.pluginId === pluginId);
    if (!plugin) {
      throw new AgentPluginNotInstalledError({ pluginId });
    }
    return { installed, plugin };
  }

  /** Refuses a host-incompatible enable; otherwise returns advisory warnings, never blocking. */
  async function enablementWarnings({ input, workspaceRoot, installed, plugin }: {
    readonly input: SetAgentPluginEnabledInput; readonly workspaceRoot: string;
    readonly installed: readonly InstalledAgentPlugin[]; readonly plugin: InstalledAgentPlugin;
  }): Promise<readonly string[]> {
    const activations = await readAgentPluginActivations(workspaceRoot);
    if (!input.enabled) return agentPluginDependentWarnings({ plugin, installed, activations, nextProvides: [] });
    const compatibility = describeAgentPluginCompatibility({ plugin, installed, activations });
    // Several digests of one id can be installed (a bundled upgrade lands beside the old one), and
    // the listing order is arbitrary, so every installed revision must be host-compatible.
    const revisions = installed.filter(candidate => candidate.pluginId === plugin.pluginId);
    if (revisions.some(revision => !describeAgentPluginCompatibility({ plugin: revision, installed, activations }).hostOk)) {
      throw new AgentPluginHostIncompatibleError({ pluginId: input.pluginId });
    }
    return compatibility.missingRequires.map(id => `Needs ${id}`);
  }

  async function setEnabledLocked({ input, workspaceRoot }: { readonly input: SetAgentPluginEnabledInput; readonly workspaceRoot: string }): Promise<SetAgentPluginEnabledResult> {
    // Re-read under the lock: an uninstall or update may have finished while this call waited.
    const { installed, plugin } = await findInstalled({ workspaceRoot, pluginId: input.pluginId });
    // Boot recovery of an unfinished update would overwrite this decision, so it refuses
    // (PLUGIN_UPDATE_PENDING) until a boot recovers it.
    await settleAgentPluginUpdateJournal({ store: createAgentPluginUpdateStore({ ports, workspaceId: input.workspaceId, pluginId: input.pluginId }) });
    const warnings = await enablementWarnings({ input, workspaceRoot, installed, plugin });
    const previous = await resolveAgentPluginActivation(workspaceRoot, input.pluginId);
    const written = await setAgentPluginActivation({
      workspaceRoot,
      pluginId: input.pluginId,
      enabled: input.enabled,
      actor: input.actor,
    });

    if ((previous.verdict === "active") !== written.plugins[input.pluginId]!.enabled) {
      try { ports.onActivationChanged?.({ pluginId: input.pluginId, workspaceId: input.workspaceId, enabled: written.plugins[input.pluginId]!.enabled, actor: input.actor }, {}); }
      catch { /* An optional observer cannot undo the committed activation. */ }
    }

    // Always present: setAgentPluginActivation asserts the same id grammar its normalizer keeps and
    // writes a boolean `enabled`, so the record it returns holds this entry (the former
    // `?? input.enabled` fallback was unreachable).
    return { pluginId: input.pluginId, enabled: written.plugins[input.pluginId]!.enabled, ...(warnings.length ? { warnings } : {}) };
  }

  /**
   * Serialized with install/update/uninstall of the same plugin by the per-plugin state lock, so a
   * toggle never judges compatibility against a package that is mid-swap. The lock is a
   * non-reentrant file lock: no caller holds it around this function (checked 2026-10-21 in this
   * package and in the host admin route / `plugins_set_enabled` tool).
   */
  async function setAgentPluginEnabled(input: SetAgentPluginEnabledInput, _optional: Record<string, never> = {}): Promise<SetAgentPluginEnabledResult> {
    const workspaceRoot = ports.layout.forWorkspace({ workspaceId: input.workspaceId }).root;
    // Checked once before locking so an unknown or ungrammatical id stays a not-installed refusal
    // and never creates workspace or lock directories (the lock path re-asserts the id grammar).
    await findInstalled({ workspaceRoot, pluginId: input.pluginId });
    return persistentState.withPluginLock({ workspaceRoot, pluginId: input.pluginId,
      run: () => setEnabledLocked({ input, workspaceRoot }) });
  }

  return { setAgentPluginEnabled };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createSetEnabledModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
