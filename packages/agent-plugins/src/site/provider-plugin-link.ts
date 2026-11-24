import type { PluginActivationRecord, PluginActivationRepoPort } from "@jini-ai/core/contracts/site/plugins-host";
import { orFallback } from "@jini-ai/core/errors/idioms";

import { readProviderPluginLink } from "@jini-ai/agent-plugins/lifecycle/host-tools";

/**
 * @file One vendor, one plugin (owner 2026-10-25): a provider plugin (the Plugins screen, its Settings
 * card, the code that sends events) and the agent plugin that is its assistant face (the chat key card
 * and know-how) are switched by ONE switch — the provider plugin's. The agent plugin declares the link
 * in its own manifest (`extensions.jini.providerPlugin`, read by `identity.ts`); core names no vendor.
 *
 * Why the face follows rather than both toggling each other: the provider plugin's activation row is
 * already the durable, permission-gated, approval-recorded decision (`setPluginEnabled`), and its
 * enable path carries capability approvals the agent-plugin switch has no business re-implementing.
 * So the provider row is the one source of truth; the face's activation record is a mirror of it:
 * - every write of the provider row (admin switch, `plugins_set_enabled`, reload, quarantine, rollback,
 *   uninstall) goes through the activation repo, which {@link followProviderActivations} wraps;
 * - boot runs {@link syncProviderFaces} after seeding, which also absorbs faces seeded inactive and any
 *   mirror write that failed;
 * - switching the face on its own is refused by the host (its linked-face error, which names the real
 *   switch; {@link linkedProviderOf} finds it).
 */

/** Recorded as the face's `updatedBy`, so an audit shows the provider plugin decided it. */
export const PROVIDER_LINK_ACTOR = "system:provider-plugin";

/** The face activation calls this module makes, bound to one workspace. */
export interface ProviderFacePorts {
  /** Installed agent plugins that declare a provider plugin: agent plugin id → provider plugin id. */
  readonly links: (required: Record<string, never>) => Promise<ReadonlyMap<string, string>>;
  /** Read canonical state and compare/write within the activation owner's serialized operation. */
  readonly reconcileFace: (required: { readonly pluginId: string; readonly resolveEnabled: () => Promise<boolean> }) => Promise<boolean>;
  readonly isFaceActive: (required: { readonly pluginId: string }) => Promise<boolean>;
}

/** The host's lifecycle-owner activation calls (one shared queue); `A` is its activations snapshot. */
export interface ProviderFaceActivations<A> {
  reconcileAgentPluginActivation(required: { workspaceRoot: string; pluginId: string; resolveEnabled: () => Promise<boolean>; actor: string }): Promise<boolean>;
  readAgentPluginActivations(required: { readonly workspaceRoot: string }): Promise<A>;
  isAgentPluginActive(required: { readonly activations: A; readonly pluginId: string }): boolean;
}

/** The host's lifecycle-owner catalog reads; `P` is its trusted package, `B` its bundled digests. */
export interface ProviderFaceCatalog<P extends { readonly pluginId: string; readonly archiveDigest: string }, B> {
  list(required: { workspaceRoot: string }): Promise<readonly P[]>;
  bundled(required: { workspaceRoot: string }): Promise<B>;
  preferBundled(installed: readonly NoInfer<P>[], bundled: NoInfer<B>): readonly NoInfer<P>[];
  read(required: { plugin: NoInfer<P>; filename: string }): Promise<string>;
}

/**
 * Brings each linked face in line with its provider plugin's enabled state; only differing faces are
 * written. `providerId` limits it to one provider's faces.
 * @returns The face ids it switched. @complexity O(l) links, one activation read each.
 */
export async function syncProviderFaces(
  { ports, providerEnabled }: { ports: ProviderFacePorts; providerEnabled: (required: { readonly pluginId: string }) => Promise<boolean> },
  optional: { readonly providerId?: string } = {},
): Promise<readonly string[]> {
  const switched: string[] = [];
  for (const [face, provider] of await ports.links({})) {
    if (optional.providerId !== undefined && provider !== optional.providerId) continue;
    if (await ports.reconcileFace({ pluginId: face, resolveEnabled: () => providerEnabled({ pluginId: provider }) })) switched.push(face);
  }
  return switched;
}

