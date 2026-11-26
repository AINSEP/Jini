import { createAutomaticAgentPluginUse, readChatAgentPluginState, type AutomaticAgentPluginPorts, type ChatAgentPluginState, type ChatAgentPlugins } from '../lifecycle/index.js';
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, optionalString, ToolInputError, type AgentToolDefinition, type Principal, type SurfaceEmitter, type ToolHandler } from '@jini-ai/core';
import type { AgentPluginGuidanceAttempt, AgentPluginGuidanceOffer, PrepareToolGuidance } from '@jini-ai/core/contracts/site/daemon';
import type { ChatDeleteSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import type { PluginMaturity } from '../lifecycle/host-tools/index.js';
import type { AgentPluginPreferencesPort } from './service-ports.js';
import type { AgentPluginWorkspaceLayout } from '@jini-ai/core/contracts/headless/plugin-host';

export interface AutomaticPluginDeps {
  workspaceId: string;
  preferences: Pick<AgentPluginPreferencesPort, 'mode' | 'snapshot' | 'saveAuto'>;
  siteTitleReady: Promise<void>;
  list: (required: Record<string, never>, optional?: Record<string, never>) => Promise<readonly (Awaited<ReturnType<AutomaticAgentPluginPorts['list']>>[number] & { maturity?: PluginMaturity | undefined })[]>;
  rank: (required: Parameters<AutomaticAgentPluginPorts['rank']>[0], optional: { automatic: true }) => ReturnType<AutomaticAgentPluginPorts['rank']>;
  resolve: AutomaticAgentPluginPorts['resolve'];
  formatPluginToolPointer: NonNullable<AutomaticAgentPluginPorts['formatPluginToolPointer']>;
  catalog: readonly AgentToolDefinition[];
  metadata: NonNullable<Parameters<typeof buildDomainRegistrations>[0]['metadata']>;
  derivedRisk: Parameters<typeof buildDomainRegistrations>[0]['derivedRisk'];
  catalogModule: string;
  copy: { preferenceBeforeAnswer: string; preferenceAfterAnswer: string; loadNotes: (required: { pluginId: string }) => Readonly<Record<string, string>> };
  warn: (error: unknown) => void;
}

/** The feature's consent port; the assistant supplies its principal-bound exchange adapter. */
export type AskAgentPluginChoice = (required: {
  surfaces: ChatDeleteSurfaceDeps; principalId: string; emitSurface: SurfaceEmitter; signal: AbortSignal;
  workspaceId: string; conversationId: string; preferenceRevisionSeq: number; selected: readonly string[];
  matches: Parameters<AutomaticAgentPluginPorts['ask']>[0]['matches'];
}, optional?: Record<string, never>) => ReturnType<AutomaticAgentPluginPorts['ask']>;

export interface AutomaticPluginRun {
  principal: Principal; conversationId: string; state: ChatAgentPluginState; query: string; pinned: readonly string[];
  signal: AbortSignal; emitSurface: SurfaceEmitter;
  maxPromptArgBytes?: number | undefined;
  publish(input: { conversationId: string; state: ChatAgentPluginState; plugins: readonly { id: string; name: string }[] }): Promise<void>;
}
type Entry = { turnId: string; controller: ReturnType<typeof createAutomaticAgentPluginUse>; context: AutomaticPluginRun; abort: AbortController; pending: boolean; preflight?: Promise<string> | undefined; attempts: Set<string>; offerIds: Map<string, string>; maturities: Map<string, PluginMaturity | undefined> };

  const chatKey = (context: AutomaticPluginRun) => JSON.stringify([context.principal.id, context.conversationId]);

  /** Release a detached, settled controller without deleting a replacement with the same id. O(1). */
  function releaseDetached(entry: Entry, turns: Map<string, Entry>): void {
    if (!entry.pending && !entry.attempts.size && turns.get(entry.turnId) === entry) turns.delete(entry.turnId);
  }

  /** Keep the successful turn snapshot across attempts; failed preparation remains retryable. */
  function preflight({ entry }: { entry: Entry }, _options = {}): Promise<string> {
    entry.preflight ??= entry.controller.prepare({ query: entry.context.query, loaded: entry.context.pinned,
      ...(entry.context.maxPromptArgBytes !== undefined && { maxPromptArgBytes: entry.context.maxPromptArgBytes }) })
      .catch(error => { entry.preflight = undefined; throw error; });
    return entry.preflight;
  }

  /** Fold a terminal attempt's late answer for this chat into the new turn, consuming it once. @complexity O(excluded). */
  function withLateAnswer({ context }: { context: AutomaticPluginRun }, lateAnswers: Map<string, ChatAgentPluginState>): AutomaticPluginRun {
    const lateAnswer = lateAnswers.get(chatKey(context));
    if (!lateAnswer) return context;
    lateAnswers.delete(chatKey(context));
    return { ...context, state: { ...lateAnswer, excluded: [...new Set([...context.state.excluded, ...lateAnswer.excluded])] } };
  }

  /** Attach a restarted attempt to its live turn's controller; refuses another principal, chat or turn.
   * @throws Error('Agent Plugin run is unavailable') on any identity mismatch. @complexity O(1). */
  function rejoin({ existing, runId, messageId, context }: { existing: Entry; runId: string; messageId?: string; context: AutomaticPluginRun }, { runs }: { runs: Map<string, Entry> }): Entry {
    if (existing.context.principal.id !== context.principal.id || existing.context.conversationId !== context.conversationId || (messageId !== undefined && existing.turnId !== messageId)) throw new Error('Agent Plugin run is unavailable');
    existing.context = context;
    existing.attempts.add(runId);
    runs.set(runId, existing);
    return existing;
  }

  type OfferLiveness = Parameters<ReturnType<typeof createAutomaticAgentPluginUse>['offer']>[0]['isAttemptLive'];
  const attemptKey = (scope: AgentPluginGuidanceAttempt) => JSON.stringify([scope.runId, scope.attempt, scope.principalId]);
function createPluginChoiceAsk({ deps, surfaces, askAgentPluginChoice, context, abort }: Parameters<typeof createScopedAutomaticPluginRuns>[0] & { context: AutomaticPluginRun; abort: AbortController }, { getEntry, approve }: { getEntry: () => Entry; approve: (revisionSeq: number) => void }): AutomaticAgentPluginPorts['ask'] {
  return async ({ matches }) => {
        const entry = getEntry();
        entry.pending = true;
        try {
          const preference = await deps.preferences.snapshot({ workspaceId: deps.workspaceId, principalId: context.principal.id });
          if (preference.mode !== 'ask') throw new ToolInputError({ message: deps.copy.preferenceBeforeAnswer });
          const answer = await askAgentPluginChoice({ surfaces, principalId: context.principal.id,
            workspaceId: deps.workspaceId, conversationId: context.conversationId, preferenceRevisionSeq: preference.revisionSeq,
            selected: context.state.decision?.selected ?? [],
            // A retry can replace this attempt while the card is open; its receipt belongs to the
            // current transcript emitter, just like the later plugin-state publication below.
            emitSurface: async emission => {
              // Detached turns already hand late consent to the next turn below. A terminal
              // lifecycle refuses emissions; recording must not turn that valid consent into an error.
              if (emission.channel === 'user_message' && !entry.attempts.size) return;
              await entry.context.emitSurface(emission);
            }, signal: abort.signal, matches });
          if (answer.action !== 'skip') {
            const current = await deps.preferences.snapshot({ workspaceId: deps.workspaceId, principalId: context.principal.id });
            if (current.mode !== preference.mode || current.revisionSeq !== preference.revisionSeq) throw new ToolInputError({ message: deps.copy.preferenceAfterAnswer });
            approve(preference.revisionSeq);
          }
          return answer;
        } catch (error) {
          // Preflight callers keep the turn running after a failed choice. Preserve the domain's
          // person-facing refusal in the transcript; raw provider/filesystem errors stay private.
          if (error instanceof ToolInputError) await entry.context.emitSurface({ channel: 'text_delta', payload: { delta: `\n\n${error.message}\n\n` } });
          throw error;
        } finally { entry.pending = false; }
      };
}


/** The automatic resolver port: rechecks activation and trust on every read. Off plugins are read
 * only when Jini's explicit loader asks with `allowInactiveGuidance`; automatic delivery omits it,
 * so a plugin switched off after ranking is never inlined. Read-only setup guidance is not activation,
 * authorization or delivery. O(1) plus one resolver read.
 */
export function bindAutomaticGuidanceResolver<Layout extends Pick<AgentPluginWorkspaceLayout, 'packages' | 'root'>>(
  { workspaceLayout, resolveGuidance }: { workspaceLayout: Layout; resolveGuidance: (required: { pluginRefIds: readonly string[]; workspaceLayout: Layout }, optional: Omit<Parameters<AutomaticAgentPluginPorts['resolve']>[0], 'pluginId'> & { deliveryMode: 'inject'; allowInactiveGuidance: boolean }) => ReturnType<AutomaticAgentPluginPorts['resolve']> },
  _optional = {},
): AutomaticAgentPluginPorts['resolve'] {
  return ({ pluginId, ...request }, { allowInactiveGuidance = false } = {}) => resolveGuidance(
    { pluginRefIds: [pluginId], workspaceLayout },
    { ...request, deliveryMode: 'inject', allowInactiveGuidance },
  );
}

  /** One logical turn's controller wired to the existing catalog, resolver, consent card and settings ports. */
  function createEntry({ mode, context, turnId, runId }: { mode: ChatAgentPlugins; context: AutomaticPluginRun; turnId: string; runId: string }, { deps, surfaces, askAgentPluginChoice, lateAnswers }: Parameters<typeof createScopedAutomaticPluginRuns>[0] & { lateAnswers: Map<string, ChatAgentPluginState> }): Entry {
    const abort = new AbortController();
    const maturities = new Map<string, PluginMaturity | undefined>();
    let approvedPreferenceRevisionSeq: number | undefined;
    let entry: Entry;
    const controller = createAutomaticAgentPluginUse({ mode, state: readChatAgentPluginState({ value: context.state }), ports: {
      formatPluginToolPointer: deps.formatPluginToolPointer,
      list: async () => {
        const candidates = await deps.list({});
        maturities.clear();
        for (const candidate of candidates) if (candidate.enabled) maturities.set(candidate.pluginId, candidate.maturity);
        return candidates;
      },
      rank: (input) => deps.rank({ query: input.query.slice(0, 16000), candidates: input.candidates, limit: input.limit }, { automatic: true }),
      resolve: deps.resolveForEntry({ workspaceId: deps.workspaceId }),
      ask: createPluginChoiceAsk({ deps, surfaces, askAgentPluginChoice, context, abort }, { getEntry: () => entry, approve: revisionSeq => { approvedPreferenceRevisionSeq = revisionSeq; } }),
      saveAuto: () => deps.preferences.saveAuto({ workspaceId: deps.workspaceId, principalId: context.principal.id,
        ...(approvedPreferenceRevisionSeq !== undefined && { expectedRevisionSeq: approvedPreferenceRevisionSeq }) }),
      publish: async value => {
        if (abort.signal.aborted) return;
        if (!entry.attempts.size) lateAnswers.set(chatKey(context), value.state);
        await entry.context.publish({ conversationId: context.conversationId, ...value });
      },
    } });
    entry = { turnId, controller, context, abort, pending: false, attempts: new Set([runId]), maturities, offerIds: new Map() };
    return entry;
  }
  // Existing per-plugin tools read their boot-time source, not the run's consent/exclusion owner.
  // This small id loader uses the SAME trusted pinned-ref resolver as the capability backstop.
  

function buildPluginGuidanceRegistration({ runs, turns, deps }: { runs: Map<string, Entry>; turns: Map<string, Entry>; deps: Parameters<typeof createScopedAutomaticPluginRuns>[0]['deps'] }, _optional = {}) {
  return buildDomainRegistrations({
    domain: 'agent-plugin-guidance', catalogModule: deps.catalogModule,
    catalog: indexCatalogById({ catalog: deps.catalog }),
    metadata: deps.metadata,
    derivedRisk: deps.derivedRisk,
    handlers: { load_agent_plugin: context => loadPluginGuidance(context, { runs, turns, deps }) },
  })[0];
}



async function loadPluginGuidance({ input: raw, run, principal, signal }: Parameters<ToolHandler>[0], { runs, turns, deps }: { runs: Map<string, Entry>; turns: Map<string, Entry>; deps: Parameters<typeof createScopedAutomaticPluginRuns>[0]['deps'] }) {
      const input = requireInputRecord({ input: raw });
      const pluginId = requireString({ input, key: 'pluginId' });
      if (Object.keys(input).some(key => !['pluginId', 'skill', 'file'].includes(key))) throw new ToolInputError({ message: 'Only pluginId, skill and file are accepted' });
      const skill = optionalString({ input, key: 'skill' });
      const file = optionalString({ input, key: 'file' });
      const entry = runs.get(run.id);
      if (!entry || entry.context.principal.id !== principal.id) throw new Error('Agent Plugin run is unavailable');
      const result = await entry.controller.load({ pluginId, signal, ...(skill === undefined ? {} : { skill }), ...(file === undefined ? {} : { file }) }).finally(() => releaseDetached(entry, turns));
      const notes = deps.copy.loadNotes({ pluginId });
      const maturity = entry.maturities.get(pluginId);
      return { pluginId, ...result, ...(maturity ? { maturity } : {}), ...(result.status !== 'loaded' ? { note: notes[result.status] } : {}) };
    }

  /** Bind an attempt to its logical turn; return its shared preflight note. Identity mismatches
   * throw before using consent. Settings/catalog effects stay in their existing ports.
   * @complexity O(1) ownership lookup plus the automatic-use owner's catalog work.
   */
  async function bind({ runId, messageId, context }: { runId: string; messageId?: string | undefined; context: AutomaticPluginRun }, state: { deps: Parameters<typeof createScopedAutomaticPluginRuns>[0]['deps']; surfaces: ChatDeleteSurfaceDeps; askAgentPluginChoice: AskAgentPluginChoice; runs: Map<string, Entry>; turns: Map<string, Entry>; lateAnswers: Map<string, ChatAgentPluginState> }): Promise<Entry | undefined> {
    const { deps, surfaces, askAgentPluginChoice, runs, turns, lateAnswers } = state;
    // core.interface definitions are in this existing boot chain, after the UI-tab definitions.
    await deps.siteTitleReady;
    const mode = await deps.preferences.mode({ workspaceId: deps.workspaceId, principalId: context.principal.id });
    if (context.signal.aborted) return undefined;
    // A restarted attempt still owns the same pending/answered question. Reuse the controller's
    // serialized preparation instead of rebuilding consent from the frozen request state.
    // Check after setup awaits so simultaneous starts cannot replace one another's controller.
    const turnId = messageId ?? runId;
    const existing = runs.get(runId) ?? turns.get(turnId);
    if (existing) return rejoin({ existing, runId, ...(messageId === undefined ? {} : { messageId }), context }, { runs });
    const current = withLateAnswer({ context }, lateAnswers);
    const entry = createEntry({ mode, context: current, turnId, runId }, { deps, surfaces, askAgentPluginChoice, lateAnswers });
    turns.set(turnId, entry);
    runs.set(runId, entry);
    // An Off event clears an earlier usage strip without reading the catalog or loading guidance.
    if (mode === 'off') {
      try { await current.publish({ conversationId: current.conversationId, state: current.state, plugins: [] }); }
      catch (error) { releaseDetached(entry, turns); throw error; }
    }
    return entry;
  }

  async function start({ runId, messageId, context }: { runId: string; messageId?: string; context: AutomaticPluginRun }, state: { deps: Parameters<typeof createScopedAutomaticPluginRuns>[0]['deps']; surfaces: ChatDeleteSurfaceDeps; askAgentPluginChoice: AskAgentPluginChoice; runs: Map<string, Entry>; turns: Map<string, Entry>; lateAnswers: Map<string, ChatAgentPluginState> }): Promise<string> {
    const { turns } = state;
    const entry = await bind({ runId, messageId, context }, state);
    if (!entry) return '';
    try { return await preflight({ entry }); }
    finally { releaseDetached(entry, turns); }
  }

  /** Draft guidance for one live attempt without recording delivery. Ownership (principal, chat,
   * turn) binds exactly as `start` does; the host owns the attempt scope, offer id and liveness.
   * The first successful offer id is cached per attempt, so a repeated offer cannot re-key a receipt;
   * a replacement attempt has another key and never inherits it. @complexity O(1) plus the owner's draft.
   */
  async function offer({ runId, messageId, context, scope, offerId, isAttemptLive }: { runId: string; messageId?: string | undefined; context: AutomaticPluginRun; scope: AgentPluginGuidanceAttempt; offerId: string; isAttemptLive: OfferLiveness }, state: { deps: Parameters<typeof createScopedAutomaticPluginRuns>[0]['deps']; surfaces: ChatDeleteSurfaceDeps; askAgentPluginChoice: AskAgentPluginChoice; runs: Map<string, Entry>; turns: Map<string, Entry>; lateAnswers: Map<string, ChatAgentPluginState> }): Promise<AgentPluginGuidanceOffer> {
    const { turns } = state;
    if (scope.runId !== runId || scope.principalId !== context.principal.id) throw new Error('Agent Plugin run is unavailable');
    const entry = await bind({ runId, messageId, context }, state);
    if (!entry) throw new Error('Agent Plugin preparation was cancelled');
    const key = attemptKey(scope);
    try {
      const drafted = await entry.controller.offer({ scope, offerId: entry.offerIds.get(key) ?? offerId, isAttemptLive, input: { query: context.query, loaded: context.pinned, signal: context.signal } });
      entry.offerIds.set(key, drafted.offerId);
      return drafted;
    } finally { releaseDetached(entry, turns); }
  }

  /** Record the delivered ids of this attempt's offer. Only a live alias of the same principal may
   * commit; Jini refuses a retired, replaced or older attempt and replays a same-choice receipt. */
  async function commit({ scope, offerId, deliveredIds }: { scope: AgentPluginGuidanceAttempt; offerId: string; deliveredIds: readonly string[] }, { signal }: { signal?: AbortSignal | undefined } = {}, { runs, turns }: { deps: Parameters<typeof createScopedAutomaticPluginRuns>[0]['deps']; surfaces: ChatDeleteSurfaceDeps; askAgentPluginChoice: AskAgentPluginChoice; runs: Map<string, Entry>; turns: Map<string, Entry>; lateAnswers: Map<string, ChatAgentPluginState> }): Promise<{ readonly guidanceIds: readonly string[] }> {
    const entry = runs.get(scope.runId);
    if (!entry || entry.context.principal.id !== scope.principalId) throw new Error('Agent Plugin run is unavailable');
    try { return await entry.controller.commit({ scope, offerId, deliveredIds }, signal ? { signal } : {}); }
    finally { releaseDetached(entry, turns); }
  }

  async function prepareGuidance({ run, tool, signal }: Parameters<PrepareToolGuidance>[0], { runs, turns, deps }: { deps: Parameters<typeof createScopedAutomaticPluginRuns>[0]['deps']; surfaces: ChatDeleteSurfaceDeps; askAgentPluginChoice: AskAgentPluginChoice; runs: Map<string, Entry>; turns: Map<string, Entry>; lateAnswers: Map<string, ChatAgentPluginState> }): Promise<string> {
    const entry = runs.get(run.id);
    if (!entry) return '';
    try { return await entry.controller.prepare({ ...(tool.metadata?.guidanceCapabilities ? { capabilities: tool.metadata.guidanceCapabilities } : {}), signal }); }
    catch (error) { deps.warn(error); return ''; }
    finally { releaseDetached(entry, turns); }
  }

  /** Dispose an attempt alias. Durable attempt replacement retains a pending exchange until its
   * answer/normal exchange expiry; explicit disposal aborts it. O(1), no persistent writes.
   */
  function forget({ runId }: { runId: string }, { preservePending = false } = {}, { runs, turns }: { deps: Parameters<typeof createScopedAutomaticPluginRuns>[0]['deps']; surfaces: ChatDeleteSurfaceDeps; askAgentPluginChoice: AskAgentPluginChoice; runs: Map<string, Entry>; turns: Map<string, Entry>; lateAnswers: Map<string, ChatAgentPluginState> }): void {
    const entry = runs.get(runId);
    if (!entry) return;
    runs.delete(runId);
    entry.attempts.delete(runId);
    if (entry.attempts.size || (preservePending && entry.pending)) return;
    entry.abort.abort();
    if (turns.get(entry.turnId) === entry) turns.delete(entry.turnId);
  }
/** Logical-turn controllers share preflight and the actual authorized tool gate. Cleanup is explicit.
 * @returns start/forget, the read-only guidance loader and the tool preparation hook.
 * @complexity O(1) identity lookup; one controller per live turn, one late answer per chat.
 */
export function createScopedAutomaticPluginRuns({ deps, surfaces, askAgentPluginChoice }: { deps: Omit<AutomaticPluginDeps, 'resolve'> & { resolveForEntry(required: { workspaceId: string }): AutomaticPluginDeps['resolve'] }; surfaces: ChatDeleteSurfaceDeps; askAgentPluginChoice: AskAgentPluginChoice }, _options = {}) {
  const turns = new Map<string, Entry>();
  const runs = new Map<string, Entry>();
  // A terminal attempt cannot publish its late answer. Hand it to the next turn in this chat.
  const lateAnswers = new Map<string, ChatAgentPluginState>();
  const state = { deps, surfaces, askAgentPluginChoice, runs, turns, lateAnswers };
  const loadRegistration = buildPluginGuidanceRegistration({ runs, turns, deps });
  if (loadRegistration === undefined) throw new Error('Agent Plugin guidance has no load tool registration');
  return {
    start: (input: Parameters<typeof start>[0], _optional = {}) => start(input, state),
    offer: (input: Parameters<typeof offer>[0], _optional = {}) => offer(input, state),
    commit: (input: Parameters<typeof commit>[0], optional: Parameters<typeof commit>[1] = {}) => commit(input, optional, state),
    prepareGuidance: (input: Parameters<PrepareToolGuidance>[0]) => prepareGuidance(input, state),
    loadRegistration,
    forget: (input: Parameters<typeof forget>[0], optional: Parameters<typeof forget>[1] = {}) => forget(input, optional, state),
    guidanceIds: ({ runId }: { runId: string }, _optional = {}) => runs.get(runId)?.controller.guidanceIds({}) ?? [],
  };
}

export function createAutomaticPluginRuns({ deps, surfaces, askAgentPluginChoice }: { deps: AutomaticPluginDeps; surfaces: ChatDeleteSurfaceDeps; askAgentPluginChoice: AskAgentPluginChoice }, _options = {}) {
  return createScopedAutomaticPluginRuns({ deps: { ...deps, resolveForEntry: () => deps.resolve }, surfaces, askAgentPluginChoice });
}
