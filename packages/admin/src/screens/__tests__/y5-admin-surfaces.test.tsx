import { bindProviders } from "../providers/Providers.js";
import { TabBar } from "@jini-ai/ui/tab-strip";
import { cleanup, act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { EmailStatusFacts } from "../email/EmailSenderTab.js";
import { createEmailNavigate } from "../email/Email.hooks.js";
import { useScreenshotCleanup } from "../storage/hooks/use-screenshot-cleanup.hooks.js";

afterEach(cleanup);

test("email facts show the verified sender domain and omit absent domains", () => {
  const mounted = render(<EmailStatusFacts status={{ mailDeliveryAvailable: true, senderDomainVerification: { state: "verified", domain: "example.test", providerId: "mail" } }} locale="en" />);
  expect(screen.getByText("example.test")).toBeTruthy();
  expect(screen.getByText("Verified by the provider")).toBeTruthy();
  mounted.rerender(<EmailStatusFacts status={{ mailDeliveryAvailable: false }} locale="en" />);
  expect(screen.queryByText("example.test")).toBeNull();
});

test("email navigation encodes the section and preserves replace navigation", () => {
  const navigate = vi.fn();
  const go = createEmailNavigate({ deps: { navigate, routePath: "/email", tabKey: "tab", partKey: "p" } });
  go({ tabId: "sender", part: "dns & records/one" });
  expect(navigate).toHaveBeenLastCalledWith({ routePath: "/email?tab=sender&p=dns%20%26%20records%2Fone" }, { replace: true });
  go({ tabId: "overview", part: null });
  expect(navigate).toHaveBeenLastCalledWith({ routePath: "/email?tab=overview" }, { replace: true });
});

test("screenshot retention previews before cleanup and applies only the preview token", async () => {
  const preview = vi.fn(async () => ({ previewToken: "shown", deadline: 100, count: 1, bytes: 12, items: ["old.png"] }));
  const apply = vi.fn(async () => ({ deleted: ["old.png"], kept: [] }));
  const { result } = renderHook(() => useScreenshotCleanup({ client: { preview, apply }, describeError: () => "failed" }));
  await act(() => result.current.confirm());
  expect(apply).not.toHaveBeenCalled();
  await act(() => result.current.preview({ before: 25 }));
  expect(preview).toHaveBeenCalledWith({ before: 25 });
  expect(apply).not.toHaveBeenCalled();
  await act(() => result.current.confirm());
  expect(apply).toHaveBeenCalledExactlyOnceWith({ previewToken: "shown" });
});

test("providers localize labels, fall back to External MCP, and keep Soon bodies inert", () => {
  const useIntegrationsHook = vi.fn(() => { throw new Error("unmounted webhook controller"); });
  const kit: Parameters<typeof bindProviders>[0]["kit"] = {
    TabBar,
    I18nProvider: ({ children }) => <>{children}</>,
    ExternalMcpSettingsPanel: ({ saveStatusLabel }) => <div>{saveStatusLabel ?? "external"}</div>,
    AlwaysAllowPanel: () => <div>allow</div>,
    McpServer: () => <button>demo command</button>,
    Webhooks: () => <button>demo webhook</button>,
    ComingSoonPanel: ({ children, label, note }) => <section><p>{label}</p><p>{note}</p><div inert>{children}</div></section>,
  };
  const Bound = bindProviders({ kit, hooks: {
    useProvidersHook: () => ({ externalMcp: { dependencies: { port: { fetchSources: async () => [], addSource: async () => ({ ok: true }), removeSource: async () => true } }, restartRequired: true } }),
    useAdminLocale: () => "fr", useAdminThemeBoundary: () => ({ "data-theme": "light" }), useIntegrationsHook,
  }, deps: {
    dictionaries: {}, t: ({ locale, key }) => `${locale}:${key}`, tIntegrations: ({ locale, key }) => `${locale}:${key}`,
    restartLabel: ({ locale }) => `${locale}:restart`, mcpServerHandleLabel: "host MCP", onTabChange: vi.fn(),
  } });
  const mounted = render(<Bound tabId="retired" />);
  expect(screen.getByText("fr:restart")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "fr:Integrations" })).toBeTruthy();
  mounted.rerender(<Bound tabId="mcp-server" />);
  expect(screen.getByText("demo command").closest("[inert]")).toBeTruthy();
  expect(screen.getByText("fr:Nothing below is connected to anything yet.")).toBeTruthy();
  mounted.rerender(<Bound tabId="webhooks" />);
  expect(screen.getByText("demo webhook").closest("[inert]")).toBeTruthy();
  expect(useIntegrationsHook).not.toHaveBeenCalled();
});
