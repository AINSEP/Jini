import type { RouteInputContext } from "@jini-ai/core/contracts/server";
import { describe, expect, it, vi } from "vitest";

const seen: Array<string | undefined> = [];
vi.mock("../../../../seo/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../seo/index.js")>()),
  computeIndexableEntries: async ({ deps }: { deps: { renderBaseUrl?: string } }) => { seen.push(deps.renderBaseUrl); return []; },
}));

const { llmsTxtRoute } = await import("../llms.js");
type Deps = Parameters<typeof llmsTxtRoute.handle>[0]["deps"];
const signal = new AbortController().signal;
const raw = (servingOrigin?: string) => ({ params: {}, query: {}, body: undefined, facts: { clientAddress: "203.0.113.9", ...(servingOrigin === undefined ? {} : { servingOrigin }) } }) as unknown as RouteInputContext;

function deps(): Deps {
  return {
    workspaceId: "ws", cacheControl: "public, max-age=60", seoReady: Promise.resolve(), resolveSiteTitle: async () => "My   Site",
    seoDeps: { renderBaseUrl: "https://stored.test", settings: { getSeoSettings: async () => ({ defaultDescription: "A  site" }) } } as unknown as Deps["seoDeps"],
  };
}

describe("llmsTxtRoute", () => {
  it("is a GET on /llms.txt that opts into request facts", () => {
    expect(llmsTxtRoute).toMatchObject({ method: "get", path: "/llms.txt", requestFacts: true });
  });

  it("indexes entries on the serving origin and renders title and description as markdown", async () => {
    seen.length = 0;
    const res = await llmsTxtRoute.handle({ raw: raw("https://www.example.test"), deps: deps() }, { signal });
    expect(seen).toEqual(["https://www.example.test"]);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const body = await res.text();
    expect(body).toMatch(/^# My Site$/m);
    expect(body).toMatch(/^> A site$/m);
  });

  it("keeps the stored origin when no serving origin was formed", async () => {
    seen.length = 0;
    await llmsTxtRoute.handle({ raw: raw(), deps: deps() }, { signal });
    expect(seen).toEqual(["https://stored.test"]);
  });

  it("refuses when the host supplied no request facts", async () => {
    await expect(llmsTxtRoute.handle({ raw: { params: {}, query: {}, body: undefined } as unknown as RouteInputContext, deps: deps() }, { signal })).rejects.toThrow(/request facts/);
  });
});
