/**
 * @file Projects loaded Agent Plugin tools into the EXISTING plugin tool contribution contract
 * (`@jini-ai/plugins/host`: `PluginContributionRegistry` → `attachPluginContributionTools`), so these
 * tools reach the assistant through the same namespaced ids, enablement recheck, auth port, confirmation
 * and revocable registry scope as every other plugin tool. Nothing here registers tools directly.
 *
 * Added at this seam, because only it knows a tool came from an Agent Plugin module:
 * - schema validation of the input before the module runs (the registry passes schemas through);
 * - per-call host capabilities, revoked when the plugin's tools are withdrawn;
 * - the affected-resources disclosure the host shows before confirming a write/destructive call,
 *   including the one connection the call may use (its top-level `connectionRef`), which the
 *   capability session then enforces;
 * - refusal of ambiguous ids (two plugins whose namespaced ids collide) and of write/destructive
 *   tools that cannot disclose what they change.
 */
import { Validator, type Schema } from '@cfworker/json-schema';
import { requireInputRecord, ToolInputError } from '@jini-ai/core';
import { openCapabilitySession, openCredentialScan, REVOKED_MESSAGE, runInCapabilitySession, type AgentPluginCredentialScan, type AgentPluginToolCapabilitiesPort,
  type IssuedTokenMemories, type IssuedTokenMemory } from './capabilities.js';
import type { LoadedAgentPluginTool } from './definition.js';
import type { AgentPluginToolEffect } from './manifest.js';

/** What one call receives from the plugin tool contract. Structural: the host owns that contract. */
export interface AgentPluginToolInvocation {
  readonly pluginId: string;
  readonly auth: { readonly workspaceId: string; readonly principalId?: string };
  readonly input: unknown;
  readonly signal?: AbortSignal;
}
/** One tool in the contract's shape (`PluginToolContribution` in `@jini-ai/plugins/host`). */
export interface AgentPluginContractTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Always set here; optional so the host's own snapshot type (where it is optional) fits the port. */
  readonly effect?: AgentPluginToolEffect;
  handler(required: AgentPluginToolInvocation, optional?: Record<string, never>): unknown;
}
/** A host adapter over another admitted contribution, using its existing execution owner. */
export interface AgentPluginAdditionalTool {
  readonly pluginId: string;
  readonly tool: AgentPluginContractTool;
  readonly describeAffectedResources: (required: { readonly input: unknown }) => readonly string[] | Promise<readonly string[]>;
  /** Host connection refs the contribution's execution owner may use; disclosed so the host can freeze their accounts. */
  readonly connections?: readonly string[];
}
/** One plugin's generation in the contract's snapshot shape; routes and widgets stay empty. */
export interface AgentPluginToolSnapshot {
  readonly pluginId: string;
  readonly sdk: object;
  readonly routes: readonly unknown[];
  readonly widgets: readonly unknown[];
  readonly tools: readonly AgentPluginContractTool[];
}
/** Host ports: its contribution registry and its tool-id namespacing rule (`pluginToolIdFor`). */
export interface AgentPluginToolProjectionPorts {
  readonly registry: {
    replace(required: { readonly contributions: AgentPluginToolSnapshot }, optional?: Record<string, never>): void;
    detach(required: { readonly pluginId: string }, optional?: Record<string, never>): void;
    list(required: Record<string, never>, optional?: Record<string, never>): readonly unknown[];
  };
  readonly toolIdFor: (required: { readonly pluginId: string; readonly name: string }, optional?: Record<string, never>) => string;
  readonly capabilities: AgentPluginToolCapabilitiesPort;
  /** The host's ONE token memory source, also passed to its admin-surface host (see `createIssuedTokenMemories`). */
  readonly issuedTokens: IssuedTokenMemories;
}

interface AdmittedTool { readonly toolId: string; readonly loaded: LoadedAgentPluginTool; readonly validator: Validator }
interface ProjectedPlugin { readonly snapshot: AgentPluginToolSnapshot; readonly tools: readonly AdmittedTool[]; readonly additional: readonly AgentPluginAdditionalTool[] }

/** What the host shows before confirming a call. `connections` is every connection the call may use
 *  (see {@link callConnections}); the capability session refuses any other, so the card cannot under-show. */
