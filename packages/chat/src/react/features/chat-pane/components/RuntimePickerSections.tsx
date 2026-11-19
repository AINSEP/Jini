import { useId, type ReactNode } from 'react';
import { AgentIcon, RemixIcon, SearchableModelSelect } from '@jini-ai/ui';
import { agentHandleProps, agentHandleSegment } from '@jini-ai/core/agent-handles';
import { InfoTip } from '@jini-ai/ui/admin-widgets';
import { assessNativeToolPolicy } from '@jini-ai/agent-runtime/native-tool-policy';
import { modelReasoningOptions } from '@jini-ai/agent-runtime/model-selection';
import { friendlyModelLabel, pickerModelValue, pickerCatalogNote, pickerModelOptions, shortModelLabel } from '../model-options.js';
import { definedProps } from '../../../util/defined-props.js';
import { RuntimeDropUp } from './RuntimeDropUp.js';
import { defaultChatPaneSelection, resolveChatPaneSelection } from '../rules.js';
import type { ChatPaneAgent, ChatPaneAgentSelection, ByokRuntimeSummary } from '../types.js';
import { runtimeAgentStatus } from './AgentRuntimePicker.js';

/**
 * An agent's `fullCliAccessNote` as a warning icon whose tip (hover, focus, tap) holds the text.
 * It was a paragraph beside the model picker that squeezed the composer row (owner 2026-10-30).
 * `descriptionId` lets the agent's own radio in the picker list read the same text.
 */
function FullAccessNoteTip({ note, descriptionId, t }: {
  note: string; descriptionId?: string | undefined; t: (key: string) => string;
}): ReactNode {
  return (
    <span className="jini-runtime-access-note">
      <InfoTip
        label={t(note)}
        triggerLabel={t('Full computer access')}
        descriptionId={descriptionId}
        placement="top"
        icon={<RemixIcon name="alert-line" size={16} />}
      />
    </span>
  );
}

/** Selection preflight uses the launch assessor; it never substitutes for enforcement. */
export function NativeToolPolicyWarning({ agent, policy, isApi, t }: {
  t: (key: string) => string;
  agent: ChatPaneAgent | undefined; policy: import('@jini-ai/core/contracts/agents').NativeToolPolicyInput | undefined; isApi: boolean;
}): ReactNode {
  if (!agent || isApi) return null;
  const warning = policy ? assessNativeToolPolicy({ def: agent, policy }) : null;
  return <>
    {agent.fullCliAccessNote ? <FullAccessNoteTip note={agent.fullCliAccessNote} t={t} /> : null}
    {warning ? <InfoTip label={t(warning)} triggerLabel={t('Agent permissions required')}
      placement="top" icon={<RemixIcon name="alert-line" size={16} />} /> : null}
  </>;
}

interface RuntimeModeButtonsProps {
  base: string | undefined;
  executionMode: 'local' | 'api';
  daemonOnline: boolean;
  apiModeAvailable: boolean;
  onExecutionModeChange: ((mode: 'local' | 'api') => void) | undefined;
  t: (key: string) => string;
}

