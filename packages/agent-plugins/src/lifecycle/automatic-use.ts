/** Automatic-use policy for one execution context. Catalog, trust, consent and presentation are ports. */
import type { AgentPluginSearchCandidate, AgentPluginSearchMatch } from './search.js';
import type { AgentPluginSkillRequest, ResolveAgentPluginRefsResult } from './resolve-agent-plugin-refs.js';
import type { AgentPluginLifecyclePorts } from './ports.js';
import { agentVisiblePluginCandidate } from './search-projection.js';

export type ChatAgentPlugins = 'auto' | 'ask' | 'off';
export const DEFAULT_CHAT_AGENT_PLUGINS: ChatAgentPlugins = 'auto';
const MAX_AUTOMATIC_GUIDANCE_BYTES = 8 * 1024;
const MAX_QUERY_GUIDANCE_BYTES = 24 * 1024;
/** Browser-owned, per-conversation state. Clearing it deliberately permits a fresh question. */
export interface ChatAgentPluginState {
  decision: { selected: readonly string[]; asked?: boolean; delivered?: readonly string[] } | null;
  excluded: readonly string[];
}
export interface AutomaticAgentPluginMatch { id: string; name: string; why: string }
/** Explicit loads report admission separately from guidance; only real delivery is `loaded`. */
export interface AutomaticAgentPluginLoadResult {
  status: 'loaded' | 'installed-but-inactive' | 'excluded' | 'untrusted' | 'missing'
    | 'off' | 'cancelled' | 'unavailable';
  /** Delivered content, or the resolver's safe refusal for an explicit skill/file request. */
  guidance: string;
}

/** Use the same one-line metadata reason in consent and progressive disclosure. */
function describeMatch({ plugin }: { plugin: AgentPluginSearchCandidate }, _options = {}): AutomaticAgentPluginMatch {
  return { id: plugin.pluginId, name: (plugin.displayName ?? plugin.pluginId).replace(/\s+/g, ' '),
    why: (plugin.summary ?? plugin.description ?? `Provides ${(plugin.provides ?? plugin.keywords).join(', ')}`).split(/[\n.]/)[0]!.replace(/\s+/g, ' ').slice(0, 180) };
}

function enabledPluginCatalog({ ctx, candidates }: {
  ctx: UseContext; candidates: readonly AgentPluginSearchCandidate[];
}, _options = {}): string {
  const rows = [...candidates].filter(plugin => !ctx.state.excluded.includes(plugin.pluginId) && !ctx.delivered.has(plugin.pluginId))
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  return rows.length ? 'Enabled agent plugins (load one before acting on its part):\n' + rows.map(plugin => catalogRow({ ctx, plugin })).join('\n') : '';
}
function catalogRow({ ctx, plugin }: { ctx: UseContext; plugin: AgentPluginSearchCandidate }, _options = {}): string {
  const { id, name, why } = describeMatch({ plugin });
  const pointer = ctx.ports.formatPluginToolPointer?.({ pluginId: id, file: 'SKILL.md' }) ?? `search_agent_plugin_local({ query: "${id}" })`;
  return `- ${name} (${id}): ${why}` + (plugin.keywords.length ? `\n  Use for: ${plugin.keywords.slice(0, 8).join(', ')}` : '') + `\n  Load: ${pointer}`;
}
export interface AutomaticAgentPluginPorts {
  /** Optional so hosts wired before this port keep working; without it, notes omit the load pointer. */
  formatPluginToolPointer?: AgentPluginLifecyclePorts['formatPluginToolPointer'] | undefined;
  list(input: Record<string, never>, options?: Record<string, never>): Promise<readonly AgentPluginSearchCandidate[]>;
  rank(input: { query: string; candidates: readonly AgentPluginSearchCandidate[]; limit: number }, options?: Record<string, never>): readonly AgentPluginSearchMatch[];
  /** Must recheck activation/trust and return real guidance, never a pointer to unopened guidance. */
  resolve(input: { pluginId: string } & AgentPluginSkillRequest, options?: Record<string, never>): Promise<ResolveAgentPluginRefsResult>;
  /** Only a principal-bound human exchange may return action=auto. */
  ask(input: { matches: readonly AutomaticAgentPluginMatch[]; signal?: AbortSignal }, options?: Record<string, never>): Promise<{ action: 'use' | 'skip' | 'auto'; selected: readonly string[] }>;
  saveAuto(input: Record<string, never>, options?: Record<string, never>): Promise<void>;
  publish(input: { state: ChatAgentPluginState; plugins: readonly { id: string; name: string }[] }, options?: Record<string, never>): Promise<void>;
}

