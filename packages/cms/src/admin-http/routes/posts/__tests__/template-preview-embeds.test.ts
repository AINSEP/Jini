import { describe, expect, it } from "vitest";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { createTemplatePreviewEmbedsRoute, type PreviewEmbedsRouteDeps } from "../template-preview-embeds.js";

/** @file The template-preview embed inspection spec: authorization before rendering, the projector
 * seeing only iframe `src` strings in document order, and inert markup never counting as an embed. */

const signal = new AbortController().signal;
const PRINCIPAL = { id: "reader" };

type Projection = { sources: readonly string[] };

function fakeDeps({ html = "<p>none</p>" }: { html?: string } = {}) {
  const renders: unknown[] = [];
  const projections: unknown[] = [];
  const deps: PreviewEmbedsRouteDeps<Projection> = {
    renderPreview: async (required, optional) => { renders.push({ required, optional }); return { html }; },
    projectEmbeds: (required) => { projections.push(required); return { sources: required.iframeSources }; },
  };
  return { deps, renders, projections };
}

function recording({ deny = false }: { deny?: boolean } = {}) {
  const seen: unknown[] = [];
  return {
    seen,
    authorize: async (r: { permission: string; entityType?: string }, o: { entityId?: string } = {}) => {
      seen.push({ ...r, ...o });
      if (deny) throw new RouteRefusalError({ status: 403, body: { error: "denied" } });
    },
  };
}

type RunOptions = {
  deps?: PreviewEmbedsRouteDeps<Projection>;
  context?: typeof PRINCIPAL | undefined;
  authorize?: ReturnType<typeof recording>["authorize"] | undefined;
  query?: Record<string, unknown>;
  body?: unknown;
};

/** Absent keys take the defaults; an explicit `undefined` context/authorizer is kept (the fail-closed cases). */
async function run(options: RunOptions = {}) {
  const route = createTemplatePreviewEmbedsRoute<Projection>({});
  const context = "context" in options ? options.context : PRINCIPAL;
  const authorize = "authorize" in options ? options.authorize : recording().authorize;
  const parsed = route.parse({ params: { workspaceId: "ws", postId: "post-1" }, query: options.query ?? {}, body: options.body ?? {} });
  if (!parsed.ok) throw new Error("parse refused");
  return route.handle({ input: parsed.value, deps: options.deps ?? fakeDeps().deps, context, ...(authorize === undefined ? {} : { authorize }) }, { signal });
}

async function sourcesFor(html: string): Promise<readonly string[]> {
  const { deps, projections } = fakeDeps({ html });
  await run({ deps });
  return (projections[0] as { iframeSources: readonly string[] }).iframeSources;
}

describe("createTemplatePreviewEmbedsRoute", () => {
  it("pins method, path and the no-store header", () => {
    const route = createTemplatePreviewEmbedsRoute<Projection>({});
    expect(route.method).toBe("post");
    expect(route.path).toBe("/api/admin/v1/workspaces/:workspaceId/posts/:postId/template-preview/embeds");
    expect(route.responseHeaders).toEqual({ "Cache-Control": "no-store" });
  });

  it("template preview embed inspection checks content.read before rendering", async () => {
    const allowed = recording();
    const { deps, renders, projections } = fakeDeps();
    await run({ deps, authorize: allowed.authorize });
    expect(allowed.seen).toEqual([{ permission: "content.read" }]);
    expect(renders).toHaveLength(1);

    const denied = recording({ deny: true });
    const refused = fakeDeps();
    await expect(run({ deps: refused.deps, authorize: denied.authorize })).rejects.toBeInstanceOf(RouteRefusalError);
    expect(denied.seen).toEqual([{ permission: "content.read" }]);
    expect(refused.renders).toHaveLength(0);
    expect(refused.projections).toHaveLength(0);
    expect(projections).toHaveLength(1);
  });

  it("fails closed with no principal or no authorizer, rendering nothing", async () => {
    const noPrincipal = fakeDeps();
    const spy = recording();
    await expect(run({ deps: noPrincipal.deps, context: undefined, authorize: spy.authorize })).rejects.toBeInstanceOf(RouteRefusalError);
    expect(spy.seen).toHaveLength(0);
    expect(noPrincipal.renders).toHaveLength(0);

    const noAuthorizer = fakeDeps();
    await expect(run({ deps: noAuthorizer.deps, authorize: undefined })).rejects.toThrow();
    expect(noAuthorizer.renders).toHaveLength(0);
    expect(noAuthorizer.projections).toHaveLength(0);
  });

  it("the projector gets iframe sources only, in document order", async () => {
    const html = [
      "<html><body>",
      "<p>text</p><img src=\"/not-an-iframe.png\"><script src=\"/s.js\"></script>",
      "<iframe src=\"https://a.example/one\"></iframe>",
      "<div><section><iframe title=\"x\" src=\"https://b.example/two\"></iframe></section></div>",
      "<iframe></iframe>",
      "<iframe src=\"\"></iframe>",
      "<iframe src=\"https://a.example/one\"></iframe>",
      "</body></html>",
    ].join("");
    expect(await sourcesFor(html)).toEqual(["https://a.example/one", "https://b.example/two", "", "https://a.example/one"]);
  });

  it("script text, comments, srcdoc and inert template markup are not iframe sources", async () => {
    const html = [
      "<html><head><script>document.write('<iframe src=\"https://script.example/x\"></iframe>')</script></head><body>",
      "<!-- <iframe src=\"https://comment.example/x\"></iframe> -->",
      "<template><iframe src=\"https://template.example/x\"></iframe></template>",
      "<iframe srcdoc=\"&lt;iframe src='https://srcdoc.example/x'&gt;&lt;/iframe&gt;\"></iframe>",
      "<noscript><iframe src=\"https://noscript.example/x\"></iframe></noscript>",
      "<iframe src=\"https://real.example/x\"></iframe>",
      "</body></html>",
    ].join("");
    const sources = await sourcesFor(html);
    expect(sources).not.toContain("https://script.example/x");
    expect(sources).not.toContain("https://comment.example/x");
    expect(sources).not.toContain("https://template.example/x");
    expect(sources).not.toContain("https://srcdoc.example/x");
    expect(sources).toEqual(["https://real.example/x"]);
  });

  it("ignores iframes in a foreign namespace", async () => {
    expect(await sourcesFor("<svg><iframe src=\"https://svg.example/x\"></iframe></svg><iframe src=\"https://html.example/x\"></iframe>")).toEqual(["https://html.example/x"]);
  });

  it("the route forwards template choice and pending body and returns only the projection", async () => {
    const body = { title: "Pending", content: "<p>draft</p>" };
    const { deps, renders, projections } = fakeDeps({ html: "<iframe src=\"https://a.example/v\"></iframe><p>secret rendered text</p>" });
    const result = await run({ deps, query: { templateChoice: "landing" }, body });
    expect(renders).toEqual([{ required: { postId: "post-1", rawTemplateChoice: "landing", body }, optional: { signal } }]);
    expect(projections).toEqual([{ iframeSources: ["https://a.example/v"] }]);
    expect(result).toEqual({ ok: true, value: { sources: ["https://a.example/v"] } });
    expect(JSON.stringify(result)).not.toContain("secret rendered text");
  });

  it("forwards an absent template choice as undefined", async () => {
    const { deps, renders } = fakeDeps();
    await run({ deps });
    expect((renders[0] as { required: { rawTemplateChoice: unknown } }).required.rawTemplateChoice).toBeUndefined();
  });
});
