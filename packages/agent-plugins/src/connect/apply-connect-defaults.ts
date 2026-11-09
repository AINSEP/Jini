import { ToolInputError } from '@jini-ai/core';
import type { AgentPluginMcpAccessSnapshot, AgentPluginMcpRecord, AgentPluginMcpContext, AgentPluginMcpProjectionPorts } from '../service-ports.js';
/**
 * @file Grants a plugin's declared default tools (`mcp.json`'s `defaultTools`, parsed by
 * `manifest.ts`) on the operator's FIRST successful sign-in to a server that plugin provisioned — so
 * connecting is the only step, with no trip to Settings to tick tools. An explicit enable card
 * calls the same owner with its listed grants, even when sign-in will happen afterwards.
 *
 * `federate-mcp.ts` rule 3 ("provisioning is not authorization") still holds: provisioning writes a
 * disabled row with empty lists; a human sign-in or an enable card naming the source and grants
 * is what authorizes turning the declared defaults on.
 *
 * Applied only when ALL of these hold, and otherwise nothing is written:
 * - the row names a provisioning plugin (`provisionedByPluginId`), so an operator's own row is never
 *   touched;
 * - on sign-in both tool lists are still empty, so a row the operator already edited is never
 *   touched, and a second sign-in (lists now filled) is a no-op. An explicit enable card may add
 *   its listed defaults to existing grants, preserving the owner's other granted names;
 * - the installed plugin still declares a server that maps to this row at the SAME url, so defaults
 *   written for one endpoint never land on a row an operator pointed somewhere else;
 * - no operator turned the plugin off (a seeder's default-off record does not count).
 *
 * Architectural role:
 * `features/agent-plugins` business rule, implementing `external-mcp-oauth.ts`'s `onConnected` port.
 * Wired where the OAuth service is composed (`composition/app.ts`, `composition/deps.ts`,
 * `agent-daemon-server.ts`).
 */
import type { AgentPluginMcpPort } from "../service-ports.js";
import type { Clock as ClockPort } from "@jini-ai/core/primitives";
import { previewAgentPluginEnableAccess, storedAgentPluginGrants, validatedAgentPluginToolGrant } from './enable-access.js';

// activation.ts was deleted; Jini owns the lifecycle, this host binding owns its effects.
import { agentPluginActivations } from "../activation-effects.js";
import { findAgentPluginMcpServerDefaults, isEmptyJsonList, resolveAgentPluginMcpServers } from "./federate-mcp.js";
import type { McpServerConfig } from "../mcp-metadata.js";
import type { AgentPluginLayout } from "../layout.js";
import { setAgentPluginEnabled } from "../set-enabled.js";

export const CONNECT_DECLINED_ACTOR = "system:connect-declined";

/** Recorded as the plugin activation's `updatedBy` and the row's write-grant attribution: the grant
 *  came from the plugin's declaration, at a sign-in, not from a Settings save. */
const CONNECT_DEFAULTS_ACTOR = "system:connect-defaults";

/** `activation.ts`'s seeder actor: its disabled record is the default, not an operator decision. */
export const SEED_ACTOR = "system:seed";

/** Whether `pluginId`'s activation record is a disabled one someone other than the seeder wrote.
 *  Shared with `switch-on-saved-token.ts`. @complexity One activations read. */
export async function isPluginOffByOperator(input: { workspaceId: string; agentPluginLayout: AgentPluginLayout; pluginId: string }, _options = {}): Promise<boolean> {
  const activations = await agentPluginActivations.readAgentPluginActivations({ workspaceRoot: input.agentPluginLayout.forWorkspace(input.workspaceId).root });
  if (!Object.hasOwn(activations.plugins, input.pluginId)) return false;
  const record = activations.plugins[input.pluginId];
  return record?.enabled === false && record.updatedBy !== SEED_ACTOR;
}

/**
 * Makes sure `pluginId`'s activation is on: no record and an "on" record already read as on (nothing
 * is written); the seeder's own disabled record is switched on (decided under the activations lock,
 * so an operator toggle racing it wins); anyone else's disabled record is an operator's "off" and
 * stays. Shared with `switch-on-saved-token.ts`, which needs it on top of connect defaults (they skip a
 * row an operator already set up and so never reach the plugin's activation). EVERY state goes through
 * `setAgentPluginEnabled`, so every one keeps the checks a switch has (installed, host-compatible, no
 * pending update, not a provider plugin's linked face, whose provider's switch decides:
 * `provider-plugin-link.ts`) before anything is granted; only its write is the locked conditional one.
 * @returns false when an operator's "off" stopped it.
 * @throws What `setAgentPluginEnabled` refuses with (`AgentPluginLinkedError`, not installed, incompatible, pending update).
 * @complexity One plugin-locked switch, at most one locked write.
 */
export async function switchPluginOnUnlessOperatorOff(input: { workspaceId: string; agentPluginLayout: AgentPluginLayout; pluginId: string }, _options = {}): Promise<boolean> {
  const result = await setAgentPluginEnabled({ workspaceId: input.workspaceId, agentPluginLayout: input.agentPluginLayout, pluginId: input.pluginId, enabled: true, actor: CONNECT_DEFAULTS_ACTOR }, { unlessOperatorDisabled: true });
  return result.enabled;
}

