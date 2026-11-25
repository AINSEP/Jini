import { describe, expect, it } from "vitest";

import { templatePreviewGetRoute, templatePreviewPostRoute, type TemplatePreviewRouteDeps } from "../template-preview.js";

/** @file The template-preview raw specs: the `content.read` gate, the tri-state template choice, the pending body shapes and the text/plain answers. */

const PATH = "/api/admin/v1/workspaces/:workspaceId/posts/:postId/template-preview";
type Rendered = { post: unknown; templateChoice: string | null; bodyJson: unknown; bodyHtml: string | undefined };

function makeDeps(overrides: Partial<TemplatePreviewRouteDeps<{ id: string }>> = {}) {
  const log = { lookups: [] as unknown[], renders: [] as Rendered[] };
  const deps: TemplatePreviewRouteDeps<{ id: string }> = {
    workspaceId: "ws1",
    getPost: async (required) => { log.lookups.push(required); return { post: { id: "p1" } }; },
    renderPreview: async (required) => { log.renders.push(required); return { html: "<p>preview</p>" }; },
    renderFailure: ({ error }) => (error instanceof RangeError ? { status: 422, message: "template is broken" } : undefined),
    isNotFound: ({ error }) => error instanceof ReferenceError,
    ...overrides,
  };
  return { deps, log };
}

async function call({ deps, query = {}, body, denied = false }: { deps: TemplatePreviewRouteDeps<{ id: string }>; query?: Record<string, unknown>; body?: unknown; denied?: boolean }) {
  const permissions: unknown[] = [];
  const authorize = async (args: unknown) => { permissions.push(args); if (denied) throw new Error("denied"); };
  const raw = { params: { workspaceId: "ws1", postId: "p1" }, query, body, readBody: async () => { throw new Error("unused"); } };
  const outcome = await templatePreviewPostRoute.handle({ raw: raw as never, deps, context: undefined, authorize }, { signal: new AbortController().signal }).then((response) => ({ response }), (error: unknown) => ({ error }));
  return { outcome, permissions };
}

describe("template-preview specs", () => {
  it("pins GET and POST on one path, buffered, sharing one handler", () => {
    expect([templatePreviewGetRoute.method, templatePreviewPostRoute.method]).toEqual(["get", "post"]);
    expect([templatePreviewGetRoute.path, templatePreviewPostRoute.path]).toEqual([PATH, PATH]);
    expect(templatePreviewGetRoute.handle).toBe(templatePreviewPostRoute.handle);
    expect([templatePreviewGetRoute.bufferedReply, templatePreviewPostRoute.bufferedReply]).toEqual([true, true]);
  });

  it("authorizes content.read before reading the post, and a denial reads nothing", async () => {
    const { deps, log } = makeDeps();
    const ok = await call({ deps });
    expect(ok.permissions).toEqual([{ permission: "content.read" }]);
    expect(log.lookups).toEqual([{ workspaceId: "ws1", idOrSlug: "p1" }]);
    const { deps: other, log: otherLog } = makeDeps();
    const refused = await call({ deps: other, denied: true });
    expect(refused.outcome).toHaveProperty("error");
    expect(otherLog.lookups).toEqual([]);
  });

  it("answers the never-cached, sandboxed html", async () => {
    const { deps } = makeDeps();
    const { outcome } = await call({ deps });
    const response = (outcome as { response: Response }).response;
    expect([response.status, response.headers.get("content-type"), response.headers.get("cache-control"), response.headers.get("content-security-policy"), await response.text()])
      .toEqual([200, "text/html; charset=utf-8", "no-store", "sandbox allow-scripts allow-forms allow-popups", "<p>preview</p>"]);
  });

  it.each([
    ["absent", {}, null],
    ["empty (the explicit no-template opt-out)", { templateChoice: "" }, ""],
    ["a filename", { templateChoice: "wide.html" }, "wide.html"],
  ])("reads the template choice tri-state: %s", async (_name, query, expected) => {
    const { deps, log } = makeDeps();
    await call({ deps, query });
    expect(log.renders[0]?.templateChoice).toBe(expected);
  });

  it.each([
    ["a parsed object", { bodyJson: { type: "doc" }, bodyHtml: "<b>x</b>" }, { type: "doc" }, "<b>x</b>"],
    ["a JSON-stringified form field", { bodyJson: "{\"type\":\"doc\"}" }, { type: "doc" }, undefined],
    ["an unparseable string", { bodyJson: "{nope", bodyHtml: 7 }, undefined, undefined],
    ["an array", { bodyJson: [1] }, undefined, undefined],
    ["a stringified array", { bodyJson: "[1]" }, undefined, undefined],
    ["a non-object body", "text", undefined, undefined],
    ["no body", undefined, undefined, undefined],
  ])("extracts the pending body from %s", async (_name, body, bodyJson, bodyHtml) => {
    const { deps, log } = makeDeps();
    await call({ deps, body });
    expect([log.renders[0]?.bodyJson, log.renders[0]?.bodyHtml]).toEqual([bodyJson, bodyHtml]);
  });

  it("maps the host's render failure and not-found to text/plain, and rethrows anything else", async () => {
    const text = async (error: Error) => {
      const { deps } = makeDeps({ renderPreview: async () => { throw error; } });
      const { outcome } = await call({ deps });
      if ("error" in outcome) return outcome.error;
      return [outcome.response.status, outcome.response.headers.get("content-type"), await outcome.response.text()];
    };
    expect(await text(new RangeError("x"))).toEqual([422, "text/plain; charset=utf-8", "template is broken"]);
    expect(await text(new ReferenceError("post gone"))).toEqual([404, "text/plain; charset=utf-8", "post gone"]);
    const boom = new Error("boom");
    expect(await text(boom)).toBe(boom);
  });
});
