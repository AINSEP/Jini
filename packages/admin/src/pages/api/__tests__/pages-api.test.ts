import { expect, it, vi } from "vitest";
import { createPagesApi, type PagesApiDeps } from "../pages-api.js";

it("keeps reads and writes on the workspace's kind-guarded pages endpoints", async () => {
  const post = { id: "pages/about", title: "About & contact", version: 8 };
  const request = vi.fn(async ({ path }: { path: string }, options?: { init?: RequestInit }) => {
    if (path === "/workspaces/site-17/pages" && !options) return { posts: [{ post }] };
    return { post };
  });
  const api = createPagesApi({ request: request as unknown as PagesApiDeps["request"], workspaceId: "site-17" });

  await expect(api.listPages()).resolves.toEqual({ posts: [{ post }] });
  await expect(api.createPage({ title: "About & contact" })).resolves.toEqual({ post });
  await expect(api.getPage({ id: "pages/about" })).resolves.toEqual({ post });
  await expect(api.updatePageHtml({ id: "pages/about", html: "<p>New copy</p>", expectedVersion: 7 })).resolves.toEqual({ post });
  await expect(api.deletePage({ id: "pages/about" })).resolves.toEqual({ post });
  expect(request.mock.calls).toEqual([
    [{ path: "/workspaces/site-17/pages" }],
    [{ path: "/workspaces/site-17/pages" }, { init: { method: "POST", body: '{"title":"About & contact"}' } }],
    [{ path: "/workspaces/site-17/pages/pages%2Fabout" }],
    [{ path: "/workspaces/site-17/pages/pages%2Fabout/html" }, { init: { method: "PUT", body: '{"html":"<p>New copy</p>","expectedVersion":7}' } }],
    [{ path: "/workspaces/site-17/pages/pages%2Fabout" }, { init: { method: "DELETE" } }],
  ]);
});
