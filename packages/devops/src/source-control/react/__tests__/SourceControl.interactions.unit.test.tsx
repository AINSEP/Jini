// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import type { FetchQueryAdapter, QueryResult } from "@jini-ai/core/fetch";
import { fieldHelpText } from "../../../deploy/react/rules.js";
import { ProvidersTab, type ProvidersTabProps } from "../ProvidersTab.js";
import { SourceControl } from "../SourceControl.js";
import { SourceControlIcon } from "../source-control-visuals.js";
import { useSourceControlCredentials } from "../hooks/use-source-control-credentials.hooks.js";
import type { AdminSourceControlCredentialSummary, AdminSourceControlProvidersSnapshot } from "../rules.js";

afterEach(cleanup);

const lineIcon = {
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round",
  strokeLinejoin: "round", "aria-hidden": true,
} as const;
const tabProps: Omit<ProvidersTabProps, "useSourceControlCredentialsHook" | "navigate"> = {
  useAdminLocaleHook: () => "en",
  viewerTimeZone: "UTC",
  lineIcon,
  kit: {
    SecretInput: ({ label, secret = true, ...props }) => <input {...props} aria-label={label} type={secret ? "password" : "text"} />,
    Icon: ({ name, size, ...props }) => <svg {...props} width={size} height={size} data-icon={name} />,
  },
  CredentialHint: ({ hint }) => <span>{hint?.last4}</span>,
  fieldHelpText,
  fieldNameHandleSegment: ({ fieldName }) => fieldName === "appSecret" ? "app-secret" : fieldName,
  copy: { providersRegionLabel: "Connections", storedTokenHint: "Stored safely" },
};

const snapshot: AdminSourceControlProvidersSnapshot = {
  providers: [
    { id: "forge", label: "Forge", credential: {
      tokenField: "pat", tokenPageUrl: "https://forge.example/settings/tokens", help: "Grant read access",
      fields: [
        { name: "pat", label: "Forge token", secret: true, required: true },
        { name: "account", label: "Forge account", help: "Use the organization slug", required: true },
        { name: "appSecret", label: "App secret", secret: true },
      ],
    } },
    { id: "backup", label: "Backup" },
  ],
  switchedOff: [], refusals: [],
};
const saved: AdminSourceControlCredentialSummary = {
  id: "forge-primary", providerId: "forge", configured: true, label: "default", isDefault: true,
  createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z",
};
type HookDeps = Parameters<typeof useSourceControlCredentials>[0];
type QueryFixture = { providers?: AdminSourceControlProvidersSnapshot; providerError?: Error; credentials?: AdminSourceControlCredentialSummary[]; credentialsError?: Error; loading?: boolean };

function fixture(query: QueryFixture = { providers: snapshot, credentials: [] }) {
  const port = {
    listProviders: async () => snapshot,
    listCredentials: async () => ({ credentials: query.credentials ?? [] }),
    createCredential: vi.fn<HookDeps["port"]["createCredential"]>(),
    updateCredential: vi.fn<HookDeps["port"]["updateCredential"]>(),
  };
  // The host owns fetching. Supply its two query results independently to exercise the hook's
  // decisions without a cache, background refetch or timing dependency in a credential test.
  const useFetchQueryHook: FetchQueryAdapter["useFetchQuery"] = ({ key }) => {
    const isProviders = key[1] === "providers";
    const data = isProviders ? query.providers : query.credentials === undefined ? undefined : { credentials: query.credentials };
    const error = (isProviders ? query.providerError : query.credentialsError) ?? null;
    return { data: data as never, error,
      status: query.loading ? "loading" : error ? "error" : "success", isFetching: Boolean(query.loading), refetch: () => {} };
  };
  const duplicate = new Error("duplicate fixture");
  const classifyCredentialSubmitError = vi.fn<HookDeps["classifyCredentialSubmitError"]>(({ error }) =>
    error === duplicate ? { kind: "duplicate-label" } : { kind: "generic" });
  const inputs: HookDeps = {
    port, useFetchQueryHook, locale: "en", t: key => key, localizeSourceControlProviders: ({ providers }) => providers,
    credentialDraftError: ({ value }, { required }) => required && !value.trim() ? "A token is required." : null,
    translateCredentialMessage: ({ message }) => message,
    describeApiError: ({ e, fallback }) => e instanceof Error ? e.message : fallback,
    sourceControlCredentialsLoadErrorMessage: ({ error }) => `Connections unavailable: ${error}`,
    sourceControlCredentialSaveErrorMessage: ({ error }) => `Connection not saved: ${error}`,
    classifyCredentialSubmitError,
  };
  const navigate = vi.fn();
  const mount = () => render(<ProvidersTab {...tabProps} navigate={navigate} useSourceControlCredentialsHook={() => useSourceControlCredentials(inputs)} />);
  return { inputs, port, navigate, mount, duplicate };
}

