import { describe, expect, it, vi } from "vitest";
import { createProvidersApi, type ProvidersRequestFn } from "../providers-api.js";

describe("createProvidersApi", () => {
  it("useProjectKey PUTs the use flag to the workspace-scoped, URL-encoded project-key path", async () => {
    const result = { keyId: "a/b", usedByThisSite: true, usedBy: ["site"], appliesAt: "now" as const };
    const request = vi.fn(async () => result) as unknown as ProvidersRequestFn & ReturnType<typeof vi.fn>;
    const api = createProvidersApi({ request, workspaceId: "ws-1" });
    await expect(api.useProjectKey({ keyId: "a/b", use: true })).resolves.toBe(result);
    expect(request).toHaveBeenCalledWith({ path: "/workspaces/ws-1/project-keys/a%2Fb/use" }, { init: { method: "PUT", body: JSON.stringify({ use: true }) } });
  });
});
