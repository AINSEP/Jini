import type { ReactNode } from 'react';
import { agentHandleProps } from '@jini-ai/agentic';
import { useT } from '../../../i18n/index.js';
import { DEFAULT_AGENT_DESCRIPTIONS } from '../../constants.js';
import { agentMetaLabel, agentModelSummary } from '../../rules.js';
import type {
  AgentCliEnvFieldSpec,
  AgentTestState,
  DetectedAgent,
  LocalCliConfig,
} from '../../types.js';
import { useLocalCliAgentCard } from '../hooks/useLocalCliAgentCard.js';
import { AgentDiagnosticRow } from './AgentDiagnosticRow.js';
import { LocalCliAgentSettings } from './LocalCliAgentSettings.js';

export interface LocalCliAgentCardProps {
  agent: DetectedAgent;
  config: LocalCliConfig;
  selected: boolean;
  onSelect: (agentId: string) => void;
  onModelChange: (agentId: string, model: string) => void;
  onReasoningChange: (agentId: string, reasoning: string) => void;
  onEnvChange: (agentId: string, envKey: string, value: string) => void;
  /** Shared CLI-env catalog, filtered to this agent by `AgentCliEnvFields`
   *  itself — see that component's doc. */
  cliEnvFields: readonly AgentCliEnvFieldSpec[];
  /** Rendered in the card's icon slot. A host passes its own vendor marks;
   *  without one the card falls back to a monogram rather than a gap. */
  renderIcon?: ((agent: DetectedAgent) => ReactNode) | undefined;
  onTest?: ((agent: DetectedAgent) => void) | undefined;
  agentTest: AgentTestState;
  /** Wired straight into `AgentDiagnosticRow`'s `{kind:'rescan'}` fix action —
   *  the same rescan the list's own header button triggers. Omitted hides
   *  that specific fix button (a diagnostic with no OTHER fix action then
   *  renders with no buttons at all, same as the origin). */
  onRescan?: (() => void) | undefined;
  /** This card's own agent handle — see `ExecutionTab`'s `agentHandle` doc; `LocalCliAgentList`
   *  derives one distinct handle per agent and passes it here. */
  agentHandle?: string;
}

/**
 * One detected code-agent CLI, as a selectable card.
 *
 * Origin: `SettingsDialog.tsx`'s `agent-card` (~4260-4600) and the
 * `renderAgentModelConfig` block it expands into when active. Ported: the
 * icon, name + vendor tagline, auth/version meta line, badges, selection, the
 * per-agent model picker with its source badge, the Test button, agent
 * diagnostics with fix affordances, per-agent CLI env overrides, a reasoning
 * picker, custom-model free text entry, a searchable model list, and the
 * codex-style executable-path repair affordance. Deliberately left behind:
 * the origin's managed-runtime card — its wallet balance, plan badges,
 * sign-in pill, and upgrade coachmarks are bound to that product's hosted
 * service, not to the idea of "a CLI on a machine".
 *
 * Owner, 2026-10-09: selection grows this card inside its own grid column.
 * `LocalCliAgentSettings` stays inside it, so the neighbour keeps its normal
 * height rather than sharing a full-row settings strip.
 */
