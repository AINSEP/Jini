import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { WorkspaceMismatchError } from "../../../../taxonomy/index.js";
import { taxonomyAssignedTermsRoute, taxonomyAssignTermsRoute, taxonomyUnassignTermsRoute } from "../assign-terms.js";
import { taxonomyCreateRoute } from "../create-taxonomy.js";
import { taxonomyCreateTermRoute } from "../create-term.js";
import { taxonomyDeleteTermRoute, type TaxonomyDeleteTermRouteDeps } from "../delete-term.js";
import { taxonomyRenameTermRoute } from "../rename-term.js";

const PRINCIPAL = { id: "principal-7" };
const RAW = { body: {}, query: {}, params: {} };
const allow = async () => ({ allowed: true, reason: "matched" });
const deny = async () => ({ allowed: false, reason: "no grant" });
const unusedPortAuthorize = async () => { throw new Error("these routes authorize through deps.authorize"); };

async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try { await fn(); } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error("expected a route refusal");
}

/** Write-route deps with recording fakes; `overrides` replaces any field. */
function writeDeps(overrides: Record<string, unknown> = {}) {
  const calls: { authorize: unknown[]; inserted: unknown[] } = { authorize: [], inserted: [] };
  const deps = {
    workspaceId: "ws-7",
    authorize: async (params: unknown) => { calls.authorize.push(params); return { allowed: true, reason: "matched" }; },
    clock: { nowMs: () => Date.parse("2026-10-21T00:00:00.000Z") },
    idGen: { newId: () => "id-new" },
    outbox: { enqueue: async () => {} },
    taxonomyRepo: { insert: async (row: unknown) => { calls.inserted.push(row); }, findById: async () => ({ id: "tax-1", hierarchical: true }), transaction: ({ fn }: { fn: () => Promise<unknown> }) => fn() },
    termRepo: { insert: async (row: unknown) => { calls.inserted.push(row); }, findById: async () => null },
    entryTermRepo: { listForContent: async () => [{ termId: "t-2" }, { termId: "t-1" }] },
    taxonomyRevisionRepo: { insert: async () => {} },
    stampWatermark: async () => {},
    postRepo: { findById: async () => null },
    entryRepo: {},
    contentTypeRepo: {},
    ...overrides,
  };
  return { deps: deps as never, calls };
}

describe("taxonomyCreateRoute", () => {
  it("keeps the path and refuses a body without name/hierarchical with the exact 400", async () => {
    expect([taxonomyCreateRoute.method, taxonomyCreateRoute.path, taxonomyCreateRoute.successStatus]).toEqual(["post", "/api/admin/v1/taxonomy", 201]);
    for (const body of [undefined, { name: "Topics" }, { name: 7, hierarchical: true }]) {
      expect(await refusalOf(() => taxonomyCreateRoute.parse({ ...RAW, body }))).toEqual({
        status: 400, body: { error: "'name' (string) and 'hierarchical' (boolean) are required", code: "VALIDATION_ERROR" },
      });
    }
  });

  it("creates through the workspace-scoped authorizer and answers { taxonomy }", async () => {
    const { deps, calls } = writeDeps();
    const input = taxonomyCreateRoute.parse({ ...RAW, body: { name: "Topics", hierarchical: false } });
    expect(input).toEqual({ ok: true, value: { name: "Topics", hierarchical: false } });
    const result = await taxonomyCreateRoute.handle({ input: { name: "Topics", hierarchical: false }, deps, context: PRINCIPAL, authorize: unusedPortAuthorize });
    expect(result).toEqual({ ok: true, value: { taxonomy: { id: "id-new", name: "Topics", hierarchical: false, status: "active", updatedAt: "2026-10-21T00:00:00.000Z", version: 1 } } });
    expect(calls.authorize).toEqual([{ principalId: "principal-7", permission: "admin.taxonomy.manage", workspaceId: "ws-7" }]);
  });

  it("maps a denied permission to the flat 403 FORBIDDEN body and rethrows anything unmapped", async () => {
    expect(await refusalOf(() => taxonomyCreateRoute.handle({ input: { name: "T", hierarchical: true }, deps: writeDeps({ authorize: deny }).deps, context: PRINCIPAL, authorize: unusedPortAuthorize }))).toEqual({
      status: 403, body: { error: "principal 'principal-7' is not authorized for 'admin.taxonomy.manage' (no grant)", code: "FORBIDDEN" },
    });
    const broken = writeDeps({ taxonomyRepo: { insert: async () => { throw new Error("db closed"); } } }).deps;
    await expect(taxonomyCreateRoute.handle({ input: { name: "T", hierarchical: true }, deps: broken, context: PRINCIPAL, authorize: unusedPortAuthorize })).rejects.toThrow("db closed");
  });
});