type PrepareInput = { maxPromptArgBytes?: number; query?: string; capabilities?: readonly string[]; loaded?: readonly string[]; signal?: AbortSignal };

/** A guarded capability admits its providers outright; a query is ranked for relevance. */
function rankCandidates(
  { candidates, input, ports }: { candidates: readonly AgentPluginSearchCandidate[]; input: PrepareInput; ports: AutomaticAgentPluginPorts },
  _options = {},
): readonly AgentPluginSearchMatch[] {
  const { capabilities } = input;
  const admit = (plugins: readonly AgentPluginSearchCandidate[]) => plugins.map(plugin => ({ ...plugin, score: 4 }));
  if (capabilities) return admit(candidates.filter(plugin => plugin.provides?.some(capability => capabilities.includes(capability))));
  return withRequiredProviders({ ranked: ports.rank({ query: input.query ?? '', candidates, limit: candidates.length }, {}), candidates });
}

function withRequiredProviders({ ranked, candidates }: {
  ranked: readonly AgentPluginSearchMatch[]; candidates: readonly AgentPluginSearchCandidate[];
}, _options = {}): readonly AgentPluginSearchMatch[] {
  const top = ranked[0];
  if (!top) return ranked;
  const required = candidates.filter(plugin => plugin.enabled && plugin.provides?.some(capability => top.requires?.includes(capability)))
    .map(plugin => ranked.find(match => match.pluginId === plugin.pluginId) ?? { ...plugin, score: 4 });
  const ordered = [top, ...required, ...ranked];
  return ordered.filter((plugin, index) => ordered.findIndex(match => match.pluginId === plugin.pluginId) === index);
}

/** Validate the request's small browser state; malformed state means no previous decision.
 * @returns A fresh state; no caller input is mutated. @complexity O(n) in saved identities.
 */
export function readChatAgentPluginState({ value }: { value: unknown }, _options = {}): ChatAgentPluginState {
  const empty = { decision: null, excluded: [] };
  if (!value || typeof value !== 'object') return empty;
  const record = value as Record<string, unknown>;
  if (!ids(record.excluded)) return empty;
  const decision = record.decision as SavedDecision | null;
  if (decision !== null && (!decision || !ids(decision.selected))) return empty;
  return { decision: decision ? copyDecision({ decision }) : null, excluded: [...new Set(record.excluded)] };
}

type SavedDecision = { selected?: unknown; asked?: unknown; delivered?: unknown };

/** A saved id list: non-empty strings of at most 160 characters. O(n). */
function ids(raw: unknown): raw is string[] {
  return Array.isArray(raw) && raw.every(id => typeof id === 'string' && id.length > 0 && id.length <= 160);
}

/** Copy a decision whose `selected` list was already validated, keeping only well-formed optional fields. O(n). */
function copyDecision({ decision }: { decision: SavedDecision }, _options = {}): NonNullable<ChatAgentPluginState['decision']> {
  return { selected: [...new Set(decision.selected as string[])], ...(typeof decision.asked === 'boolean' ? { asked: decision.asked } : {}), ...(ids(decision.delivered) ? { delivered: [...new Set(decision.delivered)] } : {}) };
}

