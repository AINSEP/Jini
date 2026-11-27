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
    outwardErrorMessage: ({ error }: { error: Error }) => error.message,
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

  it("preserves the host's trusted actor on the creation event", async () => {
    const events: unknown[] = [];
    const actorRequests: unknown[] = [];
    const { deps } = writeDeps({
      mutationActor: ({ principalId }: { principalId: string }) => {
        actorRequests.push(principalId);
        return { id: principalId, kind: "user" };
      },
      outbox: { enqueue: async (event: unknown) => { events.push(event); } },
    });
    await taxonomyCreateRoute.handle({ input: { name: "Topics", hierarchical: true }, deps, context: PRINCIPAL, authorize: unusedPortAuthorize });
    expect(actorRequests).toEqual(["principal-7"]);
    expect(events).toEqual([expect.objectContaining({
      name: "taxonomy.created", workspaceId: "ws-7", actorId: "principal-7", actor: { id: "principal-7", kind: "user" },
    })]);
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

  it("persists a term under an existing parent and answers the inserted term", async () => {
    const inserted: unknown[] = [];
    const { deps } = writeDeps({
      termRepo: {
        findById: async ({ id }: { id: string }) => id === "parent-1" ? { id, taxonomyId: "tax-1" } : null,
        insert: async (term: unknown) => { inserted.push(term); },
      },
    });
    const parsed = taxonomyCreateTermRoute.parse({ ...RAW, params: { taxonomyId: "tax-1" }, body: { name: "Local", parentId: "parent-1" } });
    if (!parsed.ok) throw new Error("expected valid term input");
    const term = { id: "id-new", taxonomyId: "tax-1", parentId: "parent-1", name: "Local", status: "active", updatedAt: "2026-10-21T00:00:00.000Z", version: 1 };
    expect(await taxonomyCreateTermRoute.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize: unusedPortAuthorize })).toEqual({ ok: true, value: { term } });
    expect(inserted).toEqual([term]);
  });

  it.each([
    { parent: null, message: "parent term 'parent-1' was not found" },
    { parent: { id: "parent-1", taxonomyId: "different-taxonomy" }, message: "parent term 'parent-1' belongs to taxonomy 'different-taxonomy', not 'tax-1'" },
  ])("refuses invalid hierarchy without inserting a term ($message)", async ({ parent, message }) => {
    const inserted: unknown[] = [];
    const { deps } = writeDeps({ termRepo: { findById: async () => parent, insert: async (term: unknown) => { inserted.push(term); } } });
    expect(await refusalOf(() => taxonomyCreateTermRoute.handle({ input: { taxonomyId: "tax-1", name: "Local", parentId: "parent-1" }, deps, context: PRINCIPAL, authorize: unusedPortAuthorize }))).toEqual({
      status: 400, body: { error: message, code: "VALIDATION_ERROR" },
    });
    expect(inserted).toEqual([]);
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

  it("renames the path's term in the host transaction and answers the updated version", async () => {
    const previous = { id: "term-1", taxonomyId: "tax-1", parentId: "parent-1", name: "Old", status: "active", updatedAt: "2026-10-20T00:00:00.000Z", version: 4 };
    const changed = { ...previous, name: "New", updatedAt: "2026-10-21T00:00:00.000Z", version: 5 };
    const calls: unknown[] = [];
    const { deps } = writeDeps({
      taxonomyRepo: {
        transaction: async ({ fn }: { fn: () => Promise<unknown> }) => {
          calls.push("begin");
          const result = await fn();
          calls.push("commit");
          return result;
        },
      },
      termRepo: {
        findById: async ({ id }: { id: string }) => id === previous.id ? previous : null,
        update: async (row: unknown) => { calls.push(row); },
      },
    });
    const parsed = taxonomyRenameTermRoute.parse({ ...RAW, params: { id: previous.id }, body: { newName: "New" } });
    if (!parsed.ok) throw new Error("expected valid rename");
    expect(await taxonomyRenameTermRoute.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize: unusedPortAuthorize })).toEqual({ ok: true, value: { term: changed } });
    expect(calls).toEqual(["begin", changed, "commit"]);
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
    const parsed = taxonomyAssignedTermsRoute.parse({ ...RAW, query: { contentType: "post", contentId: "p1", ignored: "extra" } });
    expect(parsed).toEqual({ ok: true, value: { contentType: "post", contentId: "p1" } });
    if (!parsed.ok) throw new Error("expected valid assigned terms query");
    const result = await taxonomyAssignedTermsRoute.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize: unusedPortAuthorize });
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

  it("parses and applies both assignment verbs to the named post without touching its other terms", async () => {
    const terms = new Set(["keep"]);
    const requests: unknown[] = [];
    const events: unknown[] = [];
    const { deps, calls } = writeDeps({
      mutationActor: ({ principalId }: { principalId: string }) => ({ id: principalId, kind: "user" }),
      outbox: { enqueue: async (event: unknown) => { events.push(event); } },
      postRepo: { findById: async ({ workspaceId, id }: { workspaceId: string; id: string }) => workspaceId === "ws-7" && id === "post-1" ? { workspaceId, kind: "post" } : null },
      termRepo: { findById: async ({ id }: { id: string }) => id === "term-1" ? { id, taxonomyId: "tax-1" } : null },
      entryTermRepo: {
        upsert: async (row: { contentType: string; contentId: string; termId: string; addedAt: string }) => {
          requests.push(row);
          terms.add(row.termId);
        },
        remove: async (row: { contentType: string; contentId: string; termId: string }) => {
          requests.push(row);
          return terms.delete(row.termId) ? 1 : 0;
        },
      },
    });
    const body = { contentType: "post", contentId: "post-1", termIds: ["term-1"] };
    const assigned = taxonomyAssignTermsRoute.parse({ ...RAW, body });
    if (!assigned.ok) throw new Error("expected valid assignment");
    expect(await taxonomyAssignTermsRoute.handle({ input: assigned.value, deps, context: PRINCIPAL, authorize: unusedPortAuthorize })).toEqual({ ok: true, value: undefined });
    expect([...terms]).toEqual(["keep", "term-1"]);
    const unassigned = taxonomyUnassignTermsRoute.parse({ ...RAW, body });
    if (!unassigned.ok) throw new Error("expected valid removal");
    expect(await taxonomyUnassignTermsRoute.handle({ input: unassigned.value, deps, context: PRINCIPAL, authorize: unusedPortAuthorize })).toEqual({ ok: true, value: undefined });
    expect([...terms]).toEqual(["keep"]);
    expect(requests).toEqual([
      { contentType: "post", contentId: "post-1", termId: "term-1", addedAt: "2026-10-21T00:00:00.000Z" },
      { contentType: "post", contentId: "post-1", termId: "term-1" },
    ]);
    expect(events).toEqual(["taxonomy.terms_assigned", "taxonomy.terms_unassigned"].map((name) => expect.objectContaining({
      name, actor: { id: PRINCIPAL.id, kind: "user" }, payload: expect.objectContaining(body),
    })));
    expect(calls.authorize).toEqual(["content.write", "admin.taxonomy.manage", "content.write", "admin.taxonomy.manage"].map(
      (permission) => ({ principalId: PRINCIPAL.id, workspaceId: "ws-7", permission }),
    ));
  });

  it.each([
    { label: "trashed post", deletedAt: "2026-10-01", kind: "post", term: null, status: 409, code: "ENTITY_IN_TRASH", error: "ENTITY_IN_TRASH: post 'post-1' is in the Trash. Restore it from the Trash before changing it." },
    { label: "missing term", deletedAt: null, kind: "post", term: null, status: 404, code: "TERM_NOT_FOUND", error: "term 'term-1' was not found" },
    { label: "content type mismatch", deletedAt: null, kind: "page", term: { id: "term-1", taxonomyId: "tax-1" }, status: 400, code: "VALIDATION_ERROR", error: "supplied content type 'post' does not match the resolved row's own kind 'page'" },
  ])("refuses an assignment to a $label without writing a join", async ({ deletedAt, kind, term, status, code, error }) => {
    const writes: unknown[] = [];
    const { deps } = writeDeps({
      postRepo: { findById: async () => ({ workspaceId: "ws-7", kind, deletedAt }) },
      termRepo: { findById: async () => term },
      entryTermRepo: { upsert: async (row: unknown) => { writes.push(row); } },
    });
    expect(await refusalOf(() => taxonomyAssignTermsRoute.handle({
      input: { contentType: "post", contentId: "post-1", termIds: ["term-1"] }, deps, context: PRINCIPAL, authorize: unusedPortAuthorize,
    }))).toEqual({ status, body: { error, code } });
    expect(writes).toEqual([]);
  });

  it("keeps an unexpected repository rejection unchanged for the host", async () => {
    const disconnected = "connection reset";
    const { deps } = writeDeps({ entryTermRepo: { listForContent: async () => { throw disconnected; } } });
    await expect(taxonomyAssignedTermsRoute.handle({
      input: { contentType: "post", contentId: "post-1" }, deps, context: PRINCIPAL, authorize: unusedPortAuthorize,
    })).rejects.toBe(disconnected);
  });

  it("refuses to assign a term if the post edit gate denies, before looking up content", async () => {
    const writes: unknown[] = [];
    const { deps } = writeDeps({
      authorize: async ({ permission }: { permission: string }) => ({ allowed: permission !== "content.write", reason: "no editor grant" }),
      postRepo: { findById: async () => { throw new Error("denied request must not read the post"); } },
      entryTermRepo: { upsert: async (row: unknown) => { writes.push(row); } },
    });
    expect(await refusalOf(() => taxonomyAssignTermsRoute.handle({
      input: { contentType: "post", contentId: "post-1", termIds: ["term-1"] }, deps, context: PRINCIPAL, authorize: unusedPortAuthorize,
    }))).toEqual({
      status: 403, body: { error: "principal 'principal-7' is not authorized for 'content.write' (no editor grant)", code: "FORBIDDEN" },
    });
    expect(writes).toEqual([]);
  });
});

describe("taxonomy write routes outward copy", () => {
  it("answers a recognized error with the host's outward message, keeping status and code", async () => {
    const deps = { ...writeDeps({ authorize: deny }).deps as object, outwardErrorMessage: ({ error }: { error: Error }) => `host: ${error.message}` };
    expect(await refusalOf(() => taxonomyCreateRoute.handle({ input: { name: "T", hierarchical: true }, deps: deps as never, context: PRINCIPAL, authorize: unusedPortAuthorize }))).toEqual({
      status: 403, body: { error: "host: principal 'principal-7' is not authorized for 'admin.taxonomy.manage' (no grant)", code: "FORBIDDEN" },
    });
  });
});
