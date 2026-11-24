// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAgentPluginSurfaces } from "../use-agent-plugin-surfaces.hooks.js";
import type { AgentPluginSurfacesPort, AgentPluginSurfaceSummary } from "../agent-plugin-surfaces-port.hooks.js";

/**
 * @file Which admin surfaces the details modal offers for one plugin: the listing's surfaces once
 * it answers, nothing while it is pending, nothing for a failed or malformed listing, and never a
 * previous plugin's surfaces after the modal switched plugins (or a late answer after unmount).
 * Typed fake port with controllable resolution.
 */

const surfaceOf = (id: string): AgentPluginSurfaceSummary => ({ id, title: `Surface ${id}`, src: `/s/${id}/index.html`, actions: [] });

/** A port whose `list` answers are released by the test, one deferred per call. */
function deferredPort() {
  const pending: { pluginId: string; resolve: (value: { surfaces: readonly AgentPluginSurfaceSummary[] }) => void; reject: (error: Error) => void }[] = [];
  const port: AgentPluginSurfacesPort = {
    list: vi.fn<AgentPluginSurfacesPort["list"]>(({ pluginId }) => new Promise((resolve, reject) => { pending.push({ pluginId, resolve, reject }); })),
    bootstrap: vi.fn<AgentPluginSurfacesPort["bootstrap"]>(async () => { throw new Error("not used"); }),
    action: vi.fn<AgentPluginSurfacesPort["action"]>(async () => { throw new Error("not used"); }),
  };
  return { port, pending };
}

describe("useAgentPluginSurfaces", () => {
  it("offers nothing while the listing is pending, then exactly the listed surfaces", async () => {
    const { port, pending } = deferredPort();
    const { result } = renderHook(() => useAgentPluginSurfaces({ pluginId: "acme-office", port }));
    expect(result.current).toEqual([]);
    await act(async () => { pending[0]!.resolve({ surfaces: [surfaceOf("a")] }); });
    expect(result.current).toEqual([surfaceOf("a")]);
    expect(port.list).toHaveBeenCalledWith({ pluginId: "acme-office" });
  });

  it("offers nothing when the listing fails", async () => {
    const { port, pending } = deferredPort();
    const { result } = renderHook(() => useAgentPluginSurfaces({ pluginId: "acme-office", port }));
    await act(async () => { pending[0]!.reject(new Error("503")); });
    expect(result.current).toEqual([]);
  });

  it("treats a 200 without a surfaces array (an older server, a proxy page) as no surfaces", async () => {
    const { port, pending } = deferredPort();
    const { result } = renderHook(() => useAgentPluginSurfaces({ pluginId: "acme-office", port }));
    // Malformed-input fixture: the wire answer lacks the typed `surfaces` array.
    await act(async () => { pending[0]!.resolve({ surfaces: "<html>" } as unknown as { surfaces: readonly AgentPluginSurfaceSummary[] }); });
    expect(result.current).toEqual([]);
  });

  it("never shows the previous plugin's surfaces after switching plugins", async () => {
    const { port, pending } = deferredPort();
    const { result, rerender } = renderHook(({ pluginId }) => useAgentPluginSurfaces({ pluginId, port }), { initialProps: { pluginId: "first" } });
    await act(async () => { pending[0]!.resolve({ surfaces: [surfaceOf("first-surface")] }); });
    expect(result.current).toEqual([surfaceOf("first-surface")]);
    rerender({ pluginId: "second" });
    // Same render as the switch: the first plugin's surfaces are already gone.
    expect(result.current).toEqual([]);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1]!.resolve({ surfaces: [surfaceOf("second-surface")] }); });
    expect(result.current).toEqual([surfaceOf("second-surface")]);
  });

  it("ignores a listing that answers after the plugin changed", async () => {
    const { port, pending } = deferredPort();
    const { result, rerender } = renderHook(({ pluginId }) => useAgentPluginSurfaces({ pluginId, port }), { initialProps: { pluginId: "first" } });
    rerender({ pluginId: "second" });
    await act(async () => { pending[1]!.resolve({ surfaces: [surfaceOf("second-surface")] }); });
    await act(async () => { pending[0]!.resolve({ surfaces: [surfaceOf("stale")] }); });
    expect(result.current).toEqual([surfaceOf("second-surface")]);
  });
});