describe("taxonomyCreateTermRoute", () => {
  it("refuses a non-string name with the exact 400 and defaults parentId to null", async () => {
    expect([taxonomyCreateTermRoute.method, taxonomyCreateTermRoute.path, taxonomyCreateTermRoute.successStatus]).toEqual(["post", "/api/admin/v1/taxonomy/:taxonomyId/terms", 201]);
    for (const body of [undefined, null, { name: 7 }]) {
      expect(await refusalOf(() => taxonomyCreateTermRoute.parse({ ...RAW, params: { taxonomyId: "tax-1" }, body }))).toEqual({
        status: 400, body: { error: "'name' (string) is required", code: "VALIDATION_ERROR" },
      });
    }
    expect(taxonomyCreateTermRoute.parse({ ...RAW, params: { taxonomyId: "tax-1" }, body: { name: "News", parentId: 4 } })).toEqual({
      ok: true, value: { taxonomyId: "tax-1", name: "News", parentId: null },
    });
  });

  it("maps a missing taxonomy to 404 TAXONOMY_NOT_FOUND and a flat-taxonomy parent to 400", async () => {
    const missing = writeDeps({ taxonomyRepo: { findById: async () => null } }).deps;
    expect(await refusalOf(() => taxonomyCreateTermRoute.handle({ input: { taxonomyId: "tax-404", name: "News", parentId: null }, deps: missing, context: PRINCIPAL, authorize: unusedPortAuthorize }))).toEqual({
      status: 404, body: { error: "taxonomy 'tax-404' was not found", code: "TAXONOMY_NOT_FOUND" },
    });
    const flat = writeDeps({ taxonomyRepo: { findById: async () => ({ id: "tax-1", hierarchical: false }) }, termRepo: { findById: async () => ({ id: "p-1", taxonomyId: "tax-1" }) } }).deps;
    const refusal = await refusalOf(() => taxonomyCreateTermRoute.handle({ input: { taxonomyId: "tax-1", name: "Child", parentId: "p-1" }, deps: flat, context: PRINCIPAL, authorize: unusedPortAuthorize }));
    expect(refusal.status).toBe(400);
    expect((refusal.body as { code: string }).code).toBe("VALIDATION_ERROR");
  });
});

describe("taxonomyRenameTermRoute", () => {
  it("refuses a missing newName and maps an unknown term to 404 TERM_NOT_FOUND", async () => {
    expect([taxonomyRenameTermRoute.method, taxonomyRenameTermRoute.path]).toEqual(["put", "/api/admin/v1/taxonomy/terms/:id"]);
    expect(await refusalOf(() => taxonomyRenameTermRoute.parse({ ...RAW, params: { id: "term-1" }, body: {} }))).toEqual({
      status: 400, body: { error: "'newName' (string) is required", code: "VALIDATION_ERROR" },
    });
    expect(await refusalOf(() => taxonomyRenameTermRoute.handle({ input: { termId: "term-9", newName: "X" }, deps: writeDeps().deps, context: PRINCIPAL, authorize: unusedPortAuthorize }))).toEqual({
      status: 404, body: { error: "term 'term-9' was not found", code: "TERM_NOT_FOUND" },
    });
  });
});

function deleteTermDeps(found: boolean, removed: Awaited<ReturnType<TaxonomyDeleteTermRouteDeps["removeTerm"]>>): TaxonomyDeleteTermRouteDeps {
  return {
    workspaceId: "ws-7",
    clock: { nowIso: () => "2026-10-21T00:00:00.000Z" },
    termRepo: { findForTrash: async () => (found ? { id: "term-1", name: "News", taxonomyName: "Topics", version: 4 } : null) },
    removeTerm: async () => removed,
  };
}

