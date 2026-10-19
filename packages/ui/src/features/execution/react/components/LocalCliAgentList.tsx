import type { ReactNode } from 'react';
import { agentHandleProps, buildAgentListHandles } from '@jini-ai/agentic';
import { useT } from '../../../i18n/index.js';
import type {
  AgentCliEnvFieldSpec,
  AgentScanState,
  AgentTestState,
  DetectedAgent,
  LocalCliConfig,
} from '../../types.js';
import { LocalCliAgentCard } from './LocalCliAgentCard.js';
import { useLocalCliAgentList, type UseLocalCliAgentListResult } from '../hooks/useLocalCliAgentList.js';

export interface LocalCliAgentListProps {
  agents: readonly DetectedAgent[];
  config: LocalCliConfig;
  scan: AgentScanState;
  onSelect: (agentId: string) => void;
  onModelChange: (agentId: string, model: string) => void;
  onReasoningChange: (agentId: string, reasoning: string) => void;
  onEnvChange: (agentId: string, envKey: string, value: string) => void;
  cliEnvFields: readonly AgentCliEnvFieldSpec[];
  onRescan?: (() => void) | undefined;
  onTest?: ((agent: DetectedAgent) => void) | undefined;
  agentTest: AgentTestState;
  renderAgentIcon?: ((agent: DetectedAgent) => ReactNode) | undefined;
  /**
   * Where detection ran, in the host's own words — "on this machine" for a
   * desktop app, "on the server" for a deployed one.
   *
   * This is host-supplied because this package cannot know: the same component
   * backs a local app whose CLIs really are the operator's, and a hosted CMS
   * whose detection runs on the server. Hardcoding "on this machine" made the
   * hosted case state something false. The default below says only what is
   * true in both shapes.
   */
  scopeLabel?: string | undefined;
  /** This list's own agent handle — see `ExecutionTab`'s `agentHandle` doc. Each card gets its own
   *  distinct sub-handle, derived from the agent's own stable id via `buildAgentListHandles`. */
  agentHandle?: string;
  /** Injection seam for the not-installed disclosure state. */
  useAgentList?: typeof useLocalCliAgentList | undefined;
}

/**
 * The detected code-agent CLIs, as a selectable card grid.
 *
 * Origin: the `daemon`-mode branch of `SettingsDialog.tsx`'s execution tab —
 * its agent group header, rescan control, and card grid. The origin's
 * managed-runtime entry (wallet, sign-in, plan upgrades) is left behind; see
 * `LocalCliAgentCard` for what that split does and does not cover.
 */
export function LocalCliAgentList({
  agents,
  config,
  scan,
  onSelect,
  onModelChange,
  onReasoningChange,
  onEnvChange,
  cliEnvFields,
  onRescan,
  onTest,
  agentTest,
  renderAgentIcon,
  scopeLabel,
  agentHandle,
  useAgentList = useLocalCliAgentList,
}: LocalCliAgentListProps) {
  const t = useT();
  const installed = agents.filter((agent) => agent.installed);
  const scope = scopeLabel ?? t('Runs a code-agent CLI detected by the host.');
  const handleList = agentHandle ? buildAgentListHandles({ prefix: agentHandle, ids: agents.map((agent) => agent.id) }) : undefined;
  const cardHandles = new Map(agents.map((agent, index) => [agent.id, handleList?.[index]]));
  const list = useAgentList({ agents, selectedAgentId: config.agentId });
  const renderCard = (agent: DetectedAgent) => {
    const handle = cardHandles.get(agent.id);
    return (
      <LocalCliAgentCard
        key={agent.id}
        agent={agent}
        config={config}
        selected={config.agentId === agent.id}
        onSelect={onSelect}
        onModelChange={onModelChange}
        onReasoningChange={onReasoningChange}
        onEnvChange={onEnvChange}
        cliEnvFields={cliEnvFields}
        renderIcon={renderAgentIcon}
        onTest={onTest}
        agentTest={agentTest}
        onRescan={onRescan}
        {...(handle ? { agentHandle: handle } : {})}
      />
    );
  };

  return (
    <section className="jini-settings-section jini-local-cli">
      <div className="jini-section-head">
        <div className="jini-section-head-text">
          <h4 className="jini-agent-group-head">
            {t('Your CLIs')} ({installed.length})
          </h4>
          <p className="jini-field-hint">{t('Pick the CLI that runs your prompts.')}</p>
        </div>
        {onRescan ? <RescanButton scanning={scan.status === 'scanning'} onRescan={onRescan} agentHandle={agentHandle} /> : null}
      </div>

      <p className="jini-field-hint jini-local-cli-scope">{scope}</p>

      {/* A failed scan is reported as a failure and never as an empty result:
          "detection could not run" and "detection found nothing" are different
          answers, and only one of them justifies telling the operator they
          have no CLIs installed. */}
      {scan.status === 'error' ? (
        <p className="jini-field-hint is-error" role="alert">
          {scan.message}
        </p>
      ) : null}

      <AgentListBody scan={scan} agents={agents} list={list} renderCard={renderCard} agentHandle={agentHandle} />
    </section>
  );
}

function RescanButton({
  scanning,
  onRescan,
  agentHandle,
}: {
  scanning: boolean;
  onRescan: () => void;
  agentHandle: string | undefined;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className="jini-btn jini-local-cli-rescan"
      disabled={scanning}
      onClick={onRescan}
      {...agentHandleProps({}, { base: agentHandle, ...({ action: 'rescan', role: 'button', label: t('Rescan') }) })}
    >
      {scanning ? t('Scanning…') : t('↻ Rescan')}
    </button>
  );
}

interface AgentListBodyProps {
  scan: AgentScanState;
  agents: readonly DetectedAgent[];
  list: UseLocalCliAgentListResult;
  renderCard: (agent: DetectedAgent) => ReactNode;
  agentHandle: string | undefined;
}

/** The scanning card, the empty state, or the card grid with its not-installed disclosure. */
function AgentListBody({ scan, agents, list, renderCard, agentHandle }: AgentListBodyProps) {
  const t = useT();
  if (scan.status === 'scanning') {
    return (
      <div className="jini-agent-scan-card" role="status" aria-live="polite">
        <span className="jini-agent-scan-ring" aria-hidden="true" />
        <strong>{t('Scanning for installed agents…')}</strong>
      </div>
    );
  }
  if (agents.length === 0) {
    return scan.status === 'error' ? null : <div className="jini-empty-card">{t('No agent CLIs detected.')}</div>;
  }
  return (
    <>
      <div className="jini-agent-grid">{list.visible.map(renderCard)}</div>
      {list.collapsed.length > 0 ? (
        <>
          <button
            type="button"
            className="jini-btn jini-local-cli-more"
            aria-expanded={list.showCollapsed}
            onClick={list.toggleCollapsed}
            {...agentHandleProps({}, { base: agentHandle, ...({ action: 'toggle-not-installed', role: 'button', label: t('Show not-installed CLIs') }) })}
          >
            {list.showCollapsed
              ? t('Hide not installed')
              : t('Show {count} not installed').replace('{count}', String(list.collapsed.length))}
          </button>
          {list.showCollapsed ? <div className="jini-agent-grid">{list.collapsed.map(renderCard)}</div> : null}
        </>
      ) : null}
    </>
  );
}
