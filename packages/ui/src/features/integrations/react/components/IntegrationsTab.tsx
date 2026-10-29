import { useMemo, useState } from 'react';
import { agentHandleProps, agentSubHandle } from '@jini-ai/agentic';
import { useT, type I18nContextValue } from '../../../i18n/index.js';
import { DEFAULT_MCP_CLIENT_ID, DEFAULT_MCP_SERVER_NAME, MCP_CLIENTS } from '../../constants.js';
import { createFakeMcpIntegrationsPort } from '../../dependencies.js';
import type { McpIntegrationsPort } from '../../ports.js';
import {
  isMcpInstallPrerequisiteMissing,
  methodLabelForClient,
  snippetForClient,
} from '../../rules.js';
import type { McpClientDescriptor, McpClientId, McpClientSnippet, McpInstallInfo } from '../../types.js';
import { useMcpInstallInfo } from '../hooks/useMcpInstallInfo.js';
import { ClientPicker } from './ClientPicker.js';
import { SnippetBlock } from './SnippetBlock.js';
import { CodexInstallToggleButton } from './CodexInstallToggleButton.js';

export interface IntegrationsTabProps {
  /** The MCP server name every generated snippet installs under — the
   *  parameter that replaces the origin's hardcoded product-name literal.
   *  Required: this is the one thing that makes the generated snippets
   *  actually correct for a given host. */
  serverName?: string;
  clients?: readonly McpClientDescriptor[];
  initialClientId?: McpClientId;
  /** Defaults to an in-memory fake — supply a real `McpIntegrationsPort`
   *  bound to your own daemon for production use. */
  port?: McpIntegrationsPort;
  capabilitiesTitle?: string;
  capabilities?: readonly string[];
  /**
   * This tab's own agent handle. The client picker, the one-click install link, and the Codex
   * install/uninstall toggle all derive their own `data-agent-*` handle from this ONE base.
   */
  agentHandle?: string;
}

/**
 * Multi-client "install me as an MCP server" snippet generator. Origin:
 * `IntegrationsSection` in `SettingsDialog.tsx` — r6 §1.3: "Generic
 * mechanism, 100% branded content." Every snippet builder in `rules.ts` now
 * takes `serverName` as an explicit parameter instead of the origin's
 * hardcoded product-name literal, and the daemon transport
 * (`/api/mcp/install-info`, `/api/mcp/install/codex*`) is routed through the
 * injected `McpIntegrationsPort` instead of a hardcoded `fetch()` call.
 */
export function IntegrationsTab({
  serverName = DEFAULT_MCP_SERVER_NAME,
  clients = MCP_CLIENTS,
  initialClientId = DEFAULT_MCP_CLIENT_ID,
  port,
  capabilitiesTitle,
  capabilities,
  agentHandle,
}: IntegrationsTabProps) {
  const t = useT();
  const resolvedPort = useMemo(() => port ?? createFakeMcpIntegrationsPort(), [port]);
  const [clientId, setClientId] = useState<McpClientId>(initialClientId);
  const { info, error, loading } = useMcpInstallInfo(resolvedPort);
  const { client, resolved } = resolveClientSnippet({ clients, clientId, serverName, info });

  return (
    <section className="jini-settings-section jini-settings-integrations">
      <DaemonErrorCard error={error} />

      <CapabilitiesCard title={capabilitiesTitle} lines={capabilities} />

      <div className="jini-mcp-setup-card">
        <ClientPicker
          clients={clients}
          selectedClientId={clientId}
          onSelect={setClientId}
          {...methodLabelProps({ resolved, info, clients, t })}
          {...childHandleProps({ agentHandle, action: 'client' })}
        />

        {resolved ? <p className="jini-mcp-instruction">{t(resolved.instructionTemplate, resolved.instructionVars)}</p> : null}

        {client?.id === 'codex' ? (
          <CodexInstallToggleButton port={resolvedPort} {...childHandleProps({ agentHandle, action: 'codex-toggle' })} />
        ) : null}

        {resolved?.deeplink && info ? <DeeplinkInstallRow deeplink={resolved.deeplink} info={info} agentHandle={agentHandle} /> : null}

        <InstallSnippet resolved={resolved} loading={loading} error={error} />

        <PrerequisiteWarning info={info} />

        <div className="jini-mcp-restart-note">
          <strong>{t('Restart your client after installing.')}</strong>{' '}
          <span>{t('Most MCP clients only pick up new servers on restart.')}</span>
        </div>
      </div>
    </section>
  );
}

/**
 * The client the picker shows, and the snippet generated for THAT client (`null` until install
 * info loads, or when `clients` is empty).
 */
function resolveClientSnippet({
  clients,
  clientId,
  serverName,
  info,
}: {
  clients: readonly McpClientDescriptor[];
  clientId: McpClientId;
  serverName: string;
  info: McpInstallInfo | null;
}): { client: McpClientDescriptor | undefined; resolved: McpClientSnippet | null } {
  // Resolve the client ONCE, then generate from THAT — rather than displaying a
  // fallback while generating from the raw stored id. `initialClientId` defaults
  // to a constant a host with a restricted `clients` list need not include, and
  // `clientId` also survives a later change to `clients`. So the picker showed
  // `clients[0]` — say "Codex" — with its one-click button, while the page
  // generated `claude mcp add-json …` and told the operator to run it, for a
  // client the host had deliberately excluded.
  const client = clients.find((c) => c.id === clientId) ?? clients[0];
  const resolved = info && client ? snippetForClient(client.id, serverName, info) : null;
  return { client, resolved };
}

