import { ToolInputError } from "@jini-ai/core";
import { describe, expect, it } from "vitest";

import { EntityNotLiveError } from "../../../../core/index.js";
import { pageUpdateHtmlRoute, type PageHtmlStore, type PageUpdateHtmlRouteDeps } from "../update-html.js";
import type { AdminPageRecord } from "../shared.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

class FakeKindMismatch extends Error {}
class FakeNotFound extends Error {}
class FakeConcurrentEdit extends Error {}
/** Matches BOTH the kind-mismatch and not-found predicates, to pin the ladder's order. */
class FakeKindAndMissing extends Error {}

const PAGE: AdminPageRecord & { id: string } = { id: "p1", kind: "page", bodyHtml: "<p>Saved</p>" };
const EDIT_HTML = "pages.edit_html";

/** A recording store and deps: every call lands in `calls` in order, so a test pins what ran (and what did not). */
function makeDeps(optional: { storeError?: Error; warnings?: readonly unknown[] | "none"; found?: boolean; validator?: boolean } = {}) {
  const calls: unknown[] = [];
  const store: PageHtmlStore = {
    ensureHtmlFormat: async (input) => { calls.push(["ensureHtmlFormat", input]); if (optional.storeError) throw optional.storeError; },
    write: async (input) => { calls.push(["write", input]); },
    ...(optional.warnings === "none" ? {} : { embedWarnings: () => (optional.warnings ?? []) as readonly unknown[] }),
  };
  const deps: PageUpdateHtmlRouteDeps = {
    workspaceId: WORKSPACE_ID,
    editHtmlPermission: EDIT_HTML,
    defaultPageSkeleton: "<main>skeleton</main>",
    pagesHtmlStore: (scope) => { calls.push(["store", scope]); return store; },
    pluginExports: () => (optional.validator === false ? undefined : { validateHtml: async (input) => { calls.push(["validateHtml", input]); return []; } }),
    findPostById: async (input) => { calls.push(["findPostById", input]); return optional.found === false ? null : PAGE; },
    toAdminPageResponse: ({ post }) => ({ dto: (post as typeof PAGE).id }),
    isPageKindMismatch: ({ err }) => err instanceof FakeKindMismatch || err instanceof FakeKindAndMissing,
    isPageNotFound: ({ err }) => err instanceof FakeNotFound || err instanceof FakeKindAndMissing,
    isPageConcurrentEdit: ({ err }) => err instanceof FakeConcurrentEdit,
  };
  return { deps, calls };
}

const run = (deps: PageUpdateHtmlRouteDeps, body: { html: unknown; expectedVersion?: unknown }, authorize = recordingAuthorize().authorize) =>
  pageUpdateHtmlRoute.handle({ input: { pageId: "p1", ...body }, deps, context: PRINCIPAL, authorize });

