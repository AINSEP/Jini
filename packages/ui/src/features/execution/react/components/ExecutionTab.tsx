import type { CSSProperties, ReactNode } from 'react';
import { agentHandleProps, agentSubHandle } from '@jini-ai/core/agent-handles';
import { useT } from '../../../i18n/index.js';
import { DEFAULT_AGENT_CLI_ENV_FIELDS } from '../../constants.js';
import type { AgentCliEnvFieldSpec, ExecutionCardAgent, ExecutionConfig, ExecutionMode, ExecutionPort, ProviderPreset } from '@jini-ai/core/contracts/execution';
import {
  isValidApiBaseUrl,
  nextConfigForAgentCliEnvChange,
  nextConfigForAgentModel,
  nextConfigForAgentReasoning,
  nextConfigForAgentSelect,
  selectedAgentModel,
} from '../../rules.js';
import type { useExecutionTab } from '../hooks/useExecutionTab.js';
import { useByokPane, useExecutionTabView } from './ExecutionTab.hooks.js';
import { ByokProviderForm } from './ByokProviderForm.js';
import { LocalCliAgentList } from './LocalCliAgentList.js';
import { ProviderChipGroup } from './ProviderChipGroup.js';

export interface ExecutionTabProps {
  config: ExecutionConfig;
  onConfigChange: (config: ExecutionConfig) => void;
  port: ExecutionPort;
  /** Host-owned endpoint catalog. Omitted means manual endpoint entry. */
  presets?: readonly ProviderPreset[];
  /** Per-agent CLI env-var catalog (proxy URLs, custom config dirs, a
   *  binary-path override). Defaults to this package's starter set for the
   *  CLIs it already knows about — a host with a different/larger agent
   *  roster passes its own, same convention as `presets`. */
  cliEnvFields?: readonly AgentCliEnvFieldSpec[];
  /** Disables Local CLI with an explanatory title, for hosts that cannot run
   *  local subprocesses (e.g. a hosted deployment). */
  localCliUnavailableReason?: string;
  /** Rendered in each agent card's icon slot — vendor marks are the host's to
   *  supply, since this package ships no logo set. */
  renderAgentIcon?: (agent: ExecutionCardAgent) => ReactNode;
  /** Where local-CLI detection actually runs, in the host's words. See
   *  `LocalCliAgentListProps.scopeLabel` — a hosted deployment must not tell
   *  the operator these are the CLIs "on this machine". */
  localCliScopeLabel?: string;
  autoDetect?: boolean;
  ariaLabel?: string;
  /**
   * Pass-throughs to the internal `ByokProviderForm`'s identically-named props — see that
   * component's own doc comments for the full contract (write-only credential display, the
   * placeholder-never-a-value safety property, and the footer slot).
   *
   * Added here rather than only on `ByokProviderForm` because a host whose BYOK config is
   * ALSO offering Local CLI (the common case — see `types.ts`'s `ExecutionMode`) has no way to
   * reach `ByokProviderForm` directly: it is `ExecutionTab` that owns the mode switch and
   * renders the BYOK section conditionally. Without these, a host storing its admin's own key
   * server-side (as opposed to the visitor-key screen, which renders `ByokProviderForm` on its
   * own because it has no Local CLI option to switch away from) would have to fork this
   * component to add write-only display — exactly the mistake one host integration already made
   * and reverted. Omitted by every existing caller, so the rendered output is byte-identical
   * without them.
   */
  apiKeyFooter?: ReactNode;
  formFooter?: ReactNode;
  apiKeyStoredExternally?: boolean;
  apiKeyPlaceholder?: string;
  /**
   * Whether the tab may run model discovery right now. Defaults to `true`.
   *
   * For a host that holds a key the browser cannot read and knows that key cannot be used at the
   * selected endpoint, e.g. a key its backend saved for another provider and refuses to send anywhere
   * else. With nothing typed, discovery then has nothing it may send, so the tab stays idle instead of
   * showing that refusal.
   *
   * Read when discovery would run anyway (an endpoint change, a key typed or cleared, Test connection)
   * and deliberately NOT a trigger of its own. A host flips it to `true` when its stored key is
   * re-pointed at the selected endpoint, and probing on that flip alone would send the key there
   * without the operator asking. Turning it `false` only resets discovery to idle and discards any
   * response still in flight, which sends nothing.
   */
  canDiscoverModels?: boolean;
  /** Pass-through to `useExecutionTab`'s `describeProbeError` — see that option's doc. Words a failed
   *  model discovery and a failed Test connection. */
  describeProbeError?: (error: unknown) => string;
  /**
   * This tab's own agent handle, published by the host. Every interactive control below — the mode
   * switch, every provider chip, the whole BYOK card, and every detected-CLI card — derives its own
   * `data-agent-*` handle from this ONE base via `agentHandleProps`/`agentSubHandle`. Omit and no
   * `data-agent-*` markup is emitted anywhere in this tab — additive, never a behavior change.
   */
  agentHandle?: string;
  useTHook?: typeof useT;
  useExecutionTabViewHook?: typeof useExecutionTabView;
}

