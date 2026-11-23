import { describe, expect, it } from "vitest";
import { seoPutEntryRoute } from "../put-entry.js";
import { denyingAuthorize, ENTRY_ID, makeSeoRouteDeps, PRINCIPAL, recordingAuthorize, refusalOf, seedEntry, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (params: Record<string, string>, body: unknown) => ({ body, query: {}, params });
const put = (body: unknown, deps = makeSeoRouteDeps(), entryId = ENTRY_ID) =>
  seoPutEntryRoute.handle({ input: { entryId, body }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal });

describe("seoPutEntryRoute", () => {
  it("keeps the path and passes :entryId plus the untouched body through", () => {
    expect(seoPutEntryRoute.method).toBe("put");
    expect(seoPutEntryRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/seo/entries/:entryId");
    expect(seoPutEntryRoute.parse(raw({ entryId: ENTRY_ID }, { title: "x" }))).toEqual({ ok: true, value: { entryId: ENTRY_ID, body: { title: "x" } } });
    expect(seoPutEntryRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { entryId: "", body: undefined } });
  });

  it("authorizes on the entry, writes as the caller, and answers the fresh meta", async () => {
    const { authorize, calls } = recordingAuthorize();
    const deps = makeSeoRouteDeps();
    const result = await seoPutEntryRoute.handle({ input: { entryId: ENTRY_ID, body: { title: "New", expectedVersion: 1 } }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.seo.manage", entityType: "seo-entry", entityId: ENTRY_ID }]);
    expect((result as { ok: true; value: { data: { title: string } } }).value.data.title).toBe("New");
    const stored = await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: ENTRY_ID });
    expect(JSON.parse(stored?.seoExtJson ?? "{}")).toEqual({ title: "New" });
  });

  it("an empty or missing body is a no-op patch that still answers the current meta", async () => {
    const result = await put(undefined);
    expect((result as { ok: true; value: { data: { title: string } } }).value.data.title).toBe("Hello");
  });

  it("refuses a malformed expectedVersion with 400 VALIDATION_ERROR and writes nothing", async () => {
    const deps = makeSeoRouteDeps();
    expect(await refusalOf(() => put({ title: "x", expectedVersion: "1" }, deps))).toEqual({
      status: 400, body: { error: "'expectedVersion' must be a non-negative integer when present", code: "VALIDATION_ERROR" },
    });
    expect((await deps.repo.findById({ workspaceId: WORKSPACE_ID, id: ENTRY_ID }))?.seoExtJson ?? null).toBeNull();
  });

  it("refuses a stale basis with 409 VERSION_CONFLICT and its version details", async () => {
    const refusal = await refusalOf(() => put({ title: "x", expectedVersion: 7 }));
    expect(refusal.status).toBe(409);
    expect(refusal.body).toMatchObject({ code: "VERSION_CONFLICT", details: { recordId: ENTRY_ID, expectedVersion: 7, currentVersion: 1 } });
  });

  it("maps the SEO write's own errors: unknown entry 404, bad field 400, bad canonical 400, trashed 409", async () => {
    expect(await refusalOf(() => put({ title: "x" }, makeSeoRouteDeps(), "nope"))).toEqual({ status: 404, body: { error: "entry 'nope' was not found", code: "SEO_ENTRY_NOT_FOUND" } });
    expect((await refusalOf(() => put({ title: 5 }))).body).toMatchObject({ code: "SEO_FIELD_VALIDATION_ERROR" });
    expect((await refusalOf(() => put({ canonical: "javascript:alert(1)" }))).body).toMatchObject({ code: "SEO_INVALID_CANONICAL_URL" });
    const trashed = makeSeoRouteDeps([seedEntry({ deletedAt: "2026-01-01T00:00:00.000Z" })]);
    expect(await refusalOf(() => put({ title: "x" }, trashed))).toMatchObject({ status: 409, body: { code: "ENTITY_IN_TRASH" } });
  });

  it("answers 409 SEO_CONCURRENT_WRITE when every merge attempt loses the row", async () => {
    const deps = makeSeoRouteDeps();
    deps.seoDeps.postRepo.saveIfVersion = async () => ({ applied: false });
    expect(await refusalOf(() => put({ title: "x" }, deps))).toEqual({
      status: 409, body: { error: `entry '${ENTRY_ID}' is being written by another save; the SEO overrides were not applied`, code: "SEO_CONCURRENT_WRITE" },
    });
  });

  it("rethrows an unexpected failure unchanged for the host's error port", async () => {
    const deps = makeSeoRouteDeps();
    deps.seoDeps.postRepo.saveIfVersion = async () => { throw new Error("boom"); };
    await expect(put({ title: "x" }, deps)).rejects.toThrow("boom");
  });

  it("does not reach the write chokepoint when authorization refuses", async () => {
    const deps = makeSeoRouteDeps();
    let chokepointAuthorized = 0;
    deps.authorize = async () => { chokepointAuthorized += 1; return { allowed: true, reason: "matched" }; };
    await expect(seoPutEntryRoute.handle({ input: { entryId: ENTRY_ID, body: { title: "x" } }, deps, context: PRINCIPAL, authorize: denyingAuthorize })).rejects.toThrow("denied");
    expect(chokepointAuthorized).toBe(0);
  });
});
