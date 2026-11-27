import { expect, it, vi } from "vitest";
import { buildAssistantMcpUiSandboxProxyUrl } from "../assistant-mcp-ui.js";

it("forwards the parent origin to the proxy builder and returns its opaque-origin URL", () => {
  const buildSandboxProxyDataUrl = vi.fn(() => "data:text/html;charset=utf-8,%3Cp%3EProxy%3C%2Fp%3E");
  const url = buildAssistantMcpUiSandboxProxyUrl({ hostOrigin: "https://admin.example:9443", buildSandboxProxyDataUrl });
  expect(buildSandboxProxyDataUrl.mock.calls).toEqual([[{ hostOrigin: "https://admin.example:9443" }]]);
  expect(url.href).toBe("data:text/html;charset=utf-8,%3Cp%3EProxy%3C%2Fp%3E");
  expect(url.origin).toBe("null");
});
