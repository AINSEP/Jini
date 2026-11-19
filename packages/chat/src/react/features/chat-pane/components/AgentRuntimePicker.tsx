import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AgentIcon, RemixIcon, useAgentHandle, useOverlayContainer } from '@jini-ai/ui';
import { agentHandleProps } from '@jini-ai/core/agent-handles';

import { NativeToolPolicyWarning, RuntimeModeButtons, RuntimeAgentList, RuntimeBarMenus, RuntimeByokDetails, RuntimeRescanFooter } from './RuntimePickerSections.js';
import { useT } from '../../../hooks/context.js';
import { definedProps } from '../../../util/defined-props.js';
import {
  runtimeOptionLabel,
  runtimePopoverPosition,
  useAgentRuntimePicker,
  type UseAgentRuntimePickerResult,
} from '../hooks/useAgentRuntimePicker.hooks.js';
import type {
  AgentRuntimePickerProps,
  ByokRuntimeSummary,
  ChatPaneAgent,
  ChatPaneAgentSelection,
} from '../types.js';

// Re-exported so this module's public surface is unchanged by the behavior extraction; both are
// pure and now live beside the hook that consumes them.
export { runtimeOptionLabel, runtimePopoverPosition };

interface RuntimeTriggerProps {
  base: string | undefined;
  picker: UseAgentRuntimePickerResult;
  isApi: boolean;
  byokRuntime: ByokRuntimeSummary | undefined;
  agentIconBasePath: string | undefined;
  t: (key: string) => string;
}

function RuntimeTriggerIcon({ picker, isApi, byokRuntime, agentIconBasePath }: Omit<RuntimeTriggerProps, 't' | 'base'>): ReactNode {
  const basePath = definedProps({ source: { basePath: agentIconBasePath } });
  if (!isApi) {
    return <AgentIcon id={picker.selectedAgent?.id ?? ''} size={22} className="jini-runtime-agent-icon" {...basePath} />;
  }
  if (byokRuntime?.iconId) {
    return <AgentIcon id={byokRuntime.iconId} size={22} className="jini-runtime-agent-icon" {...basePath} />;
  }
  return <RemixIcon name="link" size={20} className="jini-runtime-agent-icon" />;
}

function RuntimeTrigger({ base, picker, isApi, byokRuntime, agentIconBasePath, t }: RuntimeTriggerProps): ReactNode {
  return (
    <button
      {...agentHandleProps({}, { base, action: 'trigger', role: 'button', label: t('Choose AI runtime') })}
      ref={picker.triggerRef}
      type="button"
      className={isApi ? 'jini-runtime-trigger' : 'jini-runtime-trigger jini-runtime-trigger--icon-only'}
      aria-label={t('Choose AI runtime')}
      aria-haspopup="dialog"
      aria-expanded={picker.open}
      aria-controls={picker.dialogId}
      title={`${picker.triggerTitle} · ${picker.modelLabel}`}
      onClick={picker.toggleOpen}
    >
      {/* The provider's own mark in API mode — the selected CLI's logo would be an outright false
          claim about what answers the next message. `AgentIcon` resolves the brand asset the host
          ships (e.g. `gemini.svg`); the generic link glyph is the fallback for a provider the host
          has no mark for, which is honest rather than wrong. */}
      <RuntimeTriggerIcon picker={picker} isApi={isApi} byokRuntime={byokRuntime} agentIconBasePath={agentIconBasePath} />
      {/* The agent name stays in the text (visually hidden; the icon already names it) so the
          trigger still reads "Choose agent" when none is picked; "agent · model" is the hover
          title above. In local mode the model is its own drop-up beside this button, so only
          API mode shows the model here — its picker still lives in the popover. */}
      <span className="jini-runtime-trigger__copy">
        <strong>{picker.triggerTitle}</strong>
        {isApi ? <small>{picker.modelLabel}</small> : null}
      </span>
      {isApi ? (
        <RemixIcon
          name="arrow-down-s-line"
          size={15}
          className="jini-runtime-trigger__chevron"
        />
      ) : null}
    </button>
  );
}

interface RuntimePopoverProps {
  useOverlayContainerHook?: typeof useOverlayContainer;
  base: string | undefined;
  picker: UseAgentRuntimePickerResult;
  value: ChatPaneAgentSelection;
  onChange: (selection: ChatPaneAgentSelection) => void;
  onRescan: (() => void) | undefined;
  scanning: boolean;
  daemonOnline: boolean;
  executionMode: 'local' | 'api';
  apiModeAvailable: boolean;
  onExecutionModeChange: ((mode: 'local' | 'api') => void) | undefined;
  byokRuntime: ByokRuntimeSummary | undefined;
  onByokModelChange: ((model: string) => void) | undefined;
  agentIconBasePath: string | undefined;
  t: (key: string) => string;
}

/** Keep native-dialog ownership and the originating page across a host overlay portal. */
function runtimePortalBinding({ trigger, overlay }: { trigger: HTMLElement | null; overlay: HTMLElement | null }) {
  return {
    container: trigger?.closest('dialog') ?? overlay,
    page: trigger?.closest('[data-agent-page]')?.getAttribute('data-agent-page') ?? undefined,
  };
}

