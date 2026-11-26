import { asDeployTargetModule, parseDeployTargetsFile as parseDeployTargetsDescriptors } from "@jini-ai/devops/deploy";

import type { FormDestinationForm, FormSubmissionsInspection } from '@jini-ai/core/contracts/site/cms-forms';
import type { InstalledDeployTarget, InstalledDeployTargetInventory, DeployTargetDescriptor, DeployTargetModule, DeployTargetRegistry, LoadedDeployTarget } from "@jini-ai/devops/deploy/site/deploy-targets/types";

/**
 * @file Loads deploy targets that Agent Plugins contribute — the generic seam that lets each hosting
 * plugin (and only plugins the host itself ships) add a hosting vendor without core naming one.
 *
 * A plugin opts in by shipping {@link DEPLOY_TARGETS_FILENAME} at its root: a data-only list of
 * `{ id, label, module }`. Each `module` is a plain-JS `.mjs` file inside the plugin whose default
 * export is a `DeployTargetModule` (`types.ts`).
 *
 * TRUST RULE (fail closed). Importing a module runs its code in this process, so a module is loaded
 * only when all of these hold (enforced by the shared gate, `features/agent-plugins/trusted-plugin-files.ts`):
 * 1. the plugin is ACTIVE by the fail-closed reader (`resolveAgentPluginActivation`) — an unreadable
 *    activation record refuses rather than reading as consent;
 * 2. its installed digest is the one `bundled-digests.json` records for it — the build's own seed,
 *    so an operator-installed package (or a tampered copy under a bundled id) never runs here
 *    (owner decision 2026-09-29: third-party hosts come later);
 * 3. the module path resolves inside the plugin root on disk (`assertContainedOnDisk`) and ends in
 *    `.mjs`, so no `package.json` above the install directory can make Node read it as CommonJS.
 *
 * Failure isolation: a bad plugin drops only its own targets, a bad module only itself, and a target
 * id two plugins both declare is dropped for both ("refusing to guess", as in
 * `resolve-agent-plugin-refs.ts`). Every drop is reported in `refusals`, never thrown.
 *
 * Architectural role: `features/deployments` capability, read by the static-publish adapter. Depends
 * on `features/agent-plugins` for installed-package discovery and trust; nothing depends back.
 */

/** The file a plugin ships at its root to contribute deploy targets. */
export const DEPLOY_TARGETS_FILENAME = "jini-deploy-targets.json";

/** Every trust gate is the installed CALLER's job, or the hermetic source registry's trust basis. */
const targetContribution = {
  filename: DEPLOY_TARGETS_FILENAME, contribution: "deploy targets",
  parse: ({ raw }: { raw: string }) => parseDeployTargetsDescriptors({ raw }), modulePath: ({ descriptor }: { descriptor: DeployTargetDescriptor }) => descriptor.module,
  validate: ({ exported }: { exported: unknown }) => asDeployTargetModule<FormDestinationForm, FormSubmissionsInspection>({ exported }),
  refusal: ({ plugin, descriptor, reason }: { plugin: TargetPackage; descriptor: DeployTargetDescriptor; reason: string }) => `deploy target '${descriptor.id}' from '${plugin.pluginId}' was not loaded: ${reason}`,
};

/**
 * Builds this workspace's deploy-target registry from its installed Agent Plugins.
 *
 * Read fresh on every call (publishing is rare and human-triggered); a module import itself is cached
 * by Node per file URL, and installed digest directories never change.
 *
 * @throws Nothing for a plugin-level fault (see this file's header); only a filesystem fault listing
 * the workspace's package directory itself propagates.
 * @param required - Contribution loader from this boot's lifecycle; no site-dependent module default.
 * @complexity O(p) installed plugins, each one small file read plus one import per declared target.
 */
export async function loadDeployTargetRegistry(required: {
  workspaceId: string;
  loadContributions(input: { workspaceId: string; definition: typeof targetContribution }, options: { orderByPluginId: boolean }): Promise<{ items: readonly LoadedDeployTarget[]; refusals: readonly string[] }>;
}, _optional = {}): Promise<DeployTargetRegistry> {
  // Plugin-id order, not installed order: each host is its own plugin, so the Static site tab
  // lists them the same way on every site, and the same way as the hermetic bundled registry below.
  const load = await required.loadContributions({ workspaceId: required.workspaceId, definition: targetContribution }, { orderByPluginId: true });
  return buildRegistry({ loaded: load.items, refusals: load.refusals });
}

/** Discover installed host descriptors through the existing data loader, including disabled hosts.
 * No module is imported. Digest, containment, parser and ambiguous-id refusals retain their owners.
 * @returns Installed metadata and every refusal; activation read failures are represented as unknown.
 * @complexity O(p + t) installed packages and targets, with one activation read per target.
 */
