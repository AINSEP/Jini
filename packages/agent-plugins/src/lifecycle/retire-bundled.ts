/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import { type BundledAgentPluginEnableOutcome } from "./activation.js";
import { createActivationModule } from "./activation.js";
import { createBundledDigestsModule } from "./bundled-digests.js";
import type { AgentPluginLayout } from "./layout.js";
import { createResolveAgentPluginRefsModule } from "./resolve-agent-plugin-refs.js";
import { createUninstallModule } from "./uninstall.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export type RetiredAgentPluginSuccessorOutcome = BundledAgentPluginEnableOutcome | "not-needed";

export type RetiredAgentPluginOutcome =
  | { readonly pluginId: string; readonly successorId: string; readonly status: "absent" }
  | {
      readonly pluginId: string;
      readonly successorId: string;
      readonly status: "retired";

      readonly removedDigests: readonly string[];
      readonly activationRemoved: boolean;
      readonly ledgerEntryRemoved: boolean;

      readonly successor: RetiredAgentPluginSuccessorOutcome;
    }
  | { readonly pluginId: string; readonly successorId: string; readonly status: "failed"; readonly reason: string };

export interface RetireBundledAgentPluginsRequired {

  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;
}

export interface RetireBundledAgentPluginsOptional {

  readonly retired?: (ReadonlyMap<string, string>) | undefined;
  readonly now?: ((required: Record<string, never>) => Date) | undefined;
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const { deleteAgentPluginActivation, enableBundledAgentPluginUnlessOperatorDisabled, readAgentPluginActivations, resolveAgentPluginActivation } = createActivationModule(ports);
  const { removeBundledAgentPluginDigest } = createBundledDigestsModule(ports);
  const { listInstalledPlugins } = createResolveAgentPluginRefsModule(ports);
  const { uninstallAgentPlugin } = createUninstallModule(ports);
  async function retireBundledAgentPlugins(
    required: RetireBundledAgentPluginsRequired,
    optional: RetireBundledAgentPluginsOptional = {},
  ): Promise<readonly RetiredAgentPluginOutcome[]> {
    const outcomes: RetiredAgentPluginOutcome[] = [];
    for (const [pluginId, successorId] of optional.retired ?? ports.retiredBundledPlugins) {
      try {
        outcomes.push(await retireOne(required, optional, pluginId, successorId));
      } catch (error) {
        outcomes.push({ pluginId, successorId, status: "failed", reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return outcomes;
  }

  async function retireOne(
    required: RetireBundledAgentPluginsRequired,
    optional: RetireBundledAgentPluginsOptional,
    pluginId: string,
    successorId: string,
  ): Promise<RetiredAgentPluginOutcome> {
    const workspaceLayout = required.layout.forWorkspace({ workspaceId: required.workspaceId });
    const workspaceRoot = workspaceLayout.root;

    const verdict = await resolveAgentPluginActivation(workspaceRoot, pluginId);
    if (verdict.verdict === "undetermined") {
      return { pluginId, successorId, status: "failed", reason: `cannot tell whether '${pluginId}' was enabled: ${verdict.reason}` };
    }

    const installed = (await listInstalledPlugins(workspaceLayout.root)).filter((plugin) => plugin.pluginId === pluginId);
    const hasRecord = Object.hasOwn((await readAgentPluginActivations(workspaceRoot)).plugins, pluginId);

    if (installed.length === 0 && !hasRecord) {
      const ledgerEntryRemoved = await removeBundledAgentPluginDigest({ workspaceRoot, pluginId });
      if (!ledgerEntryRemoved) return { pluginId, successorId, status: "absent" };
      return { pluginId, successorId, status: "retired", removedDigests: [], activationRemoved: false, ledgerEntryRemoved, successor: "not-needed" };
    }

    const successor: RetiredAgentPluginSuccessorOutcome =
      verdict.verdict === "active"
        ? await enableBundledAgentPluginUnlessOperatorDisabled({
            workspaceRoot,
            pluginId: successorId,
            actor: `system:retire-${pluginId}`,
            ...(optional.now !== undefined ? { now: optional.now } : {}),
          })
        : "not-needed";

    let removedDigests: readonly string[] = [];
    if (installed.length > 0) {
      removedDigests = (
        await uninstallAgentPlugin({ layout: required.layout, workspaceId: required.workspaceId, pluginId }, { retiredBundled: true })
      ).removedDigests;
    } else {
      await deleteAgentPluginActivation({ workspaceRoot, pluginId });
    }

    const ledgerEntryRemoved = await removeBundledAgentPluginDigest({ workspaceRoot, pluginId });
    return { pluginId, successorId, status: "retired", removedDigests, activationRemoved: hasRecord, ledgerEntryRemoved, successor };
  }

  return { retireBundledAgentPlugins };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createRetireBundledModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
