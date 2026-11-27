import { expect, it } from "vitest";
import { isLiveEditor } from "../live-tiptap-editor.js";

it("accepts a schema-bearing editor before the view mounts, but rejects a destroyed or absent editor", () => {
  expect(isLiveEditor({ editor: { schema: { nodes: {} }, isDestroyed: true } })).toBe(true);
  expect(isLiveEditor({ editor: { schema: null, isDestroyed: true } })).toBe(false);
  expect(isLiveEditor({ editor: null })).toBe(false);
  expect(isLiveEditor({ editor: undefined })).toBe(false);
});
