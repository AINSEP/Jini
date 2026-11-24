import assert from "node:assert/strict";
import { test } from "vitest";

import { tiptapToBlocks } from "../tiptap-blocks.js";

/**
 * @file TipTap `bodyJson` -> `ContentBlock[]` adapter for the `content-analyzer` built-in. Defensive
 * by contract: unknown or malformed nodes are skipped, the function never throws.
 */

const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

test("headings, paragraphs and code blocks map in document order; inline text nodes join without a separator", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [t("Intro "), t("part", [{ type: "bold" }])] },
      { type: "paragraph", content: [t("Hello "), t("world", [{ type: "italic" }]), t(".")] },
      { type: "codeBlock", content: [t("const x = 1;")] },
    ],
  };
  assert.deepEqual(tiptapToBlocks({ bodyJson: doc }), [
    { kind: "heading", level: 2, text: "Intro part" },
    { kind: "text", text: "Hello world." },
    { kind: "text", text: "const x = 1;" },
  ]);
});

test("hardBreak inside a paragraph becomes a space", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [t("line one"), { type: "hardBreak" }, t("line two")] }] };
  assert.deepEqual(tiptapToBlocks({ bodyJson: doc }), [{ kind: "text", text: "line one line two" }]);
});

test("list items, blockquotes and table cells are walked into their paragraphs; bare text in a container is a text block", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [t("item one")] }] }] },
      { type: "blockquote", content: [{ type: "paragraph", content: [t("quoted")] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [t("raw cell")] }] }] },
    ],
  };
  assert.deepEqual(tiptapToBlocks({ bodyJson: doc }), [
    { kind: "text", text: "item one" },
    { kind: "text", text: "quoted" },
    { kind: "text", text: "raw cell" },
  ]);
});

test("image and mediaImage map attrs.alt (string kept, anything else null), block-level and inline", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "image", attrs: { alt: "A dog", src: "x" } },
      { type: "mediaImage", attrs: { alt: 3 } },
      { type: "image" },
      { type: "paragraph", content: [t("before "), { type: "image", attrs: { alt: "" } }, t("after")] },
    ],
  };
  assert.deepEqual(tiptapToBlocks({ bodyJson: doc }), [
    { kind: "image", alt: "A dog" },
    { kind: "image", alt: null },
    { kind: "image", alt: null },
    { kind: "text", text: "before after" },
    { kind: "image", alt: "" },
  ]);
});

test("heading level: integer 1-6 kept; missing, out-of-range or non-integer defaults to 2", () => {
  const h = (attrs: unknown) => ({ type: "heading", attrs, content: [t("H")] });
  const doc = { type: "doc", content: [h({ level: 1 }), h({ level: 6 }), h({ level: 0 }), h({ level: 7 }), h({ level: 2.5 }), h(undefined), { type: "heading" }] };
  assert.deepEqual(
    tiptapToBlocks({ bodyJson: doc }).map((b) => (b.kind === "heading" ? [b.level, b.text] : b.kind)),
    [[1, "H"], [6, "H"], [2, "H"], [2, "H"], [2, "H"], [2, "H"], [2, ""]],
  );
});

test("defensive: non-object input, unknown nodes, non-array content and non-string text are skipped, never thrown", () => {
  for (const input of [undefined, null, 42, "doc", [], {}]) {
    assert.deepEqual(tiptapToBlocks({ bodyJson: input }), []);
  }
  const doc = {
    type: "doc",
    content: [
      null,
      7,
      "str",
      { type: "mystery", attrs: { level: 2 } },
      { type: "paragraph", content: "not-an-array" },
      { type: "paragraph", content: [{ type: "text", text: 5 }, null, t("ok")] },
      { type: "horizontalRule" },
      { type: "text", text: 9 },
      { content: [t("untyped container")] },
    ],
  };
  assert.deepEqual(tiptapToBlocks({ bodyJson: doc }), [
    { kind: "text", text: "" },
    { kind: "text", text: "ok" },
    { kind: "text", text: "untyped container" },
  ]);
});

test("the admin editor's leading `title` node is skipped: the title is analyzed separately, never as body text", () => {
  // apps/admin/src/features/posts/rules.ts withTitleNode prepends this node to every saved bodyJson.
  const doc = {
    type: "doc",
    content: [
      { type: "title", content: [t("My Post Title")] },
      { type: "paragraph", content: [t("Body.")] },
    ],
  };
  assert.deepEqual(tiptapToBlocks({ bodyJson: doc }), [{ kind: "text", text: "Body." }]);
});

test("a top-level array of nodes is accepted like a doc's content", () => {
  assert.deepEqual(tiptapToBlocks({ bodyJson: [{ type: "paragraph", content: [t("x")] }] }), [{ kind: "text", text: "x" }]);
});

test("defensive: a cyclic or absurdly deep tree stops at the depth cap instead of overflowing the stack", () => {
  const cyclic: { type: string; content: unknown[] } = { type: "blockquote", content: [] };
  cyclic.content.push(cyclic, { type: "paragraph", content: [t("found")] });
  const blocks = tiptapToBlocks({ bodyJson: { type: "doc", content: [cyclic] } });
  assert.ok(blocks.length > 0);
  assert.ok(blocks.every((b) => b.kind === "text" && b.text === "found"));

  let deep: unknown = { type: "paragraph", content: [t("bottom")] };
  for (let i = 0; i < 500; i += 1) deep = { type: "blockquote", content: [deep] };
  assert.deepEqual(tiptapToBlocks({ bodyJson: { type: "doc", content: [deep] } }), []);

  let deepInline: unknown = t("deep inline");
  for (let i = 0; i < 500; i += 1) deepInline = { type: "span", content: [deepInline] };
  assert.deepEqual(tiptapToBlocks({ bodyJson: { type: "paragraph", content: [deepInline] } }), [{ kind: "text", text: "" }]);
});

test("an inline image inside a heading follows the heading block", () => {
  const doc = { type: "doc", content: [{ type: "heading", attrs: { level: 3 }, content: [t("Logo "), { type: "mediaImage", attrs: { alt: "mark" } }] }] };
  assert.deepEqual(tiptapToBlocks({ bodyJson: doc }), [{ kind: "heading", level: 3, text: "Logo " }, { kind: "image", alt: "mark" }]);
});

test("a block-level text node without string text yields nothing", () => {
  assert.deepEqual(tiptapToBlocks({ bodyJson: { type: "doc", content: [{ type: "text", text: 7 }] } }), []);
});

test("a codeBlock is a text block", () => {
  assert.deepEqual(tiptapToBlocks({ bodyJson: [{ type: "codeBlock", content: [t("const a = 1;")] }] }), [{ kind: "text", text: "const a = 1;" }]);
});
