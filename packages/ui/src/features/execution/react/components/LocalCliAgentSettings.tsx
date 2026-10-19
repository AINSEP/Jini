import { agentHandleProps, agentSubHandle } from '@jini-ai/agentic';
import { useT } from '../../../i18n/index.js';
import { CUSTOM_MODEL_SENTINEL } from '../../constants.js';
import type { AgentCliEnvFieldSpec, DetectedAgent, LocalCliConfig } from '../../types.js';
import type { UseLocalCliAgentCardResult } from '../hooks/useLocalCliAgentCard.js';
import { AgentCliEnvFields } from './AgentCliEnvFields.js';
import { SearchableModelSelect } from './SearchableModelSelect.js';

export interface LocalCliAgentSettingsProps {
  agent: DetectedAgent;
  config: LocalCliConfig;
  card: UseLocalCliAgentCardResult;
  cliEnvFields: readonly AgentCliEnvFieldSpec[];
  onModelChange: (agentId: string, model: string) => void;
  onEnvChange: (agentId: string, envKey: string, value: string) => void;
  agentHandle?: string | undefined;
}

/**
 * The selected CLI's settings, stacked inside its own card.
 *
 * Owner, 2026-10-09: both the full-row card and the separate settings strip
 * spread selection beyond its own column. Keep full-width controls and a
 * visible provenance sentence inside the card so only that card grows taller.
 */
export function LocalCliAgentSettings({
  agent,
  config,
  card,
  cliEnvFields,
  onModelChange,
  onEnvChange,
  agentHandle,
}: LocalCliAgentSettingsProps) {
  const t = useT();
  const { reasoning, result, repair, repairField } = card;
  const { hasModels, hasReasoning, reasoningOptions, reasoningValue, reasoningDisabled, customActive, customModelInputValue } =
    reasoning;

  return (
    <div
      className="jini-agent-settings"
      role="group"
      aria-label={agent.label}
      data-testid={`jini-agent-settings-${agent.id}`}
    >
      <div className="jini-agent-settings-row">
        {hasModels ? <ModelField agent={agent} card={card} agentHandle={agentHandle} /> : null}

        {customActive ? (
          <label className="jini-agent-settings-field">
            <span className="jini-field-label">{t('Custom model id')}</span>
            <input
              className="jini-input jini-agent-settings-custom"
              type="text"
              data-testid={`jini-agent-model-custom-${agent.id}`}
              value={customModelInputValue}
              placeholder={t('e.g. my-fine-tuned-model')}
              spellCheck={false}
              onChange={(event) => onModelChange(agent.id, event.target.value.trim())}
              {...agentHandleProps({}, { base: agentHandle, ...({ action: 'custom-model', role: 'field', label: t('Custom model id') }) })}
            />
          </label>
        ) : null}

        {/* Effort follows the model controls; Test belongs to the card header
            so it stays separate from both field interactions. */}
        {hasReasoning ? (
          <label className="jini-agent-settings-field">
            <span className="jini-field-label">{t('Reasoning effort')}</span>
            <select
              className="jini-input jini-agent-settings-reasoning"
              data-testid={`jini-agent-reasoning-${agent.id}`}
              value={reasoningValue}
              disabled={reasoningDisabled}
              onChange={(event) => card.selectReasoning(event.target.value)}
              {...agentHandleProps({}, { base: agentHandle, ...({ action: 'reasoning', role: 'field', label: t('Reasoning effort') }) })}
            >
              {reasoningOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {result ? <TestResultLine result={result} /> : null}

      {repair && repairField ? (
        <PathRepair agentId={agent.id} repair={repair} envKey={repairField.envKey} onEnvChange={onEnvChange} />
      ) : null}

      <AgentCliEnvFields agentId={agent.id} fields={cliEnvFields} config={config} onChange={onEnvChange} />
    </div>
  );
}

/** The model label with its provenance badge, the searchable picker, and the provenance sentence. */
function ModelField({
  agent,
  card,
  agentHandle,
}: Pick<LocalCliAgentSettingsProps, 'agent' | 'card' | 'agentHandle'>) {
  const t = useT();
  const { source, sourceLabel, sourceHint, reasoning } = card;
  return (
    <div className="jini-agent-settings-field jini-agent-settings-model">
      <div className="jini-agent-settings-label">
        <span className="jini-field-label">{t('Model')}</span>
        {sourceLabel ? (
          <span className={`jini-agent-model-source ${source}`}>{sourceLabel}</span>
        ) : null}
      </div>
      <SearchableModelSelect
        className="jini-input jini-agent-model-select"
        ariaLabel={t('Model')}
        searchPlaceholder={t('Search models')}
        testId={`jini-agent-model-${agent.id}`}
        searchInputTestId={`jini-agent-model-search-${agent.id}`}
        {...(agentHandle ? { agentHandle: agentSubHandle({ base: agentHandle, action: 'model' }) } : {})}
        value={reasoning.selectValue}
        models={reasoning.modelChoices}
        additionalOptions={reasoning.allowCustomModel ? [{ value: CUSTOM_MODEL_SENTINEL, label: t('Custom…') }] : undefined}
        onChange={card.selectModel}
      />
      {sourceHint ? <p className="jini-field-hint">{sourceHint}</p> : null}
    </div>
  );
}

function TestResultLine({ result }: { result: NonNullable<UseLocalCliAgentCardResult['result']> }) {
  const t = useT();
  if (result.status === 'error') {
    // `AgentTestState`'s 'error' variant types `message` as a required string, so a failed test
    // always carries its own words; only a passing test can arrive without one. (`useExecutionTab`
    // fills a message-less failure with an untranslated English string — a known bug pinned in
    // its own test.)
    return (
      <p className="jini-agent-card-test-result is-error" role="alert">
        {result.message}
      </p>
    );
  }
  return (
    <p className="jini-agent-card-test-result is-ok" role="status">
      {result.message ?? t('Agent is ready.')}
    </p>
  );
}

function PathRepair({
  agentId,
  repair,
  envKey,
  onEnvChange,
}: {
  agentId: string;
  repair: NonNullable<UseLocalCliAgentCardResult['repair']>;
  envKey: string;
  onEnvChange: LocalCliAgentSettingsProps['onEnvChange'];
}) {
  const t = useT();
  return (
    <div className="jini-agent-card-path-repair">
      <span className="jini-field-hint">
        {t('A custom path override did not work, so this used the automatically detected binary instead.')}
      </span>
      <div className="jini-agent-card-path-repair-actions">
        {/* `agentExecutableRepairState` (this feature's own `rules.ts`)
            always sets `canUseDetected: true` on every non-null result it produces
            today — the field exists for a FUTURE detection outcome that
            finds a fallback path but cannot vouch for it (see that
            field's doc). The `false` branch is therefore provably
            unreachable through this card's real data flow right now;
            kept rather than dropped so the card stays correct the day
            that future outcome exists, without another shape change. */}
        {repair.canUseDetected ? (
          <button
            type="button"
            className="jini-btn"
            data-testid={`jini-agent-path-repair-use-${agentId}`}
            onClick={() => onEnvChange(agentId, envKey, repair.detectedPath)}
          >
            {t('Use detected path')}
          </button>
        ) : null}
        <button
          type="button"
          className="jini-btn jini-btn-ghost"
          data-testid={`jini-agent-path-repair-clear-${agentId}`}
          onClick={() => onEnvChange(agentId, envKey, '')}
        >
          {t('Clear custom path')}
        </button>
      </div>
    </div>
  );
}
