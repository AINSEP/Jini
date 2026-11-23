import { describe, expect, it } from "vitest";
import { redirectListRoute } from "../list.js";
import { fakeRule, fakeRuleDto, MANAGE, PRINCIPAL, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (query: Record<string, unknown>) => ({ body: {}, query, params: { workspaceId: WORKSPACE_ID } });

describe("redirectListRoute", () => {
  it("keeps the path and reads only string filters", () => {
    expect(redirectListRoute.method).toBe("get");
    expect(redirectListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/redirects");
    expect(redirectListRoute.parse(raw({ status: "active", source: "import", matchType: "prefix" }))).toEqual({ ok: true, value: { status: "active", source: "import", matchType: "prefix" } });
    expect(redirectListRoute.parse(raw({ status: ["a"], source: 1 }))).toEqual({ ok: true, value: { status: undefined, source: undefined, matchType: undefined } });
  });

  it("authorizes, filters, and leaves rules in the Trash out", async () => {
    const { authorize, calls } = recordingAuthorize();
    const filters: unknown[] = [];
    const rules = [fakeRule({ id: "live" }), fakeRule({ id: "trashed", status: "disabled" })];
    const deps = {
      workspaceId: WORKSPACE_ID,
      redirectRepo: { list: async (filter: unknown) => { filters.push(filter); return rules; } },
      redirectsWriteDeps: { isInTrash: async ({ id }: { id: string; workspaceId: string }) => id === "trashed" },
    };
    const result = await redirectListRoute.handle({ input: { status: undefined, source: "manual", matchType: undefined }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([MANAGE]);
    expect(filters).toEqual([{ workspaceId: WORKSPACE_ID, status: undefined, source: "manual", matchType: undefined }]);
    expect(result).toEqual({ ok: true, value: { data: [fakeRuleDto({ id: "live" })] } });
  });
});
