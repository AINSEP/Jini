import { expect, test, vi } from "vitest";
import { PostValidationError } from "../post.js";
import { extractPostPlainText, searchAdminPosts, toPostSearchDocument, type PostSearchPort } from "../search.js";

test("indexes adjacent text runs together and separates blocks even inside unknown nodes", () => {
  const leaf = { type: "text", text: "secret below depth cap" };
  let nested: unknown = leaf;
  for (let i = 0; i < 65; i++) nested = { type: "paragraph", content: [nested] };
  expect(extractPostPlainText({ bodyJson: { content: [
    null, [], "junk", { type: "text", text: 123 }, { type: "widget", content: [
      { type: "text", text: "inter" }, { type: "text", text: "national" },
    ] }, { type: "paragraph", content: [{ type: "text", text: "  word\nbreak " }] }, nested,
  ] } })).toBe("international word break");
});

test("limits indexed doc text across block separators and ignores remaining text", () => {
  const first = "a".repeat(199_998);
  expect(extractPostPlainText({ bodyJson: { content: [
    { content: [{ type: "text", text: first }] },
    { content: [{ type: "text", text: "bcdef" }, { type: "text", text: "unvisited" }] },
  ] } })).toBe(first + " b");
});

test("HTML rows index visible HTML rather than stale document text", () => {
  const row = { id: "page", title: "Overview", slug: "about", bodyFormat: "html" as const,
    bodyJson: { type: "text", text: "old doc" } };
  expect(toPostSearchDocument({ ...row, bodyHtml: "<article><p>Café &amp; tea</p><script>secret()</script></article>" }))
    .toEqual({ postId: "page", title: "Overview", slug: "about", bodyText: "Café & tea" });
  expect(toPostSearchDocument({ ...row, bodyHtml: null }).bodyText).toBe("");
  expect(toPostSearchDocument({ ...row, bodyFormat: "doc" }).bodyText).toBe("old doc");
});

test("normalizes Unicode and sends exact admin filters and a floored bounded limit to the ranker", async () => {
  const hit = { id: "p", kind: "page" as const, title: "Café", slug: "coffee", status: "published" as const,
    updatedAt: "2026-04-02", snippet: "Café open at 42 West.", score: 0.8 };
  const search = vi.fn<PostSearchPort["search"]>().mockResolvedValue([hit]);
  const base = { workspaceId: "site", query: "CAFE\u0301…42" };
  expect(await searchAdminPosts({ deps: { search }, input: { ...base, kind: "page", status: "published", limit: 3.9 } })).toEqual({ hits: [hit] });
  for (const limit of [-4, 51, undefined]) {
    await searchAdminPosts({ deps: { search }, input: { ...base, ...(limit === undefined ? {} : { limit }) } });
  }
  expect(search.mock.calls).toEqual([
    [{ workspaceId: "site", terms: ["café", "42"], kind: "page", status: "published", limit: 3 }],
    [{ workspaceId: "site", terms: ["café", "42"], limit: 1 }],
    [{ workspaceId: "site", terms: ["café", "42"], limit: 50 }],
    [{ workspaceId: "site", terms: ["café", "42"], limit: 8 }],
  ]);
});

test("distinguishes punctuation-only queries and nonfinite limits before calling the ranker", async () => {
  const search = vi.fn<PostSearchPort["search"]>();
  const deps = { search };
  await expect(searchAdminPosts({ deps, input: { workspaceId: "site", query: "—!?" } }))
    .rejects.toThrow(new PostValidationError("query must contain at least one letter or digit — punctuation-only queries match nothing"));
  await expect(searchAdminPosts({ deps, input: { workspaceId: "site", query: "valid", limit: Infinity } }))
    .rejects.toThrow(new PostValidationError("limit must be a finite number"));
  expect(search).not.toHaveBeenCalled();
});