export interface AgentPluginToolDisclosure { readonly effect: AgentPluginToolEffect; readonly resources: readonly string[]; readonly connections: readonly string[] }

const MAX_RESOURCES = 50;
const MAX_RESOURCE_LENGTH = 300;

/** Agent Plugin tools have no site-plugin SDK; the contract's slot is filled with one that refuses. */
const refuse = (): never => { throw new Error('Agent Plugin tools have no site-plugin SDK.'); };
const INERT_SDK = Object.freeze({
  content: Object.freeze({ read: refuse, extend: refuse }), addFilter: refuse, addAction: refuse, addContribution: refuse,
  routes: Object.freeze({ add: refuse }), tools: Object.freeze({ add: refuse }), widgets: Object.freeze({ add: refuse }),
});

/** Compiles the declared schema, or says why it cannot be used. @complexity O(s) schema size. */
function compileSchema(schema: Readonly<Record<string, unknown>>): Validator | string {
  try {
    const validator = new Validator(schema as Schema, '2020-12', true);
    // cfworker resolves references lazily; one probe surfaces a root-level unresolved $ref at load.
    validator.validate({});
    return validator;
  } catch (error) { return `its input schema is invalid (${error instanceof Error ? error.message : String(error)})`; }
}

/** Why a loaded tool cannot be projected, or its admitted form. @complexity O(s) schema size. */
function admitOne(loaded: LoadedAgentPluginTool, toolIdFor: AgentPluginToolProjectionPorts['toolIdFor']): AdmittedTool | string {
  const { descriptor, module } = loaded;
  if (descriptor.effect !== 'read' && typeof module.describeAffectedResources !== 'function') {
    return `a ${descriptor.effect} tool must export describeAffectedResources()`;
  }
  const validator = compileSchema(descriptor.inputSchema);
  if (typeof validator === 'string') return validator;
  return { toolId: toolIdFor({ pluginId: loaded.pluginId, name: descriptor.name }), loaded, validator };
}

/** Admits each tool, then drops every id more than one plugin claims ("refusing to guess").
 * @complexity O(t) tools plus schema compilation. */
function admitAll(loaded: readonly LoadedAgentPluginTool[], refusals: string[], toolIdFor: AgentPluginToolProjectionPorts['toolIdFor']): AdmittedTool[] {
  const admitted: AdmittedTool[] = [];
  for (const entry of loaded) {
    const result = admitOne(entry, toolIdFor);
    if (typeof result === 'string') refusals.push(`agent tool '${entry.descriptor.name}' from '${entry.pluginId}' was not loaded: ${result}`);
    else admitted.push(result);
  }
  const claimants = new Map<string, Set<string>>();
  for (const tool of admitted) claimants.set(tool.toolId, (claimants.get(tool.toolId) ?? new Set()).add(tool.loaded.pluginId));
  for (const [toolId, owners] of claimants) {
    if (owners.size > 1) refusals.push(`agent tool '${toolId}' was not loaded: more than one plugin declares it (${[...owners].map(id => `'${id}'`).sort().join(', ')})`);
  }
  return admitted.filter(tool => claimants.get(tool.toolId)!.size === 1);
}

/** Validates input against the declared schema; the message names locations, never values.
 * @complexity O(n) input size. */
function validatedInput(tool: AdmittedTool, input: unknown): Readonly<Record<string, unknown>> {
  const record = requireInputRecord({ input });
  let result: ReturnType<Validator['validate']>;
  // A schema fault reached only by some inputs (nested $ref, bad pattern) fails closed, not as bad input.
  try { result = tool.validator.validate(record); } catch (error) {
    throw new Error(`Plugin tool '${tool.toolId}' has an unusable input schema; report it to the plugin author.`, { cause: error });
  }
  if (result.valid) return record;
  // cfworker roots every instanceLocation at '#' (validate()'s default, children append '/key'), so it
  // is never empty; pinned by "input failing at the schema root is located at #" in projection.unit.test.ts.
  const where = [...new Set(result.errors.map(unit => `${unit.instanceLocation} (${unit.keyword})`))].slice(0, 3).join(', ');
  throw new ToolInputError({ message: `Input for '${tool.toolId}' does not match its schema at ${where}. Fix the input and retry.` });
}