describe("taxonomyDeleteTermRoute", () => {
  it("authorizes the term by id, then answers 404, the 409 blocked body with its count, or { trashed }", async () => {
    expect([taxonomyDeleteTermRoute.method, taxonomyDeleteTermRoute.path]).toEqual(["delete", "/api/admin/v1/taxonomy/terms/:id"]);
    expect(taxonomyDeleteTermRoute.parse({ ...RAW, params: { id: "term-1" } })).toEqual({ ok: true, value: { id: "term-1" } });
    const seen: unknown[] = [];
    const authorize = async (required: object, optional?: object) => { seen.push({ ...required, ...optional }); };
    const run = (deps: TaxonomyDeleteTermRouteDeps) => taxonomyDeleteTermRoute.handle({ input: { id: "term-1" }, deps, context: PRINCIPAL, authorize });
    expect(await refusalOf(() => run(deleteTermDeps(false, { ok: true, version: 1 })))).toEqual({ status: 404, body: { error: "term 'term-1' was not found", code: "TERM_NOT_FOUND" } });
    expect(await refusalOf(() => run(deleteTermDeps(true, { ok: false, reason: "blocked", code: "TERM_HAS_CHILDREN", count: 2 })))).toEqual({
      status: 409, body: { error: "term 'term-1' still has child terms", code: "TERM_HAS_CHILDREN", count: 2 },
    });
    expect(await refusalOf(() => run(deleteTermDeps(true, { ok: false, reason: "version-changed" })))).toEqual({
      status: 409, body: { error: "term 'term-1' changed while it was being deleted", code: "TRASH_VERSION_CHANGED" },
    });
    expect(await run(deleteTermDeps(true, { ok: true, version: 5 }))).toEqual({ ok: true, value: { trashed: true, id: "term-1", version: 5 } });
    expect(seen[0]).toEqual({ permission: "admin.taxonomy.manage", entityType: "term", entityId: "term-1" });
  });
});

describe("taxonomy assignment routes", () => {
  it("keep their paths and refuse a malformed body or query with the exact 400", async () => {
    expect([taxonomyAssignTermsRoute, taxonomyUnassignTermsRoute, taxonomyAssignedTermsRoute].map((r) => [r.method, r.path, r.successStatus])).toEqual([
      ["post", "/api/admin/v1/taxonomy/assign-terms", 204], ["post", "/api/admin/v1/taxonomy/unassign-terms", 204], ["get", "/api/admin/v1/taxonomy/assigned-terms", undefined],
    ]);
    for (const route of [taxonomyAssignTermsRoute, taxonomyUnassignTermsRoute]) {
      expect(await refusalOf(() => route.parse({ ...RAW, body: { contentType: "post", contentId: "p1", termIds: "t-1" } }))).toEqual({
        status: 400, body: { error: "'contentType', 'contentId' (strings), and 'termIds' (array) are required", code: "VALIDATION_ERROR" },
      });
    }
    expect(await refusalOf(() => taxonomyAssignedTermsRoute.parse({ ...RAW, query: { contentType: "post", contentId: "" } }))).toEqual({
      status: 400, body: { error: "'contentType' and 'contentId' query parameters are required", code: "VALIDATION_ERROR" },
    });
  });

  it("assigned-terms answers sorted term ids after both permission checks", async () => {
    const { deps, calls } = writeDeps();
    const result = await taxonomyAssignedTermsRoute.handle({ input: { contentType: "post", contentId: "p1" }, deps, context: PRINCIPAL, authorize: unusedPortAuthorize });
    expect(result).toEqual({ ok: true, value: { termIds: ["t-1", "t-2"] } });
    expect(calls.authorize).toEqual([
      { principalId: "principal-7", permission: "admin.taxonomy.manage", workspaceId: "ws-7" },
      { principalId: "principal-7", permission: "content.write", workspaceId: "ws-7" },
    ]);
  });

  it("assigned-terms maps a denial to the flat 403 and a workspace mismatch to 400 VALIDATION_ERROR", async () => {
    expect(await refusalOf(() => taxonomyAssignedTermsRoute.handle({ input: { contentType: "post", contentId: "p1" }, deps: writeDeps({ authorize: deny }).deps, context: PRINCIPAL, authorize: unusedPortAuthorize }))).toEqual({
      status: 403, body: { error: "principal 'principal-7' is not authorized for 'admin.taxonomy.manage' (no grant)", code: "FORBIDDEN" },
    });
    const mismatch = new WorkspaceMismatchError({ message: "workspace mismatch" });
    expect(await refusalOf(() => taxonomyAssignedTermsRoute.handle({ input: { contentType: "post", contentId: "p1" }, deps: writeDeps({ authorize: async () => { throw mismatch; } }).deps, context: PRINCIPAL, authorize: unusedPortAuthorize }))).toEqual({
      status: 400, body: { error: "workspace mismatch", code: "VALIDATION_ERROR" },
    });
  });

  it("assign-terms refuses an unknown content target with 404 CONTENT_NOT_FOUND", async () => {
    const { deps } = writeDeps({ authorize: allow });
    const refusal = await refusalOf(() => taxonomyAssignTermsRoute.handle({ input: { contentType: "post", contentId: "missing", termIds: [] }, deps, context: PRINCIPAL, authorize: unusedPortAuthorize }));
    expect(refusal.status).toBe(404);
    expect((refusal.body as { code: string }).code).toBe("CONTENT_NOT_FOUND");
  });
});