/**
 * "Execution mode" — the Local CLI ↔ bring-your-own-key switch, its provider
 * and gateway chip rows, and the BYOK credential form.
 *
 * Controlled: the host owns `config` and persists it however it likes (in the
 * canary host that is a settings ledger). The tab owns only the async edges,
 * via `ExecutionPort`.
 *
 * Origin: `SettingsDialog.tsx` lines 4080-5336. The origin's managed-runtime
 * wallet — balance polling, top-up, sign-in coachmarks — is deliberately not
 * ported; it is product-bound, not generic.
 */
export function ExecutionTab({
  config,
  onConfigChange,
  port,
  presets = [],
  cliEnvFields = DEFAULT_AGENT_CLI_ENV_FIELDS,
  localCliUnavailableReason,
  renderAgentIcon,
  localCliScopeLabel,
  autoDetect = true,
  ariaLabel,
  apiKeyFooter,
  formFooter,
  apiKeyStoredExternally,
  apiKeyPlaceholder,
  canDiscoverModels = true,
  describeProbeError,
  agentHandle,
  useTHook = useT,
  useExecutionTabViewHook = useExecutionTabView,
}: ExecutionTabProps) {
  const t = useTHook();
  const { tab, selectedPreset, setMode, commitBaseUrl, isBaseUrlApproved } = useExecutionTabViewHook({ config, onConfigChange, port, presets, autoDetect, canDiscoverModels, describeProbeError });

  const modes: ReadonlyArray<{ id: ExecutionMode; title: string; meta: string }> = [
    { id: 'local-cli', title: t('Local CLI'), meta: t('Run an agent installed on this machine') },
    { id: 'byok', title: t('BYOK'), meta: t('Use your own API credentials') },
  ];

  return (
    <div className="jini-settings-execution" aria-label={ariaLabel ?? t('Execution mode')}>
      <ExecutionModeSwitch
        modes={modes}
        activeMode={config.mode}
        localCliUnavailableReason={localCliUnavailableReason}
        onSelect={setMode}
        agentHandle={agentHandle}
      />

      {config.mode === 'local-cli' ? (
        <LocalCliPane
          config={config}
          onConfigChange={onConfigChange}
          tab={tab}
          cliEnvFields={cliEnvFields}
          renderAgentIcon={renderAgentIcon}
          localCliScopeLabel={localCliScopeLabel}
          agentHandle={agentHandle}
        />
      ) : (
        <ByokPane
          config={config}
          onConfigChange={onConfigChange}
          presets={presets}
          selectedPreset={selectedPreset}
          tab={tab}
          canDiscoverModels={canDiscoverModels}
          canListModels={typeof port.listModels === 'function'}
          approval={{ commitBaseUrl, isBaseUrlApproved }}
          formProps={{ apiKeyFooter, formFooter, apiKeyStoredExternally, apiKeyPlaceholder }}
          agentHandle={agentHandle}
        />
      )}
    </div>
  );
}

/** The Local CLI ↔ BYOK segmented control. Local CLI is disabled, with the host's reason as its
 *  tooltip and caption, while the host says it is unavailable. */
