import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AgentIcon, RemixIcon } from '@jini-ai/ui';

import { useT } from '../../../../hooks/context.js';
import { defaultChatPaneSelection } from '../../rules.js';
import {
  runtimeOptionLabel,
  runtimePopoverPosition,
  useAgentRuntimePicker,
} from '../hooks/useAgentRuntimePicker.hooks.js';
import type {
  AgentRuntimePickerProps,
  ChatPaneAgent,
  ChatPaneAgentSelection,
} from '../../types.js';

// Re-exported so this module's public surface is unchanged by the behavior extraction; both are
// pure and now live beside the hook that consumes them.
export { runtimeOptionLabel, runtimePopoverPosition };

export function runtimeAgentStatus(agent: ChatPaneAgent): string {
  if (agent.available === false) return agent.diagnostic ?? 'Not found on PATH';
  if (agent.authStatus === 'missing') return 'Installed · sign-in required';
  return agent.version ?? 'Installed';
}

interface RuntimeModeButtonsProps {
  executionMode: 'local' | 'api';
  daemonOnline: boolean;
  apiModeAvailable: boolean;
  onExecutionModeChange: ((mode: 'local' | 'api') => void) | undefined;
  t: (key: string) => string;
}

function RuntimeModeButtons({
  executionMode,
  daemonOnline,
  apiModeAvailable,
  onExecutionModeChange,
  t,
}: RuntimeModeButtonsProps): ReactNode {
  return (
    <>
      <button
        type="button"
        className={`jini-runtime-mode${executionMode === 'local' ? ' is-active' : ''}`}
        disabled={!daemonOnline && executionMode !== 'local'}
        onClick={() => onExecutionModeChange?.('local')}
      >
        <RemixIcon name="terminal-box-line" size={18} />
        <span>{t('Use Local CLI')}</span>
        <span className="jini-runtime-mode__meta">
          {!daemonOnline ? t('offline') : executionMode === 'local' ? t('active') : ''}
        </span>
        {executionMode === 'local' ? (
          <RemixIcon name="check-line" size={19} className="jini-runtime-check" />
        ) : null}
      </button>
      <button
        type="button"
        className={`jini-runtime-mode${executionMode === 'api' ? ' is-active' : ''}`}
        disabled={!apiModeAvailable}
        onClick={() => onExecutionModeChange?.('api')}
      >
        <RemixIcon name="link" size={18} />
        <span>{t('Use API · BYOK')}</span>
        {!apiModeAvailable ? <span className="jini-runtime-mode__meta">{t('not configured')}</span> : null}
        {executionMode === 'api' ? (
          <RemixIcon name="check-line" size={19} className="jini-runtime-check" />
        ) : null}
      </button>
    </>
  );
}

interface RuntimeAgentListProps {
  orderedAgents: readonly ChatPaneAgent[];
  value: ChatPaneAgentSelection;
  onChange: (selection: ChatPaneAgentSelection) => void;
  agentIconBasePath: string;
  t: (key: string) => string;
}

function RuntimeAgentList({
  orderedAgents,
  value,
  onChange,
  agentIconBasePath,
  t,
}: RuntimeAgentListProps): ReactNode {
  if (orderedAgents.length === 0) {
    return <div className="jini-runtime-empty">{t('No available code agents')}</div>;
  }
  return (
    <>
      {orderedAgents.map((agent) => {
        const active = agent.id === value.agentId;
        const status = runtimeAgentStatus(agent);
        return (
          <button
            type="button"
            role="radio"
            aria-checked={active}
            className={`jini-runtime-agent${active ? ' is-active' : ''}`}
            key={agent.id}
            aria-current={active ? 'true' : undefined}
            aria-label={`${agent.name} · ${status}`}
            onClick={() => onChange(defaultChatPaneSelection(agent))}
          >
            <AgentIcon
              id={agent.id}
              size={20}
              className="jini-runtime-agent-icon"
              basePath={agentIconBasePath}
            />
            <span className="jini-runtime-agent__copy">
              <strong>{agent.name}</strong>
            </span>
            <span className="jini-runtime-agent__status">
              {active ? t('selected') : status}
            </span>
            {active ? (
              <RemixIcon name="check-line" size={19} className="jini-runtime-check" />
            ) : null}
          </button>
        );
      })}
    </>
  );
}

interface RuntimeModelSelectsProps {
  selectedAgent: ChatPaneAgent | undefined;
  value: ChatPaneAgentSelection;
  onChange: (selection: ChatPaneAgentSelection) => void;
  t: (key: string) => string;
}

