/** Portable plugin-host decisions (A8 seam, in place). Everything product- or runtime-specific is a
 * required port the host binds; this file imports only @jini-ai/core, the agent-plugins lifecycle
 * types (same package after A9) and the A8 connect bodies. It must never import the A10 connect
 * cycle (`grant-signed-in-defaults.ts` and its neighbours): the sign-in grant arrives as the
 * required `grantSignedInDefaults` port (pinned by `portable-plugin-host.no-cycle` test).
 * Discovery is metadata-only and fresh on each call so disable/uninstall cannot leave stale grants. */
import type { Clock } from "@jini-ai/core/primitives";
import { redactSecrets, ToolInputError, type AccessApprovalResource } from '@jini-ai/core';
import { createPluginLookup, readPluginIdentity, assertPluginIdentityAvailable, type PluginIdentityCandidate, type PluginLookupPort, type PluginProvider } from '@jini-ai/core/plugin-directory';
import type { InstalledAgentPlugin, SetAgentPluginEnabledInput, SetAgentPluginEnabledResult } from '@jini-ai/agent-plugins/lifecycle';
import { provisionAgentPluginMcpServers, resolveAgentPluginMcpServers } from '#src/features/agent-plugins/portable/federate-mcp';
import { recordAgentPluginAccessDeclined } from '#src/features/agent-plugins/portable/apply-connect-defaults';
import { previewAgentPluginEnableAccess } from '#src/features/agent-plugins/portable/enable-access';
import type { AgentPluginMcpPort, AgentPluginMcpProjectionPorts } from '#src/features/agent-plugins/service-ports';
import type { McpServerConfig } from '#src/features/agent-plugins/mcp-metadata';

type AgentPluginLayoutInput = Parameters<typeof resolveAgentPluginMcpServers>[0]['agentPluginLayout'];
type ProvisioningFailure = Awaited<ReturnType<typeof provisionAgentPluginMcpServers>>['failed'][number];

/** The one discovery field set the host decisions read; a narrow local copy so the portable host
 * does not depend on another plugin family's package. */
export interface PluginHostDiscoveryRecord {
  readonly id: string;
  readonly status: string;
  readonly manifest?: unknown;
  readonly version: string | null;
}

/** Point read of one site-runtime plugin's activation; `null` means never activated (off). */
export interface PluginHostActivation { readonly enabled: boolean }

/** Deps handed to the sign-in grant. Shape matches the host's existing grant owner. */
export interface PluginHostGrantDeps extends AgentPluginMcpProjectionPorts {
  readonly workspaceId: string;
  readonly agentPluginLayout: AgentPluginLayoutInput;
  readonly repo: AgentPluginMcpPort['repo'];
  readonly applyAccess: AgentPluginMcpPort['applyAccess'];
  readonly clock: Clock;
  readonly notifyRosterChanged: () => Promise<void>;
  readonly warn: (message: string) => void;
}

/** Agent-plugin lifecycle owner, bound by the host. */
export interface PluginHostLifecycle<UninstallInput> {
  /** @agent-note Provider: the host's installed-package index for THIS workspace. Every call is a
   * fresh read (no cache), so a disable/uninstall is visible on the next lookup. */
  listInstalled(): Promise<readonly InstalledAgentPlugin[]>;
  /** @agent-note Provider: the host's revision-selection owner. Receives the list just read and
   * returns the preferred revisions (e.g. bundled digests win). Must not invent a newest-version
   * policy; order of reads is list → preference read → select, once per lookup. */
  preferInstalled(required: { installed: readonly InstalledAgentPlugin[] }): Promise<readonly InstalledAgentPlugin[]>;
  /** @agent-note Provider: the host's manifest reader for one installed revision; may throw (the
   * revision is then omitted with a warning). Namespace must equal `namespace` below. */
  readIdentity(required: { plugin: InstalledAgentPlugin }): Promise<ReturnType<typeof readPluginIdentity>>;
  /** @agent-note Provider: the activation owner's verdict for one plugin. Fail closed: throw on an
   * unreadable activation store rather than answering `false`. */
  isEnabled(required: { pluginId: string }): Promise<boolean>;
  /** @agent-note Provider: the activation owner's off records, read once per catalog request. */
  inactivePluginIds(): Promise<ReadonlySet<string>>;
  /** @agent-note Provider: the activation owner's writability probe; throws when writes would fail. */
  assertWritable(): Promise<void>;
  /** @agent-note Provider: the activation owner's durable enable/disable write. The host owns the
   * roster-reload notification and the workspace layout it adds to the input; the result is
   * returned unchanged. One activation queue: bind the same owner the admin toggle uses. */
  setEnabled(required: SetAgentPluginEnabledInput): Promise<SetAgentPluginEnabledResult>;
  /** @agent-note Provider: the host's uninstall tool runner. Input is passed through untouched
   * (surfaces/ctx/executionOptions are host types); authorization and confirmation stay there. */
  uninstall(required: UninstallInput): Promise<unknown>;
}

