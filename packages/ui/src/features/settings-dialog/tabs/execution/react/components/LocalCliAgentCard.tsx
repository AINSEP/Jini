import type { ReactNode } from 'react';
import { useT } from '../../../../../../features/i18n/index.js';
import { DEFAULT_AGENT_DESCRIPTIONS } from '@jini-ai/ui-core';
import { agentMetaLabel, agentModelSummary, selectedAgentModel } from '@jini-ai/ui-core';
import type { AgentTestState, DetectedAgent, LocalCliConfig } from '@jini-ai/ui-core';

export interface LocalCliAgentCardProps {
  agent: DetectedAgent;
  config: LocalCliConfig;
  selected: boolean;
  onSelect: (agentId: string) => void;
  onModelChange: (agentId: string, model: string) => void;
  /** Rendered in the card's icon slot. A host passes its own vendor marks;
   *  without one the card falls back to a monogram rather than a gap. */
  renderIcon?: ((agent: DetectedAgent) => ReactNode) | undefined;
  onTest?: ((agent: DetectedAgent) => void) | undefined;
  agentTest: AgentTestState;
}

/**
 * One detected code-agent CLI, as a selectable card.
 *
 * Origin: `SettingsDialog.tsx`'s `agent-card` (~4260-4600) and the
 * `renderAgentModelConfig` block it expands into when active. Ported: the
 * icon, name + vendor tagline, auth/version meta line, badges, selection, the
 * per-agent model picker with its source badge, and the Test button.
 * Deliberately left behind: the origin's managed-runtime card — its wallet
 * balance, plan badges, sign-in pill, and upgrade coachmarks are bound to that
 * product's hosted service, not to the idea of "a CLI on a machine".
 *
 * An earlier pass dropped the model picker, Test, version, and badges too, on
 * the theory that they were part of the same product-bound chrome. They are
 * not: every one of them is a property of a local CLI, and the data behind
 * them already ships in `@jini-ai/agent-runtime`'s detection payload.
 */
export function LocalCliAgentCard({
  agent,
  config,
  selected,
  onSelect,
  onModelChange,
  renderIcon,
  onTest,
  agentTest,
}: LocalCliAgentCardProps) {
  const t = useT();

  const description = agent.description ?? DEFAULT_AGENT_DESCRIPTIONS[agent.id];
  const meta = agentMetaLabel(agent, {
    authRequired: t('Authentication required'),
    authUnknown: t('Auth status unknown'),
    installed: t('Installed'),
    notInstalled: t('Not installed'),
  });
  const models = agent.models ?? [];
  const modelValue = selectedAgentModel(config, agent);
  const summary = agentModelSummary(config, agent);

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

  return (
    <div
      className={
        'jini-agent-card' +
        (selected ? ' is-selected' : '') +
        (agent.installed ? ' is-installed' : ' is-missing')
      }
      data-testid={`jini-agent-card-${agent.id}`}
    >
      <div className="jini-agent-card-main">
        <button
          type="button"
          className="jini-agent-card-select"
          data-testid={`jini-agent-select-${agent.id}`}
          aria-pressed={selected}
          disabled={!agent.installed}
          onClick={() => onSelect(agent.id)}
        >
          <span className="jini-agent-card-icon" aria-hidden="true">
            {renderIcon ? renderIcon(agent) : agent.label.slice(0, 1).toUpperCase()}
          </span>
          <span className="jini-agent-card-body">
            <span className="jini-agent-card-name">
              <span className="jini-agent-card-title">{agent.label}</span>
              {description ? (
                <>
                  <span className="jini-agent-card-name-divider" aria-hidden="true">
                    ·
                  </span>
                  <span className="jini-agent-card-tagline">{description}</span>
                </>
              ) : null}
            </span>
            {agent.badges?.length ? (
              <span className="jini-agent-card-badges">
                {agent.badges.map((badge) => (
                  <span key={badge} className="jini-agent-card-badge">
                    {badge}
                  </span>
                ))}
              </span>
            ) : null}
            {meta.text ? (
              <span className="jini-agent-card-meta">
                <span title={meta.title || undefined}>{meta.text}</span>
              </span>
            ) : null}
            {!selected && summary ? (
              <span className="jini-agent-card-model-summary">
                <span>{t('Model')}</span>
                <strong>{summary}</strong>
              </span>
            ) : null}
          </span>
        </button>

        {selected && onTest ? (
          <button
            type="button"
            className={'jini-btn jini-agent-card-test' + (testing ? ' is-loading' : '')}
            data-testid={`jini-agent-test-${agent.id}`}
            disabled={testing}
            onClick={() => onTest(agent)}
          >
            {testing ? t('Testing…') : t('Test')}
          </button>
        ) : null}
      </div>

      {selected && models.length > 0 ? (
        <div className="jini-agent-card-config">
          <label className="jini-field">
            <span className="jini-field-label">
              {t('Model')}
              {sourceLabel ? (
                <span className={`jini-agent-model-source ${source}`}>{sourceLabel}</span>
              ) : null}
            </span>
            <select
              className="jini-input jini-agent-model-select"
              data-testid={`jini-agent-model-${agent.id}`}
              value={modelValue}
              onChange={(event) => onModelChange(agent.id, event.target.value)}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
              {/* A saved pick the current list no longer offers still has to be
                  selectable, or the <select> would silently snap to its first
                  option and change what runs without the operator touching it. */}
              {modelValue && !models.some((model) => model.id === modelValue) ? (
                <option value={modelValue}>{modelValue}</option>
              ) : null}
            </select>
          </label>
          {sourceHint ? <p className="jini-field-hint">{sourceHint}</p> : null}
        </div>
      ) : null}

      {result ? (
        <p
          className={'jini-agent-card-test-result is-' + result.status}
          role={result.status === 'error' ? 'alert' : 'status'}
        >
          {result.message ?? (result.status === 'ok' ? t('Agent is ready.') : t('Agent check failed'))}
        </p>
      ) : null}
    </div>
  );
}
