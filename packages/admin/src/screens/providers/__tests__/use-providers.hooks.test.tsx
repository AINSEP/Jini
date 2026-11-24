// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useProviders } from "../hooks/use-providers.hooks.js";

describe("useProviders", () => {
  it("composes only the injected External MCP controller, once per render", () => {
    const controller = { restartRequired: false };
    let calls = 0;
    const { result } = renderHook(() => useProviders({ useExternalMcp: () => { calls += 1; return controller; } }));
    expect(result.current).toEqual({ externalMcp: controller });
    expect(result.current.externalMcp).toBe(controller);
    expect(Object.keys(result.current)).toEqual(["externalMcp"]);
    expect(calls).toBe(1);
  });
});
