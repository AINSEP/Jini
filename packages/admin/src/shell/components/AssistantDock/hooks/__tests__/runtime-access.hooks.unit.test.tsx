// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ChatPaneAgent, ChatPaneRuntimeAccess } from "../../../../../react/kit.js";
import type { AgentsLoader } from "../agents-inventory.hooks.js";
import { useAgentsPlaceholder, useAgentsPlaceholderSeam, useRuntimeAccess, useRuntimeAccessSeam } from "../runtime-access.hooks.js";

const saved = [{ id: "saved", name: "Saved" }];
const live = [{ id: "live", name: "Live" }];

it("records a loaded inventory, hands the same loader to rescan and exposes its current deadline", async () => {
  const loader: AgentsLoader = { peek: () => undefined, load: async () => live, replace: vi.fn(), refreshAt: () => 1_500 };
  const rescanAgentsInto = vi.fn(async () => saved);
  const recordAgents = vi.fn(({ agents }: { agents: ChatPaneAgent[] }) => agents.map(agent => ({ ...agent, available: true })));
  const { result } = renderHook(() => useRuntimeAccess({
    useLoader: () => loader, readDaemonOnline: async () => true, rescanAgentsInto, recordAgents,
  }));
  await expect(result.current.listAgents()).resolves.toEqual([{ id: "live", name: "Live", available: true }]);
  expect(recordAgents.mock.calls).toEqual([[{ agents: live }]]);
  await expect(result.current.rescanAgents()).resolves.toEqual(saved);
  expect(rescanAgentsInto.mock.calls).toEqual([[{ loader }]]);
  expect(result.current.getAgentsRefreshAt?.()).toBe(1_500);
});

it("shares only the in-flight health probe and retries after a rejection", async () => {
  let refuse!: (reason: Error) => void;
  const probe = new Promise<boolean>((_resolve, reject) => { refuse = reject; });
  const health = vi.fn<() => Promise<boolean>>().mockReturnValueOnce(probe).mockResolvedValue(false);
  const loader: AgentsLoader = { peek: () => undefined, load: async () => live, replace: vi.fn(), refreshAt: () => undefined };
  const { result } = renderHook(() => useRuntimeAccess({
    useLoader: () => loader, readDaemonOnline: health, rescanAgentsInto: async () => [], recordAgents: ({ agents }) => agents,
  }));
  const first = result.current.daemonOnline();
  const overlap = result.current.daemonOnline();
  expect(overlap).toBe(first);
  expect(health).toHaveBeenCalledOnce();
  refuse(new Error("Loopback not listening"));
  await expect(overlap).rejects.toThrow("Loopback not listening");
  await expect(result.current.daemonOnline()).resolves.toBe(false);
  expect(health).toHaveBeenCalledTimes(2);
});

it("uses the saved placeholder only until the same pane can seed from live cache", () => {
  let latest: ChatPaneAgent[] | undefined;
  const loader: AgentsLoader = { peek: () => latest, load: async () => live, replace: vi.fn(), refreshAt: () => undefined };
  const readAgentsSnapshot = vi.fn(() => saved);
  const { result, rerender } = renderHook(() => useAgentsPlaceholder({ useLoader: () => loader, readAgentsSnapshot }));
  expect(result.current).toBe(saved);
  latest = live;
  rerender();
  expect(result.current).toBe(live);
  expect(readAgentsSnapshot).toHaveBeenCalledOnce();
});

it.each([false, true])("selects a single runtime seam and never reads the real placeholder with an override (%s)", overridden => {
  const real: ChatPaneRuntimeAccess = { listAgents: async () => live, rescanAgents: async () => live, daemonOnline: async () => true };
  const fake: ChatPaneRuntimeAccess = { ...real, listAgents: async () => saved };
  const useRuntimeAccessHook = vi.fn(() => real);
  const injected = vi.fn(() => fake);
  const usePlaceholder = vi.fn(() => live);
  const override = overridden ? injected : undefined;
  const { result } = renderHook(() => ({
    access: useRuntimeAccessSeam({ override, useRuntimeAccessHook }),
    placeholder: useAgentsPlaceholderSeam({ runtimeAccessOverride: override, usePlaceholder }),
  }));
  expect(result.current.access).toBe(overridden ? fake : real);
  expect(result.current.placeholder).toBe(overridden ? undefined : live);
  expect(useRuntimeAccessHook).toHaveBeenCalledTimes(overridden ? 0 : 1);
  expect(injected).toHaveBeenCalledTimes(overridden ? 1 : 0);
  expect(usePlaceholder).toHaveBeenCalledTimes(overridden ? 0 : 1);
});
