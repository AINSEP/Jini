import { useCallback, useEffect } from 'react';
import { CUSTOM_MODEL_SENTINEL } from '../../constants.js';
import {
  modelIdForReasoningLevel,
  reasoningModelGroupFor,
  reasoningModelGroups,
  selectedAgentModel,
  selectedAgentReasoning,
  shouldShowCustomModelInput,
  splitReasoningModelId,
} from '../../rules.js';
import type {
  AgentModelOption,
  DetectedAgent,
  LocalCliConfig,
  ReasoningModelGroup,
} from '../../types.js';

export interface UseReasoningControlOptions {
  agent: DetectedAgent;
  config: LocalCliConfig;
  explicitCustomMode?: boolean | undefined;
  /**
   * Notified with `''` when the resolved model's reasoning-effort options no longer include the
   * operator's previously persisted per-agent pick (`config.reasoningByAgentId[agent.id]`) — e.g.
   * switching from a model that supports `xhigh` to one that tops out at `high`. Wire this to
   * `onReasoningChange(agent.id, next)` so the stale value is actually cleared from persisted config,
   * not just patched over at render time: `selectedAgentReasoning` (`rules.ts`) is a public rule a
   * host's dispatch code may call directly, so a value corrected only inside this hook's derived
   * `reasoningValue` could still leak an unsupported id into the CLI invocation.
   *
   * Never invoked on the `reasoningInModelId` path — that shape has no reasoning value of its own to
   * clear; the level lives inside the model id itself, and picking a new base model already replaces
   * it (`resolveNextModelId`). Omitted means nothing is auto-cleared, matching this hook's behavior
   * before per-model narrowing existed.
   */
  onReasoningChange?: ((next: string) => void) | undefined;
}

export interface UseReasoningControlResult {
  /** The agent's model list, or empty array if not defined. */
  models: readonly AgentModelOption[];
  /** Whether the agent has any models defined. */
  hasModels: boolean;
  /** The model that will run, with fallback to first model or empty string. */
  resolvedModel: string;
  /** The raw model string configured for this agent in `config.modelByAgentId`. */
  rawModel: string;
  /** Vocabulary of suffix levels declared in `agent.reasoningInModelId.levels`. */
  suffixLevels: readonly AgentModelOption[];
  /** IDs of the suffix levels. */
  suffixLevelIds: readonly string[];
  /** Model groups when `reasoningInModelId` is declared, or `null` otherwise. */
  modelGroups: readonly ReasoningModelGroup[] | null;
  /** Active group corresponding to the resolved model, or `null`. */
  activeGroup: ReasoningModelGroup | null;
  /** Active effort level split from the resolved model, or `null`. */
  activeLevel: string | null;
  /** Flat reasoning options declared in `agent.reasoningOptions`. */
  flatReasoningOptions: readonly AgentModelOption[];
  /** Effort options to render in the reasoning dropdown: either flat options or the active group's levels. */
  reasoningOptions: readonly AgentModelOption[];
  /** Whether reasoning effort controls should be displayed. */
  hasReasoning: boolean;
  /** Current value for the reasoning select input. */
  reasoningValue: string;
  /** Whether the reasoning select should be disabled (e.g. single-variant base model). */
  reasoningDisabled: boolean;
  /** Whether custom model free-text input is supported. */
  allowCustomModel: boolean;
  /** Known model IDs in the agent's catalog. */
  knownModelIds: readonly string[];
  /** Whether the custom model input is currently active. */
  customActive: boolean;
  /** Options for the model select: base models for suffix agents, or raw models list. */
  modelChoices: readonly AgentModelOption[];
  /** Selected value for the model select element. */
  selectValue: string;
  /** Display value for the custom model text input. */
  customModelInputValue: string;
  /**
   * Resolves the next full model ID when the base model selection changes.
   * For model-suffix agents, carries over the active level if supported by the new base,
   * or falls back to a valid level for the target group.
   */
  resolveNextModelId: (nextValue: string) => string;
  /**
   * Resolves the full model ID when a reasoning level is selected for a model-suffix agent.
   * Returns `null` if the agent does not use suffix-in-model-id reasoning.
   */
  resolveReasoningModelId: (level: string) => string | null;
}