function RuntimePopover({ useOverlayContainerHook = useOverlayContainer, ...props }: RuntimePopoverProps): ReactNode {
  const overlay = useOverlayContainerHook({});
  const portal = runtimePortalBinding({ trigger: props.picker.triggerRef.current, overlay });
  if (!props.picker.open || !props.picker.position || !portal.container) return null;
  return createPortal(<RuntimePopoverContent {...props} page={portal.page} />, portal.container);
}

function RuntimePopoverContent({ base, picker, value, onChange, onRescan, scanning, daemonOnline,
  executionMode, apiModeAvailable, onExecutionModeChange, byokRuntime, onByokModelChange, agentIconBasePath, t, page,
}: Omit<RuntimePopoverProps, 'useOverlayContainerHook'> & { page: string | undefined }): ReactNode {
  const isApi = executionMode === 'api';
  return (
    <div
      ref={picker.popoverRef}
      className="jini-runtime-popover"
      data-agent-page={page}
      // Carries the host's theme across the portal — see `originTheme`'s own comment for the
      // dark-on-dark select this exists to prevent.
      {...(picker.originTheme ? { 'data-theme': picker.originTheme } : {})}
      id={picker.dialogId}
      role="dialog"
      aria-label={t('Choose AI runtime')}
      aria-modal="false"
      style={picker.position}
      onKeyDown={picker.handlePopoverKeyDown}
    >
      <div className="jini-runtime-popover__head">
        <strong>{executionMode === 'local' ? t('Local CLI') : t('API · BYOK')}</strong>
        <span>{picker.runtimeSummary}</span>
      </div>
      <RuntimeModeButtons base={base} executionMode={executionMode} daemonOnline={daemonOnline}
        apiModeAvailable={apiModeAvailable} onExecutionModeChange={onExecutionModeChange} t={t} />

      {isApi ? (
        <RuntimeByokDetails base={base} byokRuntime={byokRuntime} onByokModelChange={onByokModelChange} t={t} />
      ) : (
        <>
          <div className="jini-runtime-section-label">{t('Code agent')}</div>
          <div role="radiogroup" aria-label={t('Code agent')}>
            <RuntimeAgentList base={base} orderedAgents={picker.orderedAgents} value={value} onChange={onChange}
              {...definedProps({ source: { agentIconBasePath } })} t={t} />
          </div>

          <RuntimeRescanFooter base={base} onRescan={onRescan} scanning={scanning} t={t} />
        </>
      )}
    </div>
  );
}

/**
 * Renders the package-owned local/API, agent, model, and reasoning picker.
 *
 * @complexity Time: O(n) in the runtime inventory; space: O(n) for ordering.
 * @overallScore 100/100
 */
export function AgentRuntimePicker({
  useAgentHandleHook = useAgentHandle, useAgentRuntimePickerHook = useAgentRuntimePicker, useTHook = useT, useOverlayContainerHook,
  agentHandle, agents, nativeToolPolicy, value, onChange, onRescan,
  scanning = false,
  daemonOnline = true,
  placement = 'up',
  executionMode = 'local',
  apiModeAvailable = false,
  onExecutionModeChange, byokRuntime, onByokModelChange,
  // No default here (was '/agent-icons'): omitted means "let AgentIcon fall back to its own
  // bundled icon set" — see AgentIcon.tsx's BUNDLED_ICON_URLS. A host that still wants to vendor
  // its own asset directory can pass this explicitly, same as before.
  agentIconBasePath,
}: AgentRuntimePickerProps & { useAgentHandleHook?: typeof useAgentHandle; useAgentRuntimePickerHook?: typeof useAgentRuntimePicker; useTHook?: typeof useT; useOverlayContainerHook?: typeof useOverlayContainer }) {
  const base = useAgentHandleHook({ agentHandle });
  const t = useTHook();
  const picker = useAgentRuntimePickerHook({ agents, value, placement, t, executionMode, byokRuntime });

  // The one branch this component makes. Everything below the mode buttons describes a detected CLI
  // — the agent radios, its model and reasoning selects, and the PATH rescan — and none of it is
  // true of, or has any effect on, an API turn. Previously all of it rendered in both modes, so an
  // operator on BYOK saw a CLI named as "selected" and a model reading "Default (CLI config)"
  // while their messages went to a provider over an API key.
  const isApi = executionMode === 'api';

  return (
    <div className="jini-runtime-picker">
      <RuntimeTrigger base={base} picker={picker} isApi={isApi} byokRuntime={byokRuntime} agentIconBasePath={agentIconBasePath} t={t} />
      {isApi ? null : (
        <RuntimeBarMenus base={base} selectedAgent={picker.selectedAgent} value={value} onChange={onChange} modelLabel={picker.modelLabel} t={t} />
      )}
      <NativeToolPolicyWarning agent={picker.selectedAgent} policy={nativeToolPolicy} isApi={isApi} t={t} />

      <RuntimePopover base={base} picker={picker} value={value} onChange={onChange} onRescan={onRescan}
        scanning={scanning} daemonOnline={daemonOnline} executionMode={executionMode} apiModeAvailable={apiModeAvailable}
        onExecutionModeChange={onExecutionModeChange} byokRuntime={byokRuntime} onByokModelChange={onByokModelChange}
        agentIconBasePath={agentIconBasePath} t={t} {...definedProps({ source: { useOverlayContainerHook } })} />
    </div>
  );
}