export type ApplyConnectDefaultsDeps = Pick<AgentPluginMcpPort, "repo" | "applyAccess"> & AgentPluginMcpProjectionPorts & {
  readonly clock: ClockPort;
  readonly workspaceId: string;
  readonly agentPluginLayout: AgentPluginLayout;
  /** Injected for tests. Defaults to `federate-mcp.ts`'s `resolveAgentPluginMcpServers`. */
  readonly resolveServers?: (input: { workspaceId: string; pluginId: string }) => Promise<Readonly<Record<string, McpServerConfig>>>;
  /** Injected for tests. Defaults to {@link switchPluginOnUnlessOperatorOff}; `false` means an
   *  operator's "off" stopped it, and nothing is granted. */
  readonly enablePlugin?: (input: { workspaceId: string; pluginId: string; actor: string }) => Promise<unknown>;
  /** Host supplies the assistant's `notifyExternalMcpRosterChanged` port. */
  readonly notifyRosterChanged: () => Promise<void>;
  /** Injected for tests. Defaults to {@link isPluginOffByOperator} on this workspace's activations. */
  readonly isPluginOffByOperator?: (pluginId: string) => Promise<boolean>;
};

/** Read one matching plugin row and delegate the grant decision to Jini.
 * @complexity One indexed row read plus that plugin's existing manifest resolution; O(a+w) lists.
 */
async function readConnectGrant({ deps, serverId, resolveServers, approvedEnable, ports }: { deps: ApplyConnectDefaultsDeps; serverId: string; resolveServers: NonNullable<ApplyConnectDefaultsDeps['resolveServers']>; approvedEnable: boolean; ports: AgentPluginMcpProjectionPorts }) {
  const row = await deps.repo.findByServerId({ workspaceId: deps.workspaceId, serverId });
  if (!row) return null;
  const pluginId = row.provisionedByPluginId;
  if (!pluginId) return null;
  if (!approvedEnable && !allowsAutomaticConnectGrant(row)) return null;
  const defaults = findAgentPluginMcpServerDefaults(await resolveServers({ workspaceId: deps.workspaceId, pluginId }), row);
  // A read-only declaration is classification, not permission to change sign-in grants.
  if (!defaults?.allow) return null;
  const grant = validatedAgentPluginToolGrant({ current: storedAgentPluginGrants({ row, projections: ports.projections }), declared: defaults }, { reason: approvedEnable ? 'owner-enable' : 'sign-in', ports });
  return grant ? { row, pluginId, grant } : null;
}

/** Existing choices and nonempty selections stay until a fresh access approval. O(n) list bytes. */
function allowsAutomaticConnectGrant(row: AgentPluginMcpRecord): boolean {
  return row.writeGrantsUpdatedByPrincipalId === null &&
    isEmptyJsonList(row.allowedToolNames) && isEmptyJsonList(row.writeAllowedToolNames);
}

/**
 * Builds the `onConnected(serverId)` port.
 *
 * @throws Whatever the repo or plugin-activation write throws; the OAuth service logs it without
 * failing the sign-in.
 * @complexity O(s) in the plugin's declared server count, plus one row write and one activation write.
 */
export function createApplyConnectDefaults(deps: ApplyConnectDefaultsDeps, options: { readonly approvedEnable?: { readonly principalId: string; readonly accessKey: string } } = {}): (serverId: string) => Promise<void> {
  const resolveServers = deps.resolveServers ?? ((input: { workspaceId: string; pluginId: string }) => resolveAgentPluginMcpServers({ ...input, agentPluginLayout: deps.agentPluginLayout }));
  const enablePlugin =
    deps.enablePlugin ?? ((input: { workspaceId: string; pluginId: string }) => switchPluginOnUnlessOperatorOff({ ...input, agentPluginLayout: deps.agentPluginLayout }));
  const isOff = deps.isPluginOffByOperator ?? ((pluginId: string) => isPluginOffByOperator({ workspaceId: deps.workspaceId, agentPluginLayout: deps.agentPluginLayout, pluginId }));
  // Resolved once per factory: preview, grant and revalidation all compare with the same projections.
  const ports: AgentPluginMcpProjectionPorts = { projections: deps.projections, classifyError: deps.classifyError };

  return async (serverId) => {
    assertApprovedSnapshot(options.approvedEnable);
    const prepared = await readConnectGrant({ deps, serverId, resolveServers, approvedEnable: options.approvedEnable !== undefined, ports });
    if (!prepared) return;
    const { row, pluginId, grant } = prepared;
    const approved = approvedSource({ key: options.approvedEnable?.accessKey, connectionId: serverId, pluginId });
    assertApprovedSource({ approved, grant, current: storedAgentPluginGrants({ row, projections: ports.projections }), url: row.url, expected: ports.projections.accessSnapshot({ record: row }) });
    // A sign-in is not an "on" switch: an operator's explicit plugin-off stays off, exactly as on
    // the saved-token path (`switch-on-saved-token.ts`). The sign-in itself still completes.
    if (await isOff(pluginId)) return;

    // Plugin first: if this throws, nothing is written and the next sign-in tries again. The row
    // write is the step that makes a retry a no-op, so it goes last. The check above is only a cheap
    // early exit: an operator's "off" landing after it is caught again under the activations lock.
    if (await enablePlugin({ workspaceId: deps.workspaceId, pluginId, actor: CONNECT_DEFAULTS_ACTOR }) === false) return;
    const expected = approved?.expected ?? ports.projections.accessSnapshot({ record: row });
    // Direct repo write, the same reason `federate-mcp.ts`'s adoption gives: every other field
    // (url, auth, the token this sign-in just stored) must stay exactly as it is.
    await deps.applyAccess({ workspaceId: deps.workspaceId, serverId,
      expected, access: { enabled: true, allowedToolNames: grant.allow, writeAllowedToolNames: grant.write },
      principalId: options.approvedEnable?.principalId ?? CONNECT_DEFAULTS_ACTOR });
    await deps.notifyRosterChanged();
  };
}