/** Product copy the host decisions report. Texts name host tools, so they are host input. */
export interface PluginHostMessages {
  /** @agent-note Product copy for an approved enable whose provisioning failed for `failed`
   * servers. Returned text is passed through `redactSecrets` before it is thrown. Name the host's
   * own enable tool for the retry hint. */
  provisioningFailed(required: { pluginId: string; failed: readonly ProvisioningFailure[] }): string;
  /** @agent-note Product copy when an approved enable carries no access snapshot key. Nothing has
   * been provisioned or granted when this is thrown. */
  approvedSnapshotMissing(): string;
  /** @agent-note Product copy when an approved enable's provisioning/grant threw; `detail` is the
   * raw error message (unredacted) — the result is passed through `redactSecrets`. */
  approvedLoadFailed(required: { detail: string }): string;
}

export interface PluginHostDeps<UninstallInput> {
  readonly workspaceId: string;
  readonly agentPluginLayout: AgentPluginLayoutInput;
  readonly clock: Clock;
  /** @agent-note Your app's id; it is the namespace of every plugin identity this host reads and
   * admits, so it must not change between installs. */
  readonly namespace: string;
  /** @agent-note Provider: the site-runtime plugin discovery owner. Metadata only, fresh per call. */
  readonly discoverPlugins: () => Promise<readonly PluginHostDiscoveryRecord[]>;
  /** @agent-note Provider: the site-runtime activation repo point read (same repo the runtime uses). */
  readonly getActivation: (required: { workspaceId: string; pluginId: string }) => Promise<PluginHostActivation | null>;
  readonly lifecycle: PluginHostLifecycle<UninstallInput>;
  /** @agent-note Serializes identity admission and publication across plugin kinds. Provider: ONE
   * cross-process lock per agent-plugins tree (the host chooses the lock file; creating its parent
   * is the host's job). Every install path of every family must take the same lock. */
  readonly withLock: <T>(required: { run: () => Promise<T> }) => Promise<T>;
  /** @agent-note The host's MCP store port: ONE repo/vault/private context shared with the admin
   * toggle and the sign-in callback; never a wrapped or re-sealed copy. It must carry the host's
   * projection pair: portable bodies never fall back to another host's projections. */
  readonly mcp: AgentPluginMcpPort & AgentPluginMcpProjectionPorts;
  /** @agent-note The projection/error pair, resolved ONCE per binding by the host and shared by
   * preview, provisioning grant and status (same function and error identity as `mcp`'s owner). */
  readonly mcpPorts: AgentPluginMcpProjectionPorts;
  /**
   * @agent-note Host supplies its sign-in grant owner (Tovu: `grantDeclaredToolsToSignedInRows`).
   * Order: called once per `provisionMcp`, AFTER provisioning and after its failure warnings; an
   * approved enable whose provisioning failed refuses before this runs (no grant on a refused
   * consent). `skipServerKeys` carries exactly the failed servers; `approvedEnable` is passed only
   * for an approved enable, with the approved snapshot key. Same deps instance shape as the admin
   * toggle; returns the connection ids it granted. Saved rows/approval bytes are the owner's.
   */
  readonly grantSignedInDefaults: (
    required: { deps: PluginHostGrantDeps; pluginId: string; servers: Readonly<Record<string, McpServerConfig>> },
    optional: { skipServerKeys?: readonly string[]; approvedEnable?: { readonly principalId: string; readonly accessKey: string } },
  ) => Promise<readonly string[]>;
  /** @agent-note Host diagnostics sink (redacted strings only; never thrown at callers). */
  readonly warn: (message: string) => void;
  readonly messages: PluginHostMessages;
}

/** Lifecycle orchestration capability, structurally equal to the host's headless contract. */
export interface AgentPluginLifecycleCapability<UninstallInput> {
  inactivePluginIds(): Promise<ReadonlySet<string>>;
  previewEnableAccess(required: { pluginId: string }): Promise<{ readonly key: string; readonly resources?: readonly Omit<AccessApprovalResource, 'scope'>[] }>;
  recordDeclinedAccess(required: { accessKey: string }): Promise<void>;
  listInstalled(): Promise<readonly InstalledAgentPlugin[]>;
  assertWritable(): Promise<void>;
  setEnabled(required: SetAgentPluginEnabledInput): Promise<SetAgentPluginEnabledResult>;
  provisionMcp(required: { pluginId: string; principalId: string }, optional?: { readonly approvedEnable?: boolean; readonly approvedEnableKey?: string }): Promise<void>;
  uninstall(required: UninstallInput): Promise<unknown>;
}