function ExecutionModeSwitch({ modes, activeMode, localCliUnavailableReason, onSelect, agentHandle, useTHook = useT }: {
  modes: ReadonlyArray<{ id: ExecutionMode; title: string; meta: string }>;
  activeMode: ExecutionMode;
  localCliUnavailableReason: string | undefined;
  onSelect: (mode: ExecutionMode) => void;
  agentHandle: string | undefined;
  useTHook?: typeof useT;
}) {
  const t = useTHook();
  const localCliDisabled = Boolean(localCliUnavailableReason);
  return (
    <div
      className="jini-seg-control"
      role="tablist"
      aria-label={t('Execution mode')}
      style={{ '--seg-cols': modes.length } as CSSProperties}
    >
      {modes.map((mode) => {
        const disabled = mode.id === 'local-cli' && localCliDisabled;
        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={activeMode === mode.id}
            disabled={disabled}
            title={disabled ? localCliUnavailableReason : undefined}
            className={'jini-seg-btn' + (activeMode === mode.id ? ' active' : '')}
            onClick={() => onSelect(mode.id)}
            {...agentHandleProps({}, { base: agentHandle, ...({ action: `mode-${mode.id}`, role: 'button', label: mode.title }) })}
          >
            <span className="jini-seg-title">{mode.title}</span>
            <span className="jini-seg-meta">
              {disabled ? localCliUnavailableReason : mode.meta}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The BYOK half of the tab: protocol and gateway chip rows over the credential card. */
function ByokPane({
  config, onConfigChange, presets, selectedPreset, tab, canDiscoverModels, canListModels, approval, formProps, agentHandle,
  useTHook = useT,
  useByokPaneHook = useByokPane,
}: {
  config: ExecutionConfig;
  onConfigChange: (config: ExecutionConfig) => void;
  presets: readonly ProviderPreset[];
  selectedPreset: ProviderPreset | null;
  tab: ReturnType<typeof useExecutionTab>;
  canDiscoverModels: boolean;
  canListModels: boolean;
  approval: EndpointApproval;
  formProps: {
    apiKeyFooter: ReactNode;
    formFooter: ReactNode;
    apiKeyStoredExternally: boolean | undefined;
    apiKeyPlaceholder: string | undefined;
  };
  agentHandle: string | undefined;
  useTHook?: typeof useT;
  useByokPaneHook?: typeof useByokPane;
}) {
  const t = useTHook();
  const { protocols, gateways, configuredPresetIds, selectPreset, selectedPresetId } = useByokPaneHook({ config, onConfigChange, presets, selectedPreset, commitBaseUrl: approval.commitBaseUrl });
  return (
    <section className="jini-settings-section jini-settings-byok">
      <ProviderChipGroup
        label={t('Protocols')}
        presets={protocols}
        selectedPresetId={selectedPresetId}
        configuredPresetIds={configuredPresetIds}
        onSelect={selectPreset}
        configuredLabel={t('Configured')}
        unsetLabel={t('Not configured')}
        {...subHandleProps(agentHandle, 'protocol')}
      />
      <ProviderChipGroup
        label={t('Gateways')}
        presets={gateways}
        selectedPresetId={selectedPresetId}
        configuredPresetIds={configuredPresetIds}
        onSelect={selectPreset}
        configuredLabel={t('Configured')}
        unsetLabel={t('Not configured')}
        {...subHandleProps(agentHandle, 'gateway')}
      />
      <ByokProviderForm
        config={config.byok}
        onConfigChange={(byok) => onConfigChange({ ...config, byok })}
        preset={selectedPreset}
        {...subHandleProps(agentHandle, 'byok')}
        // The WHOLE catalog, not the `protocols`/`gateways` halves the chip rows take: the card
        // only reads it to recognise a pasted key as some other row's, and a key pasted from a
        // gateway into a protocol field is exactly the mistake worth naming.
        presets={presets}
        modelDiscovery={tab.modelDiscovery}
        connectionTest={tab.connectionTest}
        // Also re-runs discovery with the CURRENT byok config, not just the
        // connectivity probe — see this file's model-discovery effect above
        // for why that matters: a stale "could not load live models" error
        // from before this key existed (or from any earlier transient
        // failure) would otherwise never clear, even once Test Connection
        // itself goes green with the same config.
        onTestConnection={() => testEndpoint({ byok: config.byok, tab, approval, canDiscover: canDiscoverModels && canListModels })}
        // Typing only patches the displayed config; blur or Enter is the operator committing the
        // endpoint for the CURRENT provider/protocol pair.
        onBaseUrlCommit={({ baseUrl }) => approval.commitBaseUrl({ endpoint: { providerId: config.byok.providerId, protocol: config.byok.protocol, baseUrl } })}
        {...(formProps.apiKeyFooter !== undefined ? { apiKeyFooter: formProps.apiKeyFooter } : {})}
        {...(formProps.formFooter !== undefined ? { formFooter: formProps.formFooter } : {})}
        {...(formProps.apiKeyStoredExternally !== undefined ? { apiKeyStoredExternally: formProps.apiKeyStoredExternally } : {})}
        {...(formProps.apiKeyPlaceholder !== undefined ? { apiKeyPlaceholder: formProps.apiKeyPlaceholder } : {})}
      />
    </section>
  );
}

type EndpointApproval = Pick<ReturnType<typeof useExecutionTabView>, 'commitBaseUrl' | 'isBaseUrlApproved'>;

/**
 * Test connection is an explicit commit of the endpoint it tests. An incomplete or disallowed URL
 * goes to neither probe (the key would travel with it). Approval is read BEFORE committing: a newly
 * approved endpoint is discovered by the tab's automatic discovery effect, so calling `loadModels`
 * here too would probe it twice; an already approved one gets this explicit discovery retry, which
 * is what clears a stale "could not load live models" error once the connection itself goes green.
 */
function testEndpoint({ byok, tab, approval, canDiscover }: {
  byok: ExecutionConfig['byok']; tab: ReturnType<typeof useExecutionTab>; approval: EndpointApproval; canDiscover: boolean;
}, _optional = {}): void {
  const trimmed = byok.baseUrl.trim();
  if (trimmed && !isValidApiBaseUrl({ raw: trimmed })) return;
  const endpoint = { providerId: byok.providerId, protocol: byok.protocol, baseUrl: trimmed };
  const wasApproved = approval.isBaseUrlApproved({ endpoint });
  approval.commitBaseUrl({ endpoint });
  tab.testConnection({ ...byok, baseUrl: trimmed });
  if (wasApproved && canDiscover) tab.loadModels({ ...byok, baseUrl: trimmed });
}

/** The Local CLI half of the tab: detected agents, wired to the config's next-state rules. */
function LocalCliPane({ config, onConfigChange, tab, cliEnvFields, renderAgentIcon, localCliScopeLabel, agentHandle }: {
  config: ExecutionConfig;
  onConfigChange: (config: ExecutionConfig) => void;
  tab: ReturnType<typeof useExecutionTab>;
  cliEnvFields: readonly AgentCliEnvFieldSpec[];
  renderAgentIcon: ExecutionTabProps['renderAgentIcon'];
  localCliScopeLabel: ExecutionTabProps['localCliScopeLabel'];
  agentHandle: string | undefined;
}) {
  return (
    <LocalCliAgentList
      agents={tab.agents}
      config={config.localCli}
      scan={tab.scan}
      agentTest={tab.agentTest}
      onSelect={(agentId) => onConfigChange(nextConfigForAgentSelect({ config, agentId }))}
      onModelChange={(agentId, model) =>
        onConfigChange(nextConfigForAgentModel({ config, agentId, model }))
      }
      onReasoningChange={(agentId, reasoning) =>
        onConfigChange(nextConfigForAgentReasoning({ config, agentId, reasoning }))
      }
      onEnvChange={(agentId, envKey, value) =>
        onConfigChange(nextConfigForAgentCliEnvChange({ config, agentId, envKey, rawValue: value }))
      }
      cliEnvFields={cliEnvFields}
      onRescan={tab.canRescan ? tab.rescan : undefined}
      onTest={
        tab.canTestAgent
          ? (agent) => tab.testAgent(agent.id, selectedAgentModel({ config: config.localCli, agent }) || undefined)
          : undefined
      }
      renderAgentIcon={renderAgentIcon}
      scopeLabel={localCliScopeLabel}
      {...subHandleProps(agentHandle, 'local-cli')}
    />
  );
}

/** `{ agentHandle }` for a child's sub-handle under this tab's base, or nothing when no base is set. */
function subHandleProps(agentHandle: string | undefined, action: string): { agentHandle?: string } {
  return agentHandle ? { agentHandle: agentSubHandle({ base: agentHandle, action }) } : {};
}
