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
  const more = (remaining: number) => remaining ? `\n+${remaining} more relevant: search_agent_plugin_local({ query: <same request>, offset: 0 }); page with nextOffset` : '';
  const lines: string[] = [];
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  for (const match of matches) {
    const { id, name, why } = describeMatch({ plugin: match });
    const line = `${name} (${id}) — ${why}`;
    if (bytes(header + [...lines, line].join('\n') + more(matches.length - lines.length - 1) + footer) > 600) break;
    lines.push(line);
  }
  return header + lines.join('\n') + more(matches.length - lines.length) + footer;
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

type PrepareInput = { query?: string; pluginId?: string; capabilities?: readonly string[]; loaded?: readonly string[]; signal?: AbortSignal };

/** An explicit id or a guarded capability admits its providers outright; a query is ranked for relevance. */
function rankCandidates(
  { candidates, input, ports }: { candidates: readonly AgentPluginSearchCandidate[]; input: PrepareInput; ports: AutomaticAgentPluginPorts },
  _options = {},
): readonly AgentPluginSearchMatch[] {
  const { pluginId, capabilities } = input;
  const admit = (plugins: readonly AgentPluginSearchCandidate[]) => plugins.map(plugin => ({ ...plugin, score: 4 }));
  if (pluginId !== undefined) return admit(candidates.filter(plugin => plugin.pluginId === pluginId));
  if (capabilities) return admit(candidates.filter(plugin => plugin.provides?.some(capability => capabilities.includes(capability))));
  return ports.rank({ query: input.query ?? '', candidates, limit: candidates.length }, {});
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

  /** Ask mode admits only consented matches; the first non-empty match set asks the person once. */
  async function applyConsent({ matches }: { matches: AgentPluginSearchMatch[] }, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<AgentPluginSearchMatch[]> {
    if (mode !== 'ask') return matches;
    const { decision } = state;
    if (decision === null || decision.asked === false) return matches.length ? askConsent({ matches }, { signal }) : matches;
    // Consent survives cold runs; relevance still comes from this request or write capability.
    // Later matches do not inherit consent, and exclusions were applied before ranking.
    return matches.filter(plugin => decision.selected.includes(plugin.pluginId));
  }
  async function askConsent({ matches }: { matches: AgentPluginSearchMatch[] }, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<AgentPluginSearchMatch[]> {
    const offered = matches.map(plugin => describeMatch({ plugin }));
    const answer = await ports.ask({ matches: offered, ...(signal ? { signal } : {}) }, {});
    const selected = answer.action === 'skip' ? [] : answer.selected.filter(id => matches.some(plugin => plugin.pluginId === id));
    state = { decision: { selected, asked: true }, excluded: [...new Set([...state.excluded, ...matches.filter(plugin => !selected.includes(plugin.pluginId)).map(plugin => plugin.pluginId)])] };
    if (answer.action === 'auto') { await ports.saveAuto({}, {}); mode = 'auto'; }
    // Consent changes only this person's preference, never a workspace default.
    return matches.filter(plugin => selected.includes(plugin.pluginId));
  }
  async function resolveGuidance({ matches }: { matches: readonly AgentPluginSearchMatch[] }, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<string[]> {
    const guidance: string[] = [];
    for (const match of matches) {
      if (signal?.aborted) break;
      try {
        const text = await ports.resolve({ pluginId: match.pluginId }, {});
        if (!text.trim()) continue;
        delivered.set(match.pluginId, match.displayName ?? match.pluginId);
        guidance.push(text);
      } catch {
        // Automatic guidance is advisory; unavailable plugins must not block the run.
      }
    }
    return guidance;
  }
  /** Auto mode records everything delivered as selected, keeping any earlier selection and asked flag. */
  function rememberAutoSelection(): void {
    if (mode !== 'auto' || !delivered.size) return;
    const { decision } = state;
    state = { ...state, decision: { selected: [...new Set([...(decision?.selected ?? []), ...delivered.keys()])], asked: decision?.asked ?? false } };
  }
  /** Initialize usage after a decision (including Skip), then publish only loaded-set changes.
   * Empty discovery must not consume that initial publication: a later Ask answer must persist.
   */
  async function publishUsage(): Promise<void> {
    if (publishedSize === delivered.size || (delivered.size === 0 && state.decision === null)) return;
    publishedSize = delivered.size;
    try {
      await ports.publish({ state, plugins: [...delivered].map(([id, name]) => ({ id, name })) }, {});
    } catch {
      // Usage publication is advisory; losing its event must not discard resolved model guidance.
    }
  }
  /** Query preflight suggests; only an explicit id or guarded capability resolves guidance.
   * Effects serialize with loads so a suggestion never consumes a backstop's delivery.
   */
  async function prepare(input: PrepareInput): Promise<string> {
    if (mode === 'off' || input.signal?.aborted) return '';
    for (const id of input.loaded ?? []) alreadyLoaded.add(id);
    const candidates = (await ports.list({}, {})).filter(plugin => plugin.enabled && !state.excluded.includes(plugin.pluginId));
    const ranked = rankCandidates({ candidates, input, ports });
    // Owner decision 2026-10-18: no per-chat plugin count; the relevance threshold and vendor gate decide.
    const relevant = ranked.filter(plugin => !delivered.has(plugin.pluginId) && !alreadyLoaded.has(plugin.pluginId));
    const matches = await applyConsent({ matches: relevant }, { signal: input.signal });
    // Relevance is disclosure, never evidence that the model has read any guidance.
    const shouldLoad = input.pluginId !== undefined || !!input.capabilities?.length;
    const result = shouldLoad ? (await resolveGuidance({ matches }, { signal: input.signal })).join('\n\n') : relevantPluginNote({ matches });
    rememberAutoSelection();
    await publishUsage();
    return result;
  }
  /** Share one queue between preflight, explicit reads and simultaneous guarded writes. */
  function enqueue(input: PrepareInput): Promise<string> {
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
