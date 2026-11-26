import type { ProvidersProps } from "./Providers.js";

function ExternalMcpBody(props: ProvidersProps & { p: ReturnType<ProvidersProps["hooks"]["useProvidersHook"]>; locale: string; activeTabId: string }, _optional = {}) {
  const { p, locale, activeTabId, kit, deps } = props;
  const { ExternalMcpSettingsPanel, AlwaysAllowPanel, McpServer, Webhooks, ComingSoonPanel } = kit;
  const { t, tIntegrations } = deps;
  return <>
        {activeTabId === "external-mcp" ? (
          // Verbatim from the Settings page's old "External MCP" tab, plus one addition
          // (2026-09-10): `showTitle={false}`. The panel's own `<h3>External MCP servers</h3>`
          // duplicated the TabBar tab above it once this became a sub-tab here rather than a
          // standalone Settings tab — see `ExternalMcpSettingsPanel.tsx`'s own `showTitle` doc for
          // why the subtitle stays regardless. `saveStatusLabel` carries the restart notice rather
          // than "All changes saved", for the reason that tab's own comment gave: a saved row is
          // persisted but NOT live, because the admitted tool set is frozen at connect
          // (`Jini packages/mcp/src/federation/trust.ts` R5). Telling an operator their change is saved, while the
          // running assistant still cannot see the server, would be true and useless. D-33
          // (2026-10-06): show it only after an actual configuration save — the standing "Changes
          // apply when the host restarts" pill read as a pending change on a fresh site.
          <ExternalMcpSettingsPanel
            dependencies={p.externalMcp.dependencies}
            showTitle={false}
            saveStatusLabel={
              p.externalMcp.restartRequired
                ? deps.restartLabel({ locale })
                : undefined
            }
          />
        ) : null}

  </>;
}

function AlwaysAllowBody(props: ProvidersProps & { p: ReturnType<ProvidersProps["hooks"]["useProvidersHook"]>; locale: string; activeTabId: string }, _optional = {}) {
  const { p, locale, activeTabId, kit, deps } = props;
  const { ExternalMcpSettingsPanel, AlwaysAllowPanel, McpServer, Webhooks, ComingSoonPanel } = kit;
  const { t, tIntegrations } = deps;
  return <>
        {activeTabId === "always-allow" ? <AlwaysAllowPanel /> : null}

  </>;
}

function McpServerBody(props: ProvidersProps & { p: ReturnType<ProvidersProps["hooks"]["useProvidersHook"]>; locale: string; activeTabId: string }, _optional = {}) {
  const { p, locale, activeTabId, kit, deps } = props;
  const { ExternalMcpSettingsPanel, AlwaysAllowPanel, McpServer, Webhooks, ComingSoonPanel } = kit;
  const { t, tIntegrations } = deps;
  return <>
        {activeTabId === "mcp-server" ? (
          // `<IntegrationsTab>` with no `port` prop falls back to `createFakeMcpIntegrationsPort()`,
          // whose demo install command (`{command: "node", args: ["/path/to/cli.js", "mcp"]}`) is
          // not a real path on any install. Found 2026-09-19. First fix deleted the setup card
          // outright; the owner's follow-up call was to keep it VISIBLE (so an operator can see
          // what's coming) but genuinely inert — `ComingSoonPanel` (own file, full reasoning there)
          // is the shared wash+`inert` wrapper for that, reused below for Webhooks too. Wiring a
          // real `McpIntegrationsPort` (see `development/todos.md`'s "make the MCP Server real"
          // item) is a one-line change: drop this wrapper and pass a live `port`.
          <ComingSoonPanel
            label={tIntegrations({ locale: locale, key: "Coming soon" })}
            note={tIntegrations({ locale: locale, key: "Nothing below is connected to anything yet." })}
          >
            <McpServer />
          </ComingSoonPanel>
        ) : null}

  </>;
}

function WebhooksBody(props: ProvidersProps & { p: ReturnType<ProvidersProps["hooks"]["useProvidersHook"]>; locale: string; activeTabId: string }, _optional = {}) {
  const { p, locale, activeTabId, kit, deps } = props;
  const { ExternalMcpSettingsPanel, AlwaysAllowPanel, McpServer, Webhooks, ComingSoonPanel } = kit;
  const { t, tIntegrations } = deps;
  return <>
        {activeTabId === "webhooks" ? (
          // Same treatment as MCP Server above (owner call, 2026-09-19): firing a webhook needs an
          // event checklist that isn't built. `Integrations` (the webhooks list) renders no
          // `page`/`page-header` of its own — see that component's own doc comment for why: it was
          // built to be a tab body under a single page shell, first `DeveloperApi.tsx`'s, now this
          // one.
          <ComingSoonPanel
            label={tIntegrations({ locale: locale, key: "Coming soon" })}
            note={tIntegrations({ locale: locale, key: "Webhooks can't fire yet — nothing here is wired up." })}
          >
            <Webhooks useIntegrationsHook={props.hooks.useIntegrationsHook} />
          </ComingSoonPanel>
        ) : null}
  </>;
}

export function ProvidersTabBody(props: ProvidersProps & { p: ReturnType<ProvidersProps["hooks"]["useProvidersHook"]>; locale: string; activeTabId: string }, _optional = {}) {
  return <><ExternalMcpBody {...props} /><AlwaysAllowBody {...props} /><McpServerBody {...props} /><WebhooksBody {...props} /></>;
}
