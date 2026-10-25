import { concreteModelOptions } from './core/model-discovery-shared.js';
import { defaultRuntimeState, type AgentRuntimeState } from './runtime-state.js';
/**
 * @module models
 * Model-option defaults, a per-agent last-surfaced live-model cache and model-id sanitization.
 */
import type { DetectedAgent, RuntimeAgentDef, RuntimeModelOption } from './types.js';

type SelectableAgent = Pick<DetectedAgent, 'id' | 'available' | 'models' | 'modelsSource' | 'reasoningOptions' | 'reasoningInModelId' | 'authStatus' | 'supportsConcreteModelSelection' | 'defaultModelResolution'>;
type SelectionRequest = { agent: SelectableAgent; agentId: string; modelId?: string | undefined; effort?: string | undefined };

/** Refusal for an agent that cannot take this pick at all, before any model lookup. */
function agentReadinessRefusal({ agent, agentId, modelId, effort }: SelectionRequest): string | null {
  // Executable presence is not credential readiness; unknown/unprobed auth fails closed.
  if (agent.authStatus !== 'ok') return `Credentials for '${agentId}' are not ready (${agent.authStatus ?? 'unverified'}). Sign in and rescan the chat picker.`;
  if (agent.supportsConcreteModelSelection === false) return `Agent '${agentId}' cannot pin a concrete starting model.`;
  // A detector's static fallback is useful for display, but is not live evidence of a valid pick.
  if ((modelId || effort) && agent.modelsSource !== 'live') return `Live model catalog for '${agentId}' is unavailable. Rescan the chat picker before choosing a model or effort.`;
  return null;
}

/** The concrete id a pick launches: the explicit model, else the resolved default (if any). */
function selectedModelId({ agent, modelId }: { agent: SelectableAgent; modelId?: string | undefined }): string | undefined {
  if (modelId && modelId !== 'default') return modelId;
  const resolution = agent.defaultModelResolution;
  return resolution?.status === 'resolved' ? resolution.id : undefined;
}

/** Refusal for an unknown model, or an effort the selected model does not offer. */
function modelAndEffortRefusal({ agent, agentId, modelId, effort }: SelectionRequest): string | null {
  const choices = concreteModelOptions(agent);
  const resolvedId = selectedModelId({ agent, modelId });
  const model = choices.find(candidate => candidate.id === resolvedId);
  if (modelId && modelId !== 'default' && !model) return `Unknown model '${modelId}' for '${agentId}'. Available models: ${choices.map(candidate => candidate.id).join(', ')}.`;
  if (!effort) return null;
  // Default must resolve before checking model-specific effort; agent-wide levels can differ.
  if (!model) return `Default model for '${agentId}' is unresolved. Pick a concrete model before choosing effort.`;
  // Suffix-based runtimes own effort in the model id; a second effort setting would disagree.
  const levels = agent.reasoningInModelId ? [] : model.reasoning ?? agent.reasoningOptions ?? [];
  if (!levels.some(candidate => candidate.id === effort)) return `Unknown effort '${effort}' for '${agentId}'. Available effort levels: ${levels.map(candidate => candidate.id).join(', ')} (empty means Default).`;
  return null;
}

/** Validate an explicit selection against the same discovered inventory the picker displays.
 * Empty model/effort means the runtime default. Refusals include the current choices rather
 * than silently substituting a different model. Pure; O(agents + models + effort options).
 * @example validateRuntimeSelection({ agents, agentId: 'runtime', modelId: 'catalog-model' });
 */
export function validateRuntimeSelection({ agents, agentId, modelId, effort }: {
  agents: readonly SelectableAgent[];
  agentId: string;
  modelId?: string;
  effort?: string;
}, _options = {}): string | null {
  const agent = agents.find(candidate => candidate.id === agentId && candidate.available);
  if (!agent) return `Unknown or unavailable agent '${agentId}'. Available agents: ${agents.filter(candidate => candidate.available).map(candidate => candidate.id).join(', ')}.`;
  const request = { agent, agentId, modelId, effort };
  return agentReadinessRefusal(request) ?? modelAndEffortRefusal(request);
}

export const DEFAULT_MODEL_OPTION: RuntimeModelOption = {
  id: 'default',
  label: 'Default (CLI config)',
};

// A host's chat endpoint needs to validate the user's model pick against
// the list last surfaced to the UI. We keep a per-agent cache of the most
// recent live list (refreshed every detectAgents() call) and additionally
// trust any value present in the static fallback. A model that's neither
// gets rejected so a stale or hostile value can't smuggle arbitrary flags.
// Host state carries these maps; legacy callers use defaultRuntimeState.

function liveModelCacheKey(agentId: string, scope?: string | null): string {
  const trimmedScope = typeof scope === 'string' ? scope.trim() : '';
  return trimmedScope ? `${agentId}\0${trimmedScope}` : agentId;
}

