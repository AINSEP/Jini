import { expect, it, vi } from "vitest";
import { buildWebRegistrations, contributeWebTools } from "../tool-registrations.js";
import type { WebFetchResult } from "../web-page.js";

function fixture(screenshot?: WebFetchResult['screenshot']) {
  const budget = { used: 0 };
  const ports = { budget, client: "base" };
  const page: WebFetchResult = { requestedUrl: "https://example.test", finalUrl: "https://example.test", status: 200,
    contentType: "text/plain", format: "text", content: "prefix ".repeat(100) + "needle", truncated: false,
    links: [], linksTruncated: false, images: [], imagesTruncated: false, stylesheets: [], meta: {}, fetchedAt: "stamp", untrusted: true, untrustedNotice: "Untrusted", ...(screenshot ? { screenshot } : {}) };
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
  const denied = buildWebRegistrations({ routeDeps: { workspaceId: "ws", authorize: async () => ({ allowed: false, reason: "denied" }) }, ports: f.ports, host: f.host })[0]!;
  await expect(denied.handler(f.ctx)).rejects.toThrow();
  expect(f.host.fetchPage).not.toHaveBeenCalled();
  const contributor = contributeWebTools({ ports: f.ports, host: f.host }, { portsForSite: ({ deps }) => ({ client: deps.workspaceId }) });
  for (const workspaceId of ["one", "two"]) await contributor.build({ workspaceId, authorize: async () => ({ allowed: true, reason: "granted" }) }, undefined)[0]!.handler(f.ctx);
  expect(f.ports.budget.used).toBe(2);
  expect(f.host.fetchPage.mock.calls.map(([input]) => input.ports.client)).toEqual(["one", "two"]);
  expect(f.host.fetchPage.mock.calls.every(([input]) => input.ports.budget === f.ports.budget)).toBe(true);
});

it("find can see a match beyond the output window", async () => {
  const f = fixture();
  const tool = buildWebRegistrations({ routeDeps: { workspaceId: "ws", authorize: async () => ({ allowed: true, reason: "granted" }) }, ports: f.ports, host: f.host })[0]!;
  const result = await tool.handler({ ...f.ctx, input: { ...f.ctx.input, find: "needle" } });
  expect(result).toMatchObject({ matchCount: 1, matches: [{ offset: 700, snippet: "needle" }] });
});

it('emits screenshot bytes once as image content and keeps truncation in the accompanying text facts', async () => {
  const f = fixture({ mimeType: 'image/jpeg', data: 'aW1hZ2U=' });
  const routes = { workspaceId: 'ws', authorize: async () => ({ allowed: true, reason: 'granted' }) };
  const tool = buildWebRegistrations({ routeDeps: routes, ports: f.ports, host: f.host })[0]!;
  const reply = await tool.handler(f.ctx) as { content: [{ type: 'text'; text: string }, { type: 'image'; mimeType: string; data: string }] };
  expect(reply.content).toHaveLength(2);
  const [text, image] = reply.content;
  expect(text.type).toBe('text');
  expect(JSON.parse(text.text)).toEqual({
    requestedUrl: 'https://example.test', finalUrl: 'https://example.test', status: 200,
    contentType: 'text/plain', format: 'text', content: 'prefix pre', truncated: true, links: [],
    linksTruncated: false, images: [], imagesTruncated: false, stylesheets: [], meta: {},
    fetchedAt: 'stamp', untrusted: true, untrustedNotice: 'Untrusted',
  });
  expect(image).toEqual({ type: 'image', mimeType: 'image/jpeg', data: 'aW1hZ2U=' });
});