/** The picker's trigger subtitle and per-row method labels, both blank until install info loads. */
function methodLabelProps({
  resolved,
  info,
  clients,
  t,
}: {
  resolved: McpClientSnippet | null;
  info: McpInstallInfo | null;
  clients: readonly McpClientDescriptor[];
  t: I18nContextValue['t'];
}): { methodLabel: string | undefined; methodLabels: Partial<Record<McpClientId, string>> | undefined } {
  // Origin gates every `buildMethod(info)` call on `info` being loaded
  // (`info ? client.buildMethod(info) : ''` for the trigger subtitle, same
  // guard for each dropdown row) — replicated here so the method labels
  // stay blank rather than flashing in before the rest of the install info.
  const methodLabel = resolved ? t(resolved.method) : undefined;
  const methodLabels = info
    ? (Object.fromEntries(clients.map((c) => [c.id, t(methodLabelForClient(c.id))])) as Partial<Record<McpClientId, string>>)
    : undefined;
  return { methodLabel, methodLabels };
}

/** `{ agentHandle }` for a child, derived from this tab's ONE base handle — or `{}` when the host published none. */
function childHandleProps({ agentHandle, action }: { agentHandle: string | undefined; action: string }): { agentHandle?: string } {
  return agentHandle ? { agentHandle: agentSubHandle({ base: agentHandle, action }) } : {};
}

/** Inline card for a failed install-info fetch; nothing while there is no error. */
function DaemonErrorCard({ error }: { error: string | null }) {
  const t = useT();
  if (!error) return null;
  return <div className="jini-empty-card jini-empty-card-error">{t('Could not reach the daemon: {error}', { error })}</div>;
}

/** "What this server can do" card: the host's title and lines, or the generic defaults. */
function CapabilitiesCard({ title, lines }: { title: string | undefined; lines: readonly string[] | undefined }) {
  const t = useT();
  const resolvedCapabilitiesTitle = title ?? t('What this server can do');
  const resolvedCapabilities = lines ?? [
    t('Read your project files'),
    t('Pull context into the conversation'),
    t('Use default, safe tool permissions'),
  ];
  return (
    <div className="jini-mcp-capabilities-card">
      <p className="jini-mcp-capabilities-label">{resolvedCapabilitiesTitle}</p>
      <ul className="jini-mcp-capabilities-list">
        {resolvedCapabilities.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** One-click deeplink install, inert (no `href`, `aria-disabled`) while a prerequisite is missing. */
function DeeplinkInstallRow({ deeplink, info, agentHandle }: { deeplink: string; info: McpInstallInfo; agentHandle: string | undefined }) {
  const t = useT();
  const prerequisiteMissing = isMcpInstallPrerequisiteMissing(info);
  return (
    <div className="jini-mcp-deeplink-row">
      <a
        className={`jini-button jini-button-primary${prerequisiteMissing ? ' jini-button-disabled' : ''}`}
        // Origin disables this button via `disabled={!info.cliExists ||
        // !info.nodeExists}` — one-click install can't work until the
        // daemon/CLI prerequisite is actually built. An `<a>` has no
        // native `disabled`, so drop `href` (making it inert/
        // unfocusable-as-a-link) and mark `aria-disabled` instead of
        // silently letting the click through to a config that won't
        // work.
        href={prerequisiteMissing ? undefined : deeplink}
        aria-disabled={prerequisiteMissing || undefined}
        onClick={(event) => {
          if (prerequisiteMissing) event.preventDefault();
        }}
        rel="noopener noreferrer"
        {...agentHandleProps({}, { base: agentHandle, action: 'one-click-install', role: 'link', label: t('One-click install') })}
      >
        {t('One-click install')}
      </a>
      <span className="jini-hint">{t('Your editor will ask you to approve the install.')}</span>
    </div>
  );
}

/** The generated snippet, or a loading / could-not-resolve placeholder while there is none. */
function InstallSnippet({ resolved, loading, error }: { resolved: McpClientSnippet | null; loading: boolean; error: string | null }) {
  const t = useT();
  let placeholder = '';
  if (loading) placeholder = t('Loading install paths…');
  else if (error) placeholder = t('Could not resolve install paths.');
  return (
    <SnippetBlock
      snippet={resolved?.snippet ?? ''}
      language={resolved?.language ?? 'json'}
      placeholder={placeholder}
    />
  );
}

/** Build/Node warning, shown only once install info has loaded and reports a missing prerequisite. */
function PrerequisiteWarning({ info }: { info: McpInstallInfo | null }) {
  const t = useT();
  if (!info || !isMcpInstallPrerequisiteMissing(info)) return null;
  return (
    <div className="jini-empty-card jini-empty-card-warning">
      <strong>{!info.cliExists ? t('Build the server first.') : t('Node.js was not found.')}</strong>{' '}
      {info.buildHint ?? t('See your host application for build instructions.')}
    </div>
  );
}
