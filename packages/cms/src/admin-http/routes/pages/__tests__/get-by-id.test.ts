import { describe, expect, it, vi } from "vitest";
import { embedMarkerSnippetFromConfig } from "../../../../widgets/markers/index.js";
import { pageGetRoute, type PageEmbedCatalogRow, type PageGetRouteDeps } from "../get-by-id.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

class FakeNotFound extends Error {}

const marker = (plugin: string, component: string) => embedMarkerSnippetFromConfig({ config: { type: "plugin", plugin, component, version: 1 } });

function deps(overrides: Partial<PageGetRouteDeps> & { bodyHtml?: string; kind?: string } = {}): PageGetRouteDeps & { reads: unknown[]; mapped: unknown[] } {
  const reads: unknown[] = [];
  const mapped: unknown[] = [];
  const { bodyHtml = "<p>hi</p>", kind = "page", ...rest } = overrides;
  return {
    reads, mapped, workspaceId: WORKSPACE_ID,
    readPage: async (input) => { reads.push(input); return { post: { id: "about", kind, bodyHtml } }; },
    toAdminPageResponse: ({ post }) => { mapped.push(post); return { id: "about", dto: true }; },
    isPostNotFound: ({ err }) => err instanceof FakeNotFound,
    pluginExports: () => undefined,
    ...rest,
  };
}

/** A catalog port answering `rows` under one provider key, counting its loads. */
function catalogOf(rows: readonly PageEmbedCatalogRow[]) {
  const catalog = vi.fn(async (_required: { workspaceId: string }) => new Map([["provider", rows]]));
  return { catalog };
}

const run = (d: PageGetRouteDeps, idOrSlug = "about") => pageGetRoute.handle({ input: { idOrSlug }, deps: d, context: PRINCIPAL, authorize: recordingAuthorize().authorize });

describe("pageGetRoute", () => {
  it("keeps the method, path and default success status, declares no body cap, and reads :pageId with the `?? \"\"` fallback", () => {
    expect(pageGetRoute.method).toBe("get");
    expect(pageGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/pages/:pageId");
    expect(pageGetRoute.successStatus).toBeUndefined();
    expect(pageGetRoute.maxBodyBytes).toBeUndefined();
    expect(pageGetRoute.parse(raw({ pageId: "about" }))).toEqual({ ok: true, value: { idOrSlug: "about" } });
    expect(pageGetRoute.parse(raw({}))).toEqual({ ok: true, value: { idOrSlug: "" } });
  });

  it("authorizes content.read on posts without an entity id, then answers the host's DTO unchanged when no embed is authored", async () => {
    const { authorize, calls } = recordingAuthorize();
    const port = catalogOf([]);
    const d = deps({ pluginExports: () => port });
    const result = await pageGetRoute.handle({ input: { idOrSlug: "about" }, deps: d, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "content.read", entityType: "post" }]);
    expect(d.reads).toEqual([{ workspaceId: WORKSPACE_ID, idOrSlug: "about" }]);
    expect(result).toEqual({ ok: true, value: { id: "about", dto: true } });
    expect(port.catalog).not.toHaveBeenCalled();
  });

  it("answers a kind-mismatched row exactly like not-found, without mapping it", async () => {
    const d = deps({ kind: "post" });
    expect(await refusalOf(() => run(d, "hello"))).toEqual({ status: 404, body: { error: "page 'hello' was not found", code: "ENTRY_NOT_FOUND" } });
    expect(d.mapped).toEqual([]);
  });

  it("maps the host's not-found error to 404 ENTRY_NOT_FOUND with the domain's own message", async () => {
    const d = deps({ readPage: async () => { throw new FakeNotFound("post 'missing' was not found"); } });
    expect(await refusalOf(() => run(d, "missing"))).toEqual({ status: 404, body: { error: "post 'missing' was not found", code: "ENTRY_NOT_FOUND" } });
  });

  it("rethrows any other failure unchanged for the host's error port", async () => {
    const failure = new Error("private store failure");
    await expect(run(deps({ readPage: async () => { throw failure; } }))).rejects.toBe(failure);
  });

  it("does not read the page when authorization refuses, and fails closed without an authorizer", async () => {
    const d = deps();
    await expect(pageGetRoute.handle({ input: { idOrSlug: "about" }, deps: d, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    await expect(pageGetRoute.handle({ input: { idOrSlug: "about" }, deps: d, context: PRINCIPAL, authorize: undefined as never })).rejects.toThrow(/no authorizer/);
    expect(d.reads).toEqual([]);
  });

  it("describes each authored plugin embed from the injected catalog: display name when known, unavailable when not listed", async () => {
    const port = catalogOf([{ plugin: "acme/demo", component: "button", displayName: "Sign in", availability: "ready" }, { plugin: "acme/demo", component: "hidden", availability: "ready" }]);
    const d = deps({ bodyHtml: marker("acme/demo", "button") + marker("acme/other", "card"), pluginExports: () => port });
    expect(await run(d)).toEqual({ ok: true, value: { id: "about", dto: true, pluginEmbeds: [
      { plugin: "acme/demo", component: "button", displayName: "Sign in", availability: "ready" },
      { plugin: "acme/other", component: "card", availability: "PLUGIN_UNAVAILABLE" },
    ] } });
    expect(port.catalog).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID });
  });

  it("degrades a failed catalog load to unavailable instead of failing the read", async () => {
    const d = deps({ bodyHtml: marker("acme/demo", "button"), pluginExports: () => ({ catalog: async () => { throw new Error("catalog down"); } }) });
    expect(await run(d)).toEqual({ ok: true, value: { id: "about", dto: true, pluginEmbeds: [{ plugin: "acme/demo", component: "button", availability: "PLUGIN_UNAVAILABLE" }] } });
  });

  it("reads the plugin runtime per request and lists no embeds while the host has none wired", async () => {
    let port: ReturnType<typeof catalogOf> | undefined;
    const d = deps({ bodyHtml: marker("acme/demo", "button"), pluginExports: () => port });
    expect(await run(d)).toEqual({ ok: true, value: { id: "about", dto: true } });
    port = catalogOf([]);
    expect(await run(d)).toEqual({ ok: true, value: { id: "about", dto: true, pluginEmbeds: [{ plugin: "acme/demo", component: "button", availability: "PLUGIN_UNAVAILABLE" }] } });
  });

  it("treats a missing body and non-string marker fields as empty", async () => {
    const port = catalogOf([]);
    const html = embedMarkerSnippetFromConfig({ config: { type: "plugin", plugin: 7, version: 1 } });
    expect(await run(deps({ bodyHtml: html, pluginExports: () => port }))).toEqual({ ok: true, value: { id: "about", dto: true, pluginEmbeds: [{ plugin: "", component: "", availability: "PLUGIN_UNAVAILABLE" }] } });
    const noBody = deps({ pluginExports: () => port, readPage: async () => ({ post: { kind: "page", bodyHtml: null } }) });
    expect(await run(noBody)).toEqual({ ok: true, value: { id: "about", dto: true } });
  });
});
