/**
 * Lists runtime plugins and agent plugins separately because their row shapes and activation
 * lifecycles differ; merging discovery would offer runtime activation to packages it cannot own.
 * Both lists use the same read permission and workspace, avoiding cross-workspace disclosure.
 *
 * Failure isolation: a failed agent-plugin index must not take down a working runtime-plugin
 * list, so that entire half degrades to an empty array; failed public-export lookup alone uses
 * an empty export map while retaining the installed rows.
 *
 * Agent-plugin list projections expose public ids, versions, digests, skill names, projected
 * descriptions and export contracts; package roots, skill paths, executable handles and private
 * error details stay with their owner.
 * The two arrays keep each family's distinct response shape visible to callers.
 *
 * Family is explicit because independent namespaces can share an id and guessing can mutate the
 * wrong lifecycle; one enable tool avoids ambiguous near-identical choices, while install and
 * uninstall remain separate because each tool id has one risk band for its different effects.
 */
import { AGENT_TOOL_PRINCIPAL_KIND, adaptLegacyAuthorize, requireToolPermission, buildDomainRegistrations, indexCatalogById, requireInputRecord, requireNoInput, requireString, ToolInputError, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolExecutionContext, type ToolHandler, type ToolRegistration, type AccessApprovalResource } from '@jini-ai/core';
import { nowIso } from '@jini-ai/core/primitives';
import { withModelFacingErrors, type ModelFacingErrorRule } from '@jini-ai/core/model-facing-tool-errors';
import { addedPluginCapabilities, pluginCapabilitySet } from '../source-policy.js';
import { setPluginEnabled, type PluginActivationRecord } from '../activation.js';
import { toAdminPluginResponse } from '../admin-response.js';
import { PluginConflictError, type PluginConflict } from '../plugin-claims.js';
import { PluginChangedSincePreviewError, previewUninstallPlugin, uninstallPlugin, type PluginUninstallPreview, type UninstallPluginRequired } from '../uninstall.js';
import { type PluginDiscoveryRecord } from '../discovery-types.js';
import type { PluginManagementToolsRequired, InstalledPluginRevision, ClassifiedPluginError, OptionalValue, PluginLifecycleToolsPort, PluginFamily, SetEnabledRequest, PluginExportRow } from './contract.js';
const AGENT_PLUGIN_FAMILY = 'agent-plugin' as const;


/** Public installed row; the privacy and two-array rationale is documented in this file header. */
interface AgentPluginListRow {

  readonly pluginId: string;

  readonly version: string | null;

  readonly archiveDigest: string;

  readonly skills: readonly string[];

  readonly exports: readonly PluginExportRow[];
}


function toAgentPluginListRow(required: {
  plugin: InstalledPluginRevision;
  exports: readonly PluginExportRow[] }, _options = {}): AgentPluginListRow {
  const p = required.plugin;
  return { pluginId: p.pluginId, version: p.version ?? null, archiveDigest: p.archiveDigest, skills: p.skills.map((s) => s.name), exports: required.exports };
}


/** Isolates the complete agent-plugin read so its failure cannot break the runtime-plugin list. */
async function listAgentPluginsForResponse<Description>(routeDeps: PluginManagementToolsRequired<Description>): Promise<readonly (AgentPluginListRow | Pick<ReturnType<PluginLifecycleToolsPort['searchCandidate']>, 'pluginId' | 'enabled' | 'description'>)[]> {
  try {
    const installed = await routeDeps.agentPlugins.listInstalled({}, {});
    const inactive = await routeDeps.agentPlugins.inactivePluginIds?.({ strict: false }, {}) ?? new Set<string>();
    const exports = await routeDeps.pluginExports?.catalog({ workspaceId: routeDeps.workspaceId }).catch(() => new Map());
    return installed.map(plugin => {
      if (!inactive.has(plugin.pluginId)) return toAgentPluginListRow({ plugin, exports: exports?.get(plugin.pluginId) ?? [] });
      const visible = routeDeps.agentPlugins.searchCandidate({ candidate: { ...plugin, enabled: false, keywords: [], skills: [], mcpServerIds: [] } });
      return { pluginId: visible.pluginId, enabled: false, description: visible.description };
    });
  } catch {
    return [];
  }
}


/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export function pluginManagementDerivedRiskFor({ toolIds }: {
  toolIds: PluginManagementToolsRequired<unknown>['toolIds'] }, _optional = {}): DerivedRiskByToolId { return new Map<string, AgentToolSideEffect>([
  // -> discoverPlugins() + pluginActivationRepo.getActivation() per record: reads only.
  [toolIds.list, "none"],
  // Activation and its injected enable hook can mutate durable state.
  [toolIds.setEnabled, "mutates-durable-state"],
  // Runtime removal uses shared Trash; agent removal is permanent, so use the worse risk band.
  [toolIds.uninstall, "deletes-durable-state"],
]); }


