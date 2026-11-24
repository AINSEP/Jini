import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { taxonomyDeleteRoute, type TaxonomyDeleteRouteDeps } from "../delete-taxonomy.js";
import { taxonomyListRoute } from "../list.js";

const PRINCIPAL = { id: "operator" };

function recordingAuthorize() {
  const calls: unknown[] = [];
  return { calls, authorize: async (required: { permission: string; entityType: string }, optional?: { entityId?: string }) => { calls.push({ ...required, ...optional }); } };
}

async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try { await fn(); } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error("expected a route refusal");
}

function deleteDeps(record: { id: string; name: string; version: number } | null, removed: { ok: boolean } = { ok: true }): TaxonomyDeleteRouteDeps & { removals: unknown[] } {
  const removals: unknown[] = [];
  return {
    removals,
    workspaceId: "ws-1",
    clock: { nowIso: () => "2026-07-13T00:00:00.000Z" },
    taxonomyRepo: { findForTrash: async () => record },
    removeTaxonomy: async (request) => { removals.push(request); return removed.ok ? { ok: true, version: 4 } : { ok: false, reason: "version-changed" }; },
  };
}

describe("taxonomyListRoute", () => {
  it("keeps the path, authorizes the single manage permission and lists taxonomies with terms", async () => {
    expect([taxonomyListRoute.method, taxonomyListRoute.path]).toEqual(["get", "/api/admin/v1/taxonomy"]);
    const { authorize, calls } = recordingAuthorize();
    const deps = { taxonomyRepo: { list: async () => [] }, termRepo: { list: async () => [] } } as never;
    const result = await taxonomyListRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "admin.taxonomy.manage", entityType: "taxonomy" }]);
    expect(result).toEqual({ ok: true, value: { items: [] } });
  });
});

describe("taxonomyDeleteRoute", () => {
  it("reads :id, authorizes that taxonomy and refuses an unknown one with 404 TAXONOMY_NOT_FOUND", async () => {
    expect([taxonomyDeleteRoute.method, taxonomyDeleteRoute.path]).toEqual(["delete", "/api/admin/v1/taxonomy/:id"]);
    expect(taxonomyDeleteRoute.parse({ body: {}, query: {}, params: { id: "tx-1" } })).toEqual({ ok: true, value: { id: "tx-1" } });
    const { authorize, calls } = recordingAuthorize();
    expect(await refusalOf(() => taxonomyDeleteRoute.handle({ input: { id: "tx-1" }, deps: deleteDeps(null), context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "taxonomy 'tx-1' was not found", code: "TAXONOMY_NOT_FOUND" },
    });
    expect(calls).toEqual([{ permission: "admin.taxonomy.manage", entityType: "taxonomy", entityId: "tx-1" }]);
  });

  it("moves the taxonomy to the Trash as its principal and answers { trashed, id, version }", async () => {
    const { authorize } = recordingAuthorize();
    const deps = deleteDeps({ id: "tx-1", name: "Topics", version: 3 });
    const result = await taxonomyDeleteRoute.handle({ input: { id: "tx-1" }, deps, context: PRINCIPAL, authorize });
    expect(result).toEqual({ ok: true, value: { trashed: true, id: "tx-1", version: 4 } });
    expect(deps.removals).toEqual([{ workspaceId: "ws-1", id: "tx-1", display: { title: "Topics" }, at: "2026-07-13T00:00:00.000Z", expectedVersion: 3, actor: { principalId: "operator", pluginId: null } }]);
  });

  it("refuses a concurrent change with 409 TRASH_VERSION_CHANGED", async () => {
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => taxonomyDeleteRoute.handle({ input: { id: "tx-1" }, deps: deleteDeps({ id: "tx-1", name: "Topics", version: 3 }, { ok: false }), context: PRINCIPAL, authorize }))).toEqual({
      status: 409, body: { error: "taxonomy 'tx-1' changed while it was being deleted", code: "TRASH_VERSION_CHANGED" },
    });
  });

  it("checks the gate before touching the repo", async () => {
    const denied = async () => { throw new Error("denied"); };
    await expect(taxonomyDeleteRoute.handle({ input: { id: "tx-1" }, deps: deleteDeps(null), context: PRINCIPAL, authorize: denied })).rejects.toThrow("denied");
  });
});
