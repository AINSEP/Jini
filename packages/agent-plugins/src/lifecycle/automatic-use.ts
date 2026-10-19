/** Automatic-use policy for one execution context. Catalog, trust, consent and presentation are ports. */
import type { AgentPluginSearchCandidate, AgentPluginSearchMatch } from './search.js';

export type ChatAgentPlugins = 'auto' | 'ask' | 'off';
export const DEFAULT_CHAT_AGENT_PLUGINS: ChatAgentPlugins = 'auto';
/** Browser-owned, per-conversation state. Clearing it deliberately permits a fresh question. */
export interface ChatAgentPluginState {
  decision: { selected: readonly string[]; asked?: boolean } | null;
  excluded: readonly string[];
}
export interface AutomaticAgentPluginMatch { id: string; name: string; why: string }

/** Use the same one-line metadata reason in consent and progressive disclosure. */
function describeMatch({ plugin }: { plugin: AgentPluginSearchCandidate }, _options = {}): AutomaticAgentPluginMatch {
  return { id: plugin.pluginId, name: (plugin.displayName ?? plugin.pluginId).replace(/\s+/g, ' '),
    why: (plugin.summary ?? plugin.description ?? `Provides ${(plugin.provides ?? plugin.keywords).join(', ')}`).split(/[\n.]/)[0]!.replace(/\s+/g, ' ').slice(0, 180) };
}

/** Present metadata only. A byte is a conservative upper bound on a UTF-8 text token, so
 * this stays below 600 tokens without a model-specific tokenizer or a plugin-count limit.
 * @returns A bounded note in relevance order, with discovery for every omitted match.
 * @complexity O(p) metadata formatting; output is bounded independently of plugin count.
 */
function relevantPluginNote({ matches }: { matches: readonly AgentPluginSearchCandidate[] }, _options = {}): string {
  if (!matches.length) return '';
  const header = 'Relevant agent plugins for this request:\n';
  const footer = '\nLoad one with load_agent_plugin({ pluginId }) before acting on that part.';
  const lines: string[] = [];
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  for (const match of matches) {
    const { id, name, why } = describeMatch({ plugin: match });
    const line = `${name} (${id}) — ${why}`;
    const remaining = matches.length - lines.length - 1;
    const more = remaining ? `\n+${remaining} more relevant: search_agent_plugin_local({ query: <same request>, offset: 0 }); page with nextOffset` : '';
    if (bytes(header + [...lines, line].join('\n') + more + footer) > 600) break;
    lines.push(line);
  }
  const remaining = matches.length - lines.length;
  return header + lines.join('\n') + (remaining ? `\n+${remaining} more relevant: search_agent_plugin_local({ query: <same request>, offset: 0 }); page with nextOffset` : '') + footer;
}
export interface AutomaticAgentPluginPorts {
  list(input: Record<string, never>, options?: Record<string, never>): Promise<readonly AgentPluginSearchCandidate[]>;
  rank(input: { query: string; candidates: readonly AgentPluginSearchCandidate[]; limit: number }, options?: Record<string, never>): readonly AgentPluginSearchMatch[];
  /** Must recheck activation/trust and return real guidance, never a pointer to unopened guidance. */
  resolve(input: { pluginId: string }, options?: Record<string, never>): Promise<string>;
  /** Only a principal-bound human exchange may return action=auto. */
  ask(input: { matches: readonly AutomaticAgentPluginMatch[]; signal?: AbortSignal }, options?: Record<string, never>): Promise<{ action: 'use' | 'skip' | 'auto'; selected: readonly string[] }>;
  saveAuto(input: Record<string, never>, options?: Record<string, never>): Promise<void>;
  publish(input: { state: ChatAgentPluginState; plugins: readonly { id: string; name: string }[] }, options?: Record<string, never>): Promise<void>;
}

/** Validate the request's small browser state; malformed state means no previous decision.
 * @returns A fresh state; no caller input is mutated. @complexity O(n) in saved identities.
 */
export function readChatAgentPluginState({ value }: { value: unknown }, _options = {}): ChatAgentPluginState {
  const empty = { decision: null, excluded: [] };
  if (!value || typeof value !== 'object') return empty;
  const record = value as Record<string, unknown>;
  const ids = (raw: unknown): raw is string[] => Array.isArray(raw) && raw.every(id => typeof id === 'string' && id.length > 0 && id.length <= 160);
  if (!ids(record.excluded)) return empty;
  const decision = record.decision as { selected?: unknown; asked?: unknown } | null;
  if (decision !== null && (!decision || !ids(decision.selected))) return empty;
  return { decision: decision ? { selected: [...new Set(decision.selected as string[])], ...(typeof decision.asked === 'boolean' ? { asked: decision.asked } : {}) } : null, excluded: [...new Set(record.excluded)] };
}

/** Create one run's preparation owner. Calls serialize so parallel tool writes share one question.
 * @param required Host effects and the person's mode; browser state is advisory selection only.
 * @returns prepare(): a relevance note or capability guidance; load(): one plugin's real guidance.
 * @complexity O(p*t) ranking plus at most one resolve per admitted plugin; relevance, not a count, bounds it.
 * @example const use = createAutomaticAgentPluginUse({ mode: 'auto', ports });
 */