export function LocalCliAgentCard({
  agent,
  config,
  selected,
  onSelect,
  onModelChange,
  onReasoningChange,
  onEnvChange,
  cliEnvFields,
  renderIcon,
  onTest,
  agentTest,
  onRescan,
  agentHandle,
}: LocalCliAgentCardProps) {
  const t = useT();
  const card = useLocalCliAgentCard({ agent, config, agentTest, cliEnvFields, onModelChange, onReasoningChange, onRescan, onTest, t });

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
        <LocalCliAgentSelection
          agent={agent} config={config} selected={selected} onSelect={onSelect}
          renderIcon={renderIcon} agentHandle={agentHandle}
        />
        {selected && onTest ? (
          <button
            type="button"
            className={'jini-btn jini-agent-card-test' + (card.testing ? ' is-loading' : '')}
            data-testid={`jini-agent-test-${agent.id}`}
            disabled={card.testing}
            onClick={() => onTest(agent)}
            {...agentHandleProps({}, { base: agentHandle, action: 'test', role: 'button', label: t('Test') })}
          >
            {card.testing ? t('Testing…') : t('Test')}
          </button>
        ) : null}
      </div>

      {/* Why is this CLI unavailable, or only partially usable? Shown on
          BOTH an installed-but-troubled card and a not-installed one — a
          diagnostic is a property of detection, not of selection. */}
      {(agent.diagnostics ?? []).map((diagnostic, index) => (
        <AgentDiagnosticRow key={`${diagnostic.reason}-${index}`} diagnostic={diagnostic} handlers={card.diagnosticHandlers} />
      ))}
      {selected && card.hasSettings ? (
        <LocalCliAgentSettings
          agent={agent}
          config={config}
          card={card}
          cliEnvFields={cliEnvFields}
          onModelChange={onModelChange}
          onEnvChange={onEnvChange}
          agentHandle={agentHandle}
        />
      ) : null}
    </div>
  );
}

/** The selectable identity stays independent of the header's Test action. */
function LocalCliAgentSelection({ agent, config, selected, onSelect, renderIcon, agentHandle }:
  Pick<LocalCliAgentCardProps, 'agent' | 'config' | 'selected' | 'onSelect' | 'renderIcon'> & { agentHandle: string | undefined }) {
  return (
    <button
      type="button"
      className="jini-agent-card-select"
      data-testid={`jini-agent-select-${agent.id}`}
      aria-pressed={selected}
      disabled={!agent.installed}
      onClick={() => onSelect(agent.id)}
      {...agentHandleProps({}, { base: agentHandle, action: 'select', role: 'button', label: agent.label })}
    >
      <span className="jini-agent-card-icon" aria-hidden="true">
        {renderIcon ? renderIcon(agent) : agent.label.slice(0, 1).toUpperCase()}
      </span>
      <LocalCliAgentSummary agent={agent} config={config} selected={selected} />
      {selected ? (
        <span className="jini-agent-card-check" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );
}

/** Detection metadata and the compact model summary for the card's identity. */
function LocalCliAgentSummary({ agent, config, selected }:
  Pick<LocalCliAgentCardProps, 'agent' | 'config' | 'selected'>) {
  const t = useT();
  const description = agent.description ?? DEFAULT_AGENT_DESCRIPTIONS[agent.id];
  const meta = agentMetaLabel(agent, {
    authRequired: t('Authentication required'),
    authUnknown: t('Auth status unknown'),
    installed: t('Installed'),
    notInstalled: t('Not installed'),
  });
  const summary = agentModelSummary(config, agent);

  return (
    <span className="jini-agent-card-body">
      <span className="jini-agent-card-name">
        <span className="jini-agent-card-title">{agent.label}</span>
        {description ? (
          <span className="jini-agent-card-tagline">
            {description}
          </span>
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
      {/* Pre-existing (not part of this pass's six gaps): `agentMetaLabel`
          (this feature's own `rules.ts`) always returns a non-empty
          `text` for every branch of its own contract, so this ternary's
          `false` side is
          provably unreachable through the rule as written today — kept
          defensive rather than asserted-non-null in case that contract
          ever changes. */}
      {meta.text ? (
        <span className="jini-agent-card-meta">
          <span title={meta.title || undefined}>{meta.text}</span>
        </span>
      ) : null}
      {/* The selected card has the full model picker below; keep the
          compact summary on the other cards so their model stays visible. */}
      {!selected && summary ? (
        <span className="jini-agent-card-model-summary">
          <span>{t('Model')}</span>
          <strong>{summary}</strong>
        </span>
      ) : null}
    </span>
  );
}
