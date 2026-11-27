// @vitest-environment jsdom
import { render, screen, testAdminKit, within } from "../../../__tests__/fetch-query-support.js";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Observability, type ObservabilityProps } from "../Observability.js";
import { useObservabilityTab } from "../hooks/use-observability-tab.hooks.js";
import type { ObservabilityStatusController } from "../hooks/use-observability-status.hooks.js";

const t = (key: string) => key;
const at = "2026-10-15T00:00:00.000Z";

function setup(status: Partial<ObservabilityStatusController> = {}) {
  const navigate = vi.fn();
  const readToolGaps = vi.fn(async () => ({ entries: [] }));
  const useRecentServerErrorsHook = vi.fn<ObservabilityProps["useRecentServerErrorsHook"]>(() => ({
    rows: [], logs: { entries: [], matched: 0, buffered: 0, truncated: false, capturing: true },
    loading: false, error: null, refresh: () => {},
    clipboard: { copyText: async () => false }, t,
  }));
  const props: ObservabilityProps = {
    productName: "Orchard", useObservabilityStatusHook: () => ({ status: null, error: null, locale: "en", t, ...status }),
    useRecentServerErrorsHook, useRecentErrorItemHook: () => { throw new Error("No recent error row expected"); },
    useQueriesTabHook: () => ({ visible: false, readOnly: true }),
    QueryCachePanel: () => <p>Live cache entries</p>, readToolGaps,
    useAdminThemeBoundaryHook: () => ({ "data-theme": "dark" }),
    useObservabilityTabHook: (args) => useObservabilityTab({
      ...args, useTabbedDialogHook: testAdminKit.hooks.useTabbedDialog, useAdminKitValuesHook: () => testAdminKit.values, navigate,
    }),
    useAdminKitValuesHook: () => testAdminKit.values,
    layoutClassNames: {
      page: "host-page", header: "host-header", headerText: "host-header-text",
      kicker: "host-kicker", title: "host-title", description: "host-description", section: "host-section",
    },
  };
  return { props, navigate, readToolGaps, useRecentServerErrorsHook };
}

it("distinguishes checking, failure and disabled status without offering an unauthorized diagnostic", () => {
  const { props, useRecentServerErrorsHook, readToolGaps } = setup();
  const { rerender } = render(<Observability {...props} />);
  expect(screen.getByRole("heading", { name: "Observability" })).toHaveClass("host-title");
  expect(screen.getByRole("status")).toHaveTextContent("Checking current status…");
  expect(screen.getByRole("link", { name: "Read the OpenTelemetry documentation" }))
    .toHaveAttribute("href", "https://opentelemetry.io/docs/");
  expect(screen.getByRole("region", { name: "Observability Overview" }).closest(".host-section")).toHaveAttribute("data-theme", "dark");
  expect(screen.queryByRole("button", { name: "Send test error" })).toBeNull();

  rerender(<Observability {...props} useObservabilityStatusHook={() => ({
    status: null, error: "Status request denied", locale: "en", t,
  })} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Status request denied");
  expect(screen.queryByText("Checking current status…")).toBeNull();

  rerender(<Observability {...props} useObservabilityStatusHook={() => ({
    status: { enabled: false, serviceName: null, canSendTestError: false }, error: null, locale: "en", t,
  })} />);
  expect(screen.getByRole("status")).toHaveTextContent("OpenTelemetry is OFF (the default) — nothing is being recorded.");
  expect(screen.getByRole("status")).toHaveTextContent("Orchard is running its safe, no-op default");
  expect(screen.queryByRole("button", { name: "Send test error" })).toBeNull();
  expect(useRecentServerErrorsHook.mock.calls).toEqual([]);
  expect(readToolGaps.mock.calls).toEqual([]);
});

it("shows each provider's own delivery evidence, forwards refresh/test clicks and distinguishes local acceptance from export", async () => {
  const user = userEvent.setup();
  const sendTestError = vi.fn(async () => {});
  const refresh = vi.fn();
  const lastExport = { phase: "export" as const, outcome: "failed" as const, host: "collector.test", at };
  const { props } = setup({
    status: { enabled: true, serviceName: "orchard-api", canSendTestError: true, providers: [
      { providerId: "off", exportEnabled: false, lastExport: { ...lastExport, errorClass: "hidden" }, lastShutdown: null },
      { providerId: "waiting", lastExport: null, lastShutdown: null },
      { providerId: "ok", lastExport: { ...lastExport, outcome: "ok" }, lastShutdown: null },
      { providerId: "retrying", lastExport: { ...lastExport, errorClass: "Transport", statusCode: 503 }, lastShutdown: null },
      { providerId: "denied", lastExport: { ...lastExport, errorClass: "CollectorDenied" }, lastShutdown: null },
    ] },
    sendTestError, refresh,
    testResult: { providers: [{ providerId: "ok", signals: ["error", "span"] }, { providerId: "retrying", signals: ["metric"] }] },
  });
  render(<Observability {...props} />);
  expect(screen.getByText('Reporting under the service name "orchard-api".')).toBeVisible();
  expect(screen.getByText("OpenTelemetry is ON — traces are being recorded.")).toBeVisible();
  expect(screen.getByText("off: Export disabled in this runtime")).toBeVisible();
  expect(screen.getByText("waiting: No export result yet")).toBeVisible();
  const ok = screen.getByText(/^ok:/).closest("p")!;
  expect(ok).toHaveTextContent("Last export succeeded");
  expect(ok.querySelector("time")).toHaveAttribute("datetime", at);
  expect(screen.getByText(/^retrying:/)).toHaveTextContent(/Last export failed.*\(Transport, HTTP 503\)$/);
  expect(screen.getByText(/^denied:/)).toHaveTextContent(/Last export failed.*\(CollectorDenied\)$/);
  expect(screen.getByText(/Accepted locally by:/)).toHaveTextContent("Accepted locally by: ok (error, span); retrying (metric).");
  expect(screen.getByText(/Accepted locally by:/)).toHaveTextContent("Remote delivery is confirmed by export status and your provider.");
  await user.click(screen.getByRole("button", { name: "Send test error" }));
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  expect(sendTestError.mock.calls).toEqual([[]]);
  expect(refresh).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "click" }));
});