export function createAutomaticAgentPluginUse(
  { mode, state: initialState, ports }: { mode: ChatAgentPlugins; state?: ChatAgentPluginState | undefined; ports: AutomaticAgentPluginPorts },
  _options = {},
) {
  let state = readChatAgentPluginState({ value: initialState });
  const delivered = new Map<string, string>();
  const alreadyLoaded = new Set<string>();
  let publishedSize: number | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  /** Query preflight suggests; only an explicit id or guarded capability resolves guidance.
   * Effects serialize with loads so a suggestion never consumes a backstop's delivery.
   */
  async function prepare(input: { query?: string; pluginId?: string; capabilities?: readonly string[]; loaded?: readonly string[]; signal?: AbortSignal }): Promise<string> {
    if (mode === 'off' || input.signal?.aborted) return '';
    for (const id of input.loaded ?? []) alreadyLoaded.add(id);
    const candidates = (await ports.list({}, {})).filter(plugin => plugin.enabled && !state.excluded.includes(plugin.pluginId));
    const ranked = input.pluginId !== undefined
      ? candidates.filter(plugin => plugin.pluginId === input.pluginId).map(plugin => ({ ...plugin, score: 4 }))
      : input.capabilities
      ? candidates.filter(plugin => plugin.provides?.some(capability => input.capabilities!.includes(capability))).map(plugin => ({ ...plugin, score: 4 }))
      : ports.rank({ query: input.query ?? '', candidates, limit: candidates.length }, {});
    // Owner decision 2026-10-18: no per-chat plugin count; the relevance threshold and vendor gate decide.
    let matches = ranked.filter(plugin => !delivered.has(plugin.pluginId) && !alreadyLoaded.has(plugin.pluginId));
    if (mode === 'ask' && (state.decision === null || state.decision.asked === false) && matches.length > 0) {
      const offered = matches.map(plugin => describeMatch({ plugin }));
      const answer = await ports.ask({ matches: offered, ...(input.signal ? { signal: input.signal } : {}) }, {});
      const selected = answer.action === 'skip' ? [] : answer.selected.filter(id => matches.some(plugin => plugin.pluginId === id));
      state = { decision: { selected, asked: true }, excluded: [...new Set([...state.excluded, ...matches.filter(plugin => !selected.includes(plugin.pluginId)).map(plugin => plugin.pluginId)])] };
      // Consent changes only this person's preference, never a workspace default.
      matches = matches.filter(plugin => selected.includes(plugin.pluginId));
      if (answer.action === 'auto') { await ports.saveAuto({}, {}); mode = 'auto'; }
    }
    if (mode === 'ask') {
      // Consent survives cold runs; relevance still comes from this request or write capability.
      // Later matches do not inherit consent, and exclusions were applied before ranking.
      matches = matches.filter(plugin => state.decision?.selected.includes(plugin.pluginId));
    }
    const guidance: string[] = [];
    // Relevance is disclosure, never evidence that the model has read any guidance.
    const shouldLoad = input.pluginId !== undefined || !!input.capabilities?.length;
    for (const match of shouldLoad ? matches : []) {
      if (input.signal?.aborted) break;
      try {
        const text = await ports.resolve({ pluginId: match.pluginId }, {});
        if (!text.trim()) continue;
        delivered.set(match.pluginId, match.displayName ?? match.pluginId);
        guidance.push(text);
      } catch {
        // Automatic guidance is advisory; unavailable plugins must not block the run.
      }
    }
    if (mode === 'auto' && delivered.size) state = { ...state, decision: { selected: [...new Set([...(state.decision?.selected ?? []), ...delivered.keys()])], asked: state.decision?.asked ?? false } };
    // Initialize usage after a decision (including Skip), then publish only loaded-set changes.
    // Empty discovery must not consume that initial publication: a later Ask answer must persist.
    const result = shouldLoad ? guidance.join('\n\n') : relevantPluginNote({ matches });
    if (publishedSize === delivered.size || (delivered.size === 0 && state.decision === null)) return result;
    publishedSize = delivered.size;
    try {
      await ports.publish({ state, plugins: [...delivered].map(([id, name]) => ({ id, name })) }, {});
    } catch {
      // Usage publication is advisory; losing its event must not discard resolved model guidance.
    }
    return result;
  }
  /** Share one queue between preflight, explicit reads and simultaneous guarded writes. */
  function enqueue(input: Parameters<typeof prepare>[0]): Promise<string> {
    const next = queue.then(() => prepare(input));
    queue = next.catch(() => undefined);
    return next;
  }
  return {
    /** Suggest relevant metadata for a query; capability calls load only their providers. */
    prepare: (input: { query?: string; capabilities?: readonly string[]; loaded?: readonly string[]; signal?: AbortSignal }, _options = {}) => enqueue(input),
    /** Resolve one active, permitted id and publish usage only after real guidance is read.
     * Returns an empty string for denied, unavailable, or already-delivered guidance.
     * @example await controller.load({ pluginId: 'my-plugin' });
     */
    load: (input: { pluginId: string; signal?: AbortSignal }, _options = {}) => enqueue(input),
  };
}