export interface PortablePluginHost<UninstallInput> extends PluginLookupPort {
  withInstallIdentity<T>(required: { candidate: PluginIdentityCandidate; run: () => Promise<T> }): Promise<T>;
  getHostCapability(required: { capability: 'agent-plugin-lifecycle' }): AgentPluginLifecycleCapability<UninstallInput> | undefined;
}

/** Preserve best-effort diagnostics for background provisioning; an approved card must instead
 * report a partial failure to its caller. O(s) in failed declared servers, no extra I/O.
 */
function reportProvisioningFailures({ pluginId, failed, approved, warn, messages }: { pluginId: string; failed: readonly ProvisioningFailure[]; approved: boolean; warn: (message: string) => void; messages: PluginHostMessages }): void {
  for (const failure of failed) warn(redactSecrets({ input: `Plugin '${pluginId}': MCP provisioning for server '${failure.serverKey}' failed — ${failure.reason}` }));
  if (approved && failed.length) throw new ToolInputError({ message: redactSecrets({ input: messages.provisioningFailed({ pluginId, failed }) }) });
}

/** An approved grant must carry the exact snapshot displayed by its host preview. */
function requireApprovedAccessKey(key: string | undefined, messages: PluginHostMessages): string {
  if (!key) throw new ToolInputError({ message: messages.approvedSnapshotMissing() });
  return key;
}

/** Bind both plugin families to one workspace. Read manifests through the same installed-package
 * index.
 * @throws Unreadable activation (fail closed).
 * Unreadable/invalid or ambiguous manifest metadata is omitted with a warning. Admission retains
 * every valid revision identity, including revisions omitted from lookup, to prevent takeovers.
 * @complexity O(p log p) per lookup, plus existing discovery/activation I/O for p installs.
 */