it("discloses token guidance and sends Manage Access Tokens to the security route", () => {
  const { mount, navigate } = fixture();
  mount();
  const row = screen.getByRole("heading", { name: "Connect Forge" }).closest("details")!;
  const guide = within(row).getByText("Which token do I need?");
  const disclosure = guide.closest("details")!;
  expect(disclosure.open).toBe(false);
  fireEvent.click(guide);
  expect(disclosure.open).toBe(true);
  expect(within(disclosure).getByText("Grant read access").textContent?.trim()).toBe("Grant read access");
  const link = within(disclosure).getByRole("link", { name: "Create a token" });
  expect(link.getAttribute("href")).toBe("https://forge.example/settings/tokens");
  expect(link.getAttribute("rel")).toBe("noreferrer");
  fireEvent.click(screen.getByRole("button", { name: "Create access token" }));
  expect(navigate).toHaveBeenCalledExactlyOnceWith({ routePath: "/access-tokens?tab=access-tokens" });
});

it("shows loading and keeps the actionable host notice separate from a credentials load error", () => {
  const loading = fixture({ loading: true }).mount();
  expect(screen.getByText("Loading connections…").textContent).toBe("Loading connections…");
  loading.unmount();
  const { mount } = fixture({ credentialsError: new Error("cannot load"), providers: {
    providers: [], switchedOff: [{ id: "forge", pluginId: "org.forge" }], refusals: ["Backup descriptor missing"],
  } });
  mount();
  const notice = screen.getByRole("status", { name: "Why no source-control host is listed" });
  expect(within(notice).getByText("No source-control host was loaded. Reinstall or turn on the plugin in Agent Plugins.").textContent)
    .toBe("No source-control host was loaded. Reinstall or turn on the plugin in Agent Plugins.");
  expect(within(notice).getAllByRole("listitem").map(item => item.textContent)).toEqual([
    "Backup descriptor missing", "forge: org.forge is turned off",
  ]);
  expect(screen.getByText("Connections unavailable: cannot load").getAttribute("role")).toBe("status");
  expect(screen.queryByText("Loading connections…")).toBeNull();
});

it("keeps a rejected draft, then creates and replaces the saved connection through the same provider row", async () => {
  const { port, duplicate, mount } = fixture();
  let rejectCreate!: (error: Error) => void;
  port.createCredential.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCreate = reject; }))
    .mockResolvedValueOnce(saved);
  const rotated = { ...saved, tokenHint: { length: 17, last4: "2026" }, updatedAt: "2026-11-21T00:00:00Z" };
  port.updateCredential.mockResolvedValueOnce(rotated);
  mount();

  const row = screen.getByRole("heading", { name: "Connect Forge" }).closest("details")!;
  const view = within(row);
  const button = view.getByRole<HTMLButtonElement>("button", { name: "Save" });
  const token = view.getByLabelText<HTMLInputElement>("Forge token");
  const account = view.getByLabelText<HTMLInputElement>("Forge account");
  const appSecret = view.getByLabelText<HTMLInputElement>("App secret");
  expect(button.disabled).toBe(true);
  expect(account.type).toBe("text");
  expect(appSecret.type).toBe("password");
  expect(view.getByText("Use the organization slug").textContent).toBe("Use the organization slug");

  fireEvent.change(token, { target: { value: "draft-token-01" } });
  expect(button.disabled).toBe(true);
  fireEvent.change(account, { target: { value: " studio " } });
  fireEvent.change(appSecret, { target: { value: " secret value " } });
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(view.getByRole<HTMLButtonElement>("button", { name: "Saving…" }).disabled).toBe(true);
  await act(async () => rejectCreate(duplicate));
  expect(view.getByRole("alert").textContent).toBe("This connection was already saved — reload the page and try again.");
  expect(token.value).toBe("draft-token-01");
  expect(account.value).toBe(" studio ");

  await act(async () => { fireEvent.click(button); });
  expect(port.createCredential.mock.calls).toEqual([1, 2].map(() => [{
    label: "default", connection: { providerId: "forge", token: "draft-token-01", account: "studio", "appSecret": " secret value " },
  }]));
  expect(token.value).toBe("");
  expect(account.value).toBe("");
  expect(appSecret.value).toBe("");
  expect(view.queryByRole("alert")).toBeNull();
  expect(row.querySelector('[role="alert"]')).toBeNull();
  expect(row.open).toBe(false);
  const backup = screen.getByRole("heading", { name: "Connect Backup" }).closest("details")!;
  expect(backup.open).toBe(true);
  fireEvent.click(view.getByText("Replace token"));

  fireEvent.change(token, { target: { value: "rotated-token-2026" } });
  fireEvent.change(account, { target: { value: "studio-next" } });
  await act(async () => { fireEvent.click(button); });
  expect(port.updateCredential).toHaveBeenCalledExactlyOnceWith({
    id: "forge-primary", input: { connection: { providerId: "forge", token: "rotated-token-2026", account: "studio-next" } },
  });
  expect(view.getByText("2026").textContent).toBe("2026");
  expect(row.querySelector("summary")?.textContent).toContain("saved 2026-11-21 00:00");
  expect(row.querySelector('summary svg[data-icon="check-long"]')?.getAttribute("aria-hidden")).toBe("true");
  expect(token.value).toBe("");
});

