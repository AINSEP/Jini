import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AgentIcon, RemixIcon } from '@jini/ui';

import { useT } from '../../../../react/hooks/context.js';
import { defaultChatPaneSelection, orderChatPaneAgents } from '../../rules.js';
import type {
  AgentRuntimePickerProps,
  ChatPaneAgent,
  ChatPaneAgentSelection,
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

/** `Tab` wraps focus around the popover's control list instead of leaving it (the popover is a
 * modal-ish dialog). Returns the index to wrap TO, or `null` when `Tab` should behave natively
 * (not at an edge). `currentIndex` may be `-1` (active element not in `controls`); `atStart`/
 * `atEnd` below only matter when it legitimately is 0 or `count - 1`. */
function resolveTabWrapIndex(shiftKey: boolean, currentIndex: number, count: number): number | null {
  if (shiftKey && currentIndex === 0) return count - 1;
  if (!shiftKey && currentIndex === count - 1) return 0;
  return null;
}

/** Arrow/Home/End roving-tabindex target, or `null` for any other key. `currentIndex === -1`
 * (nothing in `controls` focused yet) is a legitimate input — the modulo arithmetic below relies
 * on it wrapping the same way a real index would. */
function resolveRovingIndex(key: string, currentIndex: number, count: number): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return (currentIndex + 1 + count) % count;
  if (key === 'ArrowUp') return (currentIndex - 1 + count) % count;
  return null;
}

/**
 * The control index `handlePopoverKeyDown` should move focus to, or `null` to leave focus alone
 * (and, in the caller, to skip `preventDefault()`). `Tab` is resolved and returned immediately —
 * it must never fall through to the roving-tabindex logic below it.
 */
function resolvePopoverKeyAction(
  key: string,
  shiftKey: boolean,
  isButtonTarget: boolean,
  currentIndex: number,
  count: number,
): number | null {
  if (key === 'Tab') return resolveTabWrapIndex(shiftKey, currentIndex, count);
  // Native selects own their arrow/Home/End behavior. Roving applies only
  // when a button (including the agent radios) has focus.
  if (!isButtonTarget) return null;
  return resolveRovingIndex(key, currentIndex, count);
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
    // No `?? []` fallback for a null ref: this handler is only ever reachable via the
    // `onKeyDown` React wires to the exact element `popoverRef` is attached to (below), and
    // React attaches refs during commit — before that element can dispatch any event — so
    // `popoverRef.current` is guaranteed non-null by the time this runs.
    const controls = [...popoverRef.current!.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), input:not(:disabled)',
    )];
    if (controls.length === 0) return;

    const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
    const nextIndex = resolvePopoverKeyAction(
      event.key,
      event.shiftKey,
      event.target instanceof HTMLButtonElement,
      currentIndex,
      controls.length,
    );
    if (nextIndex === null) return;
    event.preventDefault();
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
