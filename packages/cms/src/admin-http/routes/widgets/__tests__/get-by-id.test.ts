import { describe, expect, it } from "vitest";
import { InMemoryEntryRepo } from "../../../../entries/repo.memory.js";
import { widgetGetRoute } from "../get-by-id.js";
import { PRINCIPAL, rbac, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const refsRepo = { findByTarget: async () => [] };

describe("widgetGetRoute", () => {
  it("keeps the path and reads the id param", () => {
    expect(widgetGetRoute.method).toBe("get");
    expect(widgetGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/widgets/:id");
    expect(widgetGetRoute.parse({ body: {}, query: {}, params: { workspaceId: WORKSPACE_ID, id: "w-9" } })).toEqual({ ok: true, value: { id: "w-9" } });
  });

  it("answers a missing instance with the WIDGETS_INSTANCE_NOT_FOUND refusal", async () => {
    const { authorize } = rbac(true);
    const entryRepo = new InMemoryEntryRepo();
    const refusal = await refusalOf(() => widgetGetRoute.handle({ input: { id: "w-9" }, deps: { workspaceId: WORKSPACE_ID, entryRepo, authorize, entryRefsRepo: refsRepo }, context: PRINCIPAL, authorize: async () => {} }, { signal }));
    expect(refusal.status).toBe(404);
    expect(refusal.body).toMatchObject({ code: "WIDGETS_INSTANCE_NOT_FOUND" });
  });

  it("rethrows an unexpected repository failure unchanged for the host's error port", async () => {
    const { authorize } = rbac(true);
    const boom = new Error("disk gone");
    const entryRepo = { findById: async () => { throw boom; }, findBySlug: async () => { throw boom; } } as never;
    await expect(widgetGetRoute.handle({ input: { id: "w-9" }, deps: { workspaceId: WORKSPACE_ID, entryRepo, authorize, entryRefsRepo: refsRepo }, context: PRINCIPAL, authorize: async () => {} }, { signal })).rejects.toBe(boom);
  });
});
