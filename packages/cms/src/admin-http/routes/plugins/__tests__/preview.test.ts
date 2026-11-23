import { describe, expect, it } from "vitest";
import { pluginPreviewRunRoute, pluginPreviewStatusRoute, type PluginPreviewRouteDeps } from "../preview.js";
import { activationRepo, FakeHookFailedError, PRINCIPAL, raw, RECORDS, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

function deps(overrides: Partial<PluginPreviewRouteDeps> = {}) {
  const entries: unknown[] = [];
  const value: PluginPreviewRouteDeps = {
    workspaceId: WORKSPACE_ID, pluginActivationRepo: activationRepo({ "word-count": true }),
    discoverPlugins: async () => RECORDS,
    previewPluginBeforeSave: async (_pluginId, entry) => { entries.push(entry); return { words: 2 }; },
    hookFailedError: FakeHookFailedError,
    // A marker proves the host's envelope builder is the one used.
    pluginHookFailedBody: (err, optional = {}) => ({ error: optional.publicText, code: "PLUGIN_HOOK_FAILED", pluginId: err.pluginId, host: true }),
    ...overrides,
  };
  return { value, entries };
}
const DRAFT = { title: "Hello", bodyJson: { type: "doc" } };
const run = (d: PluginPreviewRouteDeps, body: unknown = DRAFT, authorize = recordingAuthorize().authorize, pluginId = "word-count") =>
  pluginPreviewRunRoute.handle({ input: { pluginId, body }, deps: d, context: PRINCIPAL, authorize }, { signal });
const BAD_DRAFT = { status: 400, body: { error: "title (string) and bodyJson (object) are required; postId, slug and metaDescription must be strings", code: "VALIDATION_ERROR" } };

describe("pluginPreviewStatusRoute", () => {
  it("keeps the path, falls back to an empty id, and answers the activation row's enabled under content.write", async () => {
    expect(pluginPreviewStatusRoute.method).toBe("get");
    expect(pluginPreviewStatusRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId/preview");
    expect(pluginPreviewStatusRoute.parse(raw({}))).toEqual({ ok: true, value: { pluginId: "" } });
    const { authorize, calls } = recordingAuthorize();
    expect(await pluginPreviewStatusRoute.handle({ input: { pluginId: "word-count" }, deps: deps().value, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { pluginId: "word-count", enabled: true } });
    expect(await pluginPreviewStatusRoute.handle({ input: { pluginId: "seo" }, deps: deps().value, context: PRINCIPAL, authorize })).toEqual({ ok: true, value: { pluginId: "seo", enabled: false } });
    expect(calls).toEqual([{ permission: "content.write", entityType: "plugin" }, { permission: "content.write", entityType: "plugin" }]);
  });

  it("answers 404 for an undiscovered id and does not read activation when refused", async () => {
    const repo = activationRepo();
    expect(await refusalOf(() => pluginPreviewStatusRoute.handle({ input: { pluginId: "ghost" }, deps: deps({ pluginActivationRepo: repo }).value, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({ status: 404, body: { error: "plugin was not found", code: "PLUGIN_NOT_FOUND" } });
    await expect(pluginPreviewStatusRoute.handle({ input: { pluginId: "word-count" }, deps: deps({ pluginActivationRepo: repo }).value, context: PRINCIPAL, authorize: recordingAuthorize(["content.write"]).authorize })).rejects.toThrow("denied");
    expect(repo.reads).toEqual([]);
  });
});

describe("pluginPreviewRunRoute", () => {
  it("keeps method and path, passes the raw body through parse (validated after the permission gate)", () => {
    expect(pluginPreviewRunRoute.method).toBe("post");
    expect(pluginPreviewRunRoute.maxBodyBytes).toBeUndefined();
    expect(pluginPreviewRunRoute.parse(raw({ pluginId: "p" }, "junk"))).toEqual({ ok: true, value: { pluginId: "p", body: "junk" } });
  });

  it("runs the plugin's filter on the draft with placeholder id/slug, and keeps the optional fields when sent", async () => {
    const { value, entries } = deps();
    expect(await run(value)).toEqual({ ok: true, value: { pluginId: "word-count", fields: { words: 2 } } });
    await run(value, { ...DRAFT, postId: "p1", slug: "hello", metaDescription: "m" });
    expect(entries).toEqual([
      { id: "preview", workspaceId: WORKSPACE_ID, title: "Hello", slug: "", status: "draft", bodyJson: { type: "doc" }, ext: {} },
      { id: "p1", workspaceId: WORKSPACE_ID, title: "Hello", metaDescription: "m", slug: "hello", status: "draft", bodyJson: { type: "doc" }, ext: {} },
    ]);
  });

  for (const body of [null, [], "x", { bodyJson: {} }, { title: "t" }, { title: "t", bodyJson: [] }, { ...DRAFT, postId: 1 }, { ...DRAFT, slug: 2 }, { ...DRAFT, metaDescription: false }]) {
    it(`refuses the malformed draft ${JSON.stringify(body)} with the flat 400`, async () => {
      expect(await refusalOf(() => run(deps().value, body))).toEqual(BAD_DRAFT);
    });
  }

  it("asks the permission before validating the body, so a refused caller never sees the 400", async () => {
    await expect(run(deps().value, null, recordingAuthorize(["content.write"]).authorize)).rejects.toThrow("denied");
  });

  it("answers 404 for an undiscovered id, 409 when the plugin is not enabled, and rethrows an unmapped failure", async () => {
    expect(await refusalOf(() => run(deps().value, DRAFT, recordingAuthorize().authorize, "ghost"))).toEqual({ status: 404, body: { error: "plugin was not found", code: "PLUGIN_NOT_FOUND" } });
    expect(await refusalOf(() => run(deps({ previewPluginBeforeSave: async () => null }).value))).toEqual({ status: 409, body: { error: "plugin is not enabled", code: "PLUGIN_NOT_ENABLED" } });
    await expect(run(deps({ previewPluginBeforeSave: async () => { throw new Error("worker died"); } }).value)).rejects.toThrow("worker died");
  });

  it("maps a hook failure to 422 through the injected host envelope with fixed preview text", async () => {
    const failing = deps({ previewPluginBeforeSave: async () => { throw new FakeHookFailedError("word-count", "secret internals"); } }).value;
    expect(await refusalOf(() => run(failing))).toEqual({
      status: 422, body: { error: "a site plugin (word-count) failed on this draft; nothing was saved", code: "PLUGIN_HOOK_FAILED", pluginId: "word-count", host: true },
    });
  });
});