export function rememberLiveModels({ agentId, models }: { agentId: string; models: RuntimeModelOption[] }, { scope, state = defaultRuntimeState }: { scope?: string | null; state?: AgentRuntimeState } = {}) {
  if (!Array.isArray(models)) return;
  const ids = models
    .map((m) => m && m.id)
    .filter((id): id is string => typeof id === 'string');
  const key = liveModelCacheKey(agentId, scope);
  state.liveModelCache.set(key, new Set(ids));
  state.liveModelOrder.set(key, ids);
}

export function getRememberedLiveModels({ agentId }: { agentId: string }, { scope, state = defaultRuntimeState }: { scope?: string | null; state?: AgentRuntimeState } = {}): RuntimeModelOption[] {
  const ids = state.liveModelOrder.get(liveModelCacheKey(agentId, scope)) ?? [];
  return ids.map((id) => ({ id, label: id }));
}

export function preferFreshLiveModels({ freshModels, rememberedModels }: { freshModels: RuntimeModelOption[]; rememberedModels: RuntimeModelOption[] }
): RuntimeModelOption[] {
  return freshModels.length > 0 ? freshModels : rememberedModels;
}

export function isKnownModel({ def, modelId }: { def: RuntimeAgentDef; modelId: string | null | undefined }, { scope, state = defaultRuntimeState }: { scope?: string | null; state?: AgentRuntimeState } = {}
) {
  if (!modelId) return false;
  const live = state.liveModelCache.get(liveModelCacheKey(def.id, scope));
  if (live && live.has(modelId)) return true;
  if (Array.isArray(def.fallbackModels)) {
    return def.fallbackModels.some((m) => m.id === modelId);
  }
  return false;
}

// Host-process env override. Lets an operator pin a different fallback
// id without a code change when the hardcoded default goes away
// upstream.
function envDefaultModel({ def, env }: { def: RuntimeAgentDef; env: Record<string, string | undefined> }): string | undefined {
  if (!def.defaultModelEnvVar) return undefined;
  const raw = env[def.defaultModelEnvVar];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

// `def` omits 'default' from its fallbacks: first remembered live id, else the first concrete
// fallback id, else `resolved` unchanged. Defs that list 'default' return `resolved` untouched.
function concreteFallbackModel({ def, resolved, state }: { def: RuntimeAgentDef; resolved: string | null; state: AgentRuntimeState }, { liveModelScope }: { liveModelScope?: string | null | undefined } = {}): string | null {
  // `def.fallbackModels` is typed `RuntimeModelOption[]` (never optional/non-array) and every
  // entry is a well-formed object — no defensive Array.isArray/truthy-entry guard needed for a
  // state the type system already excludes (CR-R7).
  const fallbacks = def.fallbackModels;
  if (fallbacks.some((m) => m.id === 'default')) return resolved;
  const liveModels = state.liveModelOrder.get(liveModelCacheKey(def.id, liveModelScope)) ?? [];
  const firstLive = liveModels[0];
  if (firstLive) return firstLive;
  if (fallbacks.length === 0) return resolved;
  return fallbacks[0]!.id;
}

// Some adapters reject the synthetic `'default'` model id (they require an
// explicit model-selection call before the first prompt). Those defs
// declare it by omitting DEFAULT_MODEL_OPTION from `fallbackModels`
// entirely. When the chat run produces a null or 'default' model for one
// of those adapters, prefer the first model from the live list last
// surfaced to the UI, then fall back to the def's first concrete fallback
// id so the spawn layer always has a real model to forward. Defs that DO
// list 'default' (the common case) are left untouched.
export function resolveModelForAgent({ def, resolved }: { def: RuntimeAgentDef; resolved: string | null }, { env = process.env, liveModelScope, state = defaultRuntimeState }: { env?: Record<string, string | undefined>; liveModelScope?: string | null; state?: AgentRuntimeState } = {}
): string | null {
  if (resolved && resolved !== 'default') return resolved;
  return envDefaultModel({ def, env }) ?? concreteFallbackModel({ def, resolved, state }, { liveModelScope });
}

// Permit user-typed model ids that didn't appear in either the live
// listing or the static fallback (e.g. the user is on a brand-new model
// the CLI's `models` command hasn't surfaced yet). The CLI gets the value
// as a child-process arg — not a shell string — so injection isn't a
// concern, but we still reject anything that could be misread as a flag
// by a downstream CLI or that contains whitespace / control chars.
export function sanitizeCustomModel({ id }: { id: string | null | undefined }) {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  // Catalog capability variants (e.g. Claude's [1m] context window) are native model IDs.
  // argv is never a shell string; keep the existing leading-flag/whitespace/control guards.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@\[\]-]*$/.test(trimmed)) return null;
  return trimmed;
}