/** Reads `family` as an explicit choice between the two real systems.
 *
 *  A `ToolInputError`, not a bare `Error`: this genuinely IS "the caller's input was the problem, and
 *  a different input fixes it", and a bare `Error` out of a tool handler is redacted into an opaque
 *  failure by the daemon — so the one message that could tell the model which family to name would
 *  never reach it. @complexity O(1). */
function readFamily(input: Record<string, unknown>, familyRequired: string): PluginFamily {
  const raw = input["family"];
  if (raw === "site-runtime" || raw === AGENT_PLUGIN_FAMILY) return raw;
  throw new ToolInputError({ message: familyRequired });
}


/** @complexity O(1). */
function readSetEnabledRequest(rawInput: unknown, familyRequired: string): SetEnabledRequest {
  const input = requireInputRecord({ input: rawInput });
  const family = readFamily(input, familyRequired);
  const pluginId = requireString({ input: input, key: "pluginId" });
  if (typeof input["enabled"] !== "boolean") {
    throw new ToolInputError({ message: "'enabled' (boolean) is required — true to turn the plugin on, false to turn it off" });
  }
  return { family, pluginId, enabled: input["enabled"] };
}


/** What one plugin's enable approval is bound to; `discovery` is the site-runtime snapshot it was read from. */
interface PluginApprovalIdentity {

  readonly key: string;

  readonly version?: OptionalValue<string>;

  readonly label: string;

  readonly discovery?: OptionalValue<readonly PluginDiscoveryRecord[]>;

  readonly accessKey?: OptionalValue<string>;

  readonly accessResources?: OptionalValue<readonly Omit<AccessApprovalResource, 'scope'>[]>;
}


/** Identity/version binding before and after consent. The existing MCP fingerprint owner
 * hashes the version/digest metadata; no second hashing or approval store is introduced.
 * Disabling removes capability, so it needs no identity grant and never raises a dialog.
 * @complexity One family discovery scan, bounded by the installed package count. */