export function RuntimeModeButtons({
  base,
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
        {...agentHandleProps({}, { base, action: 'mode-local', role: 'button', label: t('Use Local CLI') })}
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
        {...agentHandleProps({}, { base, action: 'mode-api', role: 'button', label: t('Use API · BYOK') })}
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
  base: string | undefined;
  orderedAgents: readonly ChatPaneAgent[];
  value: ChatPaneAgentSelection;
  onChange: (selection: ChatPaneAgentSelection) => void;
  agentIconBasePath?: string;
  t: (key: string) => string;
}

export function RuntimeAgentList({
  base,
  orderedAgents,
  value,
  onChange,
  agentIconBasePath,
  t,
}: RuntimeAgentListProps): ReactNode {
  const noteIdPrefix = useId();
  if (orderedAgents.length === 0) {
    return <div className="jini-runtime-empty">{t('No available code agents')}</div>;
  }
  return (
    <>
      {orderedAgents.map((agent) => (
        <RuntimeAgentRow
          key={agent.id}
          base={base}
          agent={agent}
          status={runtimeAgentStatus({ agent })}
          active={agent.id === value.agentId}
          noteId={agent.fullCliAccessNote ? `${noteIdPrefix}-${agent.id}-note` : undefined}
          onChange={onChange}
          agentIconBasePath={agentIconBasePath}
          t={t}
        />
      ))}
    </>
  );
}

interface RuntimeAgentRowProps {
  status: string;
  base: string | undefined;
  agent: ChatPaneAgent;
  active: boolean;
  /** Set when the agent has a `fullCliAccessNote`: the radio is described by the note's text. */
  noteId: string | undefined;
  onChange: (selection: ChatPaneAgentSelection) => void;
  agentIconBasePath?: string | undefined;
  t: (key: string) => string;
}

function RuntimeAgentRow({ base, agent, status, active, noteId, onChange, agentIconBasePath, t }: RuntimeAgentRowProps): ReactNode {
  // The note's icon is a control of its own, so it sits beside the radio, never inside it.
  return (
    <div className="jini-runtime-agent-row">
      <button
        type="button"
        {...agentHandleProps({}, { base, action: `agent-${agentHandleSegment({ value: agent.id })}`, role: 'button', label: agent.name })}
        role="radio"
        aria-checked={active}
        className={`jini-runtime-agent${active ? ' is-active' : ''}`}
        aria-current={active ? 'true' : undefined}
        aria-label={`${agent.name} · ${status}`}
        {...(noteId ? { 'aria-describedby': noteId } : {})}
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
      {agent.fullCliAccessNote ? <FullAccessNoteTip note={agent.fullCliAccessNote} descriptionId={noteId} t={t} /> : null}
    </div>
  );
}

interface RuntimeBarMenusProps {
  base: string | undefined;
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
export function RuntimeBarMenus({ base, selectedAgent, value, onChange, modelLabel, t }: RuntimeBarMenusProps): ReactNode {
  if (!selectedAgent) return null;
  // Raw catalog ids (an offline fallback list's rows) read as friendly names in the bar and its list.
  const models = pickerModelOptions(selectedAgent).map((row) => ({ ...row, label: friendlyModelLabel({ label: row.label }) }));
  const selectedModelId = pickerModelValue(selectedAgent, value.model);
  const efforts = modelReasoningOptions({ agent: selectedAgent, model: models.find(option => option.id === selectedModelId) });
  const modelName = friendlyModelLabel({ label: modelLabel });
  return (
    <>
      {models.length > 0 ? (
        <RuntimeDropUp
          agentHandle={base ? `${base}-model` : false}
          label={t('Model')} valueLabel={modelName}
          // The agent icon sits right beside it, so the bar drops the vendor word and caps the rest.
          triggerLabel={shortModelLabel({ label: modelLabel, agentId: selectedAgent.id })}
          value={pickerModelValue(selectedAgent, value.model)} options={models} note={pickerCatalogNote(selectedAgent, t)} width={260}
          onSelect={(model) => onChange(value.reasoning ? resolveChatPaneSelection({
            agents: [selectedAgent], requested: { ...value, model },
          }) : { agentId: value.agentId, model })}
        />
      ) : null}
      {efforts.length > 0 ? (
        <RuntimeDropUp
          agentHandle={base ? `${base}-reasoning` : false}
          label={t('Reasoning')}
          // An unset reasoning shows the first option, as the old native select did.
          valueLabel={efforts.find((option) => option.id === value.reasoning)?.label ?? efforts[0]!.label}
          value={value.reasoning ?? ''} options={efforts} width={180}
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
  base: string | undefined;
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

export function RuntimeByokDetails({ base, byokRuntime, onByokModelChange, t }: RuntimeByokDetailsProps): ReactNode {
  const { model, models, pickModel } = resolveByokModel({ onByokModelChange }, { byokRuntime });
  return (
    <div className="jini-runtime-models">
      <div className="jini-runtime-select jini-runtime-byok-model">
        <span>{t('Model')}</span>
        {pickModel ? (
          <SearchableModelSelect
            agentHandle={base ? `${base}-byok-model` : false}
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
  base: string | undefined;
  onRescan: (() => void) | undefined;
  scanning: boolean;
  t: (key: string) => string;
}

export function RuntimeRescanFooter({ base, onRescan, scanning, t }: RuntimeRescanFooterProps): ReactNode {
  if (onRescan) {
    return (
      <button
        type="button"
        {...agentHandleProps({}, { base, action: 'rescan', role: 'button', label: t('Rescan PATH') })}
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

