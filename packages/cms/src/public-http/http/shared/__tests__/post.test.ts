import { expect, it } from "vitest";
import { PostNotFoundError, type PostRecord } from "../../../../posts/post.js";
import { toHeadlessPost, toHeadlessContentPost } from "../post.js";

const post: PostRecord = {
  id: "page-7", workspaceId: "ws-7", kind: "page", title: "About Ada", slug: "about-ada",
  status: "draft", updatedAt: "2026-09-17T12:34:56Z", version: 9,
  bodyFormat: "doc", bodyHtml: null,
  bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ada's story" }] }] },
};
// F4.1/F6.2: branch inversion, lost ext, manufactured override, or swallowed corruption must fail.
it("HTML admin DTO carries HTML only and retains plugin data and explicit template choices", () => {
  expect(toHeadlessPost({ ...post, bodyFormat: "html", bodyHtml: "<main>Ada &amp; team</main>",
    templateChoice: "landing", overridesThemePage: true, ext: { catalog: { sku: "ADA-7" } } })).toStrictEqual({
    id: "page-7", workspaceId: "ws-7", kind: "page", title: "About Ada", slug: "about-ada",
    status: "draft", updatedAt: "2026-09-17T12:34:56Z", version: 9,
    author: null, showAuthor: false,
    bodyFormat: "html", bodyHtml: "<main>Ada &amp; team</main>", bodyJson: null,
    templateChoice: "landing", overridesThemePage: true, ext: { catalog: { sku: "ADA-7" } },
  });
});
it("document DTO preserves content and distinguishes false from an undecided override", () => {
  for (const [input, expected] of [[undefined, null], [null, null], [false, false], [true, true]] as const) {
    const result = toHeadlessPost({ ...post, overridesThemePage: input } as PostRecord);
    expect(result).toStrictEqual({
      id: "page-7", workspaceId: "ws-7", kind: "page", title: "About Ada", slug: "about-ada",
      status: "draft", updatedAt: "2026-09-17T12:34:56Z", version: 9,
      author: null, showAuthor: false,
      bodyFormat: "doc", bodyHtml: null,
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ada's story" }] }] },
      templateChoice: null, overridesThemePage: expected,
    });
  }
});
it("HTML with a null body fails loudly instead of returning an empty body", () => {
  expect(() => toHeadlessPost({ ...post, bodyFormat: "html", bodyHtml: null })).toThrow(new Error("post 'page-7' is body_format 'html' with a null body_html — data integrity violation"));
  expect(toHeadlessPost({ ...post, bodyFormat: "html", bodyHtml: "" }).bodyHtml).toBe("");
});
it("content DTO includes document content and excludes admin metadata and extensions", () => {
  expect(toHeadlessContentPost({ ...post, ext: { private: { secret: "hidden" } }, overridesThemePage: true })).toStrictEqual({
    id: "page-7", kind: "page", title: "About Ada", slug: "about-ada", updatedAt: "2026-09-17T12:34:56Z",
    author: null, showAuthor: false,
    bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ada's story" }] }] },
  });
});

it("admin retains editable credit while the public DTO exposes only opted-in display credit", () => {
  for (const showAuthor of [undefined, false, true]) {
    const record = { ...post, author: "  Guest Writer  ", showAuthor } as PostRecord;
    expect(toHeadlessPost(record).author).toBe("  Guest Writer  ");
    expect(toHeadlessContentPost(record).author).toBe(showAuthor === true ? "Guest Writer" : null);
    expect(toHeadlessContentPost(record).showAuthor).toBe(showAuthor ?? false);
  }
  for (const author of [undefined, null, "", "   "]) {
    expect(toHeadlessContentPost({ ...post, author, showAuthor: true } as PostRecord).author).toBe(null);
  }
});

it("scheduling and featured-media fields appear on the admin DTO only when set", () => {
  const scheduled = toHeadlessPost({ ...post, publishAt: "2026-10-01T09:00:00Z", featuredMediaId: "media-3" });
  expect(scheduled.publishAt).toBe("2026-10-01T09:00:00Z");
  expect(scheduled.featuredMediaId).toBe("media-3");
  const plain = toHeadlessPost({ ...post, publishAt: null, featuredMediaId: null } as PostRecord);
  expect("publishAt" in plain).toBe(false);
  expect("featuredMediaId" in plain).toBe(false);
});


it("both headless DTOs refuse storage-only email templates", () => {
  const template: PostRecord = { ...post, kind: "email-template", bodyFormat: "html", bodyHtml: "<p>private</p>" };
  expect(() => toHeadlessPost(template)).toThrow(PostNotFoundError);
  expect(() => toHeadlessContentPost(template)).toThrow(PostNotFoundError);
});


it("public HTML pages include their HTML body without leaking document or admin data", () => {
  const html = "<main>Ada &amp; team</main>";
  const result = toHeadlessContentPost({ ...post, bodyFormat: "html", bodyHtml: html, ext: { private: { secret: "hidden" } } });
  expect((result as unknown as { bodyHtml: string }).bodyHtml).toBe(html);
  expect((result as unknown as { bodyFormat: string }).bodyFormat).toBe("html");
  expect(result.bodyJson).toBe(null);
  expect("ext" in result).toBe(false);
  expect("workspaceId" in result).toBe(false);
});