export async function pluginApprovalIdentity<Description>(
  { deps: routeDeps, request }: {
  deps: Pick<PluginManagementToolsRequired<Description>, 'discoverPlugins' | 'approvalFingerprint'> & { readonly agentPlugins: Pick<PluginManagementToolsRequired<Description>['agentPlugins'], 'listInstalled' | 'previewEnableAccess'> };
  request: Pick<SetEnabledRequest, "family" | "pluginId"> }, _optional = {},
): Promise<PluginApprovalIdentity> {
  let revision: string;
  let version: string | undefined;
  let label: string | undefined;
  let discovery: readonly PluginDiscoveryRecord[] | undefined;
  let schema: Readonly<Record<string, unknown>> = {};
  let accessKey: string | undefined;
  let accessResources: PluginApprovalIdentity['accessResources'];
  if (request.family === AGENT_PLUGIN_FAMILY) {
    const plugins = await routeDeps.agentPlugins.listInstalled({}, {});
    const installed = plugins.filter(plugin => plugin.pluginId === request.pluginId);
    if (installed.length === 0) throw new ToolInputError({ message: `Agent Plugin '${request.pluginId}' is not installed` });
    // Every installed digest participates, independent of discovery ordering.
    revision = JSON.stringify(installed.map(plugin => [plugin.version ?? null, plugin.archiveDigest]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const access = await routeDeps.agentPlugins.previewEnableAccess?.({ pluginId: request.pluginId }, {});
    if (access) { revision = JSON.stringify([revision, access.key]); accessKey = access.key; accessResources = access.resources; }
    version = installed.map(plugin => plugin.version).filter((value): value is string => value !== undefined).sort().join(", ");
  } else {
    discovery = structuredClone(await routeDeps.discoverPlugins());
    const plugin = discovery.find(plugin => plugin.id === request.pluginId);
    if (!plugin) throw new ToolInputError({ message: `plugin '${request.pluginId}' was not found in the current discovery snapshot` });
    revision = plugin.version;
    schema = { ...plugin.manifest };
    version = plugin.version; label = plugin.name;
  }
  const fingerprint = routeDeps.approvalFingerprint({ family: request.family, pluginId: request.pluginId, revision, schema });
  return { key: fingerprint, version, label: label ?? request.pluginId, discovery, accessKey, accessResources };
}


/** A fresh `uninstallPlugin` request. Discovery is re-read on every call, so the post-confirmation write never resolves
 *  its target from the snapshot taken before a human was asked. @complexity one discovery scan. */
async function uninstallRequestFor<Description>(
  routeDeps: PluginManagementToolsRequired<Description>,
  pluginId: string,
  principalId: string,
): Promise<UninstallPluginRequired> {
  const discovery = await routeDeps.discoverPlugins();
  return {
    deps: { repo: routeDeps.pluginActivationRepo, discovery, remove: routeDeps.removePlugin },
    input: {
      pluginId,
      workspaceId: routeDeps.workspaceId,
      at: nowIso({ clock: routeDeps.clock }),
      actor: { principalId, pluginId: routeDeps.actorPluginId },
    },
  };
}


/**
 * The post-confirmation half of uninstall: re-discovers, then uninstalls only if the plugin is
 * still the name and version the dialog showed. A change is a not-removed RESULT, the same union
 * member `expired`/`abandoned` use; every other refusal still propagates undecorated, per this file's convention.
 * @complexity one discovery scan plus `uninstallPlugin`.
 */
async function uninstallConfirmedPlugin<Description>(
  routeDeps: PluginManagementToolsRequired<Description>,
  preview: PluginUninstallPreview,
  principalId: string,
): Promise<unknown> {
  const { pluginId } = preview;
  try {
    const result = await uninstallPlugin(await uninstallRequestFor(routeDeps, pluginId, principalId), { confirmedPreview: preview });
    return { pluginId, trashed: result.trashed };
  } catch (error) {
    if (!(error instanceof PluginChangedSincePreviewError)) throw error;
    return {
      pluginId,
      uninstalled: false,
      cancelled: false,
      reason: "changed-since-confirmation",
      note: routeDeps.messages.changedSinceConfirmation({ pluginId, name: preview.name, version: preview.version }),
    };
  }
}


/**
 * Delegate to the same scoped lifecycle writer used by other host entry points so installed
 * identity, activation and admission policy cannot drift between entry points.
 * @complexity O(d) in installed-digest count plus one small file rewrite.
 */
async function applyAgentPluginDecision<Description>(routeDeps: PluginManagementToolsRequired<Description>, principalId: string, request: SetEnabledRequest, optional: {
  accessKey?: OptionalValue<string> } = {}): Promise<unknown> {
  try {
    const input = {
      workspaceId: routeDeps.workspaceId,
      pluginId: request.pluginId,
      enabled: request.enabled,
      actor: principalId,
    };
    const result = await routeDeps.agentPlugins.setEnabled(input);
    // Provision connections only after successful activation through the host's existing owner;
    // otherwise the same enable decision would leave different usable capabilities by entry point.
    if (result.enabled) {
      await routeDeps.agentPlugins.provisionMcp({ pluginId: request.pluginId, principalId }, { approvedEnable: true, approvedEnableKey: optional.accessKey });
    }
    return {
      changed: true,
      cancelled: false,
      family: request.family,
      agentPlugin: { pluginId: result.pluginId, enabled: result.enabled },
      warnings: result.warnings ?? [],
      restartRequired: false,
      note: routeDeps.messages.restartNote(request),
    };
  } catch (error) {
    // Re-classified at the tool boundary for the same reason `readFamily` throws one: an id that is
    // not installed here IS a caller-input problem with an actionable fix (search first, then use a
    // real id), and a bare `Error` would reach the model as an opaque failure instead. The message
    // carries only the plugin id the caller already sent — nothing internal leaks.
    const classified = routeDeps.agentPlugins.classifyError({ error });
    if (classified?.kind === 'not-installed') throw new ToolInputError({ message: classified.message });
    const linkedError = routeDeps.providerFaces.describeLinkedError({ error });
    if (linkedError !== undefined) return linkedFaceResult({ request, error: linkedError });
    // Nothing changed, so return the actionable refusal rather than an opaque failure.
    const refusal = activationsRefusalResult(routeDeps, request, classified);
    if (refusal !== undefined) return refusal;
    throw error;
  }
}


/**
 * Pre-flight for an Agent Plugin ENABLE, run before the confirmation dialog: the not-changed result when this
 * workspace's activations.json cannot be read or cannot be locked, otherwise `undefined`.
 *
 * `applyAgentPluginDecision` would refuse the same write anyway, but only after a human had confirmed it — asking
 * them to approve something that cannot happen, then reporting "nothing changed" (t91 §7.2). This reads the file
 * with the same strict reader every writer uses, so it refuses exactly the files the write would. The file can
 * still break while the dialog is open; `applyAgentPluginDecision`'s own catch covers that. Disabling raises no
 * dialog, so it needs no pre-flight.
 *
 * @complexity One small file read, plus `assertAgentPluginActivationsWritable`'s own cross-process lock
 * acquisition and release — not a pure read: it also creates the workspace root if it is absent.
 */
async function unwritableAgentPluginActivationsResult<Description>(routeDeps: PluginManagementToolsRequired<Description>, request: SetEnabledRequest): Promise<unknown> {
  try {
    await routeDeps.agentPlugins.assertWritable({}, {});
    return undefined;
  } catch (error) {
    const refusal = activationsRefusalResult(routeDeps, request, routeDeps.agentPlugins.classifyError({ error }));
    if (refusal !== undefined) return refusal;
    throw error;
  }
}


/**
 * Pre-flight for an Agent Plugin ENABLE, run before the confirmation dialog: the host-incompatible result when any
 * installed revision of the plugin declares a host range this host does not satisfy, otherwise `undefined`.
 *
 * Same reason as {@link unwritableAgentPluginActivationsResult}: the write would refuse it anyway, but only after a
 * human had approved something that cannot happen. Uses the lifecycle owner's own compatibility check against the
 * same contract version, and, like its enable, requires every installed revision of the id to pass. `hostOk` does
 * not depend on other plugins' capabilities, so none are supplied.
 * @complexity O(p) in installed-plugin count.
 */
async function hostIncompatibleEnableResult<Description>(routeDeps: PluginManagementToolsRequired<Description>, request: SetEnabledRequest): Promise<unknown> {
  const revisions = (await routeDeps.agentPlugins.listInstalled({}, {})).filter(plugin => plugin.pluginId === request.pluginId);
  const incompatible = routeDeps.agentPlugins.compatibility({ pluginId: request.pluginId, revisions });
  return incompatible ? hostIncompatibleResult(routeDeps, request, incompatible) : undefined;
}


/** A provider plugin's assistant face has no switch of its own (the provider lifecycle owns it):
 *  nothing changed, and the note names the provider plugin to switch instead. @complexity O(1). */
function linkedFaceResult({ request, error }: {

  request: SetEnabledRequest;
  error: ReturnType<PluginManagementToolsRequired<unknown>['providerFaces']["describeLinkedFace"]>;
}, _optional = {}): unknown {
  return { changed: false, cancelled: false, family: request.family, pluginId: request.pluginId, restartRequired: false,
    reason: "linked", code: error.code, providerPluginId: error.providerPluginId, note: `Nothing changed. ${error.message}` };
}


/** Pre-flight: a linked face is refused before the confirmation dialog, not after it. A link that cannot be
 *  read here is left to the write, which checks again. @complexity One manifest read per installed revision. */
async function linkedFaceEnableResult<Description>(routeDeps: PluginManagementToolsRequired<Description>, request: SetEnabledRequest): Promise<unknown> {
  const providerPluginId = await routeDeps.providerFaces.linkedProvider({ pluginId: request.pluginId }).catch(() => undefined);
  return providerPluginId === undefined ? undefined : linkedFaceResult({
    request, error: routeDeps.providerFaces.describeLinkedFace({ pluginId: request.pluginId, providerPluginId }),
  });
}


/** Every Agent Plugin enable pre-flight, in order; the first not-changed result wins. @complexity As its three checks. */
async function agentPluginEnablePreflight<Description>(routeDeps: PluginManagementToolsRequired<Description>, request: SetEnabledRequest): Promise<unknown> {
  return (await unwritableAgentPluginActivationsResult(routeDeps, request)) ?? (await linkedFaceEnableResult(routeDeps, request)) ?? hostIncompatibleEnableResult(routeDeps, request);
}


/** An interrupted update of this plugin waits for boot recovery (`PLUGIN_UPDATE_PENDING`, or an
 *  unreadable recovery record): its on/off decision is frozen until then, the same refusal used by the lifecycle writer. Nothing changed, so a not-changed result. @complexity O(1). */
function updatePendingResult<Description>(routeDeps: PluginManagementToolsRequired<Description>, request: SetEnabledRequest, error: {
  code: string }): unknown {
  return {
    changed: false,
    cancelled: false,
    family: request.family,
    pluginId: request.pluginId,
    restartRequired: false,
    reason: "update-pending",
    code: error.code,
    note: `Nothing changed: an interrupted update of '${request.pluginId}' is still waiting to be recovered, so it was NOT ` +
      `${request.enabled ? "enabled" : "disabled"}. ${routeDeps.messages.updatePendingNextStep(error)}`,
  };
}


/** The plugin declares a host range this host does not satisfy, so it cannot be enabled: the canonical
 *  `PLUGIN_HOST_INCOMPATIBLE` refusal. Nothing changed, so it is
 *  a not-changed result, not a failure. @complexity O(1). */
function hostIncompatibleResult<Description>(routeDeps: PluginManagementToolsRequired<Description>, request: SetEnabledRequest, error: {
  code: string }): unknown {
  return {
    changed: false,
    cancelled: false,
    family: request.family,
    pluginId: request.pluginId,
    restartRequired: false,
    reason: "host-incompatible",
    code: error.code,
    note: routeDeps.messages.hostIncompatibleNote(request),
  };
}


/** Not-changed result: nothing changed, so it is a RESULT the model can relay, not a redacted
 *  failure. The host path and parse detail stay in the server log via the `console.warn` below;
 *  `note` carries only the fixed, path-free E3 text.
 *  @complexity O(1). */
function activationsUnreadableResult<Description>(routeDeps: PluginManagementToolsRequired<Description>, request: SetEnabledRequest, error: {
  message: string }): unknown {
  console.warn(`[agent-plugins] '${request.pluginId}': ${routeDeps.toolIds.setEnabled} refused — ${error.message}`);
  return {
    changed: false,
    cancelled: false,
    family: request.family,
    pluginId: request.pluginId,
    restartRequired: false,
    reason: "activations-unreadable",
    note: routeDeps.messages.activationsUnreadableNote(request),
  };
}


/** Another host process held the cross-process activations.json write lock and
 *  the wait timed out, or this process lost the lock before it could commit. Same not-changed
 *  shape as {@link activationsUnreadableResult}: nothing changed, so it is a RESULT the model can
 *  relay. The host lock path stays in the server log via `console.warn`; `note` is fixed and
 *  path-free.
 *  @complexity O(1). */
function activationsBusyResult<Description>(routeDeps: PluginManagementToolsRequired<Description>, request: SetEnabledRequest, error: {
  message: string }): unknown {
  console.warn(`[agent-plugins] '${request.pluginId}': ${routeDeps.toolIds.setEnabled} refused — ${error.message}`);
  return {
    changed: false,
    cancelled: false,
    family: request.family,
    pluginId: request.pluginId,
    restartRequired: false,
    reason: "activations-busy",
    note: routeDeps.messages.activationsBusyNote(request),
  };
}


/** Dispatches a thrown activation error to the matching not-changed RESULT — Unreadable to
 *  {@link activationsUnreadableResult}, Busy to {@link activationsBusyResult} — or `undefined` for
 *  any other error, so the caller can rethrow it unchanged. Shared by both
 *  {@link applyAgentPluginDecision} and {@link unwritableAgentPluginActivationsResult} so the two
 *  call sites classify activation failures identically.
 *  @complexity O(1). */
function activationsRefusalResult<Description>(routeDeps: PluginManagementToolsRequired<Description>, request: SetEnabledRequest, error: ClassifiedPluginError | undefined): unknown | undefined {
  if (error?.kind === 'host-incompatible') return hostIncompatibleResult(routeDeps, request, error);
  if (error?.kind === 'update') return updatePendingResult(routeDeps, request, error);
  if (error?.kind === 'unreadable') return activationsUnreadableResult(routeDeps, request, error);
  if (error?.kind === 'busy') return activationsBusyResult(routeDeps, request, error);
  return undefined;
}


/**
 * Runtime activation uses the injected command gateway so authorization, audit and inverse/rollback
 * remain identical across host entry points.
 * @complexity O(p) in discovered-plugin count, plus the command gateway's own writes.
 */
async function applySiteRuntimeDecision<Description>(routeDeps: PluginManagementToolsRequired<Description>, principalId: string, request: SetEnabledRequest, optional: {
  discovery?: OptionalValue<readonly PluginDiscoveryRecord[]> } = {}): Promise<unknown> {
  const { pluginId, enabled } = request;
  // Reuse the manifest that passed the post-approval identity check, avoiding another discovery
  // read between checking the approved version/digest and the activation owner loading it.
  const discovery = optional.discovery ?? await routeDeps.discoverPlugins();
  // Capture and restore the same prior row, including absence, through the command gateway.
  let priorActivation: PluginActivationRecord | null = null;

  const { result } = await routeDeps.executeCommand({
    command: {
      workspaceId: routeDeps.workspaceId,
      actor: { id: principalId, kind: AGENT_TOOL_PRINCIPAL_KIND },
      summary: `Agent set plugin '${pluginId}' enabled=${enabled}`,
      permission: routeDeps.permissions.enable,
    },
    mutation: {
      entityType: routeDeps.entityTypes.activation,
      entityId: pluginId,
      operation: "update",
      captureInverse: async () => {
        priorActivation = await routeDeps.pluginActivationRepo.getActivation({ workspaceId: routeDeps.workspaceId, pluginId });
        return { enabled: priorActivation?.enabled ?? false };
      },
      execute: () =>
        setPluginEnabled({
          deps: {
            clock: routeDeps.clock,
            repo: routeDeps.pluginActivationRepo,
            discovery,
            onEnabled: routeDeps.onPluginEnabled,
            onDisabled: routeDeps.onPluginDisabled,
          },
          input: { workspaceId: routeDeps.workspaceId, pluginId, enabled },
        }),
      rollback: async () => {
        if (priorActivation) {
          await routeDeps.pluginActivationRepo.save(priorActivation);
        } else {
          await routeDeps.pluginActivationRepo.deleteActivation({ workspaceId: routeDeps.workspaceId, pluginId });
        }
        if (priorActivation?.enabled) {
          await routeDeps.onPluginEnabled(pluginId);
        } else {
          routeDeps.onPluginDisabled(pluginId);
        }
      },
    },
  });

  if (!result.activation.enabled) await routeDeps.lowerToolAccess({ pluginId });
  const record = discovery.find((r) => r.id === pluginId);
  if (!record) throw new ToolInputError({ message: `plugin '${pluginId}' was not found in the current discovery snapshot` });
  if (((priorActivation as PluginActivationRecord | null)?.enabled ?? false) !== result.activation.enabled) routeDeps.telemetry?.toggled({ principalId, pluginId: record.id, enabled: result.activation.enabled });
  return {
    changed: true,
    cancelled: false,
    family: request.family,
    plugin: toAdminPluginResponse({ discovery: record, activation: result.activation }),
    restartRequired: enabled,
    note: routeDeps.messages.restartNote(request),
  };
}


/** The enable-permission check every write path in this file runs, through the kit's evaluator.
 * @complexity O(1) plus one authorization evaluation. */
async function requireEnablePermission<Description>(
  routeDeps: PluginManagementToolsRequired<Description>,
  required: {
  readonly principalId: string;
  readonly entityType: string;
  readonly entityId: string },
): Promise<void> {
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: required.principalId, permission: routeDeps.permissions.enable }, { entityType: required.entityType, entityId: required.entityId });
}