/** One preparation owner's mutable state and host ports, shared by the module-level helpers below. */
interface UseContext {
  mode: ChatAgentPlugins;
  state: ChatAgentPluginState;
  readonly ports: AutomaticAgentPluginPorts;
  readonly delivered: Map<string, string>;
  readonly alreadyLoaded: Set<string>;
  publishedSize: number | undefined;
  queue: Promise<unknown>;
}

/** Ask mode admits only consented matches; the first non-empty match set asks the person once. */
async function applyConsent({ ctx, matches }: {
  ctx: UseContext;
  matches: AgentPluginSearchMatch[];
}, { signal }: {
  signal?: AbortSignal | undefined;
} = {}): Promise<AgentPluginSearchMatch[]> {
  if (ctx.mode !== 'ask') return matches;
  const { decision } = ctx.state;
  if (decision === null || decision.asked === false) return matches.length ? askConsent({ ctx, matches }, { signal }) : matches;
  // Consent survives cold runs; relevance still comes from this request or write capability.
  // Later matches do not inherit consent, and exclusions were applied before ranking.
  return matches.filter(plugin => decision.selected.includes(plugin.pluginId));
}
async function askConsent({ ctx, matches }: {
  ctx: UseContext;
  matches: AgentPluginSearchMatch[];
}, { signal }: {
  signal?: AbortSignal | undefined;
} = {}): Promise<AgentPluginSearchMatch[]> {
  const offered = matches.map(plugin => describeMatch({ plugin }));
  const answer = await ctx.ports.ask({ matches: offered, ...(signal ? { signal } : {}) }, {});
  const selected = answer.action === 'skip' ? [] : answer.selected.filter(id => matches.some(plugin => plugin.pluginId === id));
  // Failed preference persistence must leave this controller without the rejected consent.
  if (answer.action === 'auto') { await ctx.ports.saveAuto({}, {}); ctx.mode = 'auto'; }
  ctx.state = { decision: { selected, asked: true }, excluded: [...new Set([...ctx.state.excluded, ...matches.filter(plugin => !selected.includes(plugin.pluginId)).map(plugin => plugin.pluginId)])] };
  // Consent changes only this person's preference, never a workspace default.
  return matches.filter(plugin => selected.includes(plugin.pluginId));
}
/** Resolve through the host's activation/trust owner; delivery is recorded only by the caller.
 * Explicit content requests retain safe resolver refusals so the model can correct its request;
 * thrown host diagnostics remain private. Failures stay retryable. O(1) bookkeeping.
 */
