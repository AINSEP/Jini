import { useState } from 'react';
import { CUSTOM_MODEL_SENTINEL } from '../../constants.js';
import { agentExecutableRepairState, binPathEnvField, cliEnvFieldsForAgent } from '../../rules.js';
import type { AgentCliEnvFieldSpec, AgentTestState, DetectedAgent, LocalCliConfig } from '../../types.js';
import { useReasoningControl, type UseReasoningControlResult } from './useReasoningControl.js';

type Translate = (key: string) => string;

export interface UseLocalCliAgentCardInput {
  agent: DetectedAgent;
  config: LocalCliConfig;
  agentTest: AgentTestState;
  cliEnvFields: readonly AgentCliEnvFieldSpec[];
  onModelChange: (agentId: string, model: string) => void;
  onReasoningChange: (agentId: string, reasoning: string) => void;
  onRescan?: (() => void) | undefined;
  /** Only its presence matters here: a Test button alone is enough to show the settings strip. */
  onTest?: ((agent: DetectedAgent) => void) | undefined;
  t: Translate;
}

export interface UseLocalCliAgentCardResult {
  reasoning: UseReasoningControlResult;
  /** Whether the selected card's settings strip has anything to show; without this it rendered
   *  as an empty bordered box for a CLI with no models, effort, Test or env fields. */
  hasSettings: boolean;
  /** `agent.modelsSource`, passed through for the badge's modifier class. */
  source: DetectedAgent['modelsSource'];
  sourceLabel: string;
  sourceHint: string;
  testing: boolean;
  result: Extract<AgentTestState, { status: 'ok' | 'error' }> | null;
  repair: ReturnType<typeof agentExecutableRepairState>;
  repairField: AgentCliEnvFieldSpec | null;
  diagnosticHandlers: {
    onRescan: (() => void) | undefined;
    onOpenInstall: (() => void) | undefined;
    onOpenDocs: (() => void) | undefined;
  };
  /** The model picker's change handler, including its "Custom…" sentinel. */
  selectModel: (nextValue: string) => void;
  /** The reasoning picker's change handler, including the model-suffix shape. */
  selectReasoning: (nextValue: string) => void;
}

/**
 * Everything `LocalCliAgentCard` and its settings strip derive from one agent, kept out of the
 * `.tsx` so both render from the same values.
 */
export function useLocalCliAgentCard({
  agent,
  config,
  agentTest,
  cliEnvFields,
  onModelChange,
  onReasoningChange,
  onRescan,
  onTest,
  t,
}: UseLocalCliAgentCardInput): UseLocalCliAgentCardResult {
  // Whether the operator explicitly opened the free-text "Custom" entry via
  // the model picker's own "Custom…" option — distinct from "the saved model
  // simply isn't in the known list" (`shouldShowCustomModelInput` covers
  // both, but only THIS one needs to be remembered as a UI-local toggle,
  // since it is not itself persisted config: see `LocalCliConfig`, which has
  // nowhere for "the operator is mid-typing a custom id" to live). Scoped to
  // this card instance, so switching to a different agent and back does not
  // leak one agent's custom-mode toggle onto another.
  const [explicitCustomMode, setExplicitCustomMode] = useState(false);

  const reasoning = useReasoningControl({
    agent,
    config,
    explicitCustomMode,
    onReasoningChange: (next) => onReasoningChange(agent.id, next),
  });

  // `modelsSource` is optional in the contract, so an absent value means the
  // host did not say where the list came from — NOT that it came from a
  // built-in fallback. Defaulting to 'fallback' rendered "Built-in list" over
  // a list that may well be live, and told the operator to Rescan to fix a
  // problem they do not have. Unknown provenance shows no badge and no claim.
  const source = agent.modelsSource;
  const sourceLabel = source === 'live' ? t('Live from CLI') : source === 'fallback' ? t('Built-in list') : '';
  const sourceHint =
    source === 'live'
      ? t("Model list comes from this CLI. Default uses the CLI's own config.")
      : source === 'fallback'
        ? t('Showing built-in defaults. Click Rescan to pull live models from the CLI.')
        : '';

  // The test result belongs to whichever agent was probed, so a stale verdict
  // from a previously-tested CLI never renders under this one.
  const testing = agentTest.status === 'testing' && agentTest.agentId === agent.id;
  const result =
    (agentTest.status === 'ok' || agentTest.status === 'error') && agentTest.agentId === agent.id
      ? agentTest
      : null;

  // The "use the binary that actually ran" / "clear the override" repair
  // affordance — only meaningful when a successful test silently fell back
  // off a configured override, AND this agent's catalog names which field
  // that override lives in. See `agentExecutableRepairState`'s doc.
  //
  // `AgentTestState`'s 'ok' variant spells success as `status: 'ok'`, not an
  // `ok: true` field — `agentExecutableRepairState` takes the latter (it
  // mirrors `ExecutionPort.testAgent`'s raw resolved shape, one layer below
  // this state union), so the two must be translated explicitly here rather
  // than passing `result` straight through.
  const repair =
    result?.status === 'ok'
      ? agentExecutableRepairState({
          ok: true,
          usedExecutableSource: result.usedExecutableSource,
          detectedExecutablePath: result.detectedExecutablePath,
        })
      : null;
  const repairField = repair ? binPathEnvField(cliEnvFields, agent.id) : null;

  const openUrl = (url: string | undefined) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const diagnosticHandlers = {
    onRescan,
    onOpenInstall: agent.installUrl ? () => openUrl(agent.installUrl) : undefined,
    onOpenDocs: agent.docsUrl ? () => openUrl(agent.docsUrl) : undefined,
  };

  const selectModel = (nextValue: string) => {
    if (nextValue === CUSTOM_MODEL_SENTINEL) {
      setExplicitCustomMode(true);
      onModelChange(agent.id, '');
      return;
    }
    setExplicitCustomMode(false);
    onModelChange(agent.id, reasoning.resolveNextModelId(nextValue));
  };

  const selectReasoning = (nextValue: string) => {
    // A model-suffix agent has no reasoning value of its own to record: the choice
    // is which model id runs, so it goes back out through `onModelChange`.
    const suffixModelId = reasoning.resolveReasoningModelId(nextValue);
    if (suffixModelId !== null) {
      onModelChange(agent.id, suffixModelId);
      return;
    }
    onReasoningChange(agent.id, nextValue);
  };

  const hasSettings =
    reasoning.hasModels ||
    reasoning.hasReasoning ||
    Boolean(onTest) ||
    result !== null ||
    cliEnvFieldsForAgent(cliEnvFields, agent.id).length > 0;

  return {
    reasoning,
    hasSettings,
    source,
    sourceLabel,
    sourceHint,
    testing,
    result,
    repair,
    repairField,
    diagnosticHandlers,
    selectModel,
    selectReasoning,
  };
}
