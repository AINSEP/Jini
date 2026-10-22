import { describe, expect, it } from "vitest";
import { isHttpLaunchSpec, type McpLaunchSpec } from "../ports.js";

describe("isHttpLaunchSpec", () => {
  it("narrows a hosted spec (one with a url) and rejects a stdio spec (one with a command)", () => {
    const hosted: McpLaunchSpec = { url: "https://mcp.example.invalid/v1", headers: { "x-client": "test" } };
    const stdio: McpLaunchSpec = { command: "node", args: ["server.js"], env: {} };
    expect(isHttpLaunchSpec({ spec: hosted })).toBe(true);
    expect(isHttpLaunchSpec({ spec: stdio })).toBe(false);

    const input = { spec: hosted };
    if (isHttpLaunchSpec(input)) expect(input.spec.url).toBe("https://mcp.example.invalid/v1");
  });
});
