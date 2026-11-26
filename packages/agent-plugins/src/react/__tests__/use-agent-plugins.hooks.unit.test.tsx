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