/** The set-enabled permission check, scoped to the family's own entity type. @complexity O(1) plus one evaluation. */
function requireSetEnabledPermission<Description>(routeDeps: PluginManagementToolsRequired<Description>, required: {
  readonly principalId: string;
  readonly request: SetEnabledRequest }): Promise<void> {
  const { principalId, request } = required;
  return requireEnablePermission(routeDeps, { principalId, entityType: request.family === AGENT_PLUGIN_FAMILY ? routeDeps.entityTypes.agentPlugin : routeDeps.entityTypes.plugin, entityId: request.pluginId });
}


/** What the owner's consent to a site-package enable rests on. Only a site-sourced `site plugin`
 * that is being enabled can carry a capability set; every other call has none. */
interface SiteConsent {

  readonly capabilities: readonly string[] | undefined;

  readonly added: readonly string[];
}


/** The site-sourced record a site-runtime ENABLE's approval identity was read from, else `undefined`
 * (a disable, an Agent Plugin, or a built-in package). @complexity O(p) in the snapshot's plugin count. */
function siteRecordBeingEnabled(
  required: {
  readonly request: SetEnabledRequest;
  readonly identity: PluginApprovalIdentity | undefined },
): PluginDiscoveryRecord | undefined {
  const { request, identity } = required;
  const record = identity?.discovery?.find(record => record.id === request.pluginId);
  return request.enabled && request.family === "site-runtime" && record?.source === "site" ? record : undefined;
}


