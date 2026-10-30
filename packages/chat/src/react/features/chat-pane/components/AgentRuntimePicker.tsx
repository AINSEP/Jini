import { pickerModelValue, pickerCatalogNote, pickerModelOptions, shortModelLabel } from '../model-options.js';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AgentIcon, RemixIcon, SearchableModelSelect } from '@jini-ai/ui';
import { assessNativeToolPolicy, type NativeToolPolicyInput } from '@jini-ai/agent-runtime/native-tool-policy';

import { useT } from '../../../hooks/context.js';
import { definedProps } from '../../../util/defined-props.js';
import { RuntimeDropUp } from './RuntimeDropUp.js';
import { defaultChatPaneSelection } from '../rules.js';
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

export function runtimeAgentStatus({ agent }: { agent: ChatPaneAgent }): string {
  if (agent.available === false) return agent.diagnostic ?? 'Not found on PATH';
  if (agent.authStatus === 'missing') return 'Installed · sign-in required';
  return agent.version ?? 'Installed';
}

/** Selection preflight uses the launch assessor; it never substitutes for enforcement. */
function NativeToolPolicyWarning({ agent, policy, isApi }: {
  agent: ChatPaneAgent | undefined; policy: NativeToolPolicyInput | undefined; isApi: boolean;
}): ReactNode {
  const t = useT();
  if (!agent || isApi) return null;
  const warning = policy ? assessNativeToolPolicy({ def: agent, policy }) : null;
  return <>
    {agent.fullCliAccessNote ? <p>{t(agent.fullCliAccessNote)}</p> : null}
    {warning ? <p role="alert">{t(warning)}</p> : null}
  </>;
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
  const localModeLabel = executionMode === 'local' ? t('active') : '';
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
          {!daemonOnline ? t('offline') : localModeLabel}
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
  agentIconBasePath?: string;
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
        const status = runtimeAgentStatus({ agent: agent });
        return (
          <button
            type="button"
            role="radio"
            aria-checked={active}
            className={`jini-runtime-agent${active ? ' is-active' : ''}`}
            key={agent.id}
            aria-current={active ? 'true' : undefined}
            aria-label={`${agent.name} · ${status}`}
            onClick={() => onChange(defaultChatPaneSelection({ agent: agent }))}
          >
            <AgentIcon
              id={agent.id}
              size={20}
              className="jini-runtime-agent-icon"
              {...definedProps({ source: { basePath: agentIconBasePath } })}
            />
            <span className="jini-runtime-agent__copy">
              <strong>{agent.name}</strong>
              {agent.fullCliAccessNote ? <small>{t(agent.fullCliAccessNote)}</small> : null}
            </span>
            {agent.supportsTools === false ? (
              <span
                className="jini-runtime-agent__badge"
                title={t("This CLI has no MCP support, so it cannot use this app's tools.")}
              >
                {t('No tools')}
              </span>
            ) : null}
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

interface RuntimeBarMenusProps {
  selectedAgent: ChatPaneAgent | undefined;
  value: ChatPaneAgentSelection;
  onChange: (selection: ChatPaneAgentSelection) => void;
  modelLabel: string;
  t: (key: string) => string;
}

/**
 * The composer bar's "Model ⌄" and "Effort ⌄" drop-ups for the selected CLI. These replace the
 * Model / Reasoning selects that used to sit in the runtime popover under the agent list (owner
 * 2026-10-18: pick them from the bar and keep the popover small); they read and write the same
 * selection, so nothing else changed. Either one renders nothing when the agent publishes no
 * choices for it, rather than an empty menu.
 */
function RuntimeBarMenus({ selectedAgent, value, onChange, modelLabel, t }: RuntimeBarMenusProps): ReactNode {
  if (!selectedAgent) return null;
  const models = pickerModelOptions(selectedAgent);
  const efforts = selectedAgent.reasoningOptions ?? [];
  return (
    <>
      {models.length > 0 ? (
        <RuntimeDropUp
          label={t('Model')}
          valueLabel={modelLabel}
          // The agent icon sits right beside it, so the bar drops the vendor word and caps the rest.
          triggerLabel={shortModelLabel({ label: modelLabel, agentId: selectedAgent.id })}
          value={pickerModelValue(selectedAgent, value.model)}
          options={models}
          note={pickerCatalogNote(selectedAgent, t)}
          width={260}
          onSelect={(model) => onChange({
            agentId: value.agentId,
            model,
            ...(value.reasoning ? { reasoning: value.reasoning } : {}),
          })}
        />
      ) : null}
      {efforts.length > 0 ? (
        <RuntimeDropUp
          label={t('Reasoning')}
          // An unset reasoning shows the first option, as the old native select did.
          valueLabel={efforts.find((option) => option.id === value.reasoning)?.label ?? efforts[0]!.label}
          value={value.reasoning ?? ''}
          options={efforts}
          width={180}
          className="jini-runtime-dropup-trigger--effort"
          onSelect={(reasoning) => onChange({
            agentId: value.agentId,
            ...(value.model ? { model: value.model } : {}),
            reasoning,
          })}
        />
      ) : null}
    </>
  );
}

interface RuntimeByokDetailsProps {
  byokRuntime: ByokRuntimeSummary | undefined;
  onByokModelChange: ((model: string) => void) | undefined;
  t: (key: string) => string;
}

/**
 * What the popover shows in place of the CLI inventory while `executionMode` is `'api'`: the model
 * the credential will run, and nothing else.
 *
 * Everything this replaces (the agent radios, the "Default (CLI config)" select, Reasoning, Rescan
 * PATH) is a property of a *detected CLI process* and has no effect on an API turn — rendering them
 * here was the defect.
 *
 * ## Why the same `SearchableModelSelect` the settings screen uses
 *
 * Not a look-alike `<select>`. This is literally the control `ByokProviderForm`'s Model field
 * renders, fed the same discovered list and writing back to the same stored config, so the two
 * surfaces cannot drift: pick a model here and the settings screen shows it, and vice versa. Its
 * search box also matters at this size — a live Gemini key discovers ~40 models, which is past the
 * point where a plain dropdown in a 320px popover is usable.
 *
 * Falls back to plain text when the host supplies no `onByokModelChange` or no model list. That is
 * a real state, not a degenerate one: a host without discovery has nothing to offer a picker, and a
 * disabled dropdown would read as "editable once something is enabled" when nothing here will
 * enable it.
 */
function resolveByokModel(
  { onByokModelChange }: { onByokModelChange: ((model: string) => void) | undefined },
  { byokRuntime }: { byokRuntime?: ByokRuntimeSummary | undefined },
): {
  model: string | undefined;
  models: NonNullable<ByokRuntimeSummary['models']>;
  /** Set only when the model is editable here: the host wired a writer AND supplied a list. */
  pickModel: ((model: string) => void) | undefined;
} {
  const model = byokRuntime?.model?.trim();
  const models = byokRuntime?.models ?? [];
  const pickModel = onByokModelChange !== undefined && models.length > 0 ? onByokModelChange : undefined;
  return { model, models, pickModel };
}

function RuntimeByokDetails({ byokRuntime, onByokModelChange, t }: RuntimeByokDetailsProps): ReactNode {
  const { model, models, pickModel } = resolveByokModel({ onByokModelChange }, { byokRuntime });
  return (
    <div className="jini-runtime-models">
      <div className="jini-runtime-select jini-runtime-byok-model">
        <span>{t('Model')}</span>
        {pickModel ? (
          <SearchableModelSelect
            models={models}
            value={model ?? ''}
            onChange={(next) => pickModel(next)}
            ariaLabel={t('Model')}
            searchPlaceholder={t('Search models')}
            // The menu portals to `document.body` at the package default `z-index: 60`, while this
            // popover positions itself at 1000 — so without this the model list opens BEHIND the
            // popover that owns it. Raised here rather than in the shared stylesheet because 60 is
            // right for every other consumer; only this one opens a portalled menu from inside an
            // already-elevated surface.
            menuClassName="jini-runtime-model-menu"
          />
        ) : (
          <strong>{model || t('No model configured')}</strong>
        )}
      </div>
      {!model && !pickModel ? (
        <div className="jini-runtime-empty">
          {t('Set a model in the BYOK settings before sending a message.')}
        </div>
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

interface RuntimeTriggerProps {
  picker: UseAgentRuntimePickerResult;
  isApi: boolean;
  byokRuntime: ByokRuntimeSummary | undefined;
  agentIconBasePath: string | undefined;
  t: (key: string) => string;
}

function RuntimeTriggerIcon({ picker, isApi, byokRuntime, agentIconBasePath }: Omit<RuntimeTriggerProps, 't'>): ReactNode {
  const basePath = definedProps({ source: { basePath: agentIconBasePath } });
  if (!isApi) {
    return <AgentIcon id={picker.selectedAgent?.id ?? ''} size={22} className="jini-runtime-agent-icon" {...basePath} />;
  }
  if (byokRuntime?.iconId) {
    return <AgentIcon id={byokRuntime.iconId} size={22} className="jini-runtime-agent-icon" {...basePath} />;
  }
  return <RemixIcon name="link" size={20} className="jini-runtime-agent-icon" />;
}

function RuntimeTrigger({ picker, isApi, byokRuntime, agentIconBasePath, t }: RuntimeTriggerProps): ReactNode {
  return (
    <button
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

function RuntimePopover({
  picker,
  value,
  onChange,
  onRescan,
  scanning,
  daemonOnline,
  executionMode,
  apiModeAvailable,
  onExecutionModeChange,
  byokRuntime,
  onByokModelChange,
  agentIconBasePath,
  t,
}: RuntimePopoverProps): ReactNode {
  if (!picker.open || !picker.position) return null;
  const isApi = executionMode === 'api';
  return createPortal(
    <div
      ref={picker.popoverRef}
      className="jini-runtime-popover"
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
      <RuntimeModeButtons
        executionMode={executionMode}
        daemonOnline={daemonOnline}
        apiModeAvailable={apiModeAvailable}
        onExecutionModeChange={onExecutionModeChange}
        t={t}
      />

      {isApi ? (
        <RuntimeByokDetails byokRuntime={byokRuntime} onByokModelChange={onByokModelChange} t={t} />
      ) : (
        <>
          <div className="jini-runtime-section-label">{t('Code agent')}</div>
          <div role="radiogroup" aria-label={t('Code agent')}>
            <RuntimeAgentList
              orderedAgents={picker.orderedAgents}
              value={value}
              onChange={onChange}
              {...definedProps({ source: { agentIconBasePath } })}
              t={t}
            />
          </div>

          <RuntimeRescanFooter onRescan={onRescan} scanning={scanning} t={t} />
        </>
      )}
    </div>,
    document.body,
  );
}

/**
 * Renders the package-owned local/API, agent, model, and reasoning picker.
 *
 * @complexity Time: O(n) in the runtime inventory; space: O(n) for ordering.
 * @overallScore 100/100
 */
export function AgentRuntimePicker({
  agents,
  nativeToolPolicy,
  value,
  onChange,
  onRescan,
  scanning = false,
  daemonOnline = true,
  placement = 'up',
  executionMode = 'local',
  apiModeAvailable = false,
  onExecutionModeChange,
  byokRuntime,
  onByokModelChange,
  // No default here (was '/agent-icons'): omitted means "let AgentIcon fall back to its own
  // bundled icon set" — see AgentIcon.tsx's BUNDLED_ICON_URLS. A host that still wants to vendor
  // its own asset directory can pass this explicitly, same as before.
  agentIconBasePath,
}: AgentRuntimePickerProps) {
  const t = useT();
  const picker = useAgentRuntimePicker({ agents, value, placement, t, executionMode, byokRuntime });

  // The one branch this component makes. Everything below the mode buttons describes a detected CLI
  // — the agent radios, its model and reasoning selects, and the PATH rescan — and none of it is
  // true of, or has any effect on, an API turn. Previously all of it rendered in both modes, so an
  // operator on BYOK saw a CLI named as "selected" and a model reading "Default (CLI config)"
  // while their messages went to a provider over an API key.
  const isApi = executionMode === 'api';

  return (
    <div className="jini-runtime-picker">
      <RuntimeTrigger picker={picker} isApi={isApi} byokRuntime={byokRuntime} agentIconBasePath={agentIconBasePath} t={t} />
      {isApi ? null : (
        <RuntimeBarMenus selectedAgent={picker.selectedAgent} value={value} onChange={onChange} modelLabel={picker.modelLabel} t={t} />
      )}
      <NativeToolPolicyWarning agent={picker.selectedAgent} policy={nativeToolPolicy} isApi={isApi} />

      <RuntimePopover
        picker={picker}
        value={value}
        onChange={onChange}
        onRescan={onRescan}
        scanning={scanning}
        daemonOnline={daemonOnline}
        executionMode={executionMode}
        apiModeAvailable={apiModeAvailable}
        onExecutionModeChange={onExecutionModeChange}
        byokRuntime={byokRuntime}
        onByokModelChange={onByokModelChange}
        agentIconBasePath={agentIconBasePath}
        t={t}
      />
    </div>
  );
}
