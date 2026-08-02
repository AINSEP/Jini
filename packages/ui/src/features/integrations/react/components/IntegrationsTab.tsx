import { useMemo, useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { DEFAULT_MCP_CLIENT_ID, DEFAULT_MCP_SERVER_NAME, MCP_CLIENTS } from '../../constants.js';
import { createFakeMcpIntegrationsPort } from '../../dependencies.js';
import type { McpIntegrationsPort } from '../../ports.js';
import {
  isMcpInstallPrerequisiteMissing,
  methodLabelForClient,
  snippetForClient,
} from '../../rules.js';
import type { McpClientDescriptor, McpClientId } from '../../types.js';
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
}: IntegrationsTabProps) {
  const t = useT();
  const resolvedPort = useMemo(() => port ?? createFakeMcpIntegrationsPort(), [port]);
  const [clientId, setClientId] = useState<McpClientId>(initialClientId);
  const { info, error, loading } = useMcpInstallInfo(resolvedPort);

  // Resolve the client ONCE, then generate from THAT — rather than displaying a
  // fallback while generating from the raw stored id. `initialClientId` defaults
  // to a constant a host with a restricted `clients` list need not include, and
  // `clientId` also survives a later change to `clients`. So the picker showed
  // `clients[0]` — say "Codex" — with its one-click button, while the page
  // generated `claude mcp add-json …` and told the operator to run it, for a
  // client the host had deliberately excluded.
  const client = clients.find((c) => c.id === clientId) ?? clients[0];
  const resolved = info && client ? snippetForClient(client.id, serverName, info) : null;

  // Origin gates every `buildMethod(info)` call on `info` being loaded
  // (`info ? client.buildMethod(info) : ''` for the trigger subtitle, same
  // guard for each dropdown row) — replicated here so the method labels
  // stay blank rather than flashing in before the rest of the install info.
  const methodLabel = resolved ? t(resolved.method) : undefined;
  const methodLabels = info
    ? (Object.fromEntries(clients.map((c) => [c.id, t(methodLabelForClient(c.id))])) as Partial<Record<McpClientId, string>>)
    : undefined;

  const resolvedCapabilitiesTitle = capabilitiesTitle ?? t('What this server can do');
  const resolvedCapabilities = capabilities ?? [
    t('Read your project files'),
    t('Pull context into the conversation'),
    t('Use default, safe tool permissions'),
  ];

  return (
    <section className="jini-settings-section jini-settings-integrations">
      {error ? <div className="jini-empty-card jini-empty-card-error">{t('Could not reach the daemon: {error}', { error })}</div> : null}

      <div className="jini-mcp-capabilities-card">
        <p className="jini-mcp-capabilities-label">{resolvedCapabilitiesTitle}</p>
        <ul className="jini-mcp-capabilities-list">
          {resolvedCapabilities.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="jini-mcp-setup-card">
        <ClientPicker
          clients={clients}
          selectedClientId={clientId}
          onSelect={setClientId}
          methodLabel={methodLabel}
          methodLabels={methodLabels}
        />

        {resolved ? <p className="jini-mcp-instruction">{t(resolved.instructionTemplate, resolved.instructionVars)}</p> : null}

        {client?.id === 'codex' ? <CodexInstallToggleButton port={resolvedPort} /> : null}

        {resolved?.deeplink && info ? (
          <div className="jini-mcp-deeplink-row">
            <a
              className={`jini-button jini-button-primary${isMcpInstallPrerequisiteMissing(info) ? ' jini-button-disabled' : ''}`}
              // Origin disables this button via `disabled={!info.cliExists ||
              // !info.nodeExists}` — one-click install can't work until the
              // daemon/CLI prerequisite is actually built. An `<a>` has no
              // native `disabled`, so drop `href` (making it inert/
              // unfocusable-as-a-link) and mark `aria-disabled` instead of
              // silently letting the click through to a config that won't
              // work.
              href={isMcpInstallPrerequisiteMissing(info) ? undefined : resolved.deeplink}
              aria-disabled={isMcpInstallPrerequisiteMissing(info) || undefined}
              onClick={(event) => {
                if (isMcpInstallPrerequisiteMissing(info)) event.preventDefault();
              }}
              rel="noopener noreferrer"
            >
              {t('One-click install')}
            </a>
            <span className="jini-hint">{t('Your editor will ask you to approve the install.')}</span>
          </div>
        ) : null}

        <SnippetBlock
          snippet={resolved?.snippet ?? ''}
          language={resolved?.language ?? 'json'}
          placeholder={loading ? t('Loading install paths…') : error ? t('Could not resolve install paths.') : ''}
        />

        {info && isMcpInstallPrerequisiteMissing(info) ? (
          <div className="jini-empty-card jini-empty-card-warning">
            <strong>{!info.cliExists ? t('Build the server first.') : t('Node.js was not found.')}</strong>{' '}
            {info.buildHint ?? t('See your host application for build instructions.')}
          </div>
        ) : null}

        <div className="jini-mcp-restart-note">
          <strong>{t('Restart your client after installing.')}</strong>{' '}
          <span>{t('Most MCP clients only pick up new servers on restart.')}</span>
        </div>
      </div>
    </section>
  );
}
