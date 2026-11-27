import { describe, expect, it } from "vitest";

import {
  postAutosaveDeleteRoute, postAutosaveGetRoute, postAutosavePutRoute, type PostAutosavePutRouteDeps, type PostAutosaveReadAndClearRouteDeps,
} from "../autosave.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./write-helpers.js";

class FakePostNotFound extends Error {}

const SNAPSHOT = { bodyFormat: "doc", title: "Parked", slug: "parked", baseVersion: 3, bodyJson: { type: "doc" } };

/** Recording deps: `findPostId` resolves `my-slug` to `p1`, misses with the host's not-found error otherwise
 *  (or throws `lookupError` when given), and the store calls record the id they were asked for. */
function makeDeps(optional: { lookupError?: Error } = {}) {
  const reads: unknown[] = [];
  const clears: unknown[] = [];
  const deps: PostAutosaveReadAndClearRouteDeps = {
    workspaceId: WORKSPACE_ID,
    findPostId: async ({ workspaceId, idOrSlug }) => {
      if (optional.lookupError) throw optional.lookupError;
      if (workspaceId === WORKSPACE_ID && idOrSlug === "my-slug") return "p1";
      throw new FakePostNotFound(`post '${idOrSlug}' not found`);
    },
    isPostNotFound: ({ err }) => err instanceof FakePostNotFound,
    readAutosave: async (input) => { reads.push(input); return input.id === "p1" ? SNAPSHOT : null; },
    clearAutosave: async (input) => { clears.push(input); },
  };
  return { deps, reads, clears };
}

const PATH = "/api/admin/v1/workspaces/:workspaceId/posts/:postId/autosave";