describe("pageUpdateHtmlRoute", () => {
  it("keeps PUT …/pages/:pageId/html, the default 200 and no spec-level body cap (the host binds its own 413 copy)", () => {
    expect(pageUpdateHtmlRoute.method).toBe("put");
    expect(pageUpdateHtmlRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/pages/:pageId/html");
    expect(pageUpdateHtmlRoute.successStatus).toBeUndefined();
    expect(pageUpdateHtmlRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses :pageId, html and expectedVersion without judging them (validation waits for authorization)", () => {
    expect(pageUpdateHtmlRoute.parse(raw({ pageId: "p1" }, { html: 7, expectedVersion: "3" }))).toEqual({ ok: true, value: { pageId: "p1", html: 7, expectedVersion: "3" } });
    expect(pageUpdateHtmlRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { pageId: "", html: undefined, expectedVersion: undefined } });
  });

  it("authorizes the injected permission on posts naming no entity, then validates, converts, writes and answers the host DTO", async () => {
    const { deps, calls } = makeDeps();
    const { authorize, calls: auth } = recordingAuthorize();
    const result = await run(deps, { html: "<p>New</p>", expectedVersion: 4 }, authorize);
    expect(auth).toEqual([{ permission: EDIT_HTML, entityType: "post" }]);
    expect(calls).toEqual([
      ["store", { workspaceId: WORKSPACE_ID, postId: "p1", actorId: PRINCIPAL.id }],
      ["validateHtml", { workspaceId: WORKSPACE_ID, html: "<p>New</p>" }],
      ["ensureHtmlFormat", { seedHtml: "<main>skeleton</main>", expectedVersion: 4 }],
      ["write", { html: "<p>New</p>" }],
      ["findPostById", { workspaceId: WORKSPACE_ID, id: "p1" }],
    ]);
    expect(result).toEqual({ ok: true, value: { dto: "p1" } });
  });

  it("an absent expectedVersion reaches the store as undefined; no plugin runtime skips validation", async () => {
    const { deps, calls } = makeDeps({ validator: false });
    await run(deps, { html: "<p>New</p>" });
    expect(calls.map((call) => (call as [string])[0])).toEqual(["store", "ensureHtmlFormat", "write", "findPostById"]);
    expect(calls[1]).toEqual(["ensureHtmlFormat", { seedHtml: "<main>skeleton</main>", expectedVersion: undefined }]);
  });

  it("attaches the store's embed warnings only when there are some", async () => {
    expect(await run(makeDeps({ warnings: [{ code: "W" }] }).deps, { html: "x" })).toEqual({ ok: true, value: { dto: "p1", warnings: [{ code: "W" }] } });
    expect(await run(makeDeps({ warnings: [] }).deps, { html: "x" })).toEqual({ ok: true, value: { dto: "p1" } });
    expect(await run(makeDeps({ warnings: "none" }).deps, { html: "x" })).toEqual({ ok: true, value: { dto: "p1" } });
  });

  it("a non-string html is a 400 VALIDATION_ERROR after authorization, touching no store", async () => {
    for (const html of [undefined, 7, null]) {
      const { deps, calls } = makeDeps();
      const { authorize, calls: auth } = recordingAuthorize();
      expect(await refusalOf(() => run(deps, { html }, authorize))).toEqual({ status: 400, body: { error: "'html' must be a string", code: "VALIDATION_ERROR" } });
      expect([auth.length, calls]).toEqual([1, []]);
    }
  });

  it("a malformed expectedVersion is a 400 VALIDATION_ERROR before the store is built", async () => {
    const { deps, calls } = makeDeps();
    expect(await refusalOf(() => run(deps, { html: "x", expectedVersion: "3" }))).toEqual({
      status: 400, body: { error: "'expectedVersion' must be a non-negative integer when present", code: "VALIDATION_ERROR" },
    });
    expect(calls).toEqual([]);
  });

  it("a page deleted between the write and the read-back is a 404 ENTRY_NOT_FOUND", async () => {
    expect(await refusalOf(() => run(makeDeps({ found: false }).deps, { html: "x" }))).toEqual({ status: 404, body: { error: "page 'p1' was not found", code: "ENTRY_NOT_FOUND" } });
  });

  it("maps store failures in the hand-written ladder's order", async () => {
    const cases: [Error, number, string][] = [
      [new ToolInputError({ message: "bad html" }), 400, "VALIDATION_ERROR"],
      // `EntityNotLiveError` subclasses ToolInputError, so its rung must sit ahead of the generic
      // 400: a trashed (or tombstoned) page answers 409 with the error's own code, as the
      // redirects/seo/taxonomy routes do.
      [new EntityNotLiveError({ entityType: "post", entityId: "p1", state: "trashed" }), 409, "ENTITY_IN_TRASH"],
      [new EntityNotLiveError({ entityType: "post", entityId: "p1", state: "tombstoned" }), 409, "ENTITY_TOMBSTONED"],
      // The plugin-embed validation error is a ToolInputError too and keeps the generic 400.
      [Object.assign(new ToolInputError({ message: "embed props" }), { code: "PLUGIN_EMBED_INVALID_PROPS" }), 400, "VALIDATION_ERROR"],
      [new FakeKindMismatch("not a page"), 400, "KIND_MISMATCH"],
      [new FakeKindAndMissing("both"), 400, "KIND_MISMATCH"],
      [new FakeNotFound("gone"), 404, "ENTRY_NOT_FOUND"],
      [new FakeConcurrentEdit("moved on"), 409, "CONCURRENT_EDIT"],
    ];
    for (const [error, status, code] of cases) {
      expect(await refusalOf(() => run(makeDeps({ storeError: error }).deps, { html: "x" }))).toEqual({ status, body: { error: error.message, code } });
    }
  });

  it("rethrows an unmapped failure unchanged (the host's redacted 500), skipping the write", async () => {
    const { deps, calls } = makeDeps({ storeError: new Error("db down") });
    await expect(run(deps, { html: "x" })).rejects.toThrow("db down");
    expect(calls.map((call) => (call as [string])[0])).not.toContain("write");
  });

  it("an authorization refusal stops before validation and every store call; no authorizer or principal fails closed", async () => {
    const { deps, calls } = makeDeps();
    const deny = async ({ permission }: { permission: string }) => { throw new Error(`denied ${permission}`); };
    await expect(run(deps, { html: 7 }, deny)).rejects.toThrow(`denied ${EDIT_HTML}`);
    await expect(pageUpdateHtmlRoute.handle({ input: { pageId: "p1", html: "x" }, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(pageUpdateHtmlRoute.handle({ input: { pageId: "p1", html: "x" }, deps, context: undefined, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    expect(calls).toEqual([]);
  });
});