/** Approval-bearing callers cannot fall back to an unbound sign-in grant. */
function assertApprovedSnapshot(approved: { readonly accessKey: string } | undefined): void {
  if (approved && !approved.accessKey) throw new ToolInputError({ message: 'The approved access snapshot is missing. Request the access change again. Nothing was granted.' });
}

/** Only the detached host-produced snapshot authorizes a chat-triggered widening.
 * The effect compares its admission and previous grants atomically in the repository. */
function approvedSource({ key, connectionId, pluginId }: { key: string | undefined; connectionId: string; pluginId: string }, _options = {}): {
  url: string; expected: AgentPluginMcpAccessSnapshot | null; current: ReturnType<typeof storedAgentPluginGrants>; grant: { enabled: boolean; allow: readonly string[]; write: readonly string[] };
} | undefined {
  if (key === undefined) return undefined;
  const sources = JSON.parse(key) as { pluginId: string; connectionId: string; url: string; expected: AgentPluginMcpAccessSnapshot | null; current: ReturnType<typeof storedAgentPluginGrants>; grant: { enabled: boolean; allow: readonly string[]; write: readonly string[] } | null }[];
  const source = sources.find(source => source.connectionId === connectionId);
  if (!source?.grant) throw new ToolInputError({ message: `The approved card did not grant access to '${connectionId}'. Request the access change again.` });
  if (source.pluginId !== pluginId) throw new ToolInputError({ message: 'The connection owner changed after approval. Request the access change again. Nothing was granted.' });
  // Provisioning associates an operator-owned row after approval without changing its source or access.
  const expected = source.expected ? { ...source.expected, provisionedByPluginId: source.expected.provisionedByPluginId ?? pluginId } : null;
  return { url: source.url, expected, current: source.current, grant: source.grant };
}

/** New sources must still have the empty access displayed before provisioning.
 * Existing sources additionally use the approved atomic repository snapshot. */
function assertApprovedSource({ approved, grant, current, url, expected }: {
  approved: ReturnType<typeof approvedSource>; grant: ReturnType<typeof storedAgentPluginGrants>; current: ReturnType<typeof storedAgentPluginGrants>; url: string | null; expected: AgentPluginMcpAccessSnapshot;
}, _options = {}): void {
  if (!approved) return;
  const sameGrant = JSON.stringify(approved.grant) === JSON.stringify(grant);
  const sameNewSource = approved.expected !== null || JSON.stringify(approved.current) === JSON.stringify(current);
  const sameExistingSource = approved.expected === null || JSON.stringify(approved.expected) === JSON.stringify(expected);
  if (!sameGrant || !sameNewSource || !sameExistingSource || approved.url !== url) throw new ToolInputError({ message: 'The plugin declaration or access changed after approval. Request the access change again. Nothing was granted.' });
}


/** Remember a declined proposal without replacing an earlier grant's attribution or credentials.
 * Existing decisions already prevent automatic defaults; only an unattributed source needs a marker.
 * @throws The existing conditional writer's source-changed error if a displayed row changed.
 * @complexity One conditional point write per eligible displayed source; O(s*(a+w)) grant bytes.
 */
export async function recordAgentPluginAccessDeclined({ applyAccess, workspaceId, accessKey }: {
  applyAccess: AgentPluginMcpPort['applyAccess']; workspaceId: string; accessKey: string;
}, _options = {}): Promise<void> {
  const sources = JSON.parse(accessKey) as Awaited<ReturnType<typeof previewAgentPluginEnableAccess>>['snapshots'];
  for (const source of sources) {
    if (!source.grant || !source.expected || source.expected.writeGrantsUpdatedByPrincipalId !== null) continue;
    await applyAccess({ workspaceId, serverId: source.connectionId, expected: source.expected,
      principalId: CONNECT_DECLINED_ACTOR,
      access: { enabled: source.current.enabled, allowedToolNames: source.current.allow, writeAllowedToolNames: source.current.write } });
  }
}
