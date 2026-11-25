import { expect, it, vi } from "vitest";
import { buildWebRegistrations, contributeWebTools } from "../tool-registrations.js";
import type { WebFetchResult } from "../web-page.js";

function fixture() {
  const budget = { used: 0 };
  const ports = { budget, client: "base" };
  const page: WebFetchResult = { requestedUrl: "https://example.test", finalUrl: "https://example.test", status: 200,
    contentType: "text/plain", format: "text", content: "prefix ".repeat(100) + "needle", truncated: false,
    links: [], linksTruncated: false, images: [], imagesTruncated: false, stylesheets: [], meta: {}, fetchedAt: "stamp", untrusted: true, untrustedNotice: "Untrusted" };
  const fetchPage = vi.fn(async ({ input, ports }: { input: { maxChars: number }; ports: { budget: { used: number }; client: string } }) => {
    ports.budget.used++;
    return { ...page, content: page.content.slice(0, input.maxChars), truncated: page.content.length > input.maxChars };
  });
  const host = { catalogModule: "host/web/catalog", permission: "host.read", fetchPage,
    catalog: [{ name: "web_fetch_page", description: "Read page", sideEffects: "none" as const, authorization: { permission: "host.read" }, inputSchema: { type: "object" } }],
    readPageBodyOptions: ({ input }: { input: Record<string, unknown> }) => ({ find: typeof input.find === "string" ? input.find : undefined }),
    shapePageBody: ({ body }: { body: string }, { find, maxBytes }: { find?: string; maxBytes?: number } = {}) => ({
      bodyBytes: body.length, truncated: false, matches: body.includes(find ?? "") ? [{ offset: body.indexOf(find ?? ""), snippet: body.slice(body.indexOf(find ?? ""), body.indexOf(find ?? "") + maxBytes!) }] : [],
      matchCount: body.includes(find ?? "") ? 1 : 0,
    }),
  };
  const ctx = { executionId: "exec", principal: { id: "actor" }, run: { id: "run" }, input: { url: "https://example.test", format: "text", maxChars: 10 }, signal: new AbortController().signal };
  return { ports, host, ctx };
}

it("deny causes no fetch and a site-specific client retains the contributor limiter", async () => {
  const f = fixture();
  const denied = buildWebRegistrations({ routeDeps: { workspaceId: "ws", authorize: async () => false }, ports: f.ports, host: f.host })[0]!;
  await expect(denied.handler(f.ctx)).rejects.toThrow();
  expect(f.host.fetchPage).not.toHaveBeenCalled();
  const contributor = contributeWebTools({ ports: f.ports, host: f.host }, { portsForSite: ({ deps }) => ({ client: deps.workspaceId }) });
  for (const workspaceId of ["one", "two"]) await contributor.build({ workspaceId, authorize: async () => true }, undefined)[0]!.handler(f.ctx);
  expect(f.ports.budget.used).toBe(2);
  expect(f.host.fetchPage.mock.calls.map(([input]) => input.ports.client)).toEqual(["one", "two"]);
  expect(f.host.fetchPage.mock.calls.every(([input]) => input.ports.budget === f.ports.budget)).toBe(true);
});

it("find can see a match beyond the output window", async () => {
  const f = fixture();
  const tool = buildWebRegistrations({ routeDeps: { workspaceId: "ws", authorize: async () => true }, ports: f.ports, host: f.host })[0]!;
  const result = await tool.handler({ ...f.ctx, input: { ...f.ctx.input, find: "needle" } });
  expect(result).toMatchObject({ matchCount: 1, matches: [{ offset: 700, snippet: "needle" }] });
});
