import { expect, it } from "vitest";
import { createPostAgentToolCatalog } from "../agent-tools.js";
it("catalog preserves ordered IDs and uses the supplied authoring vocabulary and schema", () => {
  const tiptapDocSchema = { type: "object", description: "host document", properties: { type: { const: "custom-doc" } } };
  const featuredImageSchema = { type: "object", description: "host image" };
  const postIdSchema = { type: "string", pattern: "^host-id$" };
  const catalog = createPostAgentToolCatalog({ editGuidance: "HOST EDIT GUIDANCE", featuredImageSchema, postIdSchema, tiptapDocSchema,
    copy: { contentPostRead: "articles.inspect", navigate: "browser.go", menuRead: "nav.read", updateMenuTree: "nav.write", fetchPublishedPage: "page.fetch", postPreview: "article.preview", trashRestoreItem: "trash.restore" } });
  expect(catalog.map(t => t.name)).toEqual(["content_post_search", "content_post_list", "content_post_get", "content_post_create", "content_post_update", "content_post_delete"]);
  expect(catalog[0]?.description).toContain("browser.go");
  expect(catalog[0]?.description).toContain("articles.inspect");
  expect(catalog[0]?.description).not.toContain("content_read.content_post");
  const update = catalog[4];
  expect(update?.description).toContain("HOST EDIT GUIDANCE");
  expect(update?.inputSchema).toMatchObject({ properties: { id: postIdSchema, bodyJson: { ...tiptapDocSchema, description: expect.stringContaining("host document") }, featuredImage: { description: expect.stringContaining("host image") }, template: { type: ["string", "null"] } } });
});
