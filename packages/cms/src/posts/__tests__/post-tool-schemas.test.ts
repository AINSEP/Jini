import { Validator, type Schema } from "@cfworker/json-schema";
import { TIPTAP_TEXT_NODE_SCHEMA } from "../tiptap-text-schema.js";
import { describe, expect, it } from "vitest";
import { featuredImageSchema, postIdSchema, type PostSchemaToolNames } from "../post-tool-schemas.js";
import { tiptapBlockNodeSchema } from "../tiptap-block-schema.js";

const tools: PostSchemaToolNames = {
  mediaRead: "host.read_media",
  mediaUpload: "host_upload",
  mediaGenerate: "host_generate",
  mediaImportFromUrl: "host_import",
  widgetInsertEmbed: "host_embed_insert",
  postCreate: "host_post_create",
  postRead: "host.read_post",
};

describe("post tool schemas cite the host's tool names", () => {
  it("names the bound media tools in the featured-image copy", () => {
    const { description } = featuredImageSchema({ tools });
    expect(description).toContain("(from host.read_media, host_upload, host_generate or host_import)");
    expect(featuredImageSchema({ tools }).type).toEqual(["string", "null"]);
  });

  it("names the bound create and read tools in the id copy", () => {
    expect(postIdSchema({ tools }).description).toBe(
      "The post/page's id, as returned by host_post_create, or by host.read_post called WITHOUT an id (its listing mode).",
    );
  });

  it("names the bound tools in the block node copy and no unbound tool name", () => {
    const json = JSON.stringify(tiptapBlockNodeSchema({ tools }));
    for (const name of ["host.read_media", "host_upload", "host_generate", "host_import", "host_embed_insert"]) {
      expect(json).toContain(name);
    }
    expect(json).not.toMatch(/media_upload_asset|content_read\.|widgets_insert_embed/);
  });

  it("keeps the block vocabulary stable across bindings", () => {
    const kinds = tiptapBlockNodeSchema({ tools }).oneOf.map((node) => node.properties.type.const);
    expect(kinds).toEqual([
      "paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock",
      "horizontalRule", "table", "media", "youtube", "widgetEmbed",
    ]);
  });
});

it("validates the supported inline mark vocabulary and rejects invalid inline attributes", () => {
  const validator = new Validator(TIPTAP_TEXT_NODE_SCHEMA as unknown as Schema);
  const text = { type: "text", text: "Formatting" };
  const marks = [
    { type: "bold" }, { type: "italic" }, { type: "code" }, { type: "strike" }, { type: "underline" },
    { type: "subscript" }, { type: "superscript" },
    { type: "textStyle", attrs: { color: "#f00", backgroundColor: "blue", fontFamily: "serif", fontSize: "16px", lineHeight: "1.5" } },
    { type: "highlight", attrs: { color: "gold" } }, { type: "link", attrs: { href: "/article" } },
  ];
  expect(validator.validate({ ...text, marks }).valid).toBe(true);
  expect(validator.validate(text).valid).toBe(true);
  for (const invalid of [
    { type: "paragraph", text: "Formatting" }, { type: "text" }, { ...text, content: [] },
    { ...text, marks: [{ type: "unknownMark" }] }, { ...text, marks: [{ type: "link", attrs: { href: 17 } }] },
    { ...text, marks: [{ type: "bold", attrs: { unsupported: true } }] }, { ...text, marks: [{ type: "bold", extra: "no" }] },
  ]) expect(validator.validate(invalid).valid, JSON.stringify(invalid)).toBe(false);
});