it("validates a direct save request and uses the generic transport error path without losing a saved row", async () => {
  const { inputs, port } = fixture({ providers: snapshot, credentials: [saved] });
  port.updateCredential.mockRejectedValueOnce(new Error("transport went away"));
  const { result } = renderHook(() => useSourceControlCredentials(inputs));
  const row = (id: string) => result.current.rows?.find(item => item.providerId === id);
  await act(async () => { await result.current.save("backup"); });
  expect(row("backup")?.error).toBe("A token is required.");
  expect(port.createCredential).not.toHaveBeenCalled();
  act(() => {
    result.current.setToken({ providerId: "forge", value: "keep-my-draft" });
    result.current.setField({ providerId: "forge", name: "account", value: "studio" });
  });
  await act(async () => { await result.current.save("forge"); });
  expect(row("forge")).toMatchObject({
    saved, token: "keep-my-draft", saving: false, error: "Connection not saved: transport went away",
  });
  expect(row("backup")?.error).toBe("A token is required.");
});

it("forwards a labeled tab selection and keeps the connection glyph decorative", () => {
  const onTabChange = vi.fn();
  const resolveActiveTabId = vi.fn(() => "providers" as const);
  render(<SourceControl
    classes={{ page: "", pageHeader: "", pageHeaderText: "", pageKicker: "", pageTitle: "", pageDescription: "" }}
    useAdminLocaleHook={() => "en"} t={({ key }) => key} tabId="stale" resolveActiveTabId={resolveActiveTabId}
    TabBar={({ tabs, activeId, onChange, ariaLabel }) => <div role="tablist" aria-label={ariaLabel}>{tabs.map(tab =>
      <button key={tab.id} role="tab" aria-selected={tab.id === activeId} onClick={() => onChange(tab.id)}>{tab.icon}{tab.label}</button>)}</div>}
    onTabChange={onTabChange} providerIcon={<SourceControlIcon lineIcon={lineIcon} size={27} />}
    providers={<section aria-label="Provider connections" />} headerAttrs={{}}
    copy={{ descriptionKey: "Manage providers", providerTabHandleLabel: "Show providers" }}
  />);
  expect(resolveActiveTabId).toHaveBeenCalledExactlyOnceWith({ tabId: "stale", validIds: ["providers"], defaultId: "providers" });
  const tab = within(screen.getByRole("tablist", { name: "Source Control" })).getByRole("tab", { name: "Providers", selected: true });
  const glyph = tab.querySelector("svg");
  expect(glyph?.getAttribute("aria-hidden")).toBe("true");
  expect(glyph?.getAttribute("width")).toBe("27");
  expect(glyph?.getAttribute("height")).toBe("27");
  expect(Array.from(glyph?.querySelectorAll("circle") ?? [], circle => [circle.getAttribute("cx"), circle.getAttribute("cy")]))
    .toEqual([["6", "6"], ["18", "18"]]);
  expect(glyph?.querySelector("path")?.getAttribute("d")).toBe("M8 7.5 16 16.5");
  fireEvent.click(tab);
  expect(onTabChange).toHaveBeenCalledExactlyOnceWith({ nextTabId: "providers" });
  expect(screen.getByRole("region", { name: "Provider connections" }).getAttribute("aria-label")).toBe("Provider connections");
});