/** Reads the capabilities beyond the owner's last approval for the
 * record the approval identity was read from (so `record.version` IS the identity's version).
 * @complexity O(c) in the manifest's declared capability count, plus one approval-port read. */
async function siteConsentFor<Description>(
  routeDeps: PluginManagementToolsRequired<Description>,
  required: {
  readonly request: SetEnabledRequest;
  readonly identity: PluginApprovalIdentity | undefined },
): Promise<SiteConsent> {
  const { request } = required;
  const record = siteRecordBeingEnabled(required);
  if (record === undefined) return { capabilities: undefined, added: [] };
  const capabilities = record.manifest ? pluginCapabilitySet({ manifest: record.manifest }) : undefined;
  const added = capabilities === undefined ? [] : addedPluginCapabilities({ approved: await routeDeps.pluginSource?.readApproval({ id: request.pluginId }, {}), next: capabilities });
  return { capabilities, added };
}


/** One prepared set-enabled call: everything the card names and the write re-checks. */
interface SetEnabledPrepared {

  readonly request: SetEnabledRequest;

  readonly identity: PluginApprovalIdentity | undefined;

  readonly refusal: unknown;

  readonly confirm: boolean;

  readonly capabilities: readonly string[] | undefined;

  readonly added: readonly string[];

  readonly previousEnabled: boolean | null;
}