export async function loadInstalledDeployTargets(required: {
  readonly workspaceId: string;
  readonly loadContributions: (input: { workspaceId: string; definition: {
    filename: string; contribution: string; kind: 'data'; parse: typeof parseDeployTargetsDescriptors;
    load(input: { plugin: TargetPackage; descriptor: DeployTargetDescriptor }): Promise<InstalledDeployTarget>;
  } }, options: { requireActive: boolean; orderByPluginId: boolean }) => Promise<{ items: readonly InstalledDeployTarget[]; refusals: readonly string[] }>;
  readonly readEnabled: (input: { workspaceId: string; pluginId: string }) => Promise<boolean | null>;
}, _optional: Record<string, never> = {}): Promise<InstalledDeployTargetInventory> {
  const definition = {
    filename: DEPLOY_TARGETS_FILENAME, contribution: "deploy targets", kind: "data" as const,
    parse: ({ raw }: { raw: string }) => parseDeployTargetsDescriptors({ raw }),
    load: async ({ plugin, descriptor }: { plugin: TargetPackage; descriptor: DeployTargetDescriptor }) => ({ descriptor, pluginId: plugin.pluginId,
      enabled: await required.readEnabled({ workspaceId: required.workspaceId, pluginId: plugin.pluginId }) }),
  };
  const load = await required.loadContributions({ workspaceId: required.workspaceId, definition }, { requireActive: false, orderByPluginId: true });
  const registry = buildRegistry({ loaded: load.items, refusals: load.refusals });
  return { items: registry.list(), refusals: registry.refusals };
}

/** The two facts the source loader needs about a package: whose it is and where it lives. */
type TargetPackage = { readonly pluginId: string; readonly packageRoot: string };

/**
 * A registry read straight from a plugin's SOURCE directory, with no install, activation or digest
 * gate. For the hermetic composition root (`server/runtime/composition/app.ts`) and tests only,
 * where the directory is this product's own `content/agent-plugins/<id>/`: never point it at
 * anything an operator or a third party can write.
 *
 * @complexity O(t) targets, one import each.
 */
export async function loadDeployTargetRegistryFromSource(required: {
  plugin: TargetPackage;
  loadPluginContributionsFromSource(input: { plugin: TargetPackage; definition: typeof targetContribution }): Promise<{ items: readonly LoadedDeployTarget[]; refusals: readonly string[] }>;
}, _optional: Record<string, never> = {}): Promise<DeployTargetRegistry> {
  const load = await required.loadPluginContributionsFromSource({ plugin: required.plugin, definition: targetContribution });
  return buildRegistry({ loaded: load.items, refusals: load.refusals });
}

/**
 * The hermetic registry for EVERY bundled plugin at once: each directory under `sourceRoot` (the
 * product's bundled root, `bundledAgentPluginsDir()`: `content/agent-plugins/` or the composed root
 * the host's bundled-source override names. Callers once passed the raw `content/agent-plugins` so a
 * fixture-pointed env still saw the real hosts; since the hosts moved to `@jini-ai/agent-plugins`
 * they exist only in the composed root, so the raw path loses them in dev) that holds both
 * `plugin.json` and {@link DEPLOY_TARGETS_FILENAME}, minus retired ids, in plugin-id order (the
 * installed loader's `orderByPluginId`). A directory without the file is skipped, as the installed
 * path skips a package that does not ship it; a target id two directories both declare is dropped
 * for both by {@link buildRegistry}. Same trust basis and same caveat as
 * {@link loadDeployTargetRegistryFromSource}: never point it at anything an operator can write.
 *
 * @throws Only a filesystem fault listing `sourceRoot` itself.
 * @complexity O(p + t): one listing, two existence checks per plugin dir, one import per target.
 */
export async function loadBundledDeployTargetRegistry(required: {
  readonly sourceRoot: string;
  bundledContributionSources(input: { sourceRoot: string; filename: string }): readonly TargetPackage[];
  loadPluginContributionsFromSource: Parameters<typeof loadDeployTargetRegistryFromSource>[0]['loadPluginContributionsFromSource'];
}, _optional: Record<string, never> = {}): Promise<DeployTargetRegistry> {
  const items: LoadedDeployTarget[] = [];
  const refusals: string[] = [];
  for (const plugin of required.bundledContributionSources({ sourceRoot: required.sourceRoot, filename: DEPLOY_TARGETS_FILENAME })) {
    const load = await required.loadPluginContributionsFromSource({ plugin });
    items.push(...load.items);
    refusals.push(...load.refusals);
  }
  return buildRegistry({ loaded: items, refusals });
}

/** Indexes loaded targets by id, dropping every id more than one plugin declares.
 *  @complexity O(n) in the loaded target count. */
function buildRegistry<T extends Pick<LoadedDeployTarget, "descriptor" | "pluginId">>(
  { loaded, refusals }: { loaded: readonly T[]; refusals: readonly string[] },
  _optional: Record<string, never> = {},
) {
  const byId = new Map<string, T[]>();
  for (const target of loaded) byId.set(target.descriptor.id, [...(byId.get(target.descriptor.id) ?? []), target]);

  const unique = new Map<string, T>();
  const allRefusals = [...refusals];
  for (const [id, claimants] of byId) {
    if (claimants.length === 1) {
      const claimant = claimants[0];
      if (claimant === undefined) throw new Error(`Deploy target ${id} has no claimant`);
      unique.set(id, claimant);
    }
    else {
      const owners = claimants.map((target) => `'${target.pluginId}'`).sort().join(", ");
      allRefusals.push(`deploy target '${id}' was not loaded: more than one plugin declares it (${owners})`);
    }
  }
  return {
    get: (targetId: string) => unique.get(targetId),
    list: () => [...unique.values()],
    refusals: allRefusals,
  };
}

