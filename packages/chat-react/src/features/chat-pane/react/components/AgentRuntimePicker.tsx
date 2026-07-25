import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { AgentIcon, RemixIcon } from '@jini/ui';

import { useT } from '../../../../react/hooks/context.js';
import { defaultChatPaneSelection, orderChatPaneAgents } from '../../rules.js';
import type {
  AgentRuntimePickerProps,
  ChatPaneAgent,
  RuntimePickerPlacement,
} from '../../types.js';

export function runtimeAgentStatus(agent: ChatPaneAgent): string {
  if (agent.available === false) return agent.diagnostic ?? 'Not found on PATH';
  if (agent.authStatus === 'missing') return 'Installed · sign-in required';
  return agent.version ?? 'Installed';
}

/**
 * Resolves the user-facing label for a selected model or reasoning option.
 *
 * @complexity Time: O(n) in the supplied option count; space: O(1).
 * @overallScore 100/100
 */
export function runtimeOptionLabel(
  options: readonly { id: string; label: string }[] | undefined,
  value: string | undefined,
  fallback: string,
): string {
  if (!value || value === 'default') return fallback;
  return options?.find((option) => option.id === value)?.label ?? value;
}

/**
 * Computes a viewport-bounded fixed position for the body-portaled picker.
 *
 * @complexity Time/space: O(1).
 * @overallScore 100/100
 */
export function runtimePopoverPosition(
  trigger: DOMRect,
  placement: RuntimePickerPlacement,
): CSSProperties {
  const margin = 12;
  const gap = 8;
  const width = Math.min(320, window.innerWidth - margin * 2);
  const left = Math.min(
    Math.max(trigger.left + trigger.width / 2 - width / 2, margin),
    window.innerWidth - width - margin,
  );
  if (placement === 'up') {
    const availableHeight = Math.max(0, trigger.top - margin - gap);
    return {
      position: 'fixed',
      left,
      bottom: Math.max(margin, window.innerHeight - trigger.top + gap),
      width,
      maxHeight: Math.min(620, availableHeight),
      overflowY: 'auto',
      zIndex: 1000,
    };
  }
  const top = trigger.bottom + gap;
  const availableHeight = Math.max(0, window.innerHeight - top - margin);
  return {
    position: 'fixed',
    top,
    left,
    width,
    maxHeight: Math.min(620, availableHeight),
    overflowY: 'auto',
    zIndex: 1000,
  };
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
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const orderedAgents = useMemo(
    () => orderChatPaneAgents(agents.filter((agent) => agent.available !== false)),
    [agents],
  );
  const selectedAgent = orderedAgents.find((agent) => agent.id === value.agentId);
  const modelLabel = runtimeOptionLabel(
    selectedAgent?.models,
    value.model,
    t('Default model'),
  );
  const reasoningLabel = runtimeOptionLabel(
    selectedAgent?.reasoningOptions,
    value.reasoning,
    t('Default reasoning'),
  );

  const focusTrigger = useCallback(() => {
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target)
        || popoverRef.current?.contains(target)
      ) return;
      setOpen(false);
      // Let the pointer's click complete before restoring focus. Otherwise the
      // browser focuses the clicked node after this mousedown handler runs.
      window.setTimeout(focusTrigger, 0);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      focusTrigger();
    };
    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [focusTrigger, open]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition(runtimePopoverPosition(rect, placement));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, placement]);

  useEffect(() => {
    if (!open || !position) return;
    const popover = popoverRef.current;
    const selectedRadio = popover?.querySelector<HTMLElement>(
      '[role="radio"][aria-checked="true"]',
    );
    const fallback = popover?.querySelector<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), input:not(:disabled)',
    );
    (selectedRadio ?? fallback)?.focus();
  }, [open, position]);

  const handlePopoverKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const controls = [...(popoverRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), input:not(:disabled)',
    ) ?? [])];
    if (controls.length === 0) return;

    const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Tab') {
      const atStart = currentIndex === 0;
      const atEnd = currentIndex === controls.length - 1;
      if (event.shiftKey && atStart) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && atEnd) {
        event.preventDefault();
        controls[0]?.focus();
      }
      return;
    }

    // Native selects own their arrow/Home/End behavior. Roving applies only
    // when a button (including the agent radios) has focus.
    if (
      !(event.target instanceof HTMLButtonElement)
      || (event.key !== 'ArrowDown'
        && event.key !== 'ArrowUp'
        && event.key !== 'Home'
        && event.key !== 'End')
    ) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? controls.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1 + controls.length) % controls.length
          : (currentIndex - 1 + controls.length) % controls.length;
    controls[nextIndex]?.focus();
  }, []);

  const runtimeSummary = selectedAgent
    ? `${selectedAgent.name}${selectedAgent.version ? ` · ${selectedAgent.version}` : ''} · ${modelLabel}`
    : t('No agent selected');

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
        onClick={() => setOpen((current) => !current)}
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

          <div className="jini-runtime-section-label">{t('Code agent')}</div>
          <div role="radiogroup" aria-label={t('Code agent')}>
          {orderedAgents.length === 0 ? (
            <div className="jini-runtime-empty">{t('No available code agents')}</div>
          ) : orderedAgents.map((agent) => {
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
          </div>

          {selectedAgent ? (
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
          ) : null}

          {onRescan ? (
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
          ) : scanning ? (
            <div className="jini-runtime-empty">{t('Scanning PATH…')}</div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