/**
 * The connections one call may use: the validated input's top-level string `connectionRef`, else none.
 * A `connectionRef` nested in payload data is data, never a connection. One rule feeds both the
 * disclosure and the capability session, so what the card shows is exactly what the call can reach.
 * @complexity O(1).
 */
function callConnections(checked: Readonly<Record<string, unknown>>): readonly string[] {
  return typeof checked.connectionRef === 'string' ? Object.freeze([checked.connectionRef]) : Object.freeze([]);
}

/** True when both generations hold the same modules and declarations: no revocation needed. @complexity O(t). */
function sameTools(previous: ProjectedPlugin | undefined, next: readonly AdmittedTool[], additional: readonly AgentPluginAdditionalTool[]): previous is ProjectedPlugin {
  if (!previous || previous.tools.length !== next.length || previous.additional.length !== additional.length
    || !previous.additional.every((tool, index) => tool === additional[index])) return false;
  return previous.tools.every((tool, index) => tool.loaded.module === next[index]!.loaded.module
    && JSON.stringify(tool.loaded.descriptor) === JSON.stringify(next[index]!.loaded.descriptor));
}

/**
 * Checks a disclosure hook's answer. Its text reaches the confirmation prompt and the transcript,
 * and module scope may still hold a token from an earlier call, so a list that mentions one is
 * refused like a malformed one. @complexity O(r) resources plus the token scan.
 */
function checkedResources(toolId: string, value: unknown, scan: AgentPluginCredentialScan): readonly string[] {
  const valid = Array.isArray(value) && value.length <= MAX_RESOURCES
    && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= MAX_RESOURCE_LENGTH)
    && !scan.mentionsToken({ value });
  if (!valid) throw new Error(`Plugin tool '${toolId}' returned an invalid affected-resources list; the call cannot be confirmed. Report it to the plugin author.`);
  return Object.freeze([...value]);
}

/** Groups admitted tools and additional contributions in declaration order.
 * Mutates only the local groups and appends admission failures to refusals. @complexity O(t) plus schema compilation. */
function groupProjectionTools({ loaded, additionalTools, refusals, toolIdFor }: {
  loaded: readonly LoadedAgentPluginTool[];
  additionalTools: readonly AgentPluginAdditionalTool[] | undefined;
  refusals: string[];
  toolIdFor: AgentPluginToolProjectionPorts['toolIdFor'];
}, _options: Record<string, never> = {}) {
  const grouped = new Map<string, AdmittedTool[]>();
  for (const tool of admitAll(loaded, refusals, toolIdFor)) {
    const group = grouped.get(tool.loaded.pluginId);
    if (group) group.push(tool); else grouped.set(tool.loaded.pluginId, [tool]);
  }
  const additional = new Map<string, AgentPluginAdditionalTool[]>();
  for (const entry of additionalTools ?? []) {
    const group = additional.get(entry.pluginId);
    if (group) group.push(entry); else additional.set(entry.pluginId, [entry]);
    if (!grouped.has(entry.pluginId)) grouped.set(entry.pluginId, []);
  }
  return { grouped, additional };
}

/** Counts all declarations, including refused tools, and appends ambiguous-id refusals.
 * @complexity O(t * (r + 1)) time and O(t) space for t declarations and r prior refusals. */
function countProjectionClaims({ loaded, additionalTools, refusals, idFor }: {
  loaded: readonly LoadedAgentPluginTool[];
  additionalTools: readonly AgentPluginAdditionalTool[] | undefined;
  refusals: string[];
  idFor: AgentPluginToolProjectionPorts['toolIdFor'];
}, _options: Record<string, never> = {}) {
  // All claimants lose an ambiguous id, including collisions between executable and surface tools.
  const counts = new Map<string, number>();
  const claimedIds = [...loaded.map(tool => idFor({ pluginId: tool.pluginId, name: tool.descriptor.name })),
    ...(additionalTools ?? []).map(entry => idFor({ pluginId: entry.pluginId, name: entry.tool.name }))];
  for (const id of claimedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) {
    if (count <= 1) continue;
    // MOVE: Admission already reports executable collisions with their owners; preserve that diagnostic once.
    if (refusals.some(reason => reason.startsWith(`agent tool '${id}' was not loaded:`))) continue;
    refusals.push(`agent tool '${id}' was not loaded: more than one contribution declares it`);
  }
  return counts;
}