/**
 * Orchestrates reasoning-effort and model selection derivation for a local CLI agent.
 *
 * Supports two distinct reasoning shapes:
 * 1. `reasoningOptions` — Flat vocabulary sent via dedicated CLI flags (`--effort high`).
 *    Persisted independently via `onReasoningChange`.
 * 2. `reasoningInModelId` — Effort level is encoded as a model slug suffix (`gemini-3.1-pro-high`).
 *    The selection is recombined into the model ID itself via `onModelChange`, with base model
 *    and effort levels derived from the agent's model catalog via `reasoningModelGroups`.
 */
export function useReasoningControl(options: UseReasoningControlOptions): UseReasoningControlResult;
export function useReasoningControl(
  agent: DetectedAgent,
  config: LocalCliConfig,
  explicitCustomMode?: boolean,
): UseReasoningControlResult;
export function useReasoningControl(
  optionsOrAgent: UseReasoningControlOptions | DetectedAgent,
  maybeConfig?: LocalCliConfig,
  maybeExplicitCustomMode?: boolean,
): UseReasoningControlResult {
  const { agent, config, explicitCustomMode = false, onReasoningChange }: UseReasoningControlOptions =
    'agent' in optionsOrAgent && 'config' in optionsOrAgent
      ? optionsOrAgent
      : {
          agent: optionsOrAgent as DetectedAgent,
          config: maybeConfig!,
          explicitCustomMode: maybeExplicitCustomMode ?? false,
        };

  const models = agent.models ?? [];
  const hasModels = models.length > 0;
  const resolvedModel = selectedAgentModel(config, agent);
  const rawModel = config.modelByAgentId?.[agent.id] ?? '';

  // Two ways an agent can expose a reasoning-effort axis, and the card branches on the DECLARATION
  // rather than on the agent's id — adding a third runtime with either shape is a def change, not
  // an edit here.
  //
  //   `reasoningOptions`     — one flat vocabulary that travels to the CLI as its own flag
  //                            (`claude --effort high`, codex's `-c model_reasoning_effort=...`).
  //                            The choice is its own persisted value; `onReasoningChange` owns it.
  //   `reasoningInModelId`   — no effort flag exists; the level is a suffix on the model id itself
  //                            (antigravity's `gemini-3.1-pro-high`). The choice IS the model, so
  //                            it goes through `onModelChange`, and the available levels are
  //                            derived PER BASE MODEL from the agent's own catalog — they are not
  //                            uniform (`gemini-3.1-pro` has no `-medium`, and `agy --model`
  //                            rejects one), so a fixed dropdown would offer ids the CLI refuses.
  const suffixLevels = agent.reasoningInModelId?.levels ?? [];
  const suffixLevelIds = suffixLevels.map((level) => level.id);
  const modelGroups = suffixLevels.length > 0 ? reasoningModelGroups(models, suffixLevels) : null;
  const activeGroup = modelGroups ? reasoningModelGroupFor(modelGroups, resolvedModel, suffixLevelIds) : null;
  const activeLevel = modelGroups ? splitReasoningModelId(resolvedModel, suffixLevelIds).level : null;

  const flatReasoningOptions = agent.reasoningOptions ?? [];
  // Per-model narrowing: a runtime whose catalog reports reasoning levels PER MODEL rather than
  // uniformly across the agent (Codex — see `AgentModelOption.reasoning`'s doc) declares them on the
  // resolved model's own catalog row. `undefined` there means "this model's entry has nothing
  // model-specific to say", so it falls back to the agent-wide union below — the same list every
  // model rendered before this field existed. An explicit `[]` is honored AS-IS, even though a model
  // with genuinely zero levels then hides the control: falling back to the union for `[]` too would
  // just move today's "every model sees every level" bug one layer down instead of fixing it.
  const selectedModelReasoning = models.find((model) => model.id === resolvedModel)?.reasoning;
  // Exactly one effort control, whichever shape declared it. `reasoningOptions` wins if a def ever
  // declares both, rather than rendering two controls that disagree about where the choice lands.
  const reasoningOptions =
    flatReasoningOptions.length === 0
      ? (activeGroup?.levels ?? [])
      : selectedModelReasoning === undefined
        ? flatReasoningOptions
        : selectedModelReasoning;
  const hasReasoning = reasoningOptions.length > 0;
  const rawReasoningValue =
    flatReasoningOptions.length > 0
      ? selectedAgentReasoning(config, agent)
      : (activeLevel ?? reasoningOptions[0]?.id ?? '');
  // The persisted (or agent-wide-default) pick can name a level the narrowed list above does not
  // actually offer for the CURRENT model — that is the whole point of narrowing. Rendering it anyway
  // would just relocate today's bug: the `<select>` below has no matching `<option>`, so it would
  // silently show whatever the browser highlights first while the underlying value stays wrong. This
  // guards what actually renders; the effect further down clears the persisted copy so every other
  // reader of `config.reasoningByAgentId` (not just this hook) sees the correction too.
  const reasoningSupported = reasoningOptions.some((option) => option.id === rawReasoningValue);
  const reasoningValue = reasoningSupported ? rawReasoningValue : (reasoningOptions[0]?.id ?? '');
  // A base model with exactly one variant has a real, fixed level worth showing — but nothing to
  // choose between, so the control is shown disabled rather than offering an illusion of choice.
  const reasoningDisabled = flatReasoningOptions.length === 0 && reasoningOptions.length < 2;

  const reasoningOptionIdsKey = reasoningOptions.map((option) => option.id).join('|');
  useEffect(() => {
    // The reasoningInModelId path has no reasoning value of its own to clear — the level lives
    // inside the model id itself, and picking a new base model already replaces it.
    if (flatReasoningOptions.length === 0) return;
    if (!onReasoningChange) return;
    const persisted = config.reasoningByAgentId?.[agent.id]?.trim();
    if (!persisted) return;
    if (reasoningOptions.some((option) => option.id === persisted)) return;
    onReasoningChange('');
    // `reasoningOptionIdsKey` stands in for `reasoningOptions` (a fresh array every render) so this
    // only re-runs when the narrowed vocabulary actually changes, not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatReasoningOptions.length, onReasoningChange, config.reasoningByAgentId, agent.id, reasoningOptionIdsKey]);

  // Adapters opt out via `supportsCustomModel: false` when their CLI has no
  // free-text model flag, or validates the id against a live catalog and
  // rejects unknown ones. `undefined` allows it, matching every adapter's
  // default before this field existed.
  const allowCustomModel = agent.supportsCustomModel !== false && modelGroups === null;
  const knownModelIds = models.map((model) => model.id);
  const customActive =
    allowCustomModel && hasModels && shouldShowCustomModelInput(resolvedModel, knownModelIds, explicitCustomMode);
  // A model-suffix agent picks a BASE model here; the effort control below supplies the rest of the
  // id. Everything else about the field — search, labels, provenance badge — is unchanged.
  const modelChoices: readonly AgentModelOption[] = modelGroups
    ? modelGroups.map((group) => ({ id: group.baseId, label: group.label }))
    : models;
  const selectValue = customActive
    ? CUSTOM_MODEL_SENTINEL
    : modelGroups
      ? (activeGroup?.baseId ?? '')
      : resolvedModel;
  // While the custom box is open, the text field must show the operator's raw
  // typed text (which may not resolve to anything yet) rather than the
  // resolved-with-fallback value — otherwise every keystroke would show a
  // stale fallback model instead of what was actually typed.
  const customModelInputValue = explicitCustomMode ? rawModel : resolvedModel;

  const resolveNextModelId = useCallback(
    (nextValue: string): string => {
      if (!modelGroups) {
        return nextValue;
      }
      // Switching base carries the current effort level over when the new base
      // really has it, and lands on one it does have otherwise — never composes a
      // slug (see `modelIdForReasoningLevel`), so `gemini-3.1-pro-medium` cannot be
      // produced from a `medium` carried off `gemini-3.8-flash`.
      const nextGroup = modelGroups.find((group) => group.baseId === nextValue);
      return nextGroup ? modelIdForReasoningLevel(nextGroup, activeLevel) : nextValue;
    },
    [modelGroups, activeLevel],
  );

  const resolveReasoningModelId = useCallback(
    (level: string): string | null => {
      // A model-suffix agent has no reasoning value of its own to record: the choice
      // is which model id runs, so it goes back out through `onModelChange`.
      if (activeGroup) {
        return modelIdForReasoningLevel(activeGroup, level);
      }
      return null;
    },
    [activeGroup],
  );

  return {
    models,
    hasModels,
    resolvedModel,
    rawModel,
    suffixLevels,
    suffixLevelIds,
    modelGroups,
    activeGroup,
    activeLevel,
    flatReasoningOptions,
    reasoningOptions,
    hasReasoning,
    reasoningValue,
    reasoningDisabled,
    allowCustomModel,
    knownModelIds,
    customActive,
    modelChoices,
    selectValue,
    customModelInputValue,
    resolveNextModelId,
    resolveReasoningModelId,
  };
}
