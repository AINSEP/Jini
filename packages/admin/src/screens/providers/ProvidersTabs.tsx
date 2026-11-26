import type { TabBarTab } from "../../react/kit.js";
import type { ProvidersProps } from "./Providers.js";

function TabIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      {children}
    </svg>
  );
}

function externalMcpTab({ locale, deps }: { locale: string; deps: ProvidersProps["deps"] }, _optional = {}): TabBarTab {
  const { t, tIntegrations } = deps;
  return {
      id: "external-mcp",
      label: t({ locale: locale, key: "External MCP" }),
      icon: (
        <TabIcon>
          <path d="M6 3v4M12 3v4M4.5 7h9v2a4.5 4.5 0 0 1-9 0z" />
          <path d="M9 13.5V16" />
        </TabIcon>
      ),
      handle: "providers-tab-external-mcp",
      handleLabel: "Switch to the External MCP tab — MCP tool servers this install connects out to",
  };
}

function alwaysAllowTab({ locale, deps }: { locale: string; deps: ProvidersProps["deps"] }, _optional = {}): TabBarTab {
  const { t, tIntegrations } = deps;
  return {
      id: "always-allow",
      label: t({ locale: locale, key: "Always allow" }),
      icon: (
        <TabIcon>
          <path d="M9 2.5l5.5 2v4.2c0 3.3-2.3 5.9-5.5 6.8-3.2-.9-5.5-3.5-5.5-6.8V4.5z" />
          <path d="M6.5 9l1.8 1.8L11.5 7.5" />
        </TabIcon>
      ),
      handle: "providers-tab-always-allow",
      handleLabel: "Switch to the Always allow tab — external tools that run without asking, each with a Revoke button",
  };
}

function mcpServerTab({ locale, deps }: { locale: string; deps: ProvidersProps["deps"] }, _optional = {}): TabBarTab {
  const { t, tIntegrations } = deps;
  return {
      // Absorbed from `DeveloperApi.tsx`'s own `mcp-server` tab (2026-09-10, second pass) — same id,
      // same label source (`integrations-i18n.tsx`'s own `t`, reused rather than re-translated), same
      // icon, same body (`IntegrationsTab`, now `ComingSoonPanel`-wrapped — see the render block
      // below).
      id: "mcp-server",
      label: tIntegrations({ locale: locale, key: "MCP Server" }),
      // Not wired to a real McpIntegrationsPort yet (see the render block below) — the tag says so
      // from the tab strip itself, before an operator clicks in. Tab stays fully clickable; see
      // `TabBarTab.tag`'s own doc for why this isn't `disabled` instead.
      tag: tIntegrations({ locale: locale, key: "Soon" }),
      icon: (
        <TabIcon>
          <path d="M4 6.5h10M4 11.5h10" />
          <circle cx="6.5" cy="6.5" r="1.5" />
          <circle cx="11.5" cy="11.5" r="1.5" />
        </TabIcon>
      ),
      handle: "providers-tab-mcp-server",
      handleLabel: deps.mcpServerHandleLabel,
  };
}

function webhooksTab({ locale, deps }: { locale: string; deps: ProvidersProps["deps"] }, _optional = {}): TabBarTab {
  const { t, tIntegrations } = deps;
  return {
      // Absorbed from `DeveloperApi.tsx`'s own `webhooks` tab — see the `mcp-server` tab above for
      // the shape of this move.
      id: "webhooks",
      label: tIntegrations({ locale: locale, key: "Webhooks" }),
      // Same "Soon" tag as MCP Server (2026-09-19, owner call): firing a webhook needs an event
      // checklist that doesn't exist yet. Confirmed no saved endpoints exist to hide behind the
      // wash (owner's own screenshot: "No webhooks yet").
      tag: tIntegrations({ locale: locale, key: "Soon" }),
      icon: (
        <TabIcon>
          <path d="M6 6l-3 3 3 3M12 6l3 3-3 3M10 4l-2 10" />
        </TabIcon>
      ),
      handle: "providers-tab-webhooks",
      handleLabel: "Switch to the Webhooks tab — outbound webhooks this site sends when its content changes (soon)",
  };
}

export function providersTabs(required: { locale: string; deps: ProvidersProps["deps"] }, _optional = {}): TabBarTab[] {
  return [externalMcpTab(required), alwaysAllowTab(required), mcpServerTab(required), webhooksTab(required)];
}
