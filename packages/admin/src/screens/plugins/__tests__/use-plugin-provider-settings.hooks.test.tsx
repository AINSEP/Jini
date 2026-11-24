// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePluginProviderSettings } from "../hooks/use-plugin-provider-settings.hooks";
import type { PluginsPort } from "../hooks/plugins-port.hooks";

/** The host's describer, faked so the tests can tell it was the one consulted. */
const describeApiError = ({ e, fallback }: { e: unknown; fallback: string }): string => `described(${String(e)}|${fallback})`;
const t = (key: string): string => key;

function portThatFails(): Pick<PluginsPort, "getProviderSettings" | "saveProviderSettings" | "useProjectKey"> {
  return {
    getProviderSettings: async () => { throw "load-boom"; },
    saveProviderSettings: async () => { throw "save-boom"; },
  };
}

describe("usePluginProviderSettings", () => {
  it("shows a load failure in the injected describer's words", async () => {
    const port = portThatFails();
    const { result } = renderHook(() => usePluginProviderSettings({ pluginId: "p", port, t, describeApiError }));
    await waitFor(() => expect(result.current.error).toBe("described(load-boom|failed to load plugin settings)"));
  });

  it("shows a save failure in the injected describer's words and resolves false", async () => {
    const port = portThatFails();
    const { result } = renderHook(() => usePluginProviderSettings({ pluginId: "p", port, t, describeApiError }));
    await waitFor(() => expect(result.current.error).toContain("load-boom"));
    let saved = true;
    await act(async () => { saved = await result.current.save(); });
    expect(saved).toBe(false);
    expect(result.current.error).toBe("described(save-boom|failed to save plugin settings)");
    expect(result.current.saving).toBe(false);
  });
});
