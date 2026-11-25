import { beforeEach, expect, it, vi } from "vitest";
import type { CommentsProviderRegistry, CommentThreadRendererPort } from "@jini-ai/core/contracts/site/comments-providers";
import { renderCommentsMarkers } from "../public-markers.js";

const entry = { id: "entry", slug: "story", title: "Story", canonicalUrl: "/story", status: "published" };
const marker = '<div class="thread" data-embed-config=\'{"type":"comments"}\'>fallback</div>';
const thread = "<p>Approved comment</p>";
const empty = '<div class="thread"><div data-comments-surface></div></div>';
const active = vi.fn<CommentsProviderRegistry["active"]>();
const get = vi.fn<CommentsProviderRegistry["get"]>();
const registry: Pick<CommentsProviderRegistry, "active" | "get"> = { active, get };
const providers = registry as CommentsProviderRegistry;
const renderThread = vi.fn<CommentThreadRendererPort["renderThread"]>();
const scripts = vi.fn();

beforeEach(() => {
  renderThread.mockReset().mockResolvedValue({ html: thread });
  active.mockReset().mockResolvedValue({
    providerId: "comments", revision: 1,
    adapter: { kind: "embedded", dashboardUrl: "/comments", renderer: { renderThread } },
  });
  get.mockReset();
  scripts.mockReset();
});

it("leaves marker-free HTML byte-identical without registry reads or scripts", async () => {
  const html = " \n<p>Ordinary &amp; unchanged</p>\r\n";
  expect(await renderCommentsMarkers({ html, siteId: "site", entry, providers }, { scripts })).toBe(html);
  expect(active).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(renderThread).not.toHaveBeenCalled();
  expect(scripts).not.toHaveBeenCalled();
});

it("resolves and renders once for multiple markers, preserving wrappers, unrelated markers and the cursor", async () => {
  const unrelated = '<nav data-embed-config=\'{"type":"menu","id":"main"}\'>menu</nav>';
  const html = await renderCommentsMarkers({ html: marker + unrelated + marker, siteId: "site", entry, providers }, { cursor: "next" });

  expect(html).toBe(`<div class="thread"><div data-comments-surface>${thread}</div></div>${unrelated}<div class="thread"><div data-comments-surface>${thread}</div></div>`);
  expect(active).toHaveBeenCalledTimes(1);
  expect(active).toHaveBeenCalledWith({ siteId: "site" });
  expect(renderThread).toHaveBeenCalledTimes(1);
  expect(renderThread).toHaveBeenCalledWith({ siteId: "site", entry, locale: "en" }, { cursor: "next" });
});

it("renders no thread or scripts for a draft without reading the registry", async () => {
  expect(await renderCommentsMarkers({ html: marker, siteId: "site", entry: { ...entry, status: "draft" }, providers }, { scripts })).toBe(empty);
  expect(active).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(renderThread).not.toHaveBeenCalled();
  expect(scripts).not.toHaveBeenCalled();
});

it("renders no thread when no provider registry is supplied", async () => {
  expect(await renderCommentsMarkers({ html: marker, siteId: "site", entry })).toBe(empty);
  expect(active).not.toHaveBeenCalled();
  expect(renderThread).not.toHaveBeenCalled();
});

it("renders no thread when the active adapter is unavailable", async () => {
  active.mockResolvedValue({ providerId: "comments", revision: 1, adapter: undefined });
  expect(await renderCommentsMarkers({ html: marker, siteId: "site", entry, providers })).toBe(empty);
  expect(active).toHaveBeenCalledTimes(1);
  expect(renderThread).not.toHaveBeenCalled();
});

it("emits provider scripts with their declared consent category while leaving the thread visible", async () => {
  renderThread.mockResolvedValue({ html: thread, scripts: [{ src: "https://comments.example/sdk.js" }] });
  get.mockReturnValue({
    id: "comments", label: "Comments", kind: "embedded", consentCategory: "marketing",
    csp: { scriptSrc: [], frameSrc: [], connectSrc: [], styleSrc: [] },
    settingsSchema: [], implementation: "adapter",
  });

  const html = await renderCommentsMarkers({ html: marker + marker, siteId: "site", entry, providers }, { scripts });

  expect(html).toBe(`<div class="thread"><div data-comments-surface>${thread}</div></div><div class="thread"><div data-comments-surface>${thread}</div></div>`);
  expect(html).not.toContain("<script");
  expect(html).not.toContain("https://comments.example/sdk.js");
  expect(scripts).toHaveBeenCalledTimes(1);
  expect(scripts).toHaveBeenCalledWith({ scripts: [{ src: "https://comments.example/sdk.js", consent: ["marketing"] }] });
  expect(get).toHaveBeenCalledWith({ providerId: "comments" });
});