/** parse -> authorize -> (Agent Plugin enable: activations.json writable?) -> identity -> consent
 * inputs. See the set-enabled handler's own comment for why this order is load-bearing.
 * @complexity One family discovery scan plus the source/policy reads in {@link siteConsentFor}. */
async function prepareSetEnabled<Description>(routeDeps: PluginManagementToolsRequired<Description>, required: {
  readonly ctx: ToolExecutionContext }): Promise<SetEnabledPrepared> {
  const { ctx } = required;
  const request = readSetEnabledRequest(ctx.input, routeDeps.messages.familyRequired);
  await requireSetEnabledPermission(routeDeps, { principalId: ctx.principal.id, request });
  const refusal = request.enabled && request.family === AGENT_PLUGIN_FAMILY ? await agentPluginEnablePreflight(routeDeps, request) : undefined;
  const identity = request.enabled && refusal === undefined ? await pluginApprovalIdentity({ deps: routeDeps, request }) : undefined;
  const consent = await siteConsentFor(routeDeps, { request, identity });
  // Consent gap (2026-10-12): the assistant can seal its own package. Always require owner
  // consent, including unchanged versions with a previous capability approval.
  const previousEnabled = await previousPluginEnabled({ deps: routeDeps, request });
  return { request, identity, refusal, confirm: true, capabilities: consent.capabilities, added: consent.added, previousEnabled };
}


/** Read only the selected family, once, for the previous access value shown on the card. */
async function previousPluginEnabled<Description>({ deps, request }: {
  deps: PluginManagementToolsRequired<Description>;
  request: SetEnabledRequest }, _options = {}): Promise<boolean | null> {
  if (request.family !== AGENT_PLUGIN_FAMILY) return (await deps.pluginActivationRepo.getActivation({ workspaceId: deps.workspaceId, pluginId: request.pluginId }))?.enabled ?? false;
  const inactive = await deps.agentPlugins.inactivePluginIds?.({ strict: true }, {});
  return inactive ? !inactive.has(request.pluginId) : null;
}