it("the connection glyph defaults to a square 20-pixel icon", () => {
  const { container } = render(<SourceControlIcon lineIcon={lineIcon} />);
  const glyph = container.querySelector("svg");
  expect(glyph?.getAttribute("width")).toBe("20");
  expect(glyph?.getAttribute("height")).toBe("20");
});

it("gives help-only and link-only providers their own token guidance", () => {
  const { mount } = fixture({ credentials: [], providers: {
    providers: [
      { id: "docs", label: "Docs", credential: { tokenField: "token", help: "Use the read scope", fields: [] } },
      { id: "portal", label: "Portal", credential: { tokenField: "token", tokenPageUrl: "https://portal.example/token", fields: [] } },
      { id: "bare", label: "Bare" },
    ],
    switchedOff: [], refusals: [],
  } });
  mount();
  const row = (name: string) => {
    const heading = screen.getByRole("heading", { name: `Connect ${name}` });
    return within(heading.closest("details")!);
  };
  const docs = row("Docs");
  fireEvent.click(docs.getByText("Which token do I need?"));
  expect(docs.getByText("Use the read scope").textContent?.trim()).toBe("Use the read scope");
  expect(docs.queryByText("Create a token")).toBeNull();
  const portal = row("Portal");
  expect(portal.getByText("Create a token").getAttribute("href")).toBe("https://portal.example/token");
  expect(portal.queryByText("Use the read scope")).toBeNull();
  expect(row("Bare").queryByText("Which token do I need?")).toBeNull();
});

it("does not save incomplete or unlisted connections and preserves its first loaded credential inventory", async () => {
  const query: QueryFixture = { credentials: [saved, { ...saved, id: "retired-key", providerId: "retired" }], providers: snapshot };
  const { inputs, port } = fixture(query);
  const { result, rerender } = renderHook(() => useSourceControlCredentials(inputs));
  const row = (id: string) => result.current.rows?.find(item => item.providerId === id);
  act(() => {
    result.current.setToken({ providerId: "forge", value: "pending-rotation" });
    result.current.setToken({ providerId: "retired", value: "not-allowed" });
  });
  await act(async () => {
    await result.current.save("forge");
    await result.current.save("retired");
    await result.current.save("missing");
  });
  expect(port.updateCredential).not.toHaveBeenCalled();
  expect(port.createCredential).not.toHaveBeenCalled();
  expect(row("forge")).toMatchObject({ saved, token: "pending-rotation", readyToSave: false });
  expect(row("retired")).toMatchObject({ saved: { id: "retired-key" }, info: { listed: false } });
  query.credentials = [];
  rerender();
  expect(row("forge")?.saved).toEqual(saved);
  expect(row("retired")?.saved?.id).toBe("retired-key");
});

it("loads the current host catalog and saved connections through their separate query callbacks", async () => {
  const { inputs } = fixture();
  const listProviders = vi.fn(async () => snapshot);
  const listCredentials = vi.fn(async () => ({ credentials: [saved] }));
  inputs.port = { ...inputs.port, listProviders, listCredentials };
  const queried = new Set<string>();
  const useFetchQueryHook: FetchQueryAdapter["useFetchQuery"] = function useHostQuery<T>(
    { key, fetch }: { key: readonly (string | number)[]; fetch: () => Promise<T> },
  ) {
    const [data, setData] = useState<T>();
    const [error, setError] = useState<Error | null>(null);
    const identity = key.join("/");
    useEffect(() => {
      queried.add(identity);
      void fetch().then(value => setData(() => value), reason => setError(reason instanceof Error ? reason : new Error(String(reason))));
      // This host fixture loads exactly once per query identity.
    }, [identity]);
    return { data, error, status: error ? "error" : data === undefined ? "loading" : "success", isFetching: data === undefined && error === null, refetch: () => {} } satisfies QueryResult<T>;
  };
  inputs.useFetchQueryHook = useFetchQueryHook;
  const { result } = renderHook(() => useSourceControlCredentials(inputs));
  expect(result.current.rows).toBeUndefined();
  await waitFor(() => expect(result.current.rows?.map(({ providerId, saved }) => [providerId, saved?.id])).toEqual([
    ["forge", "forge-primary"], ["backup", undefined],
  ]));
  expect([...queried]).toEqual(["source-control/credentials", "source-control/providers"]);
  expect(listCredentials).toHaveBeenCalledExactlyOnceWith();
  expect(listProviders).toHaveBeenCalledExactlyOnceWith();
});
