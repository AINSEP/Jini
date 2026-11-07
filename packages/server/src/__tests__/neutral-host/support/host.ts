/**
 * A neutral host: a product that is not the one these packages were extracted from, built only from
 * public `@jini-ai/*` entries. Its stores live in memory, its network is closed, and every counted
 * port reports into one set of cost counters. If a moved piece only works with the original product's
 * names, files or wiring, it fails here.
 */
import { createAgentPluginLayout, createAgentPluginLifecycle } from '@jini-ai/agent-plugins/lifecycle';
import { createNodeAgentPluginEffects } from '@jini-ai/agent-plugins/lifecycle/node';
import { countFilesystem, createCostCounters, type CostCounters } from './counters.ts';
import { createMemorySealer, createMemorySettings, createMemoryVault, type MemorySealer, type MemorySettings, type MemoryVault } from './memory-ports.ts';
import { createTestDispatcher, type TestDispatcher } from './dispatcher.ts';

export const NEUTRAL_PRODUCT_NAME = 'Another Studio';
/** Bundled plugins declare the portable namespace; a neutral host reads only that one. */
export const NEUTRAL_EXTENSION_NAMESPACE = 'jini';
export const NEUTRAL_WORKSPACE_ID = 'studio-one';

type Lifecycle = ReturnType<typeof createAgentPluginLifecycle>;

export interface NeutralHost {
  readonly productName: string;
  readonly workspaceId: string;
  readonly root: string;
  /** The workspace's own directory under `root`, as the lifecycle's layout places it. */
  readonly workspaceRoot: string;
  readonly counters: CostCounters;
  readonly lifecycle: Lifecycle;
  readonly vault: MemoryVault;
  readonly sealer: MemorySealer;
  readonly settings: MemorySettings;
  readonly dispatcher: TestDispatcher;
  /** MCP provisioning calls the lifecycle made, in order. */
  readonly provisioning: readonly { readonly call: string; readonly pluginId?: string }[];
}

/** Counts each trusted-package scan and each contribution load the host makes. */
function countLifecycle(required: { readonly lifecycle: Lifecycle; readonly counters: CostCounters }): Lifecycle {
  const { lifecycle, counters } = required;
  return {
    ...lifecycle,
    findTrustedPluginPackages: (input, optional) => {
      counters.add({ name: 'trustedPackageScans' });
      return lifecycle.findTrustedPluginPackages(input, optional);
    },
    loadPluginContributions: (input, optional) => {
      counters.add({ name: 'contributionLoads' });
      return lifecycle.loadPluginContributions(input, optional);
    },
  };
}

/**
 * @param required.root - An absolute, empty directory the host owns for plugin packages and state.
 */
export function createNeutralHost(required: { readonly root: string }, _optional: Record<string, never> = {}): NeutralHost {
  const counters = createCostCounters();
  const effects = createNodeAgentPluginEffects({});
  const provisioning: { call: string; pluginId?: string }[] = [];
  const layout = createAgentPluginLayout({ root: required.root });
  const lifecycle = createAgentPluginLifecycle({
    ...effects,
    filesystem: countFilesystem({ filesystem: effects.filesystem, counters }),
    layout,
    productName: NEUTRAL_PRODUCT_NAME,
    extensionNamespace: NEUTRAL_EXTENSION_NAMESPACE,
    deliveryMode: 'inject',
    formatPluginToolPointer: ({ pluginId, skill, file }) => `studio_read_plugin(${JSON.stringify({ pluginId, ...(skill === undefined ? {} : { skill }), ...(file === undefined ? {} : { file }) })})`,
    seededEnabledPluginIds: new Set(),
    retiredBundledPlugins: new Map(),
    bundledArchiveMagic: 'ANOTHERSTUDIOPKG1\n',
    fetch: async ({ url }) => { throw new Error(`the neutral host has no network: ${url}`); },
    outboundGuard: { assertAllowed: async ({ url }) => { throw new Error(`the neutral host allows no outbound request: ${url}`); } },
    mcpProvisioning: {
      provision: async ({ installed }) => { provisioning.push({ call: 'provision', pluginId: installed.pluginId }); },
      setEnabled: async ({ pluginId }) => { provisioning.push({ call: 'setEnabled', pluginId }); },
      remove: async ({ pluginId }) => { provisioning.push({ call: 'remove', pluginId }); },
      notifyRosterChanged: async () => { provisioning.push({ call: 'notifyRosterChanged' }); },
    },
  });
  return {
    productName: NEUTRAL_PRODUCT_NAME,
    workspaceId: NEUTRAL_WORKSPACE_ID,
    root: required.root,
    workspaceRoot: layout.forWorkspace({ workspaceId: NEUTRAL_WORKSPACE_ID }).root,
    counters,
    lifecycle: countLifecycle({ lifecycle, counters }),
    vault: createMemoryVault({ counters }),
    sealer: createMemorySealer({ counters }),
    settings: createMemorySettings(),
    dispatcher: createTestDispatcher({ counters }),
    provisioning,
  };
}