/** Re-reads an enable's identity after consent; a different key means the human approved something
 * that is no longer what is installed. Disabling binds no identity.
 * @throws {ToolInputError} `PLUGINS_STALE_APPROVAL` when the version or digest changed.
 * @complexity One family discovery scan. */
async function currentApprovedIdentity<Description>(
  routeDeps: PluginManagementToolsRequired<Description>,
  required: {
  readonly request: SetEnabledRequest;
  readonly identity: PluginApprovalIdentity | undefined },
): Promise<PluginApprovalIdentity | undefined> {
  const { request, identity } = required;
  if (!request.enabled) return undefined;
  const current = await pluginApprovalIdentity({ deps: routeDeps, request });
  if (current.key !== identity?.key) throw new ToolInputError({ message: "PLUGINS_STALE_APPROVAL: The plugin or its connection changed. Review and approve it again. Nothing was changed." });
  return current;
}


/** Fails CLOSED without an interactive transport: degrading to "remove it and mention we could
 * not ask" would make confirmation decorative in precisely the contexts that most need it.
 * A cancelled run must not leave a dialog holding a call nobody is listening to, nor hold this
 * handler open until the idle deadline. Core/host approval ports now own that abort lifecycle.
 * No mutation occurred: a no-answer is a RESULT, not an exception. Nothing was changed or removed
 * either way, and the model is still alive to read this and say something sensible.
 *
 * The confirmed (or card-free) half: refusal -> re-authorize -> identity unchanged -> not cancelled
 * -> record the approval -> write.
 * @complexity One family discovery scan plus the family's own write. */
async function runSetEnabled<Description>(
  routeDeps: PluginManagementToolsRequired<Description>,
  required: {
  readonly ctx: ToolExecutionContext;
  readonly prepared: SetEnabledPrepared },
): Promise<unknown> {
  const { ctx, prepared: { request, identity, refusal, confirm, capabilities } } = required;
  if (refusal !== undefined) return refusal;
  await requireSetEnabledPermission(routeDeps, { principalId: ctx.principal.id, request });
  const currentIdentity = await currentApprovedIdentity(routeDeps, { request, identity });
  // A cancelled run must neither keep a card open until the deadline nor grant capability.
  if (ctx.signal.aborted) return { changed: false, ...routeDeps.approvals.notConfirmed({ confirmed: false, reason: "abandoned" }) };
  // The owner approved exactly these capabilities (the identity key pins the manifest). Recorded
  // before the write so a failed record leaves the plugin off rather than enabled unrecorded.
  if (confirm && capabilities !== undefined && routeDeps.pluginSource) await routeDeps.pluginSource.recordApproval({ id: request.pluginId, capabilities }, {});
  return request.family === AGENT_PLUGIN_FAMILY
    ? applyAgentPluginDecision(routeDeps, ctx.principal.id, request, { accessKey: identity?.accessKey })
    : applySiteRuntimeDecision(routeDeps, ctx.principal.id, request, { discovery: currentIdentity?.discovery });
}


/**
 * This domain's model-facing allowlist uses core's model-facing error contract. Only the
 * conflict refusal is listed (2026-10-04): its message names plugin ids/names and the manifest's own
 * declared names — nothing internal — and it is the one refusal an agent can act on by itself
 * ("turn the other plugin off first"). Without the rule it reached the model as a redacted
 * INTERNAL_ERROR, indistinguishable from a crash. Every other error here keeps its existing
 * classification, unchanged.
 */
const PLUGINS_MODEL_FACING_ERRORS: readonly ModelFacingErrorRule[] = [
  {
    error: PluginConflictError,
    code: "PLUGINS_CONFLICT",
    guidance: "Tell the user which plugin holds the name; disabling that plugin first is their call",
  },
];