it("shows pending and empty diagnostic feedback, then hides the action if the host supplies no sender", async () => {
  const user = userEvent.setup();
  const sendTestError = vi.fn(async () => {});
  const status = { enabled: true, serviceName: "orchard-api", canSendTestError: true };
  const { props } = setup({ status, sendTestError, sendingTestError: true, testResult: { providers: [] } });
  const { rerender } = render(<Observability {...props} />);
  const pending = screen.getByRole("button", { name: "Sending test error…" });
  expect(pending).toBeDisabled();
  await user.click(pending);
  expect(sendTestError.mock.calls).toEqual([]);
  expect(screen.getByText(/No provider accepted the diagnostic yet/)).toBeVisible();

  rerender(<Observability {...props} useObservabilityStatusHook={() => ({
    status, error: null, t, locale: "en", testError: "Diagnostic access revoked",
  })} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Diagnostic access revoked");
  expect(screen.queryByRole("button", { name: /test error/i })).toBeNull();
});

it("mounts only the selected tab and forwards tab navigation with its own subtitle", async () => {
  const user = userEvent.setup();
  const { props, navigate, readToolGaps, useRecentServerErrorsHook } = setup();
  render(<Observability {...props} tabId="providers" />);
  expect(screen.getByRole("note")).toHaveTextContent("No provider connected yet");
  expect(screen.getByRole("note")).toHaveTextContent("Orchard does not fetch, configure, or send data to any provider yet.");
  expect(screen.getByText("Where a monitoring connection will live.")).toHaveClass("host-description");
  expect(screen.queryByRole("tab", { name: "Queries" })).toBeNull();
  expect(useRecentServerErrorsHook.mock.calls).toEqual([]);
  expect(readToolGaps.mock.calls).toEqual([]);

  await user.click(screen.getByRole("tab", { name: "Recent errors" }));
  expect(within(screen.getByRole("region", { name: "Recent server errors" })).getByRole("status")).toHaveTextContent("No errors recorded.");
  expect(screen.getByText("The newest errors this site's server logged.")).toHaveClass("host-description");
  expect(readToolGaps.mock.calls).toEqual([]);

  await user.click(screen.getByRole("tab", { name: "Tool gaps" }));
  expect(await screen.findByText("No tool gaps recorded.")).toBeVisible();
  expect(readToolGaps.mock.calls).toEqual([[]]);
  expect(navigate.mock.calls).toEqual([
    [{ routePath: "/observability?tab=recent-errors" }, { replace: true }],
    [{ routePath: "/observability?tab=tool-gaps" }, { replace: true }],
  ]);
});

it("exposes the default Queries panel only when allowed, preserving its read-only state", async () => {
  const user = userEvent.setup();
  const { props } = setup();
  // The panel fixture reports the theme it actually received.
  const Cache: ObservabilityProps["QueryCachePanel"] = ({ theme }) => <p>Cache theme: {theme}</p>;
  render(<Observability {...props} useQueriesTabHook={() => ({ visible: true, readOnly: true })} QueryCachePanel={Cache} />);
  expect(screen.queryByText("Cache theme: light")).toBeNull();
  await user.click(screen.getByRole("tab", { name: "Queries" }));
  const queries = screen.getByRole("region", { name: "Queries" });
  const content = within(queries).getByText("Cache theme: light");
  expect(content.closest("[inert]")).not.toBeNull();
  expect(within(queries).getByText("Live cache overview. Interaction is disabled in production.")).toBeVisible();
});

it("passes readOnly and the page translator to a host-supplied Queries panel", () => {
  const { props } = setup({ t: (key) => `host:${key}` });
  render(<Observability {...props} tabId="queries" useQueriesTabHook={() => ({ visible: true, readOnly: false })}
    QueriesPanelComponent={({ readOnly, t: translate }) => <p>{translate(readOnly ? "Read only" : "Can edit")}</p>} />);
  expect(screen.getByText("host:Can edit")).toBeVisible();
  expect(screen.queryByText("Live cache entries")).toBeNull();
});