describe("postAutosaveGetRoute / postAutosaveDeleteRoute", () => {
  it("keeps the methods, the shared path, no body cap and the default 200", () => {
    expect([postAutosaveGetRoute.method, postAutosaveDeleteRoute.method]).toEqual(["get", "delete"]);
    for (const route of [postAutosaveGetRoute, postAutosaveDeleteRoute]) {
      expect(route.path).toBe(PATH);
      expect(route.maxBodyBytes).toBeUndefined();
      expect(route.successStatus).toBeUndefined();
    }
  });

  it("parses :postId, falling back to an empty segment", () => {
    for (const route of [postAutosaveGetRoute, postAutosaveDeleteRoute]) {
      expect(route.parse(raw({ workspaceId: WORKSPACE_ID, postId: "my-slug" }))).toEqual({ ok: true, value: { postId: "my-slug" } });
      expect(route.parse(raw({}))).toEqual({ ok: true, value: { postId: "" } });
    }
  });

  it("GET authorizes content.write on posts naming no entity, resolves the slug and answers the parked snapshot", async () => {
    const { deps, reads } = makeDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await postAutosaveGetRoute.handle({ input: { postId: "my-slug" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "content.write", entityType: "post" }]);
    expect(reads).toEqual([{ workspaceId: WORKSPACE_ID, id: "p1" }]);
    expect(result).toEqual({ ok: true, value: { autosave: SNAPSHOT } });
  });

  it("DELETE authorizes the same way, clears the resolved id and answers { ok: true }", async () => {
    const { deps, clears } = makeDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await postAutosaveDeleteRoute.handle({ input: { postId: "my-slug" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "content.write", entityType: "post" }]);
    expect(clears).toEqual([{ workspaceId: WORKSPACE_ID, id: "p1" }]);
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it("a missing post falls back to the raw segment: GET null, DELETE ok — never a 404", async () => {
    const { deps, reads, clears } = makeDeps();
    const { authorize } = recordingAuthorize();
    expect(await postAutosaveGetRoute.handle({ input: { postId: "ghost" }, deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { autosave: null } });
    expect(await postAutosaveDeleteRoute.handle({ input: { postId: "ghost" }, deps, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { ok: true } });
    expect(reads).toEqual([{ workspaceId: WORKSPACE_ID, id: "ghost" }]);
    expect(clears).toEqual([{ workspaceId: WORKSPACE_ID, id: "ghost" }]);
  });

  it("any other lookup failure is rethrown unchanged (the host's redacted 500), touching no store", async () => {
    const { deps, reads, clears } = makeDeps({ lookupError: new Error("db down") });
    const { authorize } = recordingAuthorize();
    await expect(postAutosaveGetRoute.handle({ input: { postId: "my-slug" }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("db down");
    await expect(postAutosaveDeleteRoute.handle({ input: { postId: "my-slug" }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("db down");
    expect([reads, clears]).toEqual([[], []]);
  });

  it("an authorization refusal stops before any lookup, read or clear; no authorizer fails closed", async () => {
    let lookups = 0;
    const { deps, reads, clears } = makeDeps();
    const counted = { ...deps, findPostId: async (input: { workspaceId: string; idOrSlug: string }) => { lookups += 1; return deps.findPostId(input); } };
    for (const route of [postAutosaveGetRoute, postAutosaveDeleteRoute]) {
      await expect(route.handle({ input: { postId: "my-slug" }, deps: counted, context: PRINCIPAL, authorize: recordingAuthorize(["content.write"]).authorize })).rejects.toThrow("denied content.write");
      await expect(route.handle({ input: { postId: "my-slug" }, deps: counted, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    }
    expect([lookups, reads, clears]).toEqual([0, [], []]);
  });
});

class FakePostValidation extends Error {}

const NOW = "2026-11-23T10:00:00.000Z";
const HTML_BODY = { bodyFormat: "html", title: "Unsaved title", slug: "draft", bodyHtml: "<p>Draft</p>", baseVersion: 3 };
const DOC_BODY = { bodyFormat: "doc", title: "Unsaved title", slug: "draft", bodyJson: { type: "doc" }, baseVersion: 3 };

/** PUT deps over `makeDeps`'s lookup: the host's author normalizer (trims, refuses > 5 chars with its
 *  validation error), the clock, and a recording `writeAutosave` that answers `applied`. */
function makePutDeps(optional: { lookupError?: Error; applied?: boolean; normalizeError?: Error } = {}) {
  const writes: unknown[] = [];
  const normalized: unknown[] = [];
  const { deps: lookup } = makeDeps(optional.lookupError ? { lookupError: optional.lookupError } : {});
  const deps: PostAutosavePutRouteDeps = {
    workspaceId: WORKSPACE_ID,
    findPostId: lookup.findPostId,
    isPostNotFound: lookup.isPostNotFound,
    normalizeAuthor: ({ author }) => {
      normalized.push(author);
      if (optional.normalizeError) throw optional.normalizeError;
      if (typeof author === "string" && author.trim().length > 5) throw new FakePostValidation("author must be at most 5 characters");
      return typeof author === "string" ? author.trim() || null : null;
    },
    isPostValidation: ({ err }) => err instanceof FakePostValidation,
    nowIso: () => NOW,
    writeAutosave: async (input) => { writes.push(input); return { applied: optional.applied ?? true }; },
  };
  return { deps, writes, normalized };
}

const put = (deps: PostAutosavePutRouteDeps, body: unknown, optional: { postId?: string; authorize?: ReturnType<typeof recordingAuthorize>["authorize"] } = {}) =>
  postAutosavePutRoute.handle({ input: { postId: optional.postId ?? "my-slug", body }, deps, context: PRINCIPAL, authorize: optional.authorize ?? recordingAuthorize().authorize }, { signal });

const INVALID = { status: 400, body: { error: "invalid autosave body", code: "VALIDATION_ERROR" } };

describe("postAutosavePutRoute", () => {
  it("keeps PUT on the shared path, the default 200 and no spec-level body cap (the host binds its own 413 copy)", () => {
    expect(postAutosavePutRoute.method).toBe("put");
    expect(postAutosavePutRoute.path).toBe(PATH);
    expect(postAutosavePutRoute.successStatus).toBeUndefined();
    expect(postAutosavePutRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses :postId (empty-segment fallback) and passes the body through unjudged — validation waits for authorization", () => {
    expect(postAutosavePutRoute.parse(raw({ workspaceId: WORKSPACE_ID, postId: "my-slug" }, { bodyFormat: 7 }))).toEqual({ ok: true, value: { postId: "my-slug", body: { bodyFormat: 7 } } });
    expect(postAutosavePutRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { postId: "", body: undefined } });
  });

  it("authorizes content.write on posts naming no entity, resolves the slug and parks the stamped snapshot", async () => {
    const { deps, writes } = makePutDeps({ applied: false });
    const { authorize, calls } = recordingAuthorize();
    const result = await put(deps, HTML_BODY, { authorize });
    expect(calls).toEqual([{ permission: "content.write", entityType: "post" }]);
    expect(writes).toEqual([{ workspaceId: WORKSPACE_ID, id: "p1", snapshot: { ...HTML_BODY, savedAt: NOW, savedByPrincipalId: PRINCIPAL.id } }]);
    expect(result).toEqual({ ok: true, value: { applied: false } });
  });

  it("a doc body parks bodyJson; a byline is normalized by the host and absent keys stay absent", async () => {
    const { deps, writes, normalized } = makePutDeps();
    await put(deps, { ...DOC_BODY, author: "  Ann ", showAuthor: false });
    await put(deps, { ...DOC_BODY, author: null });
    await put(deps, DOC_BODY);
    const snapshots = writes.map((write) => (write as { snapshot: object }).snapshot);
    expect(snapshots).toEqual([
      { ...DOC_BODY, author: "Ann", showAuthor: false, savedAt: NOW, savedByPrincipalId: PRINCIPAL.id },
      { ...DOC_BODY, author: null, savedAt: NOW, savedByPrincipalId: PRINCIPAL.id },
      { ...DOC_BODY, savedAt: NOW, savedByPrincipalId: PRINCIPAL.id },
    ]);
    expect(normalized).toEqual(["  Ann ", null]);
  });

  it("refuses every shape the body-format CHECK would reject with the flat 400, writing nothing", async () => {
    const bad: unknown[] = [
      undefined, { ...HTML_BODY, bodyFormat: "markdown" }, { ...HTML_BODY, title: 1 }, { ...HTML_BODY, slug: null },
      { ...HTML_BODY, baseVersion: "3" }, { ...HTML_BODY, baseVersion: Number.NaN }, { ...HTML_BODY, baseVersion: Number.POSITIVE_INFINITY },
      { ...HTML_BODY, bodyHtml: undefined }, { ...DOC_BODY, bodyJson: null }, { ...DOC_BODY, bodyJson: "doc" },
      { ...HTML_BODY, author: 7 }, { ...HTML_BODY, showAuthor: "true" },
    ];
    const { deps, writes } = makePutDeps();
    for (const body of bad) expect(await refusalOf(() => put(deps, body))).toEqual(INVALID);
    expect(writes).toEqual([]);
  });

  it("the host's author validation error is a 400 carrying its message; any other normalizer failure is rethrown", async () => {
    const { deps, writes } = makePutDeps();
    expect(await refusalOf(() => put(deps, { ...HTML_BODY, author: "x".repeat(6) }))).toEqual({ status: 400, body: { error: "author must be at most 5 characters", code: "VALIDATION_ERROR" } });
    await expect(put(makePutDeps({ normalizeError: new Error("boom") }).deps, { ...HTML_BODY, author: "Ann" })).rejects.toThrow("boom");
    expect(writes).toEqual([]);
  });

  it("a missing post parks against the raw segment (the store's no-op), never a 404; other lookup failures are rethrown", async () => {
    const { deps, writes } = makePutDeps();
    await put(deps, HTML_BODY, { postId: "ghost" });
    expect((writes[0] as { id: string }).id).toBe("ghost");
    const failing = makePutDeps({ lookupError: new Error("db down") });
    await expect(put(failing.deps, HTML_BODY)).rejects.toThrow("db down");
    expect(failing.writes).toEqual([]);
  });

  it("an authorization refusal stops before validation and any write; no authorizer or principal fails closed", async () => {
    const { deps, writes, normalized } = makePutDeps();
    await expect(put(deps, { ...HTML_BODY, author: "Ann" }, { authorize: recordingAuthorize(["content.write"]).authorize })).rejects.toThrow("denied content.write");
    await expect(postAutosavePutRoute.handle({ input: { postId: "my-slug", body: HTML_BODY }, deps, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(postAutosavePutRoute.handle({ input: { postId: "my-slug", body: HTML_BODY }, deps, context: undefined, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    expect([writes, normalized]).toEqual([[], []]);
  });
});

it("preserves a host-classified author validation string without saving a snapshot", async () => {
  const { deps, writes } = makePutDeps();
  const failure = "invalid byline";
  deps.normalizeAuthor = () => { throw failure; };
  deps.isPostValidation = ({ err }) => err === failure;
  expect(await refusalOf(() => put(deps, { ...DOC_BODY, author: "Ada" })))
    .toStrictEqual({ status: 400, body: { error: "invalid byline", code: "VALIDATION_ERROR" } });
  expect(writes).toEqual([]);
});