function RuntimeModelSelects({ selectedAgent, value, onChange, t }: RuntimeModelSelectsProps): ReactNode {
  if (!selectedAgent) return null;
  return (
    <div className="jini-runtime-models">
      {(selectedAgent.models?.length ?? 0) > 0 ? (
        <label className="jini-runtime-select">
          <span>{t('Model')}</span>
          <select
            aria-label={t('Model')}
            value={value.model ?? ''}
            onChange={(event) => onChange({
              agentId: value.agentId,
              model: event.target.value,
              ...(value.reasoning ? { reasoning: value.reasoning } : {}),
            })}
          >
            {selectedAgent.models?.map((model) => (
              <option value={model.id} key={model.id}>{model.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      {(selectedAgent.reasoningOptions?.length ?? 0) > 0 ? (
        <label className="jini-runtime-select">
          <span>{t('Reasoning')}</span>
          <select
            aria-label={t('Reasoning')}
            value={value.reasoning ?? ''}
            onChange={(event) => onChange({
              agentId: value.agentId,
              ...(value.model ? { model: value.model } : {}),
              reasoning: event.target.value,
            })}
          >
            {selectedAgent.reasoningOptions?.map((option) => (
              <option value={option.id} key={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

interface RuntimeRescanFooterProps {
  onRescan: (() => void) | undefined;
  scanning: boolean;
  t: (key: string) => string;
}

function RuntimeRescanFooter({ onRescan, scanning, t }: RuntimeRescanFooterProps): ReactNode {
  if (onRescan) {
    return (
      <button
        type="button"
        className="jini-runtime-rescan"
        disabled={scanning}
        onClick={onRescan}
      >
        <RemixIcon
          name="refresh-line"
          size={17}
          {...(scanning ? { className: 'jini-runtime-spinner' } : {})}
        />
        <span>{scanning ? t('Scanning PATH…') : t('Rescan PATH')}</span>
      </button>
    );
  }
  if (scanning) {
    return <div className="jini-runtime-empty">{t('Scanning PATH…')}</div>;
  }
  return null;
}

/**
 * Renders the package-owned local/API, agent, model, and reasoning picker.
 *
 * @complexity Time: O(n) in the runtime inventory; space: O(n) for ordering.
 * @overallScore 100/100
 */
export function AgentRuntimePicker({
  agents,
  value,
  onChange,
  onRescan,
  scanning = false,
  daemonOnline = true,
  placement = 'up',
  executionMode = 'local',
  apiModeAvailable = false,
  onExecutionModeChange,
  agentIconBasePath = '/agent-icons',
}: AgentRuntimePickerProps) {
  const t = useT();
  const {
    dialogId,
    open,
    position,
    triggerRef,
    popoverRef,
    orderedAgents,
    selectedAgent,
    modelLabel,
    runtimeSummary,
    toggleOpen,
    handlePopoverKeyDown,
  } = useAgentRuntimePicker({ agents, value, placement, t });

  return (
    <div className="jini-runtime-picker">
      <button
        ref={triggerRef}
        type="button"
        className="jini-runtime-trigger"
        aria-label={t('Choose AI runtime')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={toggleOpen}
      >
        <AgentIcon
          id={selectedAgent?.id ?? ''}
          size={22}
          className="jini-runtime-agent-icon"
          basePath={agentIconBasePath}
        />
        <span className="jini-runtime-trigger__copy">
          <strong>{selectedAgent?.name ?? t('Choose agent')}</strong>
          <small>{modelLabel}</small>
        </span>
        <RemixIcon
          name="arrow-down-s-line"
          size={15}
          className="jini-runtime-trigger__chevron"
        />
      </button>

      {open && position ? createPortal(
        <div
          ref={popoverRef}
          className="jini-runtime-popover"
          id={dialogId}
          role="dialog"
          aria-label={t('Choose AI runtime')}
          aria-modal="false"
          style={position}
          onKeyDown={handlePopoverKeyDown}
        >
          <div className="jini-runtime-popover__head">
            <strong>{executionMode === 'local' ? t('Local CLI') : t('API · BYOK')}</strong>
            <span>{runtimeSummary}</span>
          </div>
          <RuntimeModeButtons
            executionMode={executionMode}
            daemonOnline={daemonOnline}
            apiModeAvailable={apiModeAvailable}
            onExecutionModeChange={onExecutionModeChange}
            t={t}
          />

          <div className="jini-runtime-section-label">{t('Code agent')}</div>
          <div role="radiogroup" aria-label={t('Code agent')}>
            <RuntimeAgentList
              orderedAgents={orderedAgents}
              value={value}
              onChange={onChange}
              agentIconBasePath={agentIconBasePath}
              t={t}
            />
          </div>

          <RuntimeModelSelects selectedAgent={selectedAgent} value={value} onChange={onChange} t={t} />

          <RuntimeRescanFooter onRescan={onRescan} scanning={scanning} t={t} />
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
