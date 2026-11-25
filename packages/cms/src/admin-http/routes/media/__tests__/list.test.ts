import { describe, expect, it } from "vitest";
import type { RouteInputContext } from "@jini-ai/core/contracts/server";
import { mediaListRoute, type MediaListRouteDeps } from "../list.js";
import { fakeMedia, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const query = (q: Record<string, unknown>): RouteInputContext => ({ ...raw({}), query: q } as RouteInputContext);

function listDeps(rows = [fakeMedia({ id: "a1" }), fakeMedia({ id: "a2", status: "trashed" })]): MediaListRouteDeps & { listed: unknown[]; resolved: unknown[] } {
  const listed: unknown[] = [];
  const resolved: unknown[] = [];
  const record = (name: string) => async ({ media }: { media: readonly { id: string }[] }) => { resolved.push([name, media.map((m) => m.id)]); return new Map(); };
  return {
    listed, resolved, workspaceId: WORKSPACE_ID,
    listMedia: async (input) => { listed.push(input); return rows; },
    resolveContentTypes: record("types"), resolvePublicUrls: record("urls"), resolveByteSizes: record("sizes"),
  };
}

describe("mediaListRoute", () => {
  it("keeps the method and path, defaults the kind to media and refuses any other kind with the hand-written 400", async () => {
    expect([mediaListRoute.method, mediaListRoute.path, mediaListRoute.successStatus]).toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/media", undefined]);
    expect(mediaListRoute.parse(query({}))).toEqual({ ok: true, value: { kind: "media" } });
    expect(mediaListRoute.parse(query({ kind: "document" }))).toEqual({ ok: true, value: { kind: "document" } });
    for (const kind of ["image", ["media"], ""]) {
      expect(await refusalOf(async () => mediaListRoute.parse(query({ kind })))).toEqual({ status: 400, body: { error: "invalid media kind" } });
    }
  });

  it("sets Cache-Control: private, no-store once admitted, for documents only", () => {
    expect(mediaListRoute.admittedResponseHeaders(query({ kind: "document" }))).toEqual({ "Cache-Control": "private, no-store" });
    expect(mediaListRoute.admittedResponseHeaders(query({ kind: "media" }))).toBeUndefined();
    expect(mediaListRoute.admittedResponseHeaders(query({}))).toBeUndefined();
  });

  it("authorizes media.read for the list before listing, then answers every asset for media", async () => {
    const deps = listDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await mediaListRoute.handle({ input: { kind: "media" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "media.read", entityType: "media" }]);
    expect(deps.listed).toEqual([{ workspaceId: WORKSPACE_ID, kind: "media" }]);
    expect(deps.resolved).toEqual([["types", ["a1", "a2"]], ["urls", ["a1", "a2"]], ["sizes", ["a1", "a2"]]]);
    expect(result.ok && (result.value as { media: { id: string }[] }).media.map((m) => m.id)).toEqual(["a1", "a2"]);
  });

  it("answers only active documents, and lists nothing when authorization is denied", async () => {
    const deps = listDeps();
    const { authorize } = recordingAuthorize();
    const result = await mediaListRoute.handle({ input: { kind: "document" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(deps.listed).toEqual([{ workspaceId: WORKSPACE_ID, kind: "document" }]);
    expect(result.ok && (result.value as { media: { id: string }[] }).media.map((m) => m.id)).toEqual(["a1"]);
    const denied = listDeps();
    await expect(mediaListRoute.handle({ input: { kind: "media" }, deps: denied, context: PRINCIPAL, authorize: recordingAuthorize(["media.read"]).authorize }, { signal })).rejects.toThrow("denied media.read");
    expect(denied.listed).toEqual([]);
  });
});