async function resolveOneGuidance(ctx: UseContext, { plugin, ...request }: { plugin: AgentPluginSearchCandidate } & AgentPluginSkillRequest, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<AutomaticAgentPluginLoadResult> {
  if (signal?.aborted) return { status: 'cancelled', guidance: '' };
  try {
    const result = await ctx.ports.resolve({ pluginId: plugin.pluginId, ...request }, {});
    if (!result.ok) return { status: result.code ?? 'unavailable', guidance: request.skill !== undefined || request.file !== undefined ? result.reason : '' };
    if (!result.promptPrefix.trim()) return { status: 'unavailable', guidance: '' };
    return { status: 'loaded', guidance: result.promptPrefix };
  } catch {
    // Automatic guidance is advisory; unavailable plugins must not block the run.
    return { status: 'unavailable', guidance: '' };
  }
}
/** Only complete primary guidance updates the loaded set. O(1), no host effects. */
function recordDelivery({ ctx, plugin, result }: {
  ctx: UseContext;
  plugin: AgentPluginSearchCandidate;
  result: AutomaticAgentPluginLoadResult;
}): void {
  if (result.status === 'loaded') ctx.delivered.set(plugin.pluginId, plugin.displayName ?? plugin.pluginId);
}
/** Bound automatic attachments before recording delivery; explicit loads retain complete text.
 * O(p*b) in resolved plugins and guidance bytes; a deferred plugin remains retryable.
 */
async function resolveGuidance({ ctx, matches }: {
  ctx: UseContext;
  matches: readonly AgentPluginSearchMatch[];
}, { budget, signal }: {
  budget?: number | undefined;
  signal?: AbortSignal | undefined;
} = {}): Promise<string[]> {
  const guidance: string[] = [];
  // Unloaded plugins contribute nothing; oversized guidance becomes a pointer instead of the text.
  const guidanceFor = async (match: AgentPluginSearchMatch): Promise<string | undefined> => {
    const result = await resolveOneGuidance(ctx, { plugin: match }, { signal });
    if (result.status !== 'loaded') return undefined;
    if (new TextEncoder().encode(result.guidance).length > (budget ?? MAX_AUTOMATIC_GUIDANCE_BYTES)) {
      const pointer = ctx.ports.formatPluginToolPointer?.({ pluginId: match.pluginId, skill: match.pluginId, file: 'SKILL.md' });
      const howToLoad = pointer === undefined ? '' : ` Load the full instructions with ${pointer}; use the same call with file '<relative path>' for supporting references.`;
      return `Agent Plugin '${match.pluginId}' guidance is deferred because it exceeds the automatic byte limit.${howToLoad}`;
    }
    recordDelivery({ ctx, plugin: match, result });
    if (budget !== undefined) budget -= new TextEncoder().encode(result.guidance).length;
    return result.guidance;
  };
  for (const match of matches) {
    if (signal?.aborted) break;
    const text = await guidanceFor(match);
    if (text !== undefined) guidance.push(text);
  }
  return guidance;
}
/** Persist actual deliveries separately from consent, using the existing chat decision. */
function rememberDelivery(ctx: UseContext, ): void {
  if (!ctx.alreadyLoaded.size && !ctx.delivered.size) return;
  const { decision } = ctx.state;
  ctx.state = { ...ctx.state, decision: { selected: [...new Set([...(decision?.selected ?? []), ...(ctx.mode === 'auto' ? ctx.delivered.keys() : [])])],
    asked: decision?.asked ?? false, delivered: [...new Set([...(decision?.delivered ?? []), ...ctx.alreadyLoaded, ...ctx.delivered.keys()])] } };
}
/** Initialize usage after a decision (including Skip), then publish only loaded-set changes.
 * Empty discovery must not consume that initial publication: a later Ask answer must persist.
 */
async function publishUsage(ctx: UseContext, ): Promise<void> {
  if (ctx.publishedSize === ctx.delivered.size || (ctx.delivered.size === 0 && ctx.state.decision === null)) return;
  ctx.publishedSize = ctx.delivered.size;
  try {
    await ctx.ports.publish({ state: ctx.state, plugins: [...ctx.delivered].map(([id, name]) => ({ id, name })) }, {});
  } catch {
    // Usage publication is advisory; losing its event must not discard resolved model guidance.
  }
}
/** Query preflight delivers the top and required providers; guarded capabilities resolve their providers.
 * Effects serialize with loads so a suggestion never consumes a backstop's delivery.
 */
async function prepare({ ctx, input }: { ctx: UseContext; input: PrepareInput }): Promise<string> {
  for (const id of input.loaded ?? []) ctx.alreadyLoaded.add(id);
  if (ctx.mode === 'off' || input.signal?.aborted) return '';
  const installed = (await ctx.ports.list({}, {})).filter(plugin => !ctx.state.excluded.includes(plugin.pluginId));
  const candidates = installed.filter(plugin => plugin.enabled);
  for (const id of ctx.alreadyLoaded) if (!candidates.some(plugin => plugin.pluginId === id)) ctx.alreadyLoaded.delete(id);
  const matches = await consentedMatches({ ctx, candidates, input });
  const result = await preparedGuidance({ ctx, matches, input });
  rememberDelivery(ctx);
  await publishUsage(ctx);
  // Preflight never resolves off packages implicitly. A catalog line offers an explicit read;
  // its setup guidance may explain whether enabling or credentials are needed.
  const off = offPluginNote(ctx, { catalog: installed, input });
  const catalog = input.query !== undefined && !input.capabilities?.length ? enabledPluginCatalog({ ctx, candidates }) : '';
  return [result, catalog, off].filter(Boolean).join('\n\n');
}
/** Rank enabled candidates, drop plugins this run already has, then apply the person's consent. */
async function consentedMatches({ ctx, candidates, input }: {
  ctx: UseContext;
  candidates: readonly AgentPluginSearchCandidate[];
  input: PrepareInput;
}): Promise<AgentPluginSearchMatch[]> {
  const ranked = rankCandidates({ candidates, input, ports: ctx.ports });
  // Owner decision 2026-10-18: no per-chat plugin count; the relevance threshold and vendor gate decide.
  const relevant = ranked.filter(plugin => !ctx.delivered.has(plugin.pluginId) && !input.loaded?.includes(plugin.pluginId) && (!ctx.alreadyLoaded.has(plugin.pluginId) || !!input.query));
  return applyConsent({ ctx, matches: relevant }, { signal: input.signal });
}
/** Capability calls resolve every match; a query resolves the top and required providers. */
async function preparedGuidance({ ctx, matches, input }: {
  ctx: UseContext;
  matches: AgentPluginSearchMatch[];
  input: PrepareInput;
}): Promise<string> {
  const shouldLoad = !!input.capabilities?.length;
  const primary = primaryMatch({ ctx, matches, input });
  return shouldLoad ? (await resolveGuidance({ ctx, matches }, { signal: input.signal })).join('\n\n') : (await resolveGuidance({ ctx, matches: primary }, { budget: MAX_QUERY_GUIDANCE_BYTES, signal: input.signal })).join('\n\n');
}
/** The top match and required providers a fresh, unbounded query preflight delivers in full; otherwise none. */
function primaryMatch({ ctx, matches, input }: {
  ctx: UseContext;
  matches: AgentPluginSearchMatch[];
  input: PrepareInput;
}): AgentPluginSearchMatch[] {
  if (!(input.maxPromptArgBytes === undefined && input.query && !input.loaded?.length && !ctx.alreadyLoaded.has(matches[0]?.pluginId ?? ''))) return [];
  const [top, ...rest] = matches;
  if (!top) return [];
  const required = rest.filter(plugin => !ctx.alreadyLoaded.has(plugin.pluginId) && plugin.provides?.some(capability => top.requires?.includes(capability)));
  return [top, ...required].slice(0, 3);
}
/** Rank readable metadata for off plugins; never load their tools or guidance implicitly. O(p*t). */
function offPluginNote(ctx: UseContext, { catalog, input }: { catalog: readonly AgentPluginSearchCandidate[]; input: PrepareInput }): string {
  if (!input.query) return '';
  const candidates = catalog.filter(plugin => !plugin.enabled).map(candidate => agentVisiblePluginCandidate({ candidate }));
  return ctx.ports.rank({ query: input.query, candidates, limit: 10 }, {}).map(plugin => [plugin.description,
    ctx.ports.formatPluginToolPointer?.({ pluginId: plugin.pluginId, file: 'SKILL.md' })].filter(Boolean).join(' ')).join('\n');
}
/** Admit one explicit id using the same catalog, consent, resolver and delivery state as prepare.
 * No activation writes; unavailable guidance is retryable. O(p) local catalog lookup.
 */
async function load(ctx: UseContext, { pluginId, signal, ...request }: { pluginId: string; signal?: AbortSignal } & AgentPluginSkillRequest, _options = {}): Promise<AutomaticAgentPluginLoadResult> {
  if (ctx.mode === 'off' && !ctx.alreadyLoaded.has(pluginId)) return { status: 'off', guidance: '' };
  if (signal?.aborted) return { status: 'cancelled', guidance: '' };
  if (ctx.state.excluded.includes(pluginId)) return { status: 'excluded', guidance: '' };
  const plugin = (await ctx.ports.list({}, {})).find(candidate => candidate.pluginId === pluginId);
  if (!plugin) return { status: 'missing', guidance: '' };
  return loadPermitted(ctx, { plugin, ...request }, { signal });
}
/** The plugin's own SKILL.md, whether defaulted or named explicitly. O(1). */
function isPrimaryInstructions(ctx: UseContext, { pluginId, skill, file }: { pluginId: string } & AgentPluginSkillRequest, _options = {}): boolean {
  return (skill === undefined || skill === pluginId) && (file === undefined || file === 'SKILL.md');
}
/** Requested content bypasses only deduplication, never consent or the resolver's trust checks.
 * Only the primary SKILL.md records full plugin delivery. O(p) consent filtering plus one read.
 */
async function loadPermitted(ctx: UseContext, { plugin, ...request }: { plugin: AgentPluginSearchCandidate } & AgentPluginSkillRequest, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<AutomaticAgentPluginLoadResult> {
  const matches = await applyConsent({ ctx, matches: [{ ...plugin, score: 4 }] }, { signal });
  if (!matches.length) {
    await publishUsage(ctx);
    return { status: 'excluded', guidance: '' };
  }
  let result = await resolveOneGuidance(ctx, { plugin, ...request }, { signal });
  if (!plugin.enabled && result.status === 'loaded') {
    result = { status: 'installed-but-inactive', guidance: `Plugin '${plugin.pluginId}' is off; its tools are unavailable.\n\n${result.guidance}` };
  }
  if (isPrimaryInstructions(ctx, { pluginId: plugin.pluginId, ...request })) recordDelivery({ ctx, plugin, result });
  rememberDelivery(ctx);
  await publishUsage(ctx);
  return result;
}
/** Share one queue between preflight, explicit reads and simultaneous guarded writes. */
function enqueue<T>({ ctx, operation }: { ctx: UseContext; operation: () => Promise<T> }): Promise<T> {
  const next = ctx.queue.then(operation);
  ctx.queue = next.catch(() => undefined);
  return next;
}

/** Create one run's preparation owner. Calls serialize so parallel tool writes share one question.
 * @param required Host effects and the person's mode; browser state is advisory selection only.
 * @returns prepare(): a relevance note or capability guidance; load(): a truthful admission/delivery outcome.
 * @complexity O(p*t) ranking plus at most one resolve per admitted plugin; relevance, not a count, bounds it.
 * @example const use = createAutomaticAgentPluginUse({ mode: 'auto', ports });
 */
export function createAutomaticAgentPluginUse(
  { mode, state: initialState, ports }: { mode: ChatAgentPlugins; state?: ChatAgentPluginState | undefined; ports: AutomaticAgentPluginPorts },
  _options = {},
) {
  const state = readChatAgentPluginState({ value: initialState });
  const ctx: UseContext = {
    mode, state, ports, delivered: new Map<string, string>(), publishedSize: undefined, queue: Promise.resolve(),
    alreadyLoaded: new Set(mode === 'off' ? [] : state.decision?.delivered?.filter(id => !state.excluded.includes(id))),
  };
  return {
    guidanceIds: (_required: Record<string, never>, _options = {}) => [...new Set([...ctx.alreadyLoaded, ...ctx.delivered.keys()])].filter(id => !ctx.state.excluded.includes(id)),
    /** Suggest relevant metadata for a query; capability calls load only their providers. */
    prepare: (input: PrepareInput, _options = {}) => enqueue({ ctx, operation: () => prepare({ ctx, input }) }),
    /** Resolve one active, permitted id and publish usage only after real guidance is read.
     * Returns a concrete status and delivered content or a safe explicit-request refusal.
     * @example await controller.load({ pluginId: 'my-plugin' });
     */
    load: (input: { pluginId: string; signal?: AbortSignal } & AgentPluginSkillRequest, _options = {}) => enqueue({ ctx, operation: () => load(ctx, input) }),
  };
}