export function createPluginHost<UninstallInput>(
  { deps }: { deps: PluginHostDeps<UninstallInput> },
  optional: {
    resolveMcpServers?: typeof resolveAgentPluginMcpServers;
    provisionMcpServers?: typeof provisionAgentPluginMcpServers;
  } = {},
): PortablePluginHost<UninstallInput> {
  const { warn, lifecycle } = deps;

  const listSiteProviders = async ({ forAdmission }: { forAdmission: boolean }, _options = {}): Promise<PluginProvider[]> => {
    const providers: PluginProvider[] = [];
    for (const record of await deps.discoverPlugins()) {
      if (record.status !== 'valid' || !record.manifest) {
        warn(`Plugin '${record.id}': invalid installed manifest omitted from metadata lookup.`);
        continue;
      }
      let parsed: ReturnType<typeof readPluginIdentity> | undefined;
      try { parsed = readPluginIdentity({ manifest: record.manifest as Readonly<Record<string, unknown>>, name: record.id, namespace: deps.namespace }); }
      catch { warn(`Plugin '${record.id}': installed identity manifest is unreadable or invalid; omitted from metadata lookup.`); }
      if (parsed) {
        const { warnings, ...identity } = parsed;
        warnings.forEach(warn);
        const activation = forAdmission ? null : await deps.getActivation({ workspaceId: deps.workspaceId, pluginId: record.id });
        providers.push({ ...identity, version: record.version, enabled: activation?.enabled === true, family: 'site-runtime', localId: record.id });
      }
    }
    return providers;
  };

  const resolveAgentProviders = async ({ agentProviders }: { agentProviders: Map<string, PluginProvider[]> }, _options = {}): Promise<PluginProvider[]> => {
    const providers: PluginProvider[] = [];
    for (const [pluginId, revisions] of agentProviders) {
      // Multiple digests are revisions of one install, not duplicate provider registrations.
      // Without a recorded winner the existing lifecycle refuses to guess; discovery follows it
      // by omitting this plugin, while unrelated lookup and installation remain available.
      if (revisions.length !== 1) {
        const declaredIds = new Set(revisions.map(provider => provider.id).filter(id => id !== `unknown/${pluginId}`));
        warn(`Plugin '${pluginId}': ${declaredIds.size > 1 ? 'conflicting publisher identities' : 'ambiguous installed revisions'}; omitted from metadata lookup.`);
        continue;
      }
      providers.push({ ...revisions[0]!, enabled: await lifecycle.isEnabled({ pluginId }) });
    }
    return providers;
  };

  const listAgentProviders = async ({ forAdmission }: { forAdmission: boolean }, _options = {}): Promise<PluginProvider[]> => {
    const providers: PluginProvider[] = [];
    const agentProviders = new Map<string, PluginProvider[]>();
    // A legacy revision may acquire its first publisher identity at upgrade; old frozen
    // digests can remain present from older installs until successful publication prunes them.
    // Reuse that owner's selection; metadata lookup must not invent a newest-version policy.
    const installed = await lifecycle.listInstalled();
    const preferred = forAdmission ? installed : await lifecycle.preferInstalled({ installed });
    const preferredKeys = new Set(preferred.map(plugin => `${plugin.pluginId}:${plugin.archiveDigest}`));
    for (const plugin of installed) {
      let parsed: ReturnType<typeof readPluginIdentity>;
      try { parsed = await lifecycle.readIdentity({ plugin }); }
      catch { warn(`Plugin '${plugin.pluginId}': installed identity manifest is unreadable or invalid; omitted from metadata lookup.`); continue; }
      const { warnings, ...identity } = parsed;
      warnings.forEach(warn);
      const provider: PluginProvider = { ...identity, version: plugin.version ?? null, enabled: false, family: 'agent-plugin', localId: plugin.pluginId };
      if (forAdmission) providers.push(provider);
      else {
        if (preferredKeys.has(`${plugin.pluginId}:${plugin.archiveDigest}`)) {
          const revisions = agentProviders.get(plugin.pluginId) ?? [];
          revisions.push(provider);
          agentProviders.set(plugin.pluginId, revisions);
        }
      }
    }
    return providers.concat(await resolveAgentProviders({ agentProviders }));
  };

  const listProviders = async ({ forAdmission = false }: { forAdmission?: boolean } = {}, _options = {}) => {
    const providers = await listSiteProviders({ forAdmission });
    return providers.concat(await listAgentProviders({ forAdmission }));
  };
  const lookup = createPluginLookup({ listPlugins: listProviders }, { warn });
  const resolveServers = (pluginId: string) => (optional.resolveMcpServers ?? resolveAgentPluginMcpServers)({ agentPluginLayout: deps.agentPluginLayout, workspaceId: deps.workspaceId, pluginId });

  // Preview, provisioning grant and status share the host's composed pair (resolved once by the host).
  const { mcp, mcpPorts } = deps;
  const agentPlugins: AgentPluginLifecycleCapability<UninstallInput> = {
    inactivePluginIds: () => lifecycle.inactivePluginIds(),
    previewEnableAccess: async ({ pluginId }) => previewAgentPluginEnableAccess({
      workspaceId: deps.workspaceId, pluginId, repo: mcp.repo, ...mcpPorts, servers: await resolveServers(pluginId),
    }),
    recordDeclinedAccess: async ({ accessKey }) => recordAgentPluginAccessDeclined({ applyAccess: mcp.applyAccess, workspaceId: deps.workspaceId, accessKey }),
    listInstalled: () => lifecycle.listInstalled(),
    assertWritable: () => lifecycle.assertWritable(),
    setEnabled: input => lifecycle.setEnabled(input),
    /** Provisioning must use the same two owners as the admin toggle. A failed connection never
     * rolls back a successful activation; report fixed diagnostics without credential material. */
    provisionMcp: async ({ pluginId, principalId }, execution = {}) => {
      try {
        const approvedEnable = execution.approvedEnable ? { principalId, accessKey: requireApprovedAccessKey(execution.approvedEnableKey, deps.messages) } : undefined;
        const servers = await resolveServers(pluginId);
        const result = await (optional.provisionMcpServers ?? provisionAgentPluginMcpServers)(mcp, { workspaceId: deps.workspaceId, pluginId, servers, principalId });
        reportProvisioningFailures({ pluginId, failed: result.failed, approved: execution.approvedEnable === true, warn, messages: deps.messages });
        // Same as the admin toggle: an account signed in while the plugin was off gets the plugin's
        // declared tools now (bug 2026-11-04, the host's sign-in grant owner).
        await deps.grantSignedInDefaults({
          deps: { workspaceId: deps.workspaceId, agentPluginLayout: deps.agentPluginLayout, repo: mcp.repo, applyAccess: mcp.applyAccess, clock: deps.clock, ...mcpPorts,
            notifyRosterChanged: () => mcp.notifyRosterChanged({}, {}), warn: message => warn(redactSecrets({ input: message })) },
          pluginId,
          servers,
        }, { skipServerKeys: result.failed.map(failure => failure.serverKey), ...(approvedEnable ? { approvedEnable } : {}) });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (execution.approvedEnable) throw new ToolInputError({ message: redactSecrets({ input: deps.messages.approvedLoadFailed({ detail }) }) });
        warn(redactSecrets({ input: `Plugin '${pluginId}': MCP provisioning could not run — ${detail}` }));
      }
    },
    uninstall: input => lifecycle.uninstall(input),
  };
  return {
    ...lookup,
    withInstallIdentity: ({ candidate, run }) => deps.withLock({
      run: async () => { assertPluginIdentityAvailable({ candidate, installed: await listProviders({ forAdmission: true }) }); return run(); },
    }),
    getHostCapability: ({ capability }) => capability === 'agent-plugin-lifecycle' ? agentPlugins : undefined };
}