/**
 * The provider activation repo, with every write of THIS workspace's rows mirrored onto the linked
 * faces. A mirror failure is reported to the host's `reportFollowFailure` port, never thrown: the provider decision
 * already stands, and the next boot's {@link syncProviderFaces} repairs the face. The sink gets the
 * provider id and the raw failure; the host formats (and redacts) its own log line.
 * @complexity As the wrapped write, plus {@link syncProviderFaces} for that one provider.
 */
export function followProviderActivations(
  { repo, workspaceId, ports, reportFollowFailure }: { repo: PluginActivationRepoPort; workspaceId: string; ports: ProviderFacePorts; reportFollowFailure: (required: { readonly pluginId: string; readonly error: unknown }) => void },
  _optional: Record<string, never> = {},
): PluginActivationRepoPort {
  const mirror = async ({ row }: { row: { workspaceId: string; pluginId: string } }) => {
    if (row.workspaceId !== workspaceId) return;
    try { await syncProviderFaces({ ports, providerEnabled: async ({ pluginId }) => (await repo.getActivation({ workspaceId, pluginId }))?.enabled ?? false }, { providerId: row.pluginId }); }
    catch (error) { reportFollowFailure({ pluginId: row.pluginId, error }); }
  };
  return {
    getActivation: (required, opts) => repo.getActivation(required, opts),
    listAll: (required, opts) => repo.listAll(required, opts),
    save: async (record: PluginActivationRecord, opts) => { await repo.save(record, opts); await mirror({ row: record }); },
    deleteActivation: async (required, opts) => { await repo.deleteActivation(required, opts); await mirror({ row: required }); },
  };
}

/** The provider plugin `pluginId` is the face of, or undefined when it declares none. @complexity As `links`. */
export async function linkedProviderOf({ ports, pluginId }: { ports: Pick<ProviderFacePorts, "links">; pluginId: string }, _optional: Record<string, never> = {}): Promise<string | undefined> {
  return (await ports.links({})).get(pluginId);
}

/**
 * Production ports over one workspace's installed agent plugins and activation record. The root is
 * resolved per call, so binding before a site is chosen is safe. An unreadable manifest links nothing.
 * The host injects its lifecycle owner's `activations` and `catalog` calls.
 * @throws Unresolved multiple revisions refuse link discovery rather than picking a switch.
 * @complexity `links`: O(p) installed packages, one trusted manifest read per selected revision.
 */
export function bindProviderFacePorts<A, P extends { readonly pluginId: string; readonly archiveDigest: string }, B>(
  { workspaceRoot, activations, catalog }: { workspaceRoot: () => string; activations: ProviderFaceActivations<A>; catalog: ProviderFaceCatalog<P, B> },
  _optional: Record<string, never> = {},
): ProviderFacePorts {
  return {
    links: async () => {
      const root = workspaceRoot();
      const selected = catalog.preferBundled(await catalog.list({ workspaceRoot: root }), await catalog.bundled({ workspaceRoot: root }));
      const counts = new Map<string, number>();
      for (const plugin of selected) counts.set(plugin.pluginId, (counts.get(plugin.pluginId) ?? 0) + 1);
      const links = new Map<string, string>();
      for (const plugin of selected) {
        // The lifecycle refuses ambiguous non-bundled revisions; none may decide a current switch.
        if (counts.get(plugin.pluginId) !== 1) throw new Error(`Agent Plugin '${plugin.pluginId}' matches ${counts.get(plugin.pluginId)} installed packages — refusing to guess which one to use`);
        const provider = await orFallback({
          work: async () => readProviderPluginLink({ manifest: JSON.parse(await catalog.read({ plugin, filename: "plugin.json" })) }),
          fallback: undefined,
          step: "read provider face link",
        }); // An unreadable manifest links nothing.
        if (provider !== undefined) links.set(plugin.pluginId, provider);
      }
      return links;
    },
    reconcileFace: ({ pluginId, resolveEnabled }) => activations.reconcileAgentPluginActivation({
      workspaceRoot: workspaceRoot(), pluginId, resolveEnabled, actor: PROVIDER_LINK_ACTOR }),
    isFaceActive: async ({ pluginId }) => activations.isAgentPluginActive({
      activations: await activations.readAgentPluginActivations({ workspaceRoot: workspaceRoot() }), pluginId }),
  };
}