export function buildPluginManagementRegistrations<Description>(routeDeps: PluginManagementToolsRequired<Description>, _optional = {}): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    [routeDeps.toolIds.list]: async (ctx) => {
      requireNoInput({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: routeDeps.permissions.read });

      const discovery = await routeDeps.discoverPlugins();
      const conflicts = (await routeDeps.listPluginConflicts?.()) ?? new Map<string, readonly PluginConflict[]>();
      const plugins = await Promise.all(
        discovery.map(async (record) => {
          const activation = await routeDeps.pluginActivationRepo.getActivation({ workspaceId: routeDeps.workspaceId, pluginId: record.id });
          if (!activation?.enabled) {
            const visible = routeDeps.agentPlugins.searchCandidate({ candidate: { pluginId: record.id, displayName: record.name, enabled: false, keywords: [], skills: [], mcpServerIds: [] } });
            return { id: record.id, enabled: false, status: record.status, description: visible.description };
          }
          return toAdminPluginResponse({ discovery: record, activation }, { conflicts: conflicts.get(record.id) ?? [] });
        }),
      );
      const agentPlugins = await listAgentPluginsForResponse(routeDeps);
      return { plugins, agentPlugins };
    },

    /**
     * Parse and authorize before preflight or disclosure, then confirm and write; the gateway's
     * later authorization is still needed because a human can leave the dialog open while access
     * changes, and the first check prevents an unauthorized principal from opening it at all.
     */
    [routeDeps.toolIds.setEnabled]: routeDeps.approvals.handler({
      prepare: ({ ctx }) => prepareSetEnabled(routeDeps, { ctx }),
      describe: ({ ctx, prepared: { request, identity, added, refusal, previousEnabled } }) => routeDeps.descriptions.enable({
        subject: { family: request.family, pluginId: request.pluginId, version: identity?.version, label: identity?.label, adds: added,
          previousEnabled, revision: identity?.key, resources: identity?.accessResources },
        ...(request.enabled && refusal === undefined ? { scope: { personId: ctx.principal.id, siteId: routeDeps.workspaceId } } : {}),
      }),
      run: ({ ctx, prepared }) => runSetEnabled(routeDeps, { ctx, prepared }),
    }, { flag: "changed", ask: ({ prepared }) => prepared.request.enabled && prepared.refusal === undefined && prepared.confirm,
      // Turning a plugin back on is a new escalation. A remembered version approval must not
      // silently turn it on after the owner switched it off.
      declined: async ({ reason, prepared }) => {
        if (reason === 'declined' && prepared?.request.family === AGENT_PLUGIN_FAMILY && prepared.identity?.accessKey) {
          await routeDeps.agentPlugins.recordDeclinedAccess?.({ accessKey: prepared.identity.accessKey });
        }
        return { changed: false, family: prepared?.request.family,
          pluginId: prepared?.request.pluginId, restartRequired: false, ...routeDeps.approvals.notConfirmed({ confirmed: false, reason }) };
      },
    }),

    /**
     * One uninstall tool avoids ambiguous family-specific choices while preserving each lifecycle.
     * Runtime removal authorizes and previews before asking so built-in, enabled or unknown targets
     * are refused before an impossible approval; after confirmation it rediscovers the shown version.
     * Removal has no useful inverse for deleted bytes, so it uses shared Trash instead of a command
     * rollback; confirmation is still required because revertibility and consent are independent.
     * Agent removal delegates its entire permission, preview, confirmation and write order, using
     * the same held-open exchange and tool id rather than constructing a second approval channel.
     */
    [routeDeps.toolIds.uninstall]: async (ctx, optional = {}) => {
      ctx = { ...ctx, input: structuredClone(ctx.input), principal: { ...ctx.principal }, run: { ...ctx.run } };
      const input = requireInputRecord({ input: ctx.input });
      const family = readFamily(input, routeDeps.messages.familyRequired);
      const pluginId = requireString({ input: input, key: "pluginId" });

      if (family === AGENT_PLUGIN_FAMILY) return routeDeps.agentPlugins.uninstall({ ctx, pluginId, executionOptions: optional }, {});

      await requireEnablePermission(routeDeps, { principalId: ctx.principal.id, entityType: routeDeps.entityTypes.plugin, entityId: pluginId });

      const preview = await previewUninstallPlugin(await uninstallRequestFor(routeDeps, pluginId, ctx.principal.id)); // throws PluginNotFoundError/NotUninstallableError/EnabledError BEFORE any dialog

      return routeDeps.approvals.handler({
        prepare: async () => preview,
        describe: ({ prepared }) => routeDeps.descriptions.uninstall({ preview: prepared }),
        run: async ({ ctx: approvedCtx, prepared }) => {
          await requireEnablePermission(routeDeps, { principalId: approvedCtx.principal.id, entityType: routeDeps.entityTypes.plugin, entityId: pluginId });
          if (approvedCtx.signal.aborted) return { uninstalled: false, ...routeDeps.approvals.notConfirmed({ confirmed: false, reason: "abandoned" }) };
          return uninstallConfirmedPlugin(routeDeps, prepared, approvedCtx.principal.id);
        },
      }, { flag: "uninstalled", declined: ({ reason }) => ({ pluginId, uninstalled: false, ...routeDeps.approvals.notConfirmed({ confirmed: false, reason }) }) })(ctx, optional);
    },
  };

  // No `unwiredToolIds`: Every supplied catalog entry must have a handler so missing wiring fails closed.
  return buildDomainRegistrations({ ...routeDeps.registration,
    catalog: indexCatalogById({ catalog: routeDeps.registration.catalog }),
    handlers: withModelFacingErrors({ handlers, rules: [...routeDeps.extraModelFacingErrors, ...PLUGINS_MODEL_FACING_ERRORS] }),
    derivedRisk: pluginManagementDerivedRiskFor({ toolIds: routeDeps.toolIds }),
  });
}