/**
 * Creates the projection for one dedicated contribution registry (keyed by plugin id, so it must not
 * be shared with site plugins whose ids could match). Call `sync` after every load: on boot and on
 * every activation change. A plugin missing from a load is detached: its tools disappear and its
 * calls' capabilities are revoked.
 * @param required.registry - Registry the host attached with `attachPluginContributionTools`.
 * @param required.toolIdFor - The contract's namespacing rule (`pluginToolIdFor`), so ids match the registry's.
 * @param required.capabilities - Host port building one call's capabilities.
 * @param required.issuedTokens - Per-plugin token memory shared with the plugin's admin-surface handlers.
 * @complexity sync is O(t) tools plus schema compilation; disclosure lookup is O(1).
 */
export function createAgentPluginToolProjection(required: AgentPluginToolProjectionPorts, _optional: Record<string, never> = {}) {
  const { registry } = required;
  let projected = new Map<string, ProjectedPlugin>();
  let additionalById = new Map<string, { readonly entry: AgentPluginAdditionalTool; readonly snapshot: AgentPluginToolSnapshot }>();
  let byToolId = new Map<string, { readonly tool: AdmittedTool; readonly snapshot: AgentPluginToolSnapshot }>();

  /** One contract tool whose handler validates, scopes capabilities and gates the result. */
  function contractTool(tool: AdmittedTool, generationOf: { readonly isLive: () => boolean; readonly issued: IssuedTokenMemory }): AgentPluginContractTool {
    const { isLive, issued } = generationOf;
    const { descriptor, module } = tool.loaded;
    const contribution: AgentPluginContractTool = {
      name: descriptor.name, description: descriptor.description, inputSchema: descriptor.inputSchema, effect: descriptor.effect,
      async handler({ pluginId, auth, input, signal }) {
        // Defense in depth: the registry rechecks enablement, but a retained handler must not run either.
        if (!isLive()) throw new Error(REVOKED_MESSAGE);
        const checked = validatedInput(tool, input);
        const host = required.capabilities({ pluginId, workspaceId: auth.workspaceId,
          ...(auth.principalId === undefined ? {} : { principalId: auth.principalId }), ...(signal === undefined ? {} : { signal }) });
        const session = openCapabilitySession({ capabilities: host, isLive, issued, connections: callConnections(checked) }, signal === undefined ? {} : { signal });
        return runInCapabilitySession({ session, run: async () => session.release({
          value: await module.invoke({ input: checked, capabilities: session.capabilities, ...(signal === undefined ? {} : { signal }) }),
        }) });
      },
    };
    return Object.freeze(contribution);
  }

  /** A fresh generation for one plugin; its tools are live only while the registry holds it. */
  function generation(pluginId: string, tools: readonly AdmittedTool[], additional: readonly AgentPluginAdditionalTool[]): ProjectedPlugin {
    let snapshot: AgentPluginToolSnapshot | undefined;
    const isLive = () => snapshot !== undefined && registry.list({}).includes(snapshot);
    const issued = required.issuedTokens.forPlugin({ pluginId });
    snapshot = Object.freeze({ pluginId, sdk: INERT_SDK, routes: Object.freeze([]), widgets: Object.freeze([]),
      tools: Object.freeze([...tools.map(tool => contractTool(tool, { isLive, issued })), ...additional.map(({ tool }) => Object.freeze({
        ...tool,
        handler(input: AgentPluginToolInvocation) {
          if (!isLive()) throw new Error(REVOKED_MESSAGE);
          return tool.handler(input);
        },
      }))]) });
    return { snapshot, tools, additional };
  }

  /** Replaces one plugin's generation unless it is unchanged; a refused replacement detaches it. */
  function place(pluginId: string, tools: readonly AdmittedTool[], additional: readonly AgentPluginAdditionalTool[], refusals: string[]): ProjectedPlugin | undefined {
    const previous = projected.get(pluginId);
    if (sameTools(previous, tools, additional)) return previous;
    const next = generation(pluginId, tools, additional);
    try { registry.replace({ contributions: next.snapshot }); return next; } catch (error) {
      registry.detach({ pluginId });
      refusals.push(`agent tools from '${pluginId}' were not loaded: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  return {
    /** Projects one load result. @returns The loader's refusals plus this seam's own, in order. */
    sync(input: { readonly loaded: readonly LoadedAgentPluginTool[]; readonly refusals: readonly string[]; readonly additionalTools?: readonly AgentPluginAdditionalTool[] }, _options: Record<string, never> = {}): { readonly refusals: readonly string[] } {
      const refusals = [...input.refusals];
      const { grouped, additional } = groupProjectionTools({
        loaded: input.loaded, additionalTools: input.additionalTools, refusals, toolIdFor: required.toolIdFor,
      });
      const idFor = required.toolIdFor;
      const counts = countProjectionClaims({ loaded: input.loaded, additionalTools: input.additionalTools, refusals, idFor });
      const nextProjected = new Map<string, ProjectedPlugin>();
      for (const [pluginId, tools] of grouped) {
        const unique = tools.filter(tool => counts.get(tool.toolId) === 1);
        const extras = (additional.get(pluginId) ?? []).filter(entry => counts.get(idFor({ pluginId, name: entry.tool.name })) === 1);
        const placed = place(pluginId, unique, extras, refusals);
        if (placed) nextProjected.set(pluginId, placed);
      }
      for (const pluginId of projected.keys()) if (!grouped.has(pluginId)) registry.detach({ pluginId });
      projected = nextProjected;
      additionalById = new Map([...nextProjected.values()].flatMap(plugin => plugin.additional.map(entry => [idFor({ pluginId: entry.pluginId, name: entry.tool.name }), { entry, snapshot: plugin.snapshot }] as const)));
      byToolId = new Map([...nextProjected.values()].flatMap(plugin => plugin.tools.map(tool => [tool.toolId, { tool, snapshot: plugin.snapshot }] as const)));
      return { refusals };
    },
    /** What a call would change, for the confirmation prompt; null for an unknown or withdrawn tool.
     * @throws ToolInputError for input that fails the schema; Error for an invalid hook answer. */
    async describeAffectedResources(input: { readonly toolId: string; readonly input: unknown }, _options: Record<string, never> = {}): Promise<AgentPluginToolDisclosure | null> {
      const extra = additionalById.get(input.toolId);
      if (extra && registry.list({}).includes(extra.snapshot)) {
        return describeAdditionalResources({ entry: extra.entry, input: input.input, toolId: input.toolId, issuedTokens: required.issuedTokens });
      }
      const entry = byToolId.get(input.toolId);
      if (!entry || !registry.list({}).includes(entry.snapshot)) return null;
      const { tool } = entry;
      const checked = validatedInput(tool, input.input);
      const connections = callConnections(checked);
      const describe = tool.loaded.module.describeAffectedResources;
      if (!describe) return { effect: tool.loaded.descriptor.effect, resources: [], connections };
      // The same per-plugin token memory the plugin's calls feed: its answers and errors are scanned alike.
      const scan = openCredentialScan({ issued: required.issuedTokens.forPlugin({ pluginId: tool.loaded.pluginId }) });
      let answer: unknown;
      try { answer = await describe({ input: checked }); } catch (error) { throw scan.sanitize({ error }); }
      return { effect: tool.loaded.descriptor.effect, resources: checkedResources(tool.toolId, answer, scan), connections };
    },
  };
}

async function describeAdditionalResources({ entry, input, toolId, issuedTokens }: { entry: AgentPluginAdditionalTool; input: unknown; toolId: string; issuedTokens: IssuedTokenMemories }): Promise<AgentPluginToolDisclosure> {
  const scan = openCredentialScan({ issued: issuedTokens.forPlugin({ pluginId: entry.pluginId }) });
  try {
    const resources = await entry.describeAffectedResources({ input });
    // Host-contributed tools run on their own execution owner, never this session's tokens; that
    // owner declares which connections it may use, so the host can pin their accounts too.
    return { effect: entry.tool.effect ?? 'write', resources: checkedResources(toolId, resources, scan), connections: entry.connections ?? Object.freeze([]) };
  } catch (error) { throw scan.sanitize({ error }); }
}
