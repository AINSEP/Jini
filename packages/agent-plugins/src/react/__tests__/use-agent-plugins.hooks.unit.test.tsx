// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { FetchQueryProvider, useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate } from "@jini-ai/ui/fetch-query";
import type { AdminHttpError } from "@jini-ai/core/admin-runtime";
import { useWiredAgentPlugins, type AgentPluginListRow } from "../use-agent-plugins.hooks.js";

it("does not let a late list read revert a confirmed toggle", async () => {
  const plugin: AgentPluginListRow = { pluginId: "plugin", version: "1", description: null, keywords: [], skills: [], mcpServerIds: [], enabled: false };
  let settle!: (value: { agentPlugins: AgentPluginListRow[] }) => void;
  const port = {
    listAgentPlugins: vi.fn().mockResolvedValueOnce({ agentPlugins: [plugin] })
      .mockImplementation(() => new Promise<{ agentPlugins: AgentPluginListRow[] }>((resolve) => { settle = resolve; })),
    setAgentPluginEnabled: vi.fn(async () => ({ agentPlugin: { ...plugin, enabled: true } })),
    getAgentPluginFiles: vi.fn(),
  };
  const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
  const { result } = renderHook(() => useWiredAgentPlugins({ port, useAdminLocaleHook: () => "en",
    useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useContentRefreshSubscription: () => {},
    resource: "agent-plugins", translatePlugins: ({ key }) => key, describeApiError: ({ fallback }) => fallback,
    isApiError: (error): error is AdminHttpError => error instanceof Error && "status" in error,
    toggleRefusalKeys: {},
  }), { wrapper });
  await waitFor(() => expect(result.current.agentPlugins).toEqual([plugin]));
  await act(async () => { await result.current.onToggleEnabled(plugin); });
  await waitFor(() => expect(port.listAgentPlugins).toHaveBeenCalledTimes(2));
  expect(result.current.agentPlugins?.[0]?.enabled).toBe(true);
  await act(async () => settle({ agentPlugins: [plugin] }));
  expect(result.current.agentPlugins?.[0]?.enabled).toBe(true);
});

const firstRow: AgentPluginListRow = { pluginId: "alpha", version: "1.0.0", description: null, keywords: [], skills: [], mcpServerIds: [], enabled: false };
const secondRow: AgentPluginListRow = { ...firstRow, pluginId: "beta", version: "3.0.0" };

function renderPlugins(port: Parameters<typeof useWiredAgentPlugins>[0]["port"]) {
  const wrapper = ({ children }: { children: ReactNode }) => <FetchQueryProvider>{children}</FetchQueryProvider>;
  return renderHook(() => useWiredAgentPlugins({
    port, useAdminLocaleHook: () => "fr", useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate,
    useContentRefreshSubscription: () => {}, resource: "agent-plugins",
    translatePlugins: ({ locale, key }) => locale + ":" + key,
    describeApiError: ({ fallback }) => "fallback:" + fallback,
    isApiError: (error): error is AdminHttpError => error instanceof Error && "status" in error,
    toggleRefusalKeys: { PLUGIN_NOT_READY: "not ready" },
  }), { wrapper });
}

it("install adds a new row and replaces an existing revision in place", async () => {
  const { result } = renderPlugins({
    listAgentPlugins: async () => ({ agentPlugins: [firstRow, secondRow] }),
    setAgentPluginEnabled: async () => { throw new Error("unexpected toggle"); }, getAgentPluginFiles: vi.fn(),
  });
  await waitFor(() => expect(result.current.agentPlugins).toEqual([firstRow, secondRow]));
  const updated = { ...firstRow, version: "2.0.1" };
  const added = { ...firstRow, pluginId: "gamma" };
  act(() => result.current.onInstalled(updated));
  act(() => result.current.onInstalled(added));
  expect(result.current.agentPlugins).toEqual([updated, secondRow, added]);
});

it("install while the first list is pending does not let an earlier empty result hide the new plugin", async () => {
  let complete!: (response: { agentPlugins: AgentPluginListRow[] }) => void;
  const pending = new Promise<{ agentPlugins: AgentPluginListRow[] }>(resolve => { complete = resolve; });
  const listAgentPlugins = vi.fn(() => pending);
  const { result } = renderPlugins({ listAgentPlugins, setAgentPluginEnabled: vi.fn(), getAgentPluginFiles: vi.fn() });
  await waitFor(() => expect(listAgentPlugins).toHaveBeenCalled());
  expect(result.current.agentPlugins).toBeNull();
  act(() => result.current.onInstalled(secondRow));
  expect(result.current.agentPlugins).toEqual([secondRow]);
  await act(async () => complete({ agentPlugins: [] }));
  expect(result.current.agentPlugins).toEqual([secondRow]);
});

it("publishes localized load and toggle errors without inventing a confirmed activation", async () => {
  const listFault = new Error("private list failure");
  const failed = renderPlugins({ listAgentPlugins: async () => { throw listFault; },
    setAgentPluginEnabled: vi.fn(), getAgentPluginFiles: vi.fn() });
  await waitFor(() => expect(failed.result.current.error).toBe("fallback:fr:failed to load agent plugins"));
  expect(failed.result.current.agentPlugins).toBeNull();
  failed.unmount();

  const setAgentPluginEnabled = vi.fn<Parameters<typeof useWiredAgentPlugins>[0]["port"]["setAgentPluginEnabled"]>()
    .mockRejectedValueOnce(Object.assign(new Error("server English"), { status: 409, code: "PLUGIN_NOT_READY" }))
    .mockRejectedValueOnce(new Error("upstream unavailable"));
  const { result } = renderPlugins({
    listAgentPlugins: async () => ({ agentPlugins: [firstRow] }), setAgentPluginEnabled, getAgentPluginFiles: vi.fn(),
  });
  await waitFor(() => expect(result.current.agentPlugins).toEqual([firstRow]));
  await act(async () => { await result.current.onToggleEnabled(firstRow); });
  expect(result.current.toggleError).toBe("fr:not ready");
  expect(result.current.error).toBeNull();
  expect(result.current.agentPlugins).toEqual([firstRow]);
  expect([...result.current.togglingIds]).toEqual([]);
  await act(async () => { await result.current.onToggleEnabled(firstRow); });
  expect(result.current.toggleError).toBe("fallback:fr:failed to update agent plugin");
  expect(result.current.agentPlugins).toEqual([firstRow]);
  expect(setAgentPluginEnabled.mock.calls).toEqual([
    [{ pluginId: "alpha", input: { enabled: true } }], [{ pluginId: "alpha", input: { enabled: true } }],
  ]);
});
