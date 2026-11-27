// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { navigateProvidersTab } from "../Providers.hooks.js";
import { bindProviders, type ProvidersProps } from "../Providers.js";

it("switches from a clean External MCP tab to the Always allow deep link without adding a history entry", async () => {
  const user = userEvent.setup();
  const url = window.location.href;
  const state = window.history.state;
  const restartLabel = vi.fn(() => "Restart to apply");
  const dependency = { port: { fetchSources: async () => [], addSource: async () => ({ ok: true }), removeSource: async () => true } };
  const wiredFallback = () => ({ dependencies: dependency, restartRequired: false });
  const fallbackIntegrations = () => { throw new Error("not in the Webhooks tab"); };
  const kit: ProvidersProps["kit"] = {
    TabBar: fakeAdminKit().components.TabBar,
    I18nProvider: ({ children }) => <>{children}</>,
    ExternalMcpSettingsPanel: ({ dependencies, showTitle, saveStatusLabel }) =>
      <p>{dependencies === dependency && !showTitle ? (saveStatusLabel ?? "No pending restart") : "Incorrect MCP configuration"}</p>,
    AlwaysAllowPanel: () => <p>Workspace approvals</p>,
    McpServer: () => <p>MCP server setup</p>,
    Webhooks: () => <p>Webhook setup</p>,
    ComingSoonPanel: ({ children }) => <>{children}</>,
  };
  const Bound = bindProviders({
    kit, hooks: { useAdminThemeBoundary: () => ({}), useAdminLocale: () => "en", useExternalMcp: wiredFallback, useIntegrationsHook: fallbackIntegrations },
    deps: { dictionaries: {}, t: ({ key }) => key, tIntegrations: ({ key }) => key, restartLabel, mcpServerHandleLabel: "MCP server", onTabChange: navigateProvidersTab },
  });
  try {
    history.replaceState(null, "", "/admin/addons/integrations?tab=external-mcp");
    const length = history.length;
    const view = render(<Bound tabId="external-mcp" />);
    expect(screen.getByText("No pending restart")).toBeInTheDocument();
    expect(restartLabel).not.toHaveBeenCalled();
    expect(screen.queryByText("Workspace approvals")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Always allow" }));
    expect(location.pathname + location.search).toBe("/admin/addons/integrations?tab=always-allow");
    expect(history.length).toBe(length);
    view.rerender(<Bound tabId={new URLSearchParams(location.search).get("tab")} />);
    expect(screen.getByRole("tab", { name: "Always allow" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Workspace approvals")).toBeInTheDocument();
    expect(screen.queryByText("No pending restart")).toBeNull();
  } finally {
    history.replaceState(state, "", url);
  }
});
