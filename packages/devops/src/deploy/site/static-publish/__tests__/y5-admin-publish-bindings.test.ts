import { describe, expect, it, vi } from "vitest";
import { createAdminPublishRead } from "../admin-publish-read.js";
import { createAdminPublishStart } from "../publish-run.js";

describe("admin publish bindings", () => {
  it("keeps registry refusal logging and public target projection in the read owner", async () => {
    const refusal = vi.fn();
    const reader = createAdminPublishRead({ deps: { workspaceId: "ws", loadDeployTargets: async () => ({ refusals: ["module unavailable"], list: () => [], get: () => undefined }), refusal } as unknown as Parameters<typeof createAdminPublishRead>[0]["deps"], credentialSource: {} as Parameters<typeof createAdminPublishRead>[0]["credentialSource"] });
    expect(await reader.publishTargets()).toEqual([]);
    expect(refusal).toHaveBeenCalledWith("module unavailable");
  });

  it("passes the selected credential into the same injected run owner without awaiting settlement", () => {
    const snapshot = { status: "running" as const, startedAtIso: "now", finishedAtIso: null, target: "target" };
    const start = vi.fn<Parameters<typeof createAdminPublishStart>[0]["start"]>(() => snapshot);
    const binding = createAdminPublishStart({ start, deps: {}, input: { workspaceId: "ws", publishOutputRootDir: "/publish", idGen: {}, exportSiteBound: {} }, clock: {}, historyStore: {} } as unknown as Parameters<typeof createAdminPublishStart>[0]);
    const result = binding({ principal: { id: "owner" }, parsed: { projectName: "project", credentialId: "chosen" }, config: { target: "target" } });
    expect(result).toBe(snapshot);
    expect(start.mock.calls[0]?.[0]).toMatchObject({ input: { workspaceId: "ws", projectName: "project", credentialId: "chosen", productEvent: { userId: "owner", source: "admin" } } });
  });
});
